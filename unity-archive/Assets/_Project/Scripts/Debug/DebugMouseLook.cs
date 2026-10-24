using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;

namespace Anxineers.DebugTools
{
    /// <summary>
    /// Editor-only fake head for testing on a computer without a headset: hold the right mouse button and move to look,
    /// and use W A S D (Q down, E up) while holding it to walk around, like the Scene view. Walking exists only here, never in a build.
    /// Disables itself whenever a real headset is present, so the camera is never moved independently of head motion.
    /// </summary>
    public class DebugMouseLook : MonoBehaviour
    {
        [SerializeField, Min(0.01f)] private float degreesPerPixel = 0.15f;
        [SerializeField, Min(0.1f)] private float walkSpeed = 1.5f;

        private float yaw;
        private float pitch;

#if UNITY_EDITOR
        private void Start()
        {
            Vector3 euler = transform.localEulerAngles;
            yaw = euler.y;
            pitch = euler.x > 180f ? euler.x - 360f : euler.x;
        }

        private void Update()
        {
            if (InputSystem.GetDevice<XRHMD>() != null)
            {
                return;
            }

            Mouse mouse = Mouse.current;
            if (mouse == null || !mouse.rightButton.isPressed)
            {
                return;
            }

            Vector2 delta = mouse.delta.ReadValue();
            yaw += delta.x * degreesPerPixel;
            pitch = Mathf.Clamp(pitch - delta.y * degreesPerPixel, -80f, 80f);
            transform.localRotation = Quaternion.Euler(pitch, yaw, 0f);

            Keyboard kb = Keyboard.current;
            if (kb != null)
            {
                Vector3 flat = Quaternion.Euler(0f, transform.eulerAngles.y, 0f) * Vector3.forward;
                Vector3 side = Quaternion.Euler(0f, transform.eulerAngles.y, 0f) * Vector3.right;
                Vector3 move = Vector3.zero;
                if (kb.wKey.isPressed) move += flat;
                if (kb.sKey.isPressed) move -= flat;
                if (kb.dKey.isPressed) move += side;
                if (kb.aKey.isPressed) move -= side;
                if (kb.eKey.isPressed) move += Vector3.up;
                if (kb.qKey.isPressed) move -= Vector3.up;
                transform.position += move * (walkSpeed * Time.deltaTime);
            }
        }
#endif
    }
}
