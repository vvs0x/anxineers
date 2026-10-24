using UnityEngine;
using UnityEngine.InputSystem;

namespace Anxineers.Session
{
    /// <summary>
    /// Keyboard shortcuts for testing the exercises without the headset.
    /// S = start the full session, G = start grounding, B = start breathing, Backspace = skip the current grounding step, Escape = stop everything.
    /// In manual voice mode, Enter counts as one spoken item.
    /// </summary>
    public class SessionShortcuts : MonoBehaviour
    {
        [SerializeField] private GroundingExercise grounding;
        [SerializeField] private BreathingExercise breathing;
        [SerializeField] private SessionController session;
        [SerializeField] private Anxineers.Effects.SplatEnvironment environment;

        private void Awake()
        {
            if (grounding == null) grounding = FindFirstObjectByType<GroundingExercise>();
            if (breathing == null) breathing = FindFirstObjectByType<BreathingExercise>();
            if (session == null) session = FindFirstObjectByType<SessionController>();
            if (environment == null) environment = FindFirstObjectByType<Anxineers.Effects.SplatEnvironment>();
        }

        private void Update()
        {
            Keyboard kb = Keyboard.current;
            if (kb == null)
            {
                return;
            }

            if (kb.gKey.wasPressedThisFrame && grounding != null) grounding.Begin();
            if (kb.bKey.wasPressedThisFrame && breathing != null) breathing.Begin();
            if (kb.backspaceKey.wasPressedThisFrame && grounding != null) grounding.SkipStep();
            if (kb.sKey.wasPressedThisFrame && session != null) session.Begin();
            if (kb.vKey.wasPressedThisFrame && environment != null) environment.Cycle();
            if (kb.escapeKey.wasPressedThisFrame)
            {
                if (session != null) session.Abort();
                if (grounding != null) grounding.Stop();
                if (breathing != null) breathing.Stop();
            }
        }
    }
}
