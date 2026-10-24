using Anxineers.Core;
using Anxineers.Gaze;
using UnityEngine;

namespace Anxineers.Effects
{
    /// <summary>
    /// Spatialized sound on a GazeTarget that swells while it is looked at, scaled by the Audio effect settings
    /// of the active profile and the intensity cap. Uses a generated placeholder drone.
    /// </summary>
    [RequireComponent(typeof(GazeTarget))]
    public class GazeAudioSwell : MonoBehaviour
    {
        [SerializeField] private bool swellEnabled = true;
        [SerializeField, Range(0f, 1f)] private float baseVolume = 0f;
        [Tooltip("Volume added at full gaze and full effect.")]
        [SerializeField, Range(0f, 1f)] private float swellVolume = 0.4f;
        [SerializeField, Range(40f, 400f)] private float droneHz = 110f;
        [SerializeField, Min(0.5f)] private float maxDistance = 12f;

        private GazeTarget target;
        private AudioSource source;

        private void Awake()
        {
            target = GetComponent<GazeTarget>();
            source = gameObject.AddComponent<AudioSource>();
            source.clip = ProceduralAudio.DroneLoop(droneHz);
            source.loop = true;
            source.playOnAwake = false;
            source.spatialBlend = 1f;
            source.rolloffMode = AudioRolloffMode.Linear;
            source.maxDistance = maxDistance;
            source.volume = 0f;
        }

        private void OnEnable()
        {
            source.Play();
        }

        private void OnDisable()
        {
            source.Stop();
        }

        private void Update()
        {
            AnxietyDirector director = AnxietyDirector.Instance;
            if (!swellEnabled || director == null)
            {
                source.volume = 0f;
                return;
            }

            float shaped = director.Shape(EffectKind.Audio, director.Drive(EffectKind.Audio, target.Value));
            source.volume = Mathf.Clamp01(baseVolume + swellVolume * shaped * target.Value);
        }
    }
}
