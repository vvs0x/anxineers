using UnityEngine;

namespace Anxineers.Gaze
{
    /// <summary>
    /// Default gaze: the ray from the head along the view center. Works on Quest 3 (no eye tracking).
    /// If no head transform is assigned it falls back to the main camera.
    /// </summary>
    public class HeadGazeProvider : MonoBehaviour, IGazeProvider
    {
        [SerializeField] private Transform head;

        public int Priority => 0;

        public bool IsValid => ResolveHead() != null;

        public Ray GazeRay
        {
            get
            {
                Transform t = ResolveHead();
                return t != null ? new Ray(t.position, t.forward) : default;
            }
        }

        private void OnEnable()
        {
            GazeSource.Register(this);
        }

        private void OnDisable()
        {
            GazeSource.Unregister(this);
        }

        private Transform ResolveHead()
        {
            if (head != null)
            {
                return head;
            }

            Camera cam = Camera.main;
            return cam != null ? cam.transform : null;
        }
    }
}
