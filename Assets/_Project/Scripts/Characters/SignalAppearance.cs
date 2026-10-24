using UnityEngine;

namespace SignalCharacter
{
    [ExecuteAlways]
    public sealed class SignalAppearance : MonoBehaviour
    {
        [Tooltip("Text projection centre above the character's feet, in metres.")]
        public float anchorHeight = 0.9f;
        private Renderer[] renderers;
        private MaterialPropertyBlock properties;
        private Transform hips;
        private static readonly int Origin = Shader.PropertyToID("_ProjectionOrigin");

        private void OnEnable()
        {
            renderers = GetComponentsInChildren<SkinnedMeshRenderer>();
            var animator = GetComponentInChildren<Animator>();
            hips = animator && animator.isHuman ? animator.GetBoneTransform(HumanBodyBones.Hips) : null;
            Apply();
        }
        private void LateUpdate() => Apply();
        public void Apply()
        {
            if (renderers == null) renderers = GetComponentsInChildren<SkinnedMeshRenderer>();
            if (properties == null) properties = new MaterialPropertyBlock();
            Vector3 anchor = transform.position + transform.up * anchorHeight;
            if (hips) anchor = hips.position + transform.up * (anchorHeight - 0.9f);
            foreach (Renderer renderer in renderers)
            {
                if (!renderer) continue;
                renderer.GetPropertyBlock(properties);
                properties.SetVector(Origin, new Vector4(anchor.x, anchor.y, anchor.z, 1));
                renderer.SetPropertyBlock(properties);
            }
        }
    }
}
