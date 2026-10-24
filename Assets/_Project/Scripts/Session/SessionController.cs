using System.Collections;
using Anxineers.Core;
using Anxineers.UI;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Anxineers.Session
{
    public enum SessionPhase
    {
        Idle,
        Consent,
        Intro,
        ModeSelect,
        CapSelect,
        Running,
        Ending,
        Done,
    }

    /// <summary>
    /// The whole session in order: consent, intro, choosing the intensity cap, the experience (Build, Peak, then grounding
    /// and breathing as recovery), and a closing screen. It enforces a maximum session length and always yields to calm now.
    /// Confirm = trigger on either controller (or Enter). Choose the cap with the thumbstick or the left/right arrow keys.
    ///
    /// ALL TEXTS BELOW ARE PLACEHOLDERS. They must be written and reviewed by a clinical advisor before real users see them.
    /// They deliberately make no therapeutic claims.
    /// </summary>
    public class SessionController : MonoBehaviour
    {
        [Header("Placeholder texts (needs clinical review)")]
        [SerializeField] private string consentTitle = "Before you begin";
        [SerializeField, TextArea(4, 10)] private string consentBody =
            "This is an educational VR experience. It gradually changes what you see and hear to show how anxiety can feel. " +
            "It is not therapy or medical advice.\n\n" +
            "You choose how strong it can get, and you can stop at any time with the A or X button.\n\n" +
            "Your spoken answers may be sent briefly to an online service to understand them.";
        [SerializeField] private string consentHint = "Pull the trigger to agree and continue";

        [SerializeField] private string introTitle = "What will happen";
        [SerializeField, TextArea(4, 10)] private string introBody =
            "You will stay where you are, seated or standing.\n\n" +
            "The room will slowly change. After a while a short exercise helps you settle: " +
            "you will name things you see, feel, hear, smell and taste, and then take a few slow breaths.";
        [SerializeField] private string introHint = "Pull the trigger to continue";

        [SerializeField] private string modeTitle = "Choose an experience";
        [SerializeField, TextArea(2, 6)] private string modeBody = "Use the thumbstick (or the left and right arrow keys) to choose.";
        [SerializeField] private string modeHint = "Pull the trigger to confirm";
        [SerializeField] private string educationLabel = "Understand anxiety (for learning)";
        [SerializeField] private string regulationLabel = "Practise settling (gentle)";

        [SerializeField] private string capTitle = "Choose the maximum intensity";
        [SerializeField] private string capHint = "Thumbstick to change, trigger to confirm. A or X always calms.";

        [SerializeField] private string endTitle = "Finished";
        [SerializeField, TextArea(2, 6)] private string endBody = "Take a moment before you take off the headset.";
        [SerializeField] private string endHint = "Pull the trigger to close";

        [Header("Limits")]
        [Tooltip("Hard maximum length of the experience part. At this point the session calms down and ends.")]
        [SerializeField, Min(60f)] private float maxSessionSeconds = 1200f;

        [SerializeField, Range(0.1f, 1f)] private float defaultCap = 0.5f;
        [SerializeField, Range(0.05f, 0.25f)] private float capStep = 0.1f;

        [Header("Profiles")]
        [Tooltip("Tuning used for the learning experience. Assigned by the Phase 7 menu.")]
        [SerializeField] private AnxietyProfile educationProfile;
        [Tooltip("Tuning used for the gentle settling experience. Assigned by the Phase 7 menu.")]
        [SerializeField] private AnxietyProfile regulationProfile;

        [Header("Start")]
        [SerializeField] private bool autoBegin = false;

        [Header("References (found automatically when empty)")]
        [SerializeField] private PromptPanel panel;
        [SerializeField] private GroundingExercise grounding;
        [SerializeField] private BreathingExercise breathing;

        private InputAction confirm;
        private InputAction adjust;
        private Coroutine routine;
        private AnxietyDirector subscribedTo;
        private bool endRequested;
        private float stickLatch;

        public SessionPhase Phase { get; private set; } = SessionPhase.Idle;
        public float RunningSeconds { get; private set; }

        private void Awake()
        {
            if (panel == null) panel = FindFirstObjectByType<PromptPanel>();
            if (grounding == null) grounding = FindFirstObjectByType<GroundingExercise>();
            if (breathing == null) breathing = FindFirstObjectByType<BreathingExercise>();
        }

        private void OnEnable()
        {
            confirm = new InputAction("Confirm", InputActionType.Button);
            confirm.AddBinding("<XRController>{RightHand}/{TriggerButton}");
            confirm.AddBinding("<XRController>{LeftHand}/{TriggerButton}");
            confirm.AddBinding("<Keyboard>/enter");
            confirm.Enable();

            adjust = new InputAction("Adjust", InputActionType.Value, expectedControlType: "Vector2");
            adjust.AddBinding("<XRController>{RightHand}/{Primary2DAxis}");
            adjust.AddBinding("<XRController>{LeftHand}/{Primary2DAxis}");
            adjust.Enable();
        }

        private void OnDisable()
        {
            confirm.Disable();
            confirm.Dispose();
            adjust.Disable();
            adjust.Dispose();
            Unsubscribe();
        }

        private void Start()
        {
            if (autoBegin)
            {
                Begin();
            }
        }

        public void Begin()
        {
            if (routine != null)
            {
                return;
            }
            routine = StartCoroutine(Run());
        }

        /// <summary>Stops the session at once: ends exercises, calms down and hides the panel.</summary>
        public void Abort()
        {
            if (routine != null)
            {
                StopCoroutine(routine);
                routine = null;
            }
            Unsubscribe();
            if (grounding != null) grounding.Stop();
            if (breathing != null) breathing.Stop();
            if (panel != null) panel.Hide();
            AnxietyDirector director = AnxietyDirector.Instance;
            if (director != null)
            {
                director.CalmNow();
            }
            Phase = SessionPhase.Idle;
        }

        private IEnumerator Run()
        {
            AnxietyDirector director = AnxietyDirector.Instance;
            if (director == null)
            {
                Debug.LogError("[Anxineers] SessionController needs an AnxietyDirector in the scene.");
                routine = null;
                yield break;
            }

            endRequested = false;
            subscribedTo = director;
            subscribedTo.CalmNowRequested += OnCalmNow;
            director.SetState(AnxietyState.Calm);

            Phase = SessionPhase.Consent;
            yield return ShowMessage(consentTitle, consentBody, consentHint);

            Phase = SessionPhase.Intro;
            yield return ShowMessage(introTitle, introBody, introHint);

            Phase = SessionPhase.ModeSelect;
            yield return SelectMode(director);

            Phase = SessionPhase.CapSelect;
            yield return SelectCap(director);

            Phase = SessionPhase.Running;
            yield return RunExperience(director);

            Phase = SessionPhase.Ending;
            yield return ShowMessage(endTitle, endBody, endHint);

            if (panel != null) panel.Hide();
            Unsubscribe();
            Phase = SessionPhase.Done;
            routine = null;
        }

        private IEnumerator ShowMessage(string title, string body, string hint)
        {
            if (panel != null)
            {
                panel.ShowMessage(title, body, hint);
            }
            yield return null;
            while (!confirm.WasPressedThisFrame())
            {
                yield return null;
            }
        }

        private IEnumerator SelectMode(AnxietyDirector director)
        {
            int choice = 0;
            bool dirty = true;
            yield return null;

            while (!confirm.WasPressedThisFrame())
            {
                int direction = ReadAdjustDirection();
                if (direction != 0)
                {
                    choice = Mathf.Clamp(choice + direction, 0, 1);
                    dirty = true;
                }

                if (dirty && panel != null)
                {
                    string body = (choice == 0 ? "> " : "   ") + educationLabel + "\n" +
                                  (choice == 1 ? "> " : "   ") + regulationLabel + "\n\n" + modeBody;
                    panel.ShowMessage(modeTitle, body, modeHint);
                    dirty = false;
                }
                yield return null;
            }

            AnxietyProfile chosen = choice == 0 ? educationProfile : regulationProfile;
            if (chosen != null)
            {
                director.SetProfile(chosen);
            }
        }

        private IEnumerator SelectCap(AnxietyDirector director)
        {
            float cap = Mathf.Clamp(Mathf.Round(defaultCap / capStep) * capStep, capStep, 1f);
            yield return null;

            while (!confirm.WasPressedThisFrame())
            {
                int direction = ReadAdjustDirection();
                if (direction != 0)
                {
                    cap = Mathf.Clamp(Mathf.Round((cap + direction * capStep) / capStep) * capStep, capStep, 1f);
                }

                if (panel != null)
                {
                    int steps = Mathf.RoundToInt(1f / capStep);
                    panel.Show(capTitle, capHint);
                    panel.SetProgress(Mathf.RoundToInt(cap / capStep), steps);
                    panel.SetLevel(-1f);
                    panel.SetStatus("Maximum: " + Mathf.RoundToInt(cap * 100f) + "%");
                }
                yield return null;
            }

            director.SetIntensityCap(cap);
        }

        private int ReadAdjustDirection()
        {
            Keyboard kb = Keyboard.current;
            if (kb != null)
            {
                if (kb.rightArrowKey.wasPressedThisFrame) return 1;
                if (kb.leftArrowKey.wasPressedThisFrame) return -1;
            }

            float x = adjust.ReadValue<Vector2>().x;
            if (Mathf.Abs(x) < 0.4f)
            {
                stickLatch = 0f;
                return 0;
            }
            if (stickLatch != 0f)
            {
                return 0;
            }
            stickLatch = Mathf.Sign(x);
            return (int)stickLatch;
        }

        private IEnumerator RunExperience(AnxietyDirector director)
        {
            RunningSeconds = 0f;
            bool groundingStarted = false;
            if (panel != null) panel.Hide();
            director.SetState(AnxietyState.Build);
            director.AutoAdvance = true;

            while (true)
            {
                RunningSeconds += Time.deltaTime;

                if (!endRequested && RunningSeconds >= maxSessionSeconds)
                {
                    director.CalmNow();
                }

                if (!endRequested && !groundingStarted && director.State == AnxietyState.Recovery && !director.CalmNowActive)
                {
                    groundingStarted = true;
                    if (grounding != null)
                    {
                        grounding.Begin();
                    }
                }

                bool exercisesIdle = (grounding == null || !grounding.IsRunning) && (breathing == null || !breathing.IsRunning);
                bool finishedNormally = groundingStarted && exercisesIdle && director.State == AnxietyState.Calm;
                bool finishedByCalmNow = endRequested && exercisesIdle && director.State == AnxietyState.Calm;
                if (finishedNormally || finishedByCalmNow)
                {
                    break;
                }

                yield return null;
            }
        }

        private void OnCalmNow()
        {
            if (Phase == SessionPhase.Running)
            {
                endRequested = true;
            }
        }

        private void Unsubscribe()
        {
            if (subscribedTo != null)
            {
                subscribedTo.CalmNowRequested -= OnCalmNow;
            }
            subscribedTo = null;
        }
    }
}
