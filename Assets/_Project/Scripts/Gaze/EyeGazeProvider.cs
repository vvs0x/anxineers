using UnityEngine;

namespace Anxineers.Gaze
{
    /// <summary>
    /// Stub for devices with eye tracking (Quest Pro or future headsets). Quest 3 has none, so this always
    /// reports invalid and <see cref="GazeSource"/> falls back to <see cref="HeadGazeProvider"/>.
    /// TODO: read the OpenXR eye gaze interaction pose here and make IsValid true when tracking is confident.
    /// </summary>
    public class EyeGazeProvider : MonoBehaviour, IGazeProvider
    {
        public int Priority => 10;

        public bool IsValid => false;

        public Ray GazeRay => default;

        private void OnEnable()
        {
            GazeSource.Register(this);
        }

        private void OnDisable()
        {
            GazeSource.Unregister(this);
        }
    }
}
