using Anxineers.Gaze;
using UnityEngine;

namespace Anxineers.Session
{
    public enum GroundingSense
    {
        See,
        Touch,
        Hear,
        Smell,
        Taste,
    }

    /// <summary>
    /// An optional helper object for a grounding step. It is hidden until its step starts, then glows softly.
    /// See and Hear items are completed by looking at them for a moment, Touch items by reaching a controller to them.
    /// Spoken answers work without any items.
    /// </summary>
    public class GroundingItem : MonoBehaviour
    {
        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        [SerializeField] private GroundingSense sense = GroundingSense.See;
        [Tooltip("Gaze value (0..1) that counts as looked at. See and Hear items need a GazeTarget.")]
        [SerializeField, Range(0.3f, 1f)] private float gazeThreshold = 0.8f;
        [Tooltip("How close a controller must be to the surface, in meters. Touch items only.")]
        [SerializeField, Range(0.03f, 0.4f)] private float touchDistance = 0.1f;
        [SerializeField] private Color activeColor = new Color(1f, 0.85f, 0.45f);
        [SerializeField] private Color doneColor = new Color(0.45f, 0.8f, 0.6f);

        private Renderer rend;
        private GazeTarget gaze;
        private AudioSource audioSource;
        private MaterialPropertyBlock block;

        public GroundingSense Sense => sense;
        public bool IsActive { get; private set; }
        public bool IsDone { get; private set; }

        private void Awake()
        {
            rend = GetComponent<Renderer>();
            gaze = GetComponent<GazeTarget>();
            audioSource = GetComponent<AudioSource>();
            block = new MaterialPropertyBlock();
            SetShown(false);
        }

        public void Activate()
        {
            IsActive = true;
            IsDone = false;
            SetShown(true);
            Tint(activeColor);
            if (audioSource != null)
            {
                audioSource.Play();
            }
        }

        public void Deactivate()
        {
            IsActive = false;
            SetShown(false);
            if (audioSource != null)
            {
                audioSource.Stop();
            }
        }

        public void MarkDone()
        {
            IsDone = true;
            Tint(doneColor);
            if (audioSource != null)
            {
                audioSource.Stop();
            }
        }

        public bool IsCompleted(Transform leftHand, Transform rightHand)
        {
            if (!IsActive || IsDone)
            {
                return false;
            }
            if (sense == GroundingSense.Touch)
            {
                return IsNear(leftHand) || IsNear(rightHand);
            }
            return gaze != null && gaze.Value >= gazeThreshold;
        }

        private bool IsNear(Transform hand)
        {
            if (hand == null || rend == null)
            {
                return false;
            }
            Vector3 closest = rend.bounds.ClosestPoint(hand.position);
            return Vector3.Distance(closest, hand.position) <= touchDistance;
        }

        private void Update()
        {
            if (IsActive && !IsDone)
            {
                float pulse = 0.75f + 0.25f * Mathf.Sin(Time.time * 2f);
                Tint(activeColor * pulse);
            }
        }

        private void SetShown(bool shown)
        {
            if (rend != null)
            {
                rend.enabled = shown;
            }
            if (gaze != null)
            {
                gaze.enabled = shown;
            }
        }

        private void Tint(Color color)
        {
            if (rend == null)
            {
                return;
            }
            rend.GetPropertyBlock(block);
            block.SetColor(BaseColorId, new Color(color.r, color.g, color.b, 1f));
            rend.SetPropertyBlock(block);
        }
    }
}
