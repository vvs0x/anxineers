using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace Anxineers.Core
{
    /// <summary>
    /// Requests floor-level tracking so the rig origin sits on the real floor.
    /// Retries for a few seconds because the XR subsystem can start after this component.
    /// This never moves the camera relative to head motion, it only picks the tracking origin mode.
    /// </summary>
    public class XRTrackingOrigin : MonoBehaviour
    {
        [SerializeField] private TrackingOriginModeFlags mode = TrackingOriginModeFlags.Floor;
        [SerializeField, Min(0f)] private float retrySeconds = 3f;

        private static readonly List<XRInputSubsystem> Subsystems = new List<XRInputSubsystem>();

        private IEnumerator Start()
        {
            float end = Time.unscaledTime + retrySeconds;
            while (true)
            {
                if (TryApply() || Time.unscaledTime >= end)
                {
                    yield break;
                }
                yield return new WaitForSecondsRealtime(0.25f);
            }
        }

        private bool TryApply()
        {
            Subsystems.Clear();
            SubsystemManager.GetSubsystems(Subsystems);
            bool any = false;
            foreach (XRInputSubsystem subsystem in Subsystems)
            {
                if (subsystem.TrySetTrackingOriginMode(mode))
                {
                    any = true;
                }
            }
            return any;
        }
    }
}
