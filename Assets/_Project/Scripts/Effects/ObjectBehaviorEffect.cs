using System.Collections.Generic;
using Anxineers.Core;
using Anxineers.Gaze;
using UnityEngine;

namespace Anxineers.Effects
{
    /// <summary>
    /// Slow drift and scale pulse on GazeTarget objects. Each object reacts to its own gaze value plus the global
    /// intensity (capped). Objects move, never the user.
    /// </summary>
    public class ObjectBehaviorEffect : EffectBase
    {
        [Header("Drift")]
        [Tooltip("Maximum drift distance in meters at full effect.")]
        [SerializeField, Range(0f, 1f)] private float driftMeters = 0.25f;

        [Tooltip("Drift speed in Hz. Very slow on purpose.")]
        [SerializeField, Range(0.01f, 0.3f)] private float driftHz = 0.05f;

        [Header("Scale pulse")]
        [Tooltip("Extra scale at the top of a pulse, at full effect (0.25 = +25%).")]
        [SerializeField, Range(0f, 0.6f)] private float pulseAmount = 0.25f;

        [Tooltip("Pulses per second, capped to a slow range.")]
        [SerializeField, Range(0.05f, 1f)] private float pulseHz = 0.25f;

        [Header("Targets")]
        [Tooltip("Leave empty to use every GazeTarget in the scene.")]
        [SerializeField] private GazeTarget[] targets;

        private struct Entry
        {
            public GazeTarget Target;
            public Vector3 BasePosition;
            public Vector3 BaseScale;
            public float Phase;
        }

        private readonly List<Entry> entries = new List<Entry>();

        public override EffectKind Kind => EffectKind.Objects;

        protected override void OnEnable()
        {
            base.OnEnable();
            RefreshTargets();
        }

        /// <summary>Re-scan targets and remember their current transforms as the neutral pose.</summary>
        [ContextMenu("Refresh targets")]
        public void RefreshTargets()
        {
            ResetEffect();
            entries.Clear();
            GazeTarget[] found = (targets != null && targets.Length > 0)
                ? targets
                : FindObjectsByType<GazeTarget>(FindObjectsSortMode.None);
            for (int i = 0; i < found.Length; i++)
            {
                if (found[i] == null)
                {
                    continue;
                }
                Transform t = found[i].transform;
                entries.Add(new Entry
                {
                    Target = found[i],
                    BasePosition = t.position,
                    BaseScale = t.localScale,
                    Phase = i * 1.7f,
                });
            }
        }

        protected override void Apply(float value, AnxietyDirector director, float deltaTime)
        {
            float time = Time.time;
            for (int i = 0; i < entries.Count; i++)
            {
                Entry e = entries[i];
                if (e.Target == null)
                {
                    continue;
                }

                float local = Evaluate(director, e.Target.Value);
                Vector3 dir = new Vector3(
                    Mathf.Sin(2f * Mathf.PI * driftHz * time + e.Phase),
                    0.5f * Mathf.Sin(2f * Mathf.PI * driftHz * 1.3f * time + e.Phase * 0.7f),
                    Mathf.Sin(2f * Mathf.PI * driftHz * 0.7f * time + e.Phase * 1.3f));
                float pulse = 0.5f + 0.5f * Mathf.Sin(2f * Mathf.PI * pulseHz * time + e.Phase);

                Transform t = e.Target.transform;
                t.position = e.BasePosition + dir * (driftMeters * local);
                t.localScale = e.BaseScale * (1f + pulseAmount * local * pulse);
            }
        }

        protected override void ResetEffect()
        {
            for (int i = 0; i < entries.Count; i++)
            {
                Entry e = entries[i];
                if (e.Target != null)
                {
                    e.Target.transform.position = e.BasePosition;
                    e.Target.transform.localScale = e.BaseScale;
                }
            }
        }
    }
}
