using Anxineers.Core;
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

        [Tooltip("How much the global director intensity tints the object, independent of gaze. 0 = gaze only.")]
        [SerializeField, Range(0f, 1f)] private float intensityInfluence = 0.6f;

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
            AnxietyDirector director = AnxietyDirector.Instance;
            float intensity = director != null ? director.Intensity * intensityInfluence : 0f;
            float t = Mathf.Clamp01(target.Value + intensity);
            block.SetColor(BaseColorId, Color.Lerp(calmColor, hotColor, t));
            rend.SetPropertyBlock(block);
        }
    }
}
