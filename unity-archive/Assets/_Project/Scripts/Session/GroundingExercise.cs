using System;
using System.Collections;
using System.Collections.Generic;
using Anxineers.Core;
using Anxineers.Effects;
using Anxineers.UI;
using Anxineers.Voice;
using UnityEngine;

namespace Anxineers.Session
{
    [Serializable]
    public class GroundingStep
    {
        public GroundingSense sense;

        [Min(1)] public int count = 1;

        [TextArea(2, 4)]
        [Tooltip("Spoken-style prompt shown to the user. PLACEHOLDER WORDING, needs review by a clinical advisor.")]
        public string prompt;

        [Tooltip("The step ends after this many seconds even if not all items were named.")]
        [Min(10f)] public float maxSeconds = 60f;
    }

    /// <summary>
    /// The 5-4-3-2-1 sensory grounding method: 5 things to see, 4 to touch, 3 to hear, 2 to smell, 1 to taste.
    /// The user answers out loud (VoiceInput) or, where helper objects exist, by looking at or touching them.
    /// Each named item lowers the intensity a little through the director, so the experience calms during the exercise.
    /// It is lenient and never traps the user: steps time out and can be skipped.
    /// Wording is placeholder text and must be reviewed by a clinical advisor before real use.
    /// </summary>
    public class GroundingExercise : MonoBehaviour
    {
        [SerializeField] private GroundingStep[] steps = DefaultSteps();

        [Header("Voice")]
        [Tooltip("How long one listen lasts at most.")]
        [SerializeField, Range(4f, 30f)] private float listenSeconds = 14f;

        [Header("Intensity")]
        [Tooltip("How fast intensity may fall while grounding, per second.")]
        [SerializeField, Range(0.02f, 0.5f)] private float intensityDropSpeed = 0.1f;

        [Header("Feedback")]
        [Tooltip("Play a soft chime whenever an item is counted.")]
        [SerializeField] private bool chimeOnItem = true;
        [SerializeField, Range(0f, 1f)] private float chimeVolume = 0.35f;

        [Header("Ending")]
        [SerializeField] private bool startBreathingAtEnd = true;

        [Header("References (found automatically when empty)")]
        [SerializeField] private VoiceInput voice;
        [SerializeField] private PromptPanel panel;
        [SerializeField] private BreathingExercise breathing;
        [SerializeField] private Transform leftHand;
        [SerializeField] private Transform rightHand;

        private Coroutine routine;
        private bool skipRequested;
        private GroundingItem[] allItems = new GroundingItem[0];
        private float startLevel;
        private float calmLevel;
        private int totalItems;
        private int completedTotal;
        private AudioSource chime;
        private string lastHeard = string.Empty;
        private string transientStatus = string.Empty;
        private float transientUntil;

        public bool IsRunning { get; private set; }
        public int StepIndex { get; private set; } = -1;
        public int ItemsDone { get; private set; }
        public GroundingStep CurrentStep => StepIndex >= 0 && StepIndex < steps.Length ? steps[StepIndex] : null;

        public event Action<GroundingStep> StepStarted;
        public event Action<GroundingStep, int> ItemCompleted;
        public event Action Finished;

        private void Awake()
        {
            if (voice == null) voice = FindFirstObjectByType<VoiceInput>();
            if (panel == null) panel = FindFirstObjectByType<PromptPanel>();
            if (breathing == null) breathing = FindFirstObjectByType<BreathingExercise>();
            if (leftHand == null) leftHand = FindByName("LeftHand");
            if (rightHand == null) rightHand = FindByName("RightHand");

            chime = gameObject.AddComponent<AudioSource>();
            chime.clip = ProceduralAudio.Chime();
            chime.playOnAwake = false;
            chime.spatialBlend = 0f;
        }

        public static GroundingStep[] DefaultSteps()
        {
            return new[]
            {
                new GroundingStep { sense = GroundingSense.See, count = 5, prompt = "Look around you. Name 5 things you can see." },
                new GroundingStep { sense = GroundingSense.Touch, count = 4, prompt = "Name 4 things you can feel or touch. You can reach out and touch objects near you." },
                new GroundingStep { sense = GroundingSense.Hear, count = 3, prompt = "Listen for a moment. Name 3 things you can hear." },
                new GroundingStep { sense = GroundingSense.Smell, count = 2, prompt = "Name 2 things you can smell, or 2 smells you like." },
                new GroundingStep { sense = GroundingSense.Taste, count = 1, prompt = "Name 1 thing you can taste, or a taste you like." },
            };
        }

        public void Begin()
        {
            if (IsRunning)
            {
                return;
            }
            routine = StartCoroutine(Run());
        }

        /// <summary>Stops the exercise right away and gives the intensity back to the state timeline.</summary>
        public void Stop()
        {
            if (!IsRunning)
            {
                return;
            }
            StopAllCoroutines();
            if (voice != null)
            {
                voice.Cancel();
            }
            Finish(false);
        }

        /// <summary>Moves on to the next step.</summary>
        public void SkipStep()
        {
            skipRequested = true;
        }

