using Anxineers.Effects;
using UnityEngine;

namespace Anxineers.Session
{
    /// <summary>
    /// Visual and audio breathing pacer: an orb that grows on the inhale and shrinks on the exhale, with a soft tone that
    /// rises and falls. It is placed once in front of the user when breathing starts and stays fixed in the world.
    /// </summary>
    public class BreathingOrb : MonoBehaviour
    {
        [SerializeField] private BreathingExercise exercise;
        [Tooltip("Child object that gets scaled. Created automatically if empty.")]
        [SerializeField] private Transform visual;

        [SerializeField, Range(0.8f, 3f)] private float distance = 1.5f;
        [SerializeField, Range(-0.5f, 0.3f)] private float heightOffset = -0.1f;
        [SerializeField, Range(0.05f, 0.5f)] private float minScale = 0.12f;
        [SerializeField, Range(0.1f, 1f)] private float maxScale = 0.45f;

        [Header("Tone")]
        [SerializeField] private bool playTone = true;
        [SerializeField, Range(0f, 0.3f)] private float toneVolume = 0.08f;
        [SerializeField, Range(100f, 500f)] private float toneHz = 220f;

        private AudioSource tone;

        private void Awake()
        {
            if (exercise == null)
            {
                exercise = FindFirstObjectByType<BreathingExercise>();
            }

            if (visual == null)
            {
                GameObject sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                sphere.name = "Orb Visual";
                Destroy(sphere.GetComponent<Collider>());
                sphere.transform.SetParent(transform, false);
                visual = sphere.transform;
            }

            tone = gameObject.AddComponent<AudioSource>();
            tone.clip = ProceduralAudio.ToneLoop(toneHz);
            tone.loop = true;
            tone.playOnAwake = false;
            tone.spatialBlend = 0f;
            tone.volume = 0f;

            visual.gameObject.SetActive(false);
        }

        private void OnEnable()
        {
            if (exercise != null)
            {
                exercise.Started += OnStarted;
                exercise.Finished += OnFinished;
            }
        }

        private void OnDisable()
        {
            if (exercise != null)
            {
                exercise.Started -= OnStarted;
                exercise.Finished -= OnFinished;
            }
        }

        private void OnStarted()
        {
            Camera cam = Camera.main;
            if (cam != null)
            {
                Vector3 forward = cam.transform.forward;
                forward.y = 0f;
                forward = forward.sqrMagnitude < 0.01f ? Vector3.forward : forward.normalized;
                transform.position = cam.transform.position + forward * distance + Vector3.up * heightOffset;
            }
            visual.gameObject.SetActive(true);
            if (playTone)
            {
                tone.Play();
            }
        }

        private void OnFinished()
        {
            visual.gameObject.SetActive(false);
            tone.Stop();
        }

        private void Update()
        {
            if (exercise == null || !exercise.IsRunning)
            {
                return;
            }

            float e = exercise.Expansion;
            visual.localScale = Vector3.one * Mathf.Lerp(minScale, maxScale, e);
            tone.volume = toneVolume * (0.3f + 0.7f * e);
            tone.pitch = 0.9f + 0.2f * e;
        }
    }
}
