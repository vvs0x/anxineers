using Anxineers.Core;
using UnityEngine;

namespace Anxineers.Effects
{
    /// <summary>
    /// Shared base for effect modules. Registers with the director, smooths the drive using the profile's
    /// rise/fall speeds, shapes it with the profile's curve and max, and calls <see cref="Apply"/>.
    /// Every effect can be switched off with the checkbox; it then returns to neutral.
    /// </summary>
    public abstract class EffectBase : MonoBehaviour, IAnxietyEffect
    {
        [Header("Effect")]
        [SerializeField] private bool effectEnabled = true;

        [Tooltip("Let the strongest gaze value in the scene raise this effect (scaled by the profile's gaze weight).")]
        [SerializeField] private bool useGlobalGaze = true;

        [Header("Live values (read-only in Play Mode)")]
        [SerializeField] private float liveDrive;
        [SerializeField] private float liveValue;

        private AnxietyDirector registeredWith;
        private float smoothed;
        private bool wasActive;

        public abstract EffectKind Kind { get; }

        public bool Enabled => effectEnabled;

        /// <summary>Smoothed drive 0..1 (intensity plus gaze, capped).</summary>
        public float Drive => smoothed;

        /// <summary>Shaped value 0..profile max, after the response curve.</summary>
        public float Value { get; private set; }

        protected virtual void OnEnable()
        {
            TryRegister();
        }

        protected virtual void OnDisable()
        {
            if (registeredWith != null)
            {
                registeredWith.Unregister(this);
            }
            registeredWith = null;
            ReturnToNeutral();
        }

        private void Update()
        {
            TryRegister();
            if (wasActive && !effectEnabled)
            {
                ReturnToNeutral();
            }
        }

        public void Tick(AnxietyDirector director, float gaze01, float deltaTime)
        {
            wasActive = true;
            EffectSettings settings = director.GetSettings(Kind);
            float target = director.Drive(Kind, useGlobalGaze ? gaze01 : 0f);
            smoothed = settings.Step(smoothed, target, deltaTime);
            Value = director.Shape(Kind, smoothed);
            liveDrive = smoothed;
            liveValue = Value;
            Apply(Value, director, deltaTime);
        }

        /// <summary>Apply the shaped value (0..profile max) to the scene.</summary>
        protected abstract void Apply(float value, AnxietyDirector director, float deltaTime);

        /// <summary>Restore the scene to its untouched look.</summary>
        protected abstract void ResetEffect();

        /// <summary>Value for a specific gaze amount, without smoothing. For per-object effects.</summary>
        protected float Evaluate(AnxietyDirector director, float gaze01)
        {
            return director.Shape(Kind, director.Drive(Kind, gaze01));
        }

        private void ReturnToNeutral()
        {
            smoothed = 0f;
            Value = 0f;
            liveDrive = 0f;
            liveValue = 0f;
            wasActive = false;
            ResetEffect();
        }

        private void TryRegister()
        {
            AnxietyDirector current = AnxietyDirector.Instance;
            if (current == registeredWith)
            {
                return;
            }
            if (registeredWith != null)
            {
                registeredWith.Unregister(this);
            }
            registeredWith = current;
            if (registeredWith != null)
            {
                registeredWith.Register(this);
            }
        }
    }
}
