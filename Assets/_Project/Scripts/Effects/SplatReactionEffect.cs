using System.Reflection;
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
        [SerializeField, Range(0f, 0.6f)] private float horizontalSquash = 0.4f;

        [Tooltip("How much the ceiling lowers (0.15 = 15% lower).")]
        [SerializeField, Range(0f, 0.4f)] private float verticalSquash = 0.2f;

        [Header("Breathing room")]
        [Tooltip("The whole room slowly swells and shrinks by this much at full effect (0.03 = 3%).")]
        [SerializeField, Range(0f, 0.08f)] private float breathAmount = 0.03f;

        [Tooltip("Breaths per second. Kept slow on purpose.")]
        [SerializeField, Range(0.05f, 0.3f)] private float breathHz = 0.15f;

        [Header("Blur (splat size)")]
        [Tooltip("The splats grow, so the room gets soft and unreal. Added to a size of 1 at full effect (0.15 = 15% bigger splats). Large values make blobs that fill the screen, especially with decimated scans.")]
        [SerializeField, Range(0f, 1f)] private float blurSplatGrowth = 0.15f;

        [Tooltip("The splat renderer component (Gaussians.ThreeD.GaussianSplat3DRenderer). Optional: without it only the squash is used.")]
        [SerializeField] private Component splatRenderer;

        private Vector3 baseScale = Vector3.one;
        private bool captured;
        private FieldInfo scaleField;
        private float baseSplatScale = 1f;

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
            if (splatRenderer != null)
            {
                // Reflection keeps this script free of any dependency on the splat package.
                scaleField = splatRenderer.GetType().GetField("m_SplatScale", BindingFlags.Public | BindingFlags.Instance);
                if (scaleField != null && scaleField.FieldType == typeof(float))
                {
                    baseSplatScale = (float)scaleField.GetValue(splatRenderer);
                }
                else
                {
                    scaleField = null;
                }
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
            float breath = 1f + breathAmount * value * Mathf.Sin(2f * Mathf.PI * breathHz * Time.time);
            pivot.localScale = new Vector3(baseScale.x * h * breath, baseScale.y * v * breath, baseScale.z * h * breath);
            if (scaleField != null && splatRenderer != null)
            {
                scaleField.SetValue(splatRenderer, baseSplatScale * (1f + blurSplatGrowth * value));
            }
        }

        protected override void ResetEffect()
        {
            if (pivot != null && captured)
            {
                pivot.localScale = baseScale;
            }
            if (scaleField != null && splatRenderer != null)
            {
                scaleField.SetValue(splatRenderer, baseSplatScale);
            }
        }
    }
}
