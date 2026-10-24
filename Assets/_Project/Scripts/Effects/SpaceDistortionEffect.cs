using Anxineers.Core;
using UnityEngine;

namespace Anxineers.Effects
{
    /// <summary>
    /// Space distortion driven by ONE shader parameter. Surfaces using the "Anxineers/Distortable Lit" shader
    /// (the room, later a proxy mesh) are pushed away from a fixed center, so walls drift away and corridors
    /// lengthen. No transforms move, and the center is fixed in the world, so head motion never moves the world.
    /// </summary>
    public class SpaceDistortionEffect : EffectBase
    {
        private static readonly int DistortionId = Shader.PropertyToID("_AnxietyDistortion");
        private static readonly int StretchId = Shader.PropertyToID("_AnxietyStretch");
        private static readonly int CenterId = Shader.PropertyToID("_AnxietyCenter");

        [Header("Stretch per axis (meters pushed per meter of distance, at full effect)")]
        [SerializeField, Range(0f, 1f)] private float stretchX = 0.25f;
        [SerializeField, Range(0f, 1f)] private float stretchY = 0f;
        [SerializeField, Range(0f, 1f)] private float stretchZ = 0.5f;

        [Header("Center")]
        [Tooltip("Fixed point the room expands away from. Defaults to this object's position at start (use the user's standing spot).")]
        [SerializeField] private Transform center;

        private Vector3 fixedCenter;

        public override EffectKind Kind => EffectKind.Space;

        protected override void OnEnable()
        {
            base.OnEnable();
            fixedCenter = center != null ? center.position : transform.position;
            Shader.SetGlobalVector(CenterId, fixedCenter);
        }

        protected override void Apply(float value, AnxietyDirector director, float deltaTime)
        {
            Shader.SetGlobalVector(CenterId, center != null ? center.position : fixedCenter);
            Shader.SetGlobalVector(StretchId, new Vector4(stretchX, stretchY, stretchZ, 0f));
            Shader.SetGlobalFloat(DistortionId, value);
        }

        protected override void ResetEffect()
        {
            Shader.SetGlobalFloat(DistortionId, 0f);
        }
    }
}
