using Anxineers.Core;
using UnityEngine;

namespace Anxineers.Effects
{
    /// <summary>
    /// Global audio response: ambience swell, heartbeat that speeds up, a quiet high tone, and a low-pass
    /// muffle on the listener. Uses generated placeholder sounds. Every level has a hard Inspector limit.
    /// </summary>
    public class AudioEffect : EffectBase
    {
        [Header("Ambience")]
        [SerializeField, Range(0f, 1f)] private float ambienceBase = 0.05f;
        [SerializeField, Range(0f, 1f)] private float ambienceMax = 0.35f;

        [Header("Heartbeat")]
        [SerializeField, Range(0f, 1f)] private float heartbeatMaxVolume = 0.5f;
        [SerializeField, Range(40f, 120f)] private float bpmCalm = 60f;
        [SerializeField, Range(40f, 120f)] private float bpmMax = 100f;

        [Header("High tone (muffled / tinnitus-like)")]
        [Tooltip("The tone only starts above this effect value.")]
        [SerializeField, Range(0f, 1f)] private float toneStart = 0.5f;
        [Tooltip("Hard limit for the tone volume. Keep low.")]
        [SerializeField, Range(0f, 0.3f)] private float toneMaxVolume = 0.08f;
        [SerializeField, Range(1000f, 8000f)] private float toneHz = 4000f;

        [Header("Muffle (low-pass on the listener)")]
        [SerializeField] private bool lowPass = true;
        [SerializeField, Range(500f, 22000f)] private float lowPassMinHz = 3500f;

        [Header("Safety")]
        [Tooltip("Final scale on all generated sounds from this effect.")]
        [SerializeField, Range(0f, 1f)] private float masterVolume = 0.8f;

        private AudioSource ambience;
        private AudioSource beat;
        private AudioSource tone;
        private AudioClip beatClip;
        private AudioLowPassFilter filter;
        private float beatTimer;

        public override EffectKind Kind => EffectKind.Audio;

        protected override void OnEnable()
        {
            base.OnEnable();
            EnsureSources();
        }

        private void EnsureSources()
        {
            if (ambience != null)
            {
                return;
            }
            ambience = MakeSource("Ambience", ProceduralAudio.RumbleLoop(), true);
            tone = MakeSource("High Tone", ProceduralAudio.ToneLoop(toneHz), true);
            beatClip = ProceduralAudio.Heartbeat();
            beat = MakeSource("Heartbeat", beatClip, false);
            beat.volume = 1f; // one-shots are scaled per call
            ambience.Play();
            tone.Play();
        }

        private AudioSource MakeSource(string sourceName, AudioClip clip, bool loop)
        {
            var go = new GameObject(sourceName);
            go.transform.SetParent(transform, false);
            AudioSource src = go.AddComponent<AudioSource>();
            src.clip = clip;
            src.loop = loop;
            src.playOnAwake = false;
            src.spatialBlend = 0f;
            src.volume = 0f;
            return src;
        }

        protected override void Apply(float value, AnxietyDirector director, float deltaTime)
        {
            EnsureSources();
            float v = Mathf.Clamp01(value);

            ambience.volume = Mathf.Lerp(ambienceBase, ambienceMax, v) * masterVolume;

            float toneAmount = Mathf.InverseLerp(toneStart, 1f, v);
            tone.volume = toneAmount * toneMaxVolume * masterVolume;

            float interval = 60f / Mathf.Lerp(bpmCalm, bpmMax, v);
            beatTimer += deltaTime;
            if (beatTimer >= interval)
            {
                beatTimer = 0f;
                float volume = heartbeatMaxVolume * v * masterVolume;
                if (volume > 0.005f)
                {
                    beat.PlayOneShot(beatClip, volume);
                }
            }

            ApplyLowPass(v);
        }

        private void ApplyLowPass(float v)
        {
            if (!lowPass)
            {
                SetFilterCutoff(22000f);
                return;
            }
            if (filter == null)
            {
                AudioListener listener = FindFirstObjectByType<AudioListener>();
                if (listener == null)
                {
                    return;
                }
                filter = listener.GetComponent<AudioLowPassFilter>();
                if (filter == null)
                {
                    filter = listener.gameObject.AddComponent<AudioLowPassFilter>();
                }
            }
            filter.cutoffFrequency = Mathf.Lerp(22000f, lowPassMinHz, v);
        }

        private void SetFilterCutoff(float hz)
        {
            if (filter != null)
            {
                filter.cutoffFrequency = hz;
            }
        }

        protected override void ResetEffect()
        {
            if (ambience != null) ambience.volume = 0f;
            if (tone != null) tone.volume = 0f;
            SetFilterCutoff(22000f);
            beatTimer = 0f;
        }
    }
}
