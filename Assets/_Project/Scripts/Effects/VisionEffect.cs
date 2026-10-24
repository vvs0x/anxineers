using Anxineers.Core;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Anxineers.Effects
{
    /// <summary>
    /// Tunnel narrowing via a URP vignette, with a very slow, small breathing of the vignette edge.
    /// Only a screen-space overlay: the camera, horizon and head tracking are never touched.
    /// </summary>
    public class VisionEffect : EffectBase
    {
        [Header("Vignette")]
        [Tooltip("Vignette intensity at full effect value.")]
        [SerializeField, Range(0f, 1f)] private float maxIntensity = 0.55f;

        [SerializeField, Range(0.01f, 1f)] private float smoothness = 0.45f;

        [Header("Edge breathing (kept subtle on purpose)")]
        [Tooltip("Added to the vignette intensity, scaled by the effect value.")]
        [SerializeField, Range(0f, 0.1f)] private float breathAmplitude = 0.03f;

        [Tooltip("Breaths per second. 0.12 is about 7 per minute. Capped to a slow range.")]
        [SerializeField, Range(0.05f, 0.3f)] private float breathHz = 0.12f;

        private Vignette vignette;

        public override EffectKind Kind => EffectKind.Vision;

        private Vignette GetVignette()
        {
            if (vignette == null)
            {
                vignette = PostFxVolume.GetOrCreate().Get<Vignette>();
                vignette.color.Override(Color.black);
                vignette.rounded.Override(true);
            }
            return vignette;
        }

        protected override void Apply(float value, AnxietyDirector director, float deltaTime)
        {
            Vignette v = GetVignette();
            float breath = Mathf.Sin(2f * Mathf.PI * breathHz * Time.time) * breathAmplitude * value;
            v.intensity.Override(Mathf.Clamp01(value * maxIntensity + breath));
            v.smoothness.Override(smoothness);
        }

        protected override void ResetEffect()
        {
            if (vignette != null)
            {
                vignette.intensity.Override(0f);
            }
        }
    }
}
