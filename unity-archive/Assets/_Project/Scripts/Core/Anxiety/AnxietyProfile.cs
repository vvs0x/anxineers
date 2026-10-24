using System;
using UnityEngine;

namespace Anxineers.Core
{
    /// <summary>Per-effect tuning. Everything here is meant to be edited in the Inspector, no code needed.</summary>
    [Serializable]
    public class EffectSettings
    {
        public EffectKind kind;

        [Tooltip("Upper bound of the effect, 0..1. Scales the final value.")]
        [Range(0f, 1f)] public float maxValue = 1f;

        [Tooltip("Response curve: x = drive 0..1, y = effect strength 0..1.")]
        public AnimationCurve response = AnimationCurve.Linear(0f, 0f, 1f, 1f);

        [Tooltip("How fast the drive may rise, in drive units per second.")]
        [Min(0f)] public float riseSpeed = 0.5f;

        [Tooltip("How fast the drive may fall, in drive units per second.")]
        [Min(0f)] public float fallSpeed = 0.8f;

        [Tooltip("How much looking at a GazeTarget adds to this effect, 0..1.")]
        [Range(0f, 1f)] public float gazeWeight = 0.5f;

        public EffectSettings(EffectKind kind, float maxValue, float gazeWeight)
        {
            this.kind = kind;
            this.maxValue = maxValue;
            this.gazeWeight = gazeWeight;
        }

        /// <summary>Moves a smoothed value toward a target using this effect's rise and fall speeds.</summary>
        public float Step(float current, float target, float deltaTime)
        {
            float speed = target > current ? riseSpeed : fallSpeed;
            return Mathf.MoveTowards(current, target, speed * deltaTime);
        }
    }

    /// <summary>
    /// A complete tuning set: session timeline plus per-effect settings. Duplicate it in the Project window to
    /// make variants such as "Education light", "Education strong" and "Regulation gentle", then swap at runtime.
    /// </summary>
    [CreateAssetMenu(menuName = "Anxineers/Anxiety Profile", fileName = "AnxietyProfile")]
    public class AnxietyProfile : ScriptableObject
    {
        [Header("Timeline")]
        [Tooltip("Intensity the session rests at in the Calm state.")]
        [SerializeField, Range(0f, 1f)] private float calmIntensity = 0f;

        [Tooltip("Intensity reached in Peak.")]
        [SerializeField, Range(0f, 1f)] private float peakIntensity = 0.8f;

        [Tooltip("Seconds to go from calm to peak.")]
        [SerializeField, Min(0.1f)] private float buildSeconds = 60f;

        [Tooltip("Seconds to stay at peak before recovery starts. 0 = stay until changed manually.")]
        [SerializeField, Min(0f)] private float peakHoldSeconds = 20f;

        [Tooltip("Seconds to go from peak back to calm.")]
        [SerializeField, Min(0.1f)] private float recoverySeconds = 40f;

        [Tooltip("Seconds for the emergency 'calm now' ramp down.")]
        [SerializeField, Min(0.1f)] private float calmNowSeconds = 6f;

        [Tooltip("Speed used to settle in Calm and Peak, intensity units per second.")]
        [SerializeField, Min(0.01f)] private float settleSpeed = 0.25f;

        [Header("Effects")]
        [SerializeField] private EffectSettings[] effects;

        public float CalmIntensity => calmIntensity;
        public float PeakIntensity => peakIntensity;
        public float BuildSeconds => buildSeconds;
        public float PeakHoldSeconds => peakHoldSeconds;
        public float RecoverySeconds => recoverySeconds;
        public float CalmNowSeconds => calmNowSeconds;
        public float SettleSpeed => settleSpeed;

        private void Reset()
        {
            ResetToDefaults();
        }

        private void OnValidate()
        {
            if (effects == null || effects.Length != Enum.GetValues(typeof(EffectKind)).Length)
            {
                ResetToDefaults();
            }
        }

        /// <summary>Settings for one effect. Returns a neutral default if the profile has none.</summary>
        public EffectSettings GetEffect(EffectKind kind)
        {
            if (effects != null)
            {
                foreach (EffectSettings settings in effects)
                {
                    if (settings != null && settings.kind == kind)
                    {
                        return settings;
                    }
                }
            }
            return new EffectSettings(kind, 1f, 0.5f);
        }

        public void Configure(float peak, float build, float hold, float recovery)
        {
            peakIntensity = Mathf.Clamp01(peak);
            buildSeconds = Mathf.Max(0.1f, build);
            peakHoldSeconds = Mathf.Max(0f, hold);
            recoverySeconds = Mathf.Max(0.1f, recovery);
        }

        /// <param name="effectScale">Scales every effect's max value, 0..1.</param>
        public void ResetToDefaults(float effectScale = 1f)
        {
            float s = Mathf.Clamp01(effectScale);
            effects = new[]
            {
                new EffectSettings(EffectKind.Space, s, 0.4f),
                new EffectSettings(EffectKind.Vision, s, 0.5f),
                new EffectSettings(EffectKind.Audio, s, 0.5f),
                new EffectSettings(EffectKind.Light, s, 0.3f),
                new EffectSettings(EffectKind.Objects, s, 0.8f),
            };
        }
    }
}
