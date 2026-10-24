using System;
using System.Collections.Generic;
using UnityEngine;

namespace Anxineers.Core
{
    /// <summary>
    /// Single source of truth for the experience. Holds the global intensity (0..1), a state machine
    /// (Calm, Build, Peak, Recovery), smoothing, and a hard user-controlled intensity cap.
    /// Effects read from here, GazeTargets report into it, nothing else owns intensity.
    /// </summary>
    [DefaultExecutionOrder(-50)]
    public class AnxietyDirector : MonoBehaviour
    {
        public static AnxietyDirector Instance { get; private set; }

        [SerializeField] private AnxietyProfile profile;
        [SerializeField] private AnxietyState startState = AnxietyState.Calm;

        [Tooltip("Advance Build to Peak to Recovery to Calm automatically using the profile timeline.")]
        [SerializeField] private bool autoAdvance = true;

        [Tooltip("Hard upper limit for intensity and every effect drive. Set before the session, 0..1.")]
        [SerializeField, Range(0f, 1f)] private float intensityCap = 1f;

        private readonly List<IAnxietyEffect> effects = new List<IAnxietyEffect>();
        private float frameGaze;
        private float timeInState;
        private bool calmNowActive;
        private float? targetOverride;
        private float overrideSpeed = 0.1f;

        public AnxietyState State { get; private set; }

        /// <summary>Smoothed intensity before the cap is applied.</summary>
        public float RawIntensity { get; private set; }

        /// <summary>Where the current state is steering the intensity.</summary>
        public float TargetIntensity { get; private set; }

        /// <summary>Final intensity, never above the cap. Effects should use this.</summary>
        public float Intensity => Mathf.Min(RawIntensity, intensityCap);

        /// <summary>Strongest GazeTarget value reported last frame, 0..1.</summary>
        public float GlobalGaze { get; private set; }

        public float IntensityCap => intensityCap;

        public float TimeInState => timeInState;

        public AnxietyProfile Profile => profile;

        public bool CalmNowActive => calmNowActive;

        /// <summary>True while a guided exercise is steering the intensity instead of the state timeline.</summary>
        public bool HasTargetOverride => targetOverride.HasValue;

        public bool AutoAdvance
        {
            get => autoAdvance;
            set => autoAdvance = value;
        }

        public event Action<AnxietyState> StateChanged;

        /// <summary>Raised when the user asks for the emergency calm-down. Phase 4 starts breathing from this.</summary>
        public event Action CalmNowRequested;

        private void Awake()
        {
            State = startState;
            if (profile == null)
            {
                Debug.LogWarning("[Anxineers] AnxietyDirector has no profile, using built-in defaults.", this);
                profile = ScriptableObject.CreateInstance<AnxietyProfile>();
                profile.ResetToDefaults();
            }
        }

        private void OnEnable()
        {
            if (Instance != null && Instance != this)
            {
                Debug.LogWarning("[Anxineers] More than one AnxietyDirector in the scene.", this);
            }
            Instance = this;
        }

        private void OnDisable()
        {
            if (Instance == this)
            {
                Instance = null;
            }
        }

        // ---- Control API ----------------------------------------------------------------------------------------

        public void SetState(AnxietyState state)
        {
            targetOverride = null;
            SetStateInternal(state, false);
        }

        /// <summary>
        /// Lets a guided exercise (grounding, breathing) steer the intensity toward a level at a given speed
        /// (intensity units per second). The state timeline pauses until <see cref="ClearTargetOverride"/>.
        /// </summary>
        public void SetTargetOverride(float target01, float speedPerSecond)
        {
            targetOverride = Mathf.Clamp01(target01);
            overrideSpeed = Mathf.Max(0.01f, speedPerSecond);
        }

        public void ClearTargetOverride()
        {
            targetOverride = null;
        }

        /// <summary>Instant user safety action: ramps intensity down quickly and announces itself.</summary>
        public void CalmNow()
        {
            targetOverride = null;
            SetStateInternal(AnxietyState.Recovery, true);
            CalmNowRequested?.Invoke();
        }

        public void SetIntensityCap(float cap)
        {
            intensityCap = Mathf.Clamp01(cap);
        }

