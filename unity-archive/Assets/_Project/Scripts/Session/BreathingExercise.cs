using System;
using Anxineers.Core;
using UnityEngine;

namespace Anxineers.Session
{
    public enum BreathPhase
    {
        Idle,
        Inhale,
        Hold,
        Exhale,
    }

    /// <summary>
    /// Short guided breathing (default 3 breaths, 4 s in, 6 s out). Exposes the phase and a 0..1 expansion value for the
    /// visual and audio pacer, and lowers the director's intensity a little with each completed breath.
    /// </summary>
    public class BreathingExercise : MonoBehaviour
    {
        [SerializeField, Range(1f, 12f)] private float inhaleSeconds = 4f;
        [Tooltip("Pause after the inhale. 0 = none.")]
        [SerializeField, Range(0f, 8f)] private float holdSeconds = 0f;
        [SerializeField, Range(1f, 12f)] private float exhaleSeconds = 6f;
        [SerializeField, Min(1)] private int breaths = 3;

        [Header("Intensity")]
        [SerializeField] private bool lowerIntensity = true;
        [Tooltip("How fast intensity may fall while breathing, per second.")]
        [SerializeField, Range(0.02f, 0.5f)] private float intensityDropSpeed = 0.12f;

        private float phaseTime;
        private float startLevel;
        private float calmLevel;
        private bool steering;

        public BreathPhase Phase { get; private set; } = BreathPhase.Idle;
        public bool IsRunning => Phase != BreathPhase.Idle;
        public int CompletedBreaths { get; private set; }
        public int TotalBreaths => breaths;

        /// <summary>0 = fully exhaled, 1 = fully inhaled. Drives the orb size.</summary>
        public float Expansion { get; private set; }

        public event Action Started;
        public event Action<BreathPhase> PhaseChanged;
        public event Action Finished;

        public void Begin()
        {
            Begin(lowerIntensity);
        }

        /// <param name="steerIntensity">
        /// True = each completed breath lowers the director's intensity. False = only pace the breathing (used after
        /// "calm now", where the director is already ramping down quickly).
        /// </param>
        public void Begin(bool steerIntensity)
        {
            if (IsRunning)
            {
                return;
            }

            CompletedBreaths = 0;
            steering = steerIntensity;
            AnxietyDirector director = AnxietyDirector.Instance;
            if (director != null && steering)
            {
                startLevel = director.RawIntensity;
                calmLevel = director.Profile.CalmIntensity;
                director.SetTargetOverride(startLevel, intensityDropSpeed);
            }

            Started?.Invoke();
            SetPhase(BreathPhase.Inhale);
        }

        public void Stop()
        {
            if (!IsRunning)
            {
                return;
            }
            Phase = BreathPhase.Idle;
            Expansion = 0f;
            AnxietyDirector director = AnxietyDirector.Instance;
            if (director != null && steering)
            {
                director.ClearTargetOverride();
            }
            Finished?.Invoke();
        }

        private void Update()
        {
            if (!IsRunning)
            {
                return;
            }

            phaseTime += Time.deltaTime;
            switch (Phase)
            {
                case BreathPhase.Inhale:
                    Expansion = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(phaseTime / inhaleSeconds));
                    if (phaseTime >= inhaleSeconds)
                    {
                        SetPhase(holdSeconds > 0f ? BreathPhase.Hold : BreathPhase.Exhale);
                    }
                    break;
                case BreathPhase.Hold:
                    Expansion = 1f;
                    if (phaseTime >= holdSeconds)
                    {
                        SetPhase(BreathPhase.Exhale);
                    }
                    break;
                case BreathPhase.Exhale:
                    Expansion = 1f - Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(phaseTime / exhaleSeconds));
                    if (phaseTime >= exhaleSeconds)
                    {
                        CompleteBreath();
                    }
                    break;
            }
        }

        private void CompleteBreath()
        {
            CompletedBreaths++;

            AnxietyDirector director = AnxietyDirector.Instance;
            if (director != null && steering)
            {
                float level = Mathf.Lerp(startLevel, calmLevel, (float)CompletedBreaths / breaths);
                director.SetTargetOverride(level, intensityDropSpeed);
            }

            if (CompletedBreaths >= breaths)
            {
                Stop();
                return;
            }
            SetPhase(BreathPhase.Inhale);
        }

        private void SetPhase(BreathPhase phase)
        {
            Phase = phase;
            phaseTime = 0f;
            PhaseChanged?.Invoke(phase);
        }
    }
}
