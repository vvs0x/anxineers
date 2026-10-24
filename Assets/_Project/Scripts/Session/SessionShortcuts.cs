using UnityEngine;
using UnityEngine.InputSystem;

namespace Anxineers.Session
{
    /// <summary>
    /// Keyboard shortcuts for testing the exercises without the headset.
    /// G = start grounding, B = start breathing, Backspace = skip the current grounding step, Escape = stop both.
    /// In manual voice mode, Enter counts as one spoken item.
    /// </summary>
    public class SessionShortcuts : MonoBehaviour
    {
        [SerializeField] private GroundingExercise grounding;
        [SerializeField] private BreathingExercise breathing;

        private void Awake()
        {
            if (grounding == null) grounding = FindFirstObjectByType<GroundingExercise>();
            if (breathing == null) breathing = FindFirstObjectByType<BreathingExercise>();
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
            if (kb.escapeKey.wasPressedThisFrame)
            {
                if (grounding != null) grounding.Stop();
                if (breathing != null) breathing.Stop();
            }
        }
    }
}