        private IEnumerator Run()
        {
            IsRunning = true;
            AnxietyDirector director = AnxietyDirector.Instance;
            allItems = FindObjectsByType<GroundingItem>(FindObjectsSortMode.None);

            totalItems = 0;
            foreach (GroundingStep step in steps)
            {
                totalItems += step.count;
            }
            completedTotal = 0;

            if (director != null)
            {
                startLevel = director.RawIntensity;
                calmLevel = director.Profile.CalmIntensity;
                director.SetState(AnxietyState.Recovery);
                director.SetTargetOverride(startLevel, intensityDropSpeed);
            }

            for (StepIndex = 0; StepIndex < steps.Length; StepIndex++)
            {
                yield return RunStep(steps[StepIndex]);
            }

            Finish(true);
        }

        private IEnumerator RunStep(GroundingStep step)
        {
            ItemsDone = 0;
            skipRequested = false;
            StepStarted?.Invoke(step);

            var helpers = new List<GroundingItem>();
            foreach (GroundingItem item in allItems)
            {
                if (item != null && item.Sense == step.sense && helpers.Count < step.count)
                {
                    helpers.Add(item);
                    item.Activate();
                }
            }

            lastHeard = string.Empty;
            transientStatus = string.Empty;
            ShowProgress(step);

            float elapsed = 0f;
            bool listening = false;
            float nextListenAt = 0f;

            while (ItemsDone < step.count && elapsed < step.maxSeconds && !skipRequested)
            {
                elapsed += Time.deltaTime;
                UpdateFeedback();

                foreach (GroundingItem item in helpers)
                {
                    if (item.IsCompleted(leftHand, rightHand))
                    {
                        item.MarkDone();
                        AddItems(step, 1);
                    }
                }

                if (voice != null && !listening && elapsed >= nextListenAt && ItemsDone < step.count)
                {
                    listening = true;
                    voice.Listen(listenSeconds, result =>
                    {
                        listening = false;
                        nextListenAt = elapsed + 0.4f;
                        if (result.Success && !string.IsNullOrWhiteSpace(result.Text))
                        {
                            int named = Mathf.Max(1, SpeechParser.CountItems(result.Text));
                            lastHeard = "\u201C" + result.Text.Trim() + "\u201D";
                            SetTransientStatus(named == 1 ? "Got it: 1 item" : "Got it: " + named + " items", 3f);
                            AddItems(step, named);
                        }
                        else if (result.Error != "cancelled")
                        {
                            SetTransientStatus("I did not catch that. Try again when you are ready.", 3f);
                        }
                    });
                }

                yield return null;
            }

            if (voice != null && listening)
            {
                voice.Cancel();
                yield return null;
            }

            foreach (GroundingItem item in helpers)
            {
                item.Deactivate();
            }
        }

        private void AddItems(GroundingStep step, int amount)
        {
            bool counted = false;
            AnxietyDirector director = AnxietyDirector.Instance;
            for (int i = 0; i < amount && ItemsDone < step.count; i++)
            {
                ItemsDone++;
                completedTotal++;
                if (director != null)
                {
                    float level = Mathf.Lerp(startLevel, calmLevel, (float)completedTotal / totalItems);
                    director.SetTargetOverride(level, intensityDropSpeed);
                }
                counted = true;
                ItemCompleted?.Invoke(step, ItemsDone);
            }

            if (counted && chimeOnItem && chime != null)
            {
                chime.PlayOneShot(chime.clip, chimeVolume);
            }
            ShowProgress(CurrentStep);
        }

        private void ShowProgress(GroundingStep step)
        {
            if (panel == null || step == null)
            {
                return;
            }
            panel.Show(step.prompt, lastHeard);
            panel.SetProgress(ItemsDone, step.count);
        }

        private void SetTransientStatus(string text, float seconds)
        {
            transientStatus = text;
            transientUntil = Time.time + seconds;
        }

        /// <summary>Keeps the status line and the microphone level bar in sync with what the voice input is doing.</summary>
        private void UpdateFeedback()
        {
            if (panel == null)
            {
                return;
            }

            string text;
            float level = -1f;

            if (Time.time < transientUntil && !string.IsNullOrEmpty(transientStatus))
            {
                text = transientStatus;
            }
            else if (voice == null)
            {
                text = "Look at the glowing objects";
            }
            else if (voice.State == VoiceState.Processing)
            {
                text = "One moment...";
            }
            else if (voice.State == VoiceState.Listening && voice.ActiveMode == VoiceMode.ElevenLabs)
            {
                text = voice.SpeechDetected ? "I am listening..." : "Speak when you are ready";
                level = voice.Level;
            }
            else if (voice.State == VoiceState.Listening)
            {
                text = "Say your answer (Enter = one item)";
            }
            else
            {
                text = string.Empty;
            }

            panel.SetStatus(text);
            panel.SetLevel(level);
        }

        private void Finish(bool completed)
        {
            foreach (GroundingItem item in allItems)
            {
                if (item != null)
                {
                    item.Deactivate();
                }
            }

            IsRunning = false;
            StepIndex = -1;
            if (panel != null)
            {
                panel.SetLevel(-1f);
                panel.Hide();
            }

            AnxietyDirector director = AnxietyDirector.Instance;
            if (director != null)
            {
                director.ClearTargetOverride();
            }

            Finished?.Invoke();

            if (completed && startBreathingAtEnd && breathing != null)
            {
                breathing.Begin();
            }
        }

        private static Transform FindByName(string objectName)
        {
            GameObject go = GameObject.Find(objectName);
            return go != null ? go.transform : null;
        }
    }
}
