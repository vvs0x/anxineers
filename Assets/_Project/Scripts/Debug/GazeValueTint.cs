using Anxineers.Gaze;
using UnityEngine;

namespace Anxineers.DebugTools
{
    /// <summary>Test helper: tints the renderer from a calm to a hot color as the GazeTarget value rises.</summary>
    [RequireComponent(typeof(GazeTarget), typeof(Renderer))]
    public class GazeValueTint : MonoBehaviour
    {
        [SerializeField] private Color calmColor = new Color(0.30f, 0.38f, 0.45f);
        [SerializeField] private Color hotColor = new Color(1.00f, 0.30f, 0.20f);

        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");

        private GazeTarget target;
        private Renderer rend;
        private MaterialPropertyBlock block;

        private void Awake()
        {
            target = GetComponent<GazeTarget>();
            rend = GetComponent<Renderer>();
            block = new MaterialPropertyBlock();
        }

        private void Update()
        {
            rend.GetPropertyBlock(block);
            block.SetColor(BaseColorId, Color.Lerp(calmColor, hotColor, target.Value));
            rend.SetPropertyBlock(block);
        }
    }
}
