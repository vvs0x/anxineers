using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;
#if UNITY_ANDROID
using UnityEngine.Android;
#endif

namespace Anxineers.Voice
{
    public enum VoiceMode
    {
        /// <summary>ElevenLabs when a key and a microphone exist, otherwise Manual.</summary>
        Auto,
        ElevenLabs,
        /// <summary>Editor and offline fallback: press Enter once per spoken item.</summary>
        Manual,
    }

    public enum VoiceState
    {
        Idle,
        Listening,
        Processing,
    }

    /// <summary>
    /// Listens for a spoken answer and returns the transcript. ElevenLabs mode records the microphone until the user
    /// stops talking, then sends the clip to the ElevenLabs speech-to-text API (model scribe_v2).
    /// PRIVACY: this sends user speech to a third party. It needs consent wording and a data-protection review.
    /// Transcripts are only written to the Console in the editor and development builds.
    /// </summary>
    public class VoiceInput : MonoBehaviour
    {
        private const string Endpoint = "https://api.elevenlabs.io/v1/speech-to-text";
        private const int SampleRate = 16000;

        [SerializeField] private VoiceMode mode = VoiceMode.Auto;

        [Tooltip("Optional language hint such as 'en' or 'de'. Empty = automatic detection.")]
        [SerializeField] private string languageCode = string.Empty;

        [Tooltip("Stop listening this long after the user stops talking.")]
        [SerializeField, Range(0.5f, 4f)] private float silenceSeconds = 1.6f;

        [Tooltip("Microphone level that counts as speech.")]
        [SerializeField, Range(0.002f, 0.1f)] private float speechThreshold = 0.015f;

        [SerializeField] private string modelId = "scribe_v2";

        private int currentRequest;
        private bool micBusy;

        public bool IsListening { get; private set; }

        public VoiceState State { get; private set; }

        /// <summary>Live microphone level 0..1, for a level meter. Zero outside ElevenLabs listening.</summary>
        public float Level { get; private set; }

        /// <summary>True once the user has started speaking in the current listen.</summary>
        public bool SpeechDetected { get; private set; }

        /// <summary>The mode that will actually be used right now.</summary>
        public VoiceMode ActiveMode
        {
            get
            {
                if (mode != VoiceMode.Auto)
                {
                    return mode;
                }
                bool hasKey = VoiceKeys.GetElevenLabsKey() != null;
                bool hasMic = Microphone.devices.Length > 0;
                return hasKey && hasMic ? VoiceMode.ElevenLabs : VoiceMode.Manual;
            }
        }

        /// <summary>Starts listening. The callback is called once, on the main thread.</summary>
        public void Listen(float maxSeconds, Action<SpeechResult> onResult)
        {
            currentRequest++;
            StartCoroutine(ListenRoutine(currentRequest, Mathf.Clamp(maxSeconds, 2f, 30f), onResult));
        }

        /// <summary>Cancels the running request. Its callback still fires, with a failed result.</summary>
        public void Cancel()
        {
            currentRequest++;
            IsListening = false;
            State = VoiceState.Idle;
            Level = 0f;
            SpeechDetected = false;
        }

        private IEnumerator ListenRoutine(int id, float maxSeconds, Action<SpeechResult> onResult)
        {
            // Wait until a cancelled recording has released the microphone.
            while (micBusy)
            {
                yield return null;
            }

            if (id != currentRequest)
            {
                onResult?.Invoke(SpeechResult.Fail("cancelled"));
                yield break;
            }

            IsListening = true;
            State = VoiceState.Listening;
            Level = 0f;
            SpeechDetected = false;
            SpeechResult result = default;
            VoiceMode active = ActiveMode;

            IEnumerator inner = active == VoiceMode.ElevenLabs
                ? ElevenLabsRoutine(id, maxSeconds, r => result = r)
                : ManualRoutine(id, maxSeconds, r => result = r);
            yield return inner;

            bool cancelled = id != currentRequest;
            if (!cancelled)
            {
                IsListening = false;
                State = VoiceState.Idle;
                Level = 0f;
                SpeechDetected = false;
            }
            onResult?.Invoke(cancelled ? SpeechResult.Fail("cancelled") : result);
        }

        // ---- Manual fallback -----------------------------------------------------------------------------------

        private IEnumerator ManualRoutine(int id, float maxSeconds, Action<SpeechResult> done)
        {
            float end = Time.unscaledTime + maxSeconds;
            while (Time.unscaledTime < end && id == currentRequest)
            {
                if (ManualKeyPressed())
                {
                    done(SpeechResult.Ok("item"));
                    yield break;
                }
                yield return null;
            }
            done(SpeechResult.Fail("timeout"));
        }

        private static bool ManualKeyPressed()
        {
            var keyboard = UnityEngine.InputSystem.Keyboard.current;
            return keyboard != null && keyboard.enterKey.wasPressedThisFrame;
        }

        // ---- ElevenLabs ----------------------------------------------------------------------------------------

