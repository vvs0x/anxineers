using Anxineers.Gaze;
using UnityEngine;

namespace Anxineers.Effects
{
    public enum EnvironmentMode
    {
        Splat,
        Primitives,
        Both,
    }

    /// <summary>
    /// Switches between the primitive blockout room and the Gaussian splat room. It does not depend on any splat package:
    /// the splat renderer lives on a normal GameObject that is referenced here, so this compiles with or without the package.
    /// Only the renderers of the blockout room are hidden. Its lights and colliders stay, so the lamp keeps working.
    /// </summary>
    public class SplatEnvironment : MonoBehaviour
    {
        [SerializeField] private EnvironmentMode mode = EnvironmentMode.Splat;

        [Tooltip("The primitive 'Waiting Room' object.")]
        [SerializeField] private Transform blockoutRoot;

        [Tooltip("The object that holds the splat renderer (usually 'Splat Pivot').")]
        [SerializeField] private GameObject splatRoot;

        [Tooltip("Layer used to hide the splat. Nothing else should use it. The splat is hidden by removing this layer from the camera instead of disabling the renderer, which makes switching instant and safe.")]
        [SerializeField, Range(8, 31)] private int hiddenLayer = 31;

        public EnvironmentMode Mode => mode;

        private void OnEnable()
        {
            Apply();
        }

        private void Start()
        {
            Apply();
        }

        private void OnValidate()
        {
            if (isActiveAndEnabled)
            {
                Apply();
            }
        }

        public void SetMode(EnvironmentMode newMode)
        {
            mode = newMode;
            Apply();
        }

        /// <summary>Cycles Splat, Primitives, Both. Bound to the V key by SessionShortcuts.</summary>
        public void Cycle()
        {
            SetMode((EnvironmentMode)(((int)mode + 1) % 3));
            Debug.Log("[Anxineers] Environment: " + mode);
        }

        private static void SetLayerRecursive(Transform t, int layer)
        {
            t.gameObject.layer = layer;
            for (int i = 0; i < t.childCount; i++)
            {
                SetLayerRecursive(t.GetChild(i), layer);
            }
        }

        private void Apply()
        {
            // Make sure no camera draws the hidden layer, then move the splat in or out of it.
            Camera[] cameras = Camera.allCameras;
            for (int i = 0; i < cameras.Length; i++)
            {
                cameras[i].cullingMask &= ~(1 << hiddenLayer);
            }
            if (splatRoot != null)
            {
                splatRoot.SetActive(true);
                int layer = mode != EnvironmentMode.Primitives ? 0 : hiddenLayer;
                SetLayerRecursive(splatRoot.transform, layer);
            }
            if (blockoutRoot != null)
            {
                bool show = mode != EnvironmentMode.Splat;
                Renderer[] renderers = blockoutRoot.GetComponentsInChildren<Renderer>(true);
                for (int i = 0; i < renderers.Length; i++)
                {
                    renderers[i].enabled = show;
                }
                // The hidden blockout furniture must not act as gaze targets while the splat is shown.
                GazeTarget[] targets = blockoutRoot.GetComponentsInChildren<GazeTarget>(true);
                for (int i = 0; i < targets.Length; i++)
                {
                    targets[i].enabled = show;
                }
            }
        }
    }
}
