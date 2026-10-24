using Anxineers.Core;
using UnityEngine;

namespace Anxineers.Gaze
{
    /// <summary>
    /// Marks an object that reacts to gaze. Computes a local 0..1 value from how close the gaze ray is to the
    /// object (angle) and how long it has been looked at (dwell), and reports it to the AnxietyDirector.
    /// Other components (effects, tint, audio) read <see cref="Value"/>.
    /// </summary>
    public class GazeTarget : MonoBehaviour
    {
        [Header("Angle")]
        [Tooltip("Gaze within this angle (degrees) of the object counts as fully looking.")]
        [SerializeField, Min(0f)] private float fullAngle = 8f;

        [Tooltip("Beyond this angle (degrees) the object is not looked at. Between the two angles the value falls off.")]
        [SerializeField, Min(0f)] private float falloffAngle = 25f;

        [Tooltip("Ignore the object when farther away than this (meters).")]
        [SerializeField, Min(0.1f)] private float maxDistance = 30f;

        [Header("Dwell")]
        [Tooltip("Seconds of steady looking until the value reaches its maximum.")]
        [SerializeField, Min(0.01f)] private float dwellInSeconds = 1.5f;

        [Tooltip("Seconds for the value to fade out after looking away.")]
        [SerializeField, Min(0.01f)] private float dwellOutSeconds = 2.5f;

        [Header("Aim")]
        [Tooltip("Point to aim at. Defaults to the collider center, or the transform position.")]
        [SerializeField] private Transform aimPoint;

        [Tooltip("Report this target's value to the AnxietyDirector.")]
        [SerializeField] private bool reportToDirector = true;

        private float dwell;
        private float lastProximity;

        /// <summary>Local gaze value 0..1 (dwell multiplied by angular proximity).</summary>
        public float Value { get; private set; }

        /// <summary>Angle in degrees between the gaze ray and the object, or -1 if there is no gaze.</summary>
        public float AngleDegrees { get; private set; } = -1f;

        public bool IsLooking { get; private set; }

        private Vector3 AimPosition
        {
            get
            {
                if (aimPoint != null)
                {
                    return aimPoint.position;
                }
                Collider col = GetComponent<Collider>();
                return col != null ? col.bounds.center : transform.position;
            }
        }

        private void OnDisable()
        {
            dwell = 0f;
            lastProximity = 0f;
            Value = 0f;
            IsLooking = false;
        }

        private void Update()
        {
            float dt = Time.deltaTime;
            bool looking = false;
            float proximity = 0f;

            if (GazeSource.TryGetRay(out Ray ray))
            {
                Vector3 toTarget = AimPosition - ray.origin;
                float distance = toTarget.magnitude;
                if (distance > 0.001f && distance <= maxDistance)
                {
                    AngleDegrees = Vector3.Angle(ray.direction, toTarget);
                    float falloff = Mathf.Max(falloffAngle, fullAngle + 0.01f);
                    proximity = 1f - Mathf.InverseLerp(fullAngle, falloff, AngleDegrees);
                    looking = proximity > 0f;
                }
                else
                {
                    AngleDegrees = -1f;
                }
            }
            else
            {
                AngleDegrees = -1f;
            }

            if (looking)
            {
                lastProximity = proximity;
            }

            float rate = looking ? 1f / dwellInSeconds : -1f / dwellOutSeconds;
            dwell = Mathf.Clamp01(dwell + rate * dt);
            IsLooking = looking;
            Value = dwell * lastProximity;

            if (reportToDirector && AnxietyDirector.Instance != null)
            {
                AnxietyDirector.Instance.ReportGaze(Value);
            }
        }
    }
}
