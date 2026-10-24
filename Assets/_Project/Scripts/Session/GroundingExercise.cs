using System;
using System.Collections;
using System.Collections.Generic;
using Anxineers.Core;
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

            ShowProgress(step, string.Empty);

            float elapsed = 0f;
            bool listening = false;
            float nextListenAt = 0f;

            while (ItemsDone < step.count && elapsed < step.maxSeconds && !skipRequested)
            {
                elapsed += Time.deltaTime;

                foreach (GroundingItem item in helpers)
                {
                    if (item.IsCompleted(leftHand, rightHand))
                    {
                        item.MarkDone();
                        AddItems(step, 1, string.Empty);
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
                            AddItems(step, Mathf.Max(1, SpeechParser.CountItems(result.Text)), result.Text);
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

        private void AddItems(GroundingStep step, int amount, string heard)
        {
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
                ItemCompleted?.Invoke(step, ItemsDone);
            }
            ShowProgress(step, heard);
        }

        private void ShowProgress(GroundingStep step, string heard)
        {
            if (panel == null)
            {
                return;
            }
            string progress = ItemsDone + " of " + step.count;
            if (!string.IsNullOrEmpty(heard) && (Application.isEditor || Debug.isDebugBuild))
            {
                progress += "\n" + heard;
            }
            panel.Show(step.prompt, progress);
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
