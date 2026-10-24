using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Anxineers.Effects
{
    /// <summary>
    /// Owns one global URP Volume created at runtime, so effects can add overrides (vignette, color) without
    /// anyone editing a Volume asset by hand. Also makes sure the main camera renders post-processing.
    /// </summary>
    public class PostFxVolume : MonoBehaviour
    {
        private Volume volume;
        private VolumeProfile profile;
        private bool loggedOnce;

        public static PostFxVolume GetOrCreate()
        {
            PostFxVolume existing = FindFirstObjectByType<PostFxVolume>();
            if (existing != null)
            {
                return existing;
            }
            var go = new GameObject("Anxiety PostFX");
            return go.AddComponent<PostFxVolume>();
        }

        /// <summary>Returns the override of type T, adding it to the profile if needed.</summary>
        public T Get<T>() where T : VolumeComponent
        {
            EnsureProfile();
            if (!profile.TryGet(out T component))
            {
                component = profile.Add<T>(false);
            }
            return component;
        }

        private void Awake()
        {
            EnsureProfile();
        }

        private void Update()
        {
            EnsureCamera();
        }

        private void EnsureCamera()
        {
            Camera cam = Camera.main;
            if (cam == null)
            {
                return;
            }

            UniversalAdditionalCameraData data = cam.GetUniversalAdditionalCameraData();
            bool changed = !data.renderPostProcessing || data.volumeTrigger == null || data.volumeLayerMask != ~0;
            data.renderPostProcessing = true;
            data.volumeLayerMask = ~0;
            if (data.volumeTrigger == null)
            {
                data.volumeTrigger = cam.transform;
            }

            if (changed || !loggedOnce)
            {
                loggedOnce = true;
                Debug.Log("[Anxineers] PostFX ready on camera '" + cam.name + "' (post-processing on, volume mask Everything, volume layer " +
                          LayerMask.LayerToName(gameObject.layer) + ").", cam);
            }
        }

        private void OnDestroy()
        {
            if (profile != null)
            {
                Destroy(profile);
            }
        }

        private void EnsureProfile()
        {
            if (profile != null)
            {
                return;
            }
            volume = gameObject.GetComponent<Volume>();
            if (volume == null)
            {
                volume = gameObject.AddComponent<Volume>();
            }
            volume.isGlobal = true;
            volume.priority = 100f;
            volume.weight = 1f;
            profile = ScriptableObject.CreateInstance<VolumeProfile>();
            volume.profile = profile;
        }
    }
}
