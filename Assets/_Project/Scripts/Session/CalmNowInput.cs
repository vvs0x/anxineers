using Anxineers.Core;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Anxineers.Session
{
    /// <summary>
    /// The always-available "calm now" safety action. Pressing the primary button (A or X) on either controller asks the
    /// director to ramp intensity down quickly. Whatever triggers it (controller, keyboard Space, gamepad), the response is
    /// the same: any running grounding stops and a short breathing exercise starts.
    /// </summary>
    public class CalmNowInput : MonoBehaviour
    {
        [SerializeField] private GroundingExercise grounding;
        [SerializeField] private BreathingExercise breathing;

        private InputAction calm;
        private AnxietyDirector subscribedTo;

        private void Awake()
        {
            if (grounding == null) grounding = FindFirstObjectByType<GroundingExercise>();
            if (breathing == null) breathing = FindFirstObjectByType<BreathingExercise>();
        }

        private void OnEnable()
        {
            calm = new InputAction("Calm Now", InputActionType.Button);
            calm.AddBinding("<XRController>{LeftHand}/{PrimaryButton}");
            calm.AddBinding("<XRController>{RightHand}/{PrimaryButton}");
            calm.Enable();
        }

        private void OnDisable()
        {
            calm.Disable();
            calm.Dispose();
            calm = null;
            Unsubscribe();
        }

        private void Update()
        {
            AnxietyDirector director = AnxietyDirector.Instance;
            if (director != subscribedTo)
            {
                Unsubscribe();
                if (director != null)
                {
                    subscribedTo = director;
                    subscribedTo.CalmNowRequested += OnCalmNow;
                }
            }

            if (director != null && calm.WasPressedThisFrame())
            {
                director.CalmNow();
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

        private void OnCalmNow()
        {
            if (grounding != null && grounding.IsRunning)
            {
                grounding.Stop();
            }
            if (breathing != null && !breathing.IsRunning)
            {
                breathing.Begin(false);
            }
        }
    }
}