        public void SetProfile(AnxietyProfile newProfile)
        {
            if (newProfile != null)
            {
                profile = newProfile;
            }
        }

        public void Register(IAnxietyEffect effect)
        {
            if (effect != null && !effects.Contains(effect))
            {
                effects.Add(effect);
            }
        }

        public void Unregister(IAnxietyEffect effect)
        {
            effects.Remove(effect);
        }

        /// <summary>Called by GazeTargets every frame. The strongest value wins.</summary>
        public void ReportGaze(float value01)
        {
            frameGaze = Mathf.Max(frameGaze, Mathf.Clamp01(value01));
        }

        // ---- Helpers for effects --------------------------------------------------------------------------------

        /// <summary>Intensity plus weighted gaze, clamped to the cap. Smooth this with EffectSettings.Step.</summary>
        public float Drive(EffectKind kind, float gaze01)
        {
            EffectSettings settings = profile.GetEffect(kind);
            float drive = Intensity + settings.gazeWeight * Mathf.Clamp01(gaze01);
            return Mathf.Min(Mathf.Clamp01(drive), intensityCap);
        }

        /// <summary>Applies the effect's response curve and max value to a drive value.</summary>
        public float Shape(EffectKind kind, float drive01)
        {
            EffectSettings settings = profile.GetEffect(kind);
            float curved = Mathf.Clamp01(settings.response.Evaluate(Mathf.Clamp01(drive01)));
            return curved * settings.maxValue;
        }

        public EffectSettings GetSettings(EffectKind kind)
        {
            return profile.GetEffect(kind);
        }

        // ---- Update ---------------------------------------------------------------------------------------------

        private void LateUpdate()
        {
            float dt = Time.deltaTime;
            timeInState += dt;

            GlobalGaze = frameGaze;
            frameGaze = 0f;

            float calm = profile.CalmIntensity;
            float peak = Mathf.Max(profile.PeakIntensity, calm);
            float span = Mathf.Max(0.1f, peak - calm);
            float speed;

            switch (State)
            {
                case AnxietyState.Build:
                    TargetIntensity = peak;
                    speed = span / profile.BuildSeconds;
                    break;
                case AnxietyState.Peak:
                    TargetIntensity = peak;
                    speed = profile.SettleSpeed;
                    break;
                case AnxietyState.Recovery:
                    TargetIntensity = calm;
                    speed = span / (calmNowActive ? profile.CalmNowSeconds : profile.RecoverySeconds);
                    break;
                default:
                    TargetIntensity = calm;
                    speed = profile.SettleSpeed;
                    break;
            }

            if (targetOverride.HasValue)
            {
                TargetIntensity = Mathf.Max(calm, targetOverride.Value);
                speed = overrideSpeed;
            }

            RawIntensity = Mathf.MoveTowards(RawIntensity, TargetIntensity, speed * dt);
            if (!targetOverride.HasValue)
            {
                AdvanceIfNeeded(calm, peak);
            }

            for (int i = 0; i < effects.Count; i++)
            {
                IAnxietyEffect effect = effects[i];
                if (effect != null && effect.Enabled)
                {
                    effect.Tick(this, GlobalGaze, dt);
                }
            }
        }

        private void AdvanceIfNeeded(float calm, float peak)
        {
            if (!autoAdvance)
            {
                return;
            }

            switch (State)
            {
                case AnxietyState.Build when RawIntensity >= peak - 0.005f:
                    SetStateInternal(AnxietyState.Peak, false);
                    break;
                case AnxietyState.Peak when profile.PeakHoldSeconds > 0f && timeInState >= profile.PeakHoldSeconds:
                    SetStateInternal(AnxietyState.Recovery, false);
                    break;
                case AnxietyState.Recovery when RawIntensity <= calm + 0.005f:
                    SetStateInternal(AnxietyState.Calm, false);
                    break;
            }
        }

        private void SetStateInternal(AnxietyState state, bool calmNow)
        {
            bool changed = state != State;
            State = state;
            calmNowActive = calmNow && state == AnxietyState.Recovery;
            timeInState = 0f;
            if (changed)
            {
                StateChanged?.Invoke(state);
            }
        }
    }
}
