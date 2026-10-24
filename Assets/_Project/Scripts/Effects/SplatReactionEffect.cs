using Anxineers.Core;
using UnityEngine;

namespace Anxineers.Effects
{
    /// <summary>
    /// Space effect for the Gaussian splat room. Splats cannot be bent by the wall shader, so this squashes the whole splat
    /// room slightly toward the user: the walls seem to close in and the ceiling to lower. Only the environment object is
    /// scaled, around the pivot (place the pivot at the user's standing spot, on the floor). The camera, the rig and the
    /// horizon are never touched. Follows the same intensity, cap and calm now as every other effect (Space channel).
    /// </summary>
    public class SplatReactionEffect : EffectBase
    {
        [Tooltip("The pivot object that contains the splat. Scaled around its own position.")]
        [SerializeField] private Transform pivot;

        [Header("Squash at full effect")]
        [Tooltip("How much the room shrinks sideways (0.3 = 30% smaller on X and Z).")]
        [SerializeField, Range(0f, 0.5f)] private float horizontalSquash = 0.3f;

        [Tooltip("How much the ceiling lowers (0.15 = 15% lower).")]
        [SerializeField, Range(0f, 0.3f)] private float verticalSquash = 0.15f;

        private Vector3 baseScale = Vector3.one;
        private bool captured;

        public override EffectKind Kind => EffectKind.Space;

        protected override void OnEnable()
        {
            base.OnEnable();
            Capture();
        }

        [ContextMenu("Capture neutral scale")]
        public void Capture()
        {
            if (pivot != null)
            {
                baseScale = pivot.localScale;
                captured = true;
            }
        }

        protected override void Apply(float value, AnxietyDirector director, float deltaTime)
        {
            if (pivot == null)
            {
                return;
            }
            if (!captured)
            {
                Capture();
            }
            float h = 1f - horizontalSquash * value;
            float v = 1f - verticalSquash * value;
            pivot.localScale = new Vector3(baseScale.x * h, baseScale.y * v, baseScale.z * h);
        }

        protected override void ResetEffect()
        {
            if (pivot != null && captured)
            {
                pivot.localScale = baseScale;
            }
        }
    }
}
