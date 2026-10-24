using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;

namespace Anxineers.DebugTools
{
    /// <summary>
    /// Editor-only fake head for testing on a computer without a headset: hold the right mouse button and move.
    /// Disables itself whenever a real headset is present, so the camera is never moved independently of head motion.
    /// </summary>
    public class DebugMouseLook : MonoBehaviour
    {
        [SerializeField, Min(0.01f)] private float degreesPerPixel = 0.15f;

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
        }
#endif
    }
}
