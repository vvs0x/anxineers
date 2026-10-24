using Anxineers.Core;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Anxineers.Effects
{
    /// <summary>
    /// Desaturation and a cooler color temperature via the URP volume, plus optional slow light flicker.
    /// Flicker is off by default and hard-limited to 3 Hz and a small amplitude.
    /// </summary>
    public class LightEffect : EffectBase
    {
        [Header("Color")]
        [Tooltip("Saturation removed at full effect value, in percent.")]
        [SerializeField, Range(0f, 100f)] private float maxDesaturation = 60f;

        [Tooltip("Temperature shift at full effect value. Negative values are cooler, so this is applied as cooler.")]
        [SerializeField, Range(0f, 100f)] private float maxCoolShift = 30f;

        [Header("Flicker (off by default)")]
        [SerializeField] private Light[] flickerLights;

        [Tooltip("0 = no flicker. Keep small, never above 0.4.")]
        [SerializeField, Range(0f, 0.4f)] private float flickerAmount = 0f;

        [Tooltip("Hz, capped at 3 to stay well below photosensitivity thresholds.")]
        [SerializeField, Range(0.2f, 3f)] private float flickerHz = 1.5f;

        private ColorAdjustments colorAdjustments;
        private WhiteBalance whiteBalance;
        private float[] baseIntensity;

        public override EffectKind Kind => EffectKind.Light;

        protected override void OnEnable()
        {
            base.OnEnable();
            CaptureLights();
        }

        protected override void OnDisable()
        {
            base.OnDisable();
            baseIntensity = null;
        }

        private void CaptureLights()
        {
            if (flickerLights == null)
            {
                return;
            }
            baseIntensity = new float[flickerLights.Length];
            for (int i = 0; i < flickerLights.Length; i++)
            {
                baseIntensity[i] = flickerLights[i] != null ? flickerLights[i].intensity : 0f;
            }
        }

        protected override void Apply(float value, AnxietyDirector director, float deltaTime)
        {
            if (colorAdjustments == null || whiteBalance == null)
            {
                PostFxVolume fx = PostFxVolume.GetOrCreate();
                colorAdjustments = fx.Get<ColorAdjustments>();
                whiteBalance = fx.Get<WhiteBalance>();
            }

            colorAdjustments.saturation.Override(-value * maxDesaturation);
            whiteBalance.temperature.Override(-value * maxCoolShift);

            if (flickerLights == null || baseIntensity == null || flickerAmount <= 0f)
            {
                return;
            }

            float wave = 0.5f + 0.5f * Mathf.Sin(2f * Mathf.PI * flickerHz * Time.time);
            float factor = 1f - flickerAmount * value * wave;
            for (int i = 0; i < flickerLights.Length && i < baseIntensity.Length; i++)
            {
                if (flickerLights[i] != null)
                {
                    flickerLights[i].intensity = baseIntensity[i] * factor;
                }
            }
        }

        protected override void ResetEffect()
        {
            if (colorAdjustments != null)
            {
                colorAdjustments.saturation.Override(0f);
            }
            if (whiteBalance != null)
            {
                whiteBalance.temperature.Override(0f);
            }
            if (flickerLights != null && baseIntensity != null)
            {
                for (int i = 0; i < flickerLights.Length && i < baseIntensity.Length; i++)
                {
                    if (flickerLights[i] != null)
                    {
                        flickerLights[i].intensity = baseIntensity[i];
                    }
                }
            }
        }
    }
}
