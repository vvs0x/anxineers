using UnityEngine;
using UnityEngine.UI;

namespace Anxineers.UI
{
    /// <summary>
    /// A simple world-space text panel built at runtime (no prefab, no TextMeshPro setup needed).
    /// It is placed once in front of the user when it appears and then stays fixed in the world, it never follows the head.
    /// </summary>
    public class PromptPanel : MonoBehaviour
    {
        [SerializeField, Range(0.8f, 3f)] private float distance = 1.6f;
        [SerializeField, Range(-0.5f, 0.5f)] private float heightOffset = -0.05f;
        [SerializeField] private Vector2 size = new Vector2(900f, 420f);
        [SerializeField, Range(24, 90)] private int titleFontSize = 52;
        [SerializeField, Range(18, 60)] private int subtitleFontSize = 34;
        [SerializeField] private Color backgroundColor = new Color(0.05f, 0.07f, 0.10f, 0.78f);
        [SerializeField] private Color textColor = new Color(0.95f, 0.96f, 0.98f, 1f);

        private Canvas canvas;
        private Text title;
        private Text subtitle;

        public bool IsVisible { get; private set; }

        /// <summary>Shows or updates the panel. Position is only chosen when it first appears.</summary>
        public void Show(string titleText, string subtitleText = "")
        {
            Build();
            if (!IsVisible)
            {
                Place();
                canvas.enabled = true;
                IsVisible = true;
            }
            title.text = titleText ?? string.Empty;
            subtitle.text = subtitleText ?? string.Empty;
        }

        public void Hide()
        {
            if (canvas != null)
            {
                canvas.enabled = false;
            }
            IsVisible = false;
        }

        private void Place()
        {
            Camera cam = Camera.main;
            if (cam == null)
            {
                return;
            }
            Vector3 forward = cam.transform.forward;
            forward.y = 0f;
            if (forward.sqrMagnitude < 0.01f)
            {
                forward = Vector3.forward;
            }
            forward.Normalize();
            transform.SetPositionAndRotation(
                cam.transform.position + forward * distance + Vector3.up * heightOffset,
                Quaternion.LookRotation(forward, Vector3.up));
        }

        private void Build()
        {
            if (canvas != null)
            {
                return;
            }

            var canvasGo = new GameObject("Prompt Canvas");
            canvasGo.transform.SetParent(transform, false);
            canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.enabled = false;

            var rect = canvas.GetComponent<RectTransform>();
            rect.sizeDelta = size;
            rect.localScale = Vector3.one * 0.001f;

            var bgGo = new GameObject("Background");
            bgGo.transform.SetParent(canvasGo.transform, false);
            var bg = bgGo.AddComponent<Image>();
            bg.color = backgroundColor;
            Stretch(bg.rectTransform, Vector2.zero, Vector2.one);

            Font font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            title = MakeText("Title", font, titleFontSize, new Vector2(0.06f, 0.35f), new Vector2(0.94f, 0.95f));
            subtitle = MakeText("Subtitle", font, subtitleFontSize, new Vector2(0.06f, 0.05f), new Vector2(0.94f, 0.35f));
        }

        private Text MakeText(string objectName, Font font, int fontSize, Vector2 anchorMin, Vector2 anchorMax)
        {
            var go = new GameObject(objectName);
            go.transform.SetParent(canvas.transform, false);
            var text = go.AddComponent<Text>();
            text.font = font;
            text.fontSize = fontSize;
            text.color = textColor;
            text.alignment = TextAnchor.MiddleCenter;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            Stretch(text.rectTransform, anchorMin, anchorMax);
            return text;
        }

        private static void Stretch(RectTransform rt, Vector2 anchorMin, Vector2 anchorMax)
        {
            rt.anchorMin = anchorMin;
            rt.anchorMax = anchorMax;
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
        }
    }
}
