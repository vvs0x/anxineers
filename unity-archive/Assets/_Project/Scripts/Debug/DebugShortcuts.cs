using Anxineers.Core;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Anxineers.DebugTools
{
    /// <summary>
    /// Keyboard and gamepad shortcuts for testing without the headset.
    /// 1-4 = Calm/Build/Peak/Recovery, Space or gamepad south = calm now, Up/Down = cap +/- 0.1.
    /// </summary>
    public class DebugShortcuts : MonoBehaviour
    {
        [SerializeField, Range(0.01f, 0.5f)] private float capStep = 0.1f;

        private void Update()
        {
            AnxietyDirector director = AnxietyDirector.Instance;
            if (director == null)
            {
                return;
            }

            Keyboard kb = Keyboard.current;
            if (kb != null)
            {
                // Calm now always works, also in release builds (a facilitator can press Space).
                if (kb.spaceKey.wasPressedThisFrame) director.CalmNow();
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                // State and cap shortcuts exist only for testing. A release build must never let the keyboard raise the user's cap.
                if (kb.digit1Key.wasPressedThisFrame) director.SetState(AnxietyState.Calm);
                if (kb.digit2Key.wasPressedThisFrame) director.SetState(AnxietyState.Build);
                if (kb.digit3Key.wasPressedThisFrame) director.SetState(AnxietyState.Peak);
                if (kb.digit4Key.wasPressedThisFrame) director.SetState(AnxietyState.Recovery);
                if (kb.upArrowKey.wasPressedThisFrame) director.SetIntensityCap(director.IntensityCap + capStep);
                if (kb.downArrowKey.wasPressedThisFrame) director.SetIntensityCap(director.IntensityCap - capStep);
#endif
            }

            Gamepad pad = Gamepad.current;
            if (pad != null)
            {
                if (pad.buttonSouth.wasPressedThisFrame) director.CalmNow();
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                if (pad.dpad.up.wasPressedThisFrame) director.SetIntensityCap(director.IntensityCap + capStep);
                if (pad.dpad.down.wasPressedThisFrame) director.SetIntensityCap(director.IntensityCap - capStep);
#endif
            }
        }
    }
}
