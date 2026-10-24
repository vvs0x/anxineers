using UnityEngine;

namespace Anxineers.Effects
{
    /// <summary>
    /// Generates simple placeholder clips in code so effects can be tuned before real sound design exists.
    /// Loops are built from whole numbers of sine cycles, so they repeat without clicks.
    /// </summary>
    public static class ProceduralAudio
    {
        private const int SampleRate = 24000;

        /// <summary>Soft low rumble, 4 s seamless loop.</summary>
        public static AudioClip RumbleLoop()
        {
            const float duration = 4f;
            int count = (int)(SampleRate * duration);
            var data = new float[count];
            var rng = new System.Random(7);
            for (int i = 0; i < 60; i++)
            {
                double freq = System.Math.Exp(System.Math.Log(40.0) + rng.NextDouble() * (System.Math.Log(600.0) - System.Math.Log(40.0)));
                freq = System.Math.Max(1.0, System.Math.Round(freq * duration)) / duration;
                double phase = rng.NextDouble() * System.Math.PI * 2.0;
                float amp = (float)(1.0 / System.Math.Sqrt(freq));
                for (int s = 0; s < count; s++)
                {
                    data[s] += amp * (float)System.Math.Sin(2.0 * System.Math.PI * freq * s / SampleRate + phase);
                }
            }
            return Build("Rumble", data, true);
        }

        /// <summary>Pure high tone, 1 s seamless loop.</summary>
        public static AudioClip ToneLoop(float frequencyHz)
        {
            int cycles = Mathf.Max(1, Mathf.RoundToInt(frequencyHz));
            int count = SampleRate;
            var data = new float[count];
            for (int s = 0; s < count; s++)
            {
                data[s] = (float)System.Math.Sin(2.0 * System.Math.PI * cycles * s / count);
            }
            return Build("Tone" + cycles, data, false);
        }

        /// <summary>Warm drone for gaze targets, 2 s seamless loop.</summary>
        public static AudioClip DroneLoop(float baseHz = 110f)
        {
            const float duration = 2f;
            int count = (int)(SampleRate * duration);
            var data = new float[count];
            float[] ratios = { 1f, 1.5f, 2f };
            float[] amps = { 1f, 0.5f, 0.3f };
            for (int k = 0; k < ratios.Length; k++)
            {
                float freq = Mathf.Round(baseHz * ratios[k] * duration) / duration;
                for (int s = 0; s < count; s++)
                {
                    data[s] += amps[k] * Mathf.Sin(2f * Mathf.PI * freq * s / SampleRate);
                }
            }
            return Build("Drone", data, true);
        }

        /// <summary>Soft rising chime, 0.8 s. Used as confirmation feedback.</summary>
        public static AudioClip Chime(float frequencyHz = 660f)
        {
            int count = (int)(SampleRate * 0.8f);
            var data = new float[count];
            for (int s = 0; s < count; s++)
            {
                float t = (float)s / SampleRate;
                float envelope = Mathf.Exp(-t * 5f) * Mathf.Clamp01(t * 80f);
                float tone = Mathf.Sin(2f * Mathf.PI * frequencyHz * t) + 0.35f * Mathf.Sin(2f * Mathf.PI * frequencyHz * 2f * t);
                data[s] = tone * envelope;
            }
            return Build("Chime", data, true);
        }

        /// <summary>Two soft thumps, about 0.7 s.</summary>
        public static AudioClip Heartbeat()
        {
            int count = (int)(SampleRate * 0.7f);
            var data = new float[count];
            AddThump(data, 0f, 1f);
            AddThump(data, 0.26f, 0.7f);
            return Build("Heartbeat", data, true);
        }

        private static void AddThump(float[] data, float startSeconds, float gain)
        {
            int start = (int)(startSeconds * SampleRate);
            int length = (int)(0.22f * SampleRate);
            for (int i = 0; i < length && start + i < data.Length; i++)
            {
                float t = (float)i / SampleRate;
                float envelope = Mathf.Exp(-t * 22f) * Mathf.Clamp01(t * 200f);
                data[start + i] += gain * envelope * Mathf.Sin(2f * Mathf.PI * 55f * t);
            }
        }

        private static AudioClip Build(string name, float[] data, bool normalize)
        {
            if (normalize)
            {
                float peak = 0.0001f;
                for (int i = 0; i < data.Length; i++)
                {
                    peak = Mathf.Max(peak, Mathf.Abs(data[i]));
                }
                for (int i = 0; i < data.Length; i++)
                {
                    data[i] = data[i] / peak * 0.9f;
                }
            }
            else
            {
                for (int i = 0; i < data.Length; i++)
                {
                    data[i] *= 0.9f;
                }
            }
            AudioClip clip = AudioClip.Create(name, data.Length, 1, SampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }
    }
}