        private IEnumerator ElevenLabsRoutine(int id, float maxSeconds, Action<SpeechResult> done)
        {
            string key = VoiceKeys.GetElevenLabsKey();
            if (key == null)
            {
                done(SpeechResult.Fail("no ElevenLabs key"));
                yield break;
            }

#if UNITY_ANDROID
            if (!Permission.HasUserAuthorizedPermission(Permission.Microphone))
            {
                Permission.RequestUserPermission(Permission.Microphone);
                float wait = 0f;
                while (!Permission.HasUserAuthorizedPermission(Permission.Microphone) && wait < 15f)
                {
                    wait += Time.unscaledDeltaTime;
                    yield return null;
                }
                if (!Permission.HasUserAuthorizedPermission(Permission.Microphone))
                {
                    done(SpeechResult.Fail("microphone permission denied"));
                    yield break;
                }
            }
#endif

            int lengthSeconds = Mathf.CeilToInt(maxSeconds);
            micBusy = true;
            AudioClip clip = Microphone.Start(null, false, lengthSeconds, SampleRate);
            float startWait = 0f;
            while (Microphone.GetPosition(null) <= 0 && startWait < 3f)
            {
                startWait += Time.unscaledDeltaTime;
                yield return null;
            }
            if (Microphone.GetPosition(null) <= 0)
            {
                Microphone.End(null);
                micBusy = false;
                done(SpeechResult.Fail("microphone did not start"));
                yield break;
            }

            var chunk = new float[2048];
            int readPos = 0;
            bool speechStarted = false;
            float lastLoud = 0f;
            float speechTime = 0f;
            float elapsed = 0f;

            while (id == currentRequest)
            {
                elapsed += Time.unscaledDeltaTime;
                int pos = Microphone.GetPosition(null);
                bool bufferFull = pos <= 0 || pos >= clip.samples;

                float frameRms = 0f;
                int available = Mathf.Max(0, (bufferFull ? clip.samples : pos) - readPos);
                while (available > 0)
                {
                    int n = Mathf.Min(available, chunk.Length);
                    if (n < chunk.Length)
                    {
                        chunk = new float[n];
                    }
                    clip.GetData(chunk, readPos);
                    float sum = 0f;
                    for (int i = 0; i < n; i++)
                    {
                        sum += chunk[i] * chunk[i];
                    }
                    float rms = Mathf.Sqrt(sum / n);
                    frameRms = Mathf.Max(frameRms, rms);
                    if (rms > speechThreshold)
                    {
                        speechStarted = true;
                        lastLoud = elapsed;
                        speechTime += (float)n / SampleRate;
                    }
                    readPos += n;
                    available -= n;
                    if (chunk.Length != 2048)
                    {
                        chunk = new float[2048];
                    }
                }

                Level = Mathf.Lerp(Level, Mathf.Clamp01(frameRms / (speechThreshold * 6f)), 0.35f);
                SpeechDetected = speechStarted;

                if (speechStarted && elapsed - lastLoud > silenceSeconds)
                {
                    break;
                }
                if (bufferFull || elapsed >= maxSeconds)
                {
                    break;
                }
                yield return null;
            }

            int endPos = Mathf.Clamp(Microphone.GetPosition(null), 0, clip.samples);
            if (endPos <= 0)
            {
                endPos = readPos;
            }
            Microphone.End(null);
            micBusy = false;

            if (id != currentRequest)
            {
                done(SpeechResult.Fail("cancelled"));
                yield break;
            }
            if (!speechStarted || speechTime < 0.3f || endPos < SampleRate / 4)
            {
                done(SpeechResult.Fail("no speech"));
                yield break;
            }

            State = VoiceState.Processing;
            Level = 0f;

            var samples = new float[endPos];
            clip.GetData(samples, 0);
            byte[] wav = WavEncoder.Encode(samples, SampleRate);

            var form = new List<IMultipartFormSection>
            {
                new MultipartFormDataSection("model_id", modelId),
                new MultipartFormDataSection("tag_audio_events", "false"),
                new MultipartFormFileSection("file", wav, "speech.wav", "audio/wav"),
            };
            if (!string.IsNullOrWhiteSpace(languageCode))
            {
                form.Add(new MultipartFormDataSection("language_code", languageCode.Trim()));
            }

            using (UnityWebRequest request = UnityWebRequest.Post(Endpoint, form))
            {
                request.SetRequestHeader("xi-api-key", key);
                request.timeout = 30;
                yield return request.SendWebRequest();

                if (request.result != UnityWebRequest.Result.Success)
                {
                    string body = request.downloadHandler != null ? request.downloadHandler.text : string.Empty;
                    done(SpeechResult.Fail("ElevenLabs " + request.responseCode + " " + request.error + " " + body));
                    yield break;
                }

                TranscriptResponse response = JsonUtility.FromJson<TranscriptResponse>(request.downloadHandler.text);
                string text = response != null ? response.text : string.Empty;
                if (Application.isEditor || Debug.isDebugBuild)
                {
                    Debug.Log("[Anxineers] Heard: " + text);
                }
                done(SpeechResult.Ok(text));
            }
        }

        [Serializable]
        private class TranscriptResponse
        {
            public string text;
        }
    }
}
