using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Anxineers.UI
{
    /// <summary>
    /// A simple world-space panel built at runtime (no prefab, no TextMeshPro setup needed).
    /// It is placed once in front of the user when it appears and then stays fixed in the world, it never follows the head.
    /// Two layouts: a feedback layout (title, progress dots, status line, microphone level bar, heard words) used by
    /// the grounding exercise, and a message layout (title, body text, hint) used for consent, intro and similar screens.
    /// </summary>
    public class PromptPanel : MonoBehaviour
    {
        [SerializeField, Range(0.8f, 3f)] private float distance = 1.6f;
        [SerializeField, Range(-0.5f, 0.5f)] private float heightOffset = -0.05f;
        [SerializeField] private Vector2 size = new Vector2(900f, 560f);
        [SerializeField, Range(24, 90)] private int titleFontSize = 50;
        [SerializeField, Range(18, 60)] private int bodyFontSize = 34;
        [SerializeField] private Color backgroundColor = new Color(0.05f, 0.07f, 0.10f, 0.80f);
        [SerializeField] private Color textColor = new Color(0.95f, 0.96f, 0.98f, 1f);
        [SerializeField] private Color doneColor = new Color(0.45f, 0.85f, 0.65f, 1f);
        [SerializeField] private Color pendingColor = new Color(0.35f, 0.40f, 0.46f, 1f);
        [SerializeField] private Color levelColor = new Color(0.55f, 0.80f, 1f, 1f);

        private Canvas canvas;
        private Text title;
        private Text body;
        private Text status;
        private Text heard;
        private RectTransform dotsRow;
        private RectTransform levelBackground;
        private RectTransform levelFill;
        private readonly List<Image> dots = new List<Image>();
        private int dotTotal = -1;

        public bool IsVisible { get; private set; }

        /// <summary>Feedback layout: prompt as title, plus dots, status, level and heard words. Use the Set methods to fill it.</summary>
        public void Show(string titleText, string heardText = "")
        {
            Build();
            ApplyLayout(false);
            Appear();
            title.text = titleText ?? string.Empty;
            heard.text = heardText ?? string.Empty;
        }

        /// <summary>Message layout: title, body text and a hint line at the bottom.</summary>
        public void ShowMessage(string titleText, string bodyText, string hint = "")
        {
            Build();
            ApplyLayout(true);
            Appear();
            title.text = titleText ?? string.Empty;
            body.text = bodyText ?? string.Empty;
            status.text = hint ?? string.Empty;
        }

        public void Hide()
        {
            if (canvas != null)
            {
                canvas.enabled = false;
            }
            IsVisible = false;
        }

        /// <summary>Fills "done" of "total" progress dots.</summary>
        public void SetProgress(int done, int total)
        {
            Build();
            if (total != dotTotal)
            {
                RebuildDots(total);
            }
            for (int i = 0; i < dots.Count; i++)
            {
                dots[i].color = i < done ? doneColor : pendingColor;
            }
        }

        public void SetStatus(string text)
        {
            Build();
            status.text = text ?? string.Empty;
        }

        public void SetHeard(string text)
        {
            Build();
            heard.text = text ?? string.Empty;
        }

        /// <summary>Shows the microphone level bar (0..1). Pass a negative value to hide it.</summary>
        public void SetLevel(float level01)
        {
            Build();
            bool show = level01 >= 0f;
            levelBackground.gameObject.SetActive(show);
            if (show)
            {
                levelFill.anchorMax = new Vector2(Mathf.Clamp01(level01), 1f);
            }
        }

        private void Appear()
        {
            if (!IsVisible)
            {
                Place();
                canvas.enabled = true;
                IsVisible = true;
            }
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

        private void ApplyLayout(bool message)
        {
            body.gameObject.SetActive(message);
            heard.gameObject.SetActive(!message);
            dotsRow.gameObject.SetActive(!message);
            if (message)
            {
                levelBackground.gameObject.SetActive(false);
                SetAnchors(title.rectTransform, 0.05f, 0.78f, 0.95f, 0.97f);
                SetAnchors(status.rectTransform, 0.05f, 0.03f, 0.95f, 0.17f);
            }
            else
            {
                SetAnchors(title.rectTransform, 0.05f, 0.62f, 0.95f, 0.97f);
                SetAnchors(status.rectTransform, 0.05f, 0.36f, 0.95f, 0.46f);
                body.text = string.Empty;
            }
        }

        private void RebuildDots(int total)
        {
            foreach (Image dot in dots)
            {
                if (dot != null)
                {
                    Destroy(dot.gameObject);
                }
            }
            dots.Clear();
            dotTotal = total;
            for (int i = 0; i < total; i++)
            {
                var go = new GameObject("Dot " + (i + 1));
                go.transform.SetParent(dotsRow, false);
                var image = go.AddComponent<Image>();
                image.color = pendingColor;
                image.rectTransform.sizeDelta = new Vector2(40f, 40f);
                dots.Add(image);
            }
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
            SetAnchors(bg.rectTransform, 0f, 0f, 1f, 1f);

            Font font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            title = MakeText("Title", font, titleFontSize, 0.05f, 0.62f, 0.95f, 0.97f);
            body = MakeText("Body", font, bodyFontSize, 0.07f, 0.20f, 0.93f, 0.78f);
            body.alignment = TextAnchor.UpperCenter;
            status = MakeText("Status", font, bodyFontSize, 0.05f, 0.36f, 0.95f, 0.46f);
            heard = MakeText("Heard", font, bodyFontSize, 0.07f, 0.03f, 0.93f, 0.27f);

            var rowGo = new GameObject("Dots");
            rowGo.transform.SetParent(canvasGo.transform, false);
            dotsRow = rowGo.AddComponent<RectTransform>();
            SetAnchors(dotsRow, 0.05f, 0.48f, 0.95f, 0.60f);
            var layout = rowGo.AddComponent<HorizontalLayoutGroup>();
            layout.childAlignment = TextAnchor.MiddleCenter;
            layout.spacing = 22f;
            layout.childControlWidth = false;
            layout.childControlHeight = false;
            layout.childForceExpandWidth = false;
            layout.childForceExpandHeight = false;

            var barGo = new GameObject("Level Background");
            barGo.transform.SetParent(canvasGo.transform, false);
            var barImage = barGo.AddComponent<Image>();
            barImage.color = pendingColor;
            levelBackground = barImage.rectTransform;
            SetAnchors(levelBackground, 0.2f, 0.29f, 0.8f, 0.33f);

            var fillGo = new GameObject("Level Fill");
            fillGo.transform.SetParent(barGo.transform, false);
            var fillImage = fillGo.AddComponent<Image>();
            fillImage.color = levelColor;
            levelFill = fillImage.rectTransform;
            SetAnchors(levelFill, 0f, 0f, 0f, 1f);

            levelBackground.gameObject.SetActive(false);
            body.gameObject.SetActive(false);
        }

        private Text MakeText(string objectName, Font font, int fontSize, float x0, float y0, float x1, float y1)
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
            SetAnchors(text.rectTransform, x0, y0, x1, y1);
            return text;
        }

        private static void SetAnchors(RectTransform rt, float x0, float y0, float x1, float y1)
        {
            rt.anchorMin = new Vector2(x0, y0);
            rt.anchorMax = new Vector2(x1, y1);
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
        }
    }
}
