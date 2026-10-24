using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Anxineers.UI
{
    /// <summary>
    /// A calm world-space panel built at runtime (no prefab, no TextMeshPro setup needed). Soft translucent boxes with round
    /// corners, a custom font, round progress dots and a slowly pulsing soft orb that shows the system is listening.
    /// It is placed once in front of the user when it appears and then stays fixed in the world, it never follows the head.
    /// Two layouts: feedback (title, dots, listening orb, status pill, heard words) used by the grounding exercise, and
    /// message (title, body box, hint pill) used for consent, intro, choices and similar screens.
    /// Font: put CalycesInc-Regular (.ttf or .otf) into Assets/_Project/Resources/Fonts/. Without it a plain default font is used.
    /// </summary>
    public class PromptPanel : MonoBehaviour
    {
        [Header("Placement")]
        [Tooltip("Distance in front of the user in meters. Kept close so the panel is never behind a wall.")]
        [SerializeField, Range(0.6f, 2.5f)] private float distance = 1.0f;
        [SerializeField, Range(-0.5f, 0.5f)] private float heightOffset = -0.03f;
        [Tooltip("Meters per canvas unit. 0.0007 makes the 900 wide panel 0.63 m wide.")]
        [SerializeField, Range(0.0003f, 0.002f)] private float worldScale = 0.0007f;
        [SerializeField] private Vector2 size = new Vector2(900f, 640f);

        [Header("Font")]
        [Tooltip("Optional. If empty, Resources/Fonts/<Font Resource Name> is tried, then the built-in font.")]
        [SerializeField] private Font font;
        [SerializeField] private string fontResourceName = "CalycesInc-Regular";
        [SerializeField, Range(24, 90)] private int titleFontSize = 52;
        [SerializeField, Range(18, 60)] private int bodyFontSize = 36;

        [Header("Look")]
        [SerializeField] private Color panelColor = new Color(0.07f, 0.12f, 0.16f, 0.42f);
        [SerializeField] private Color boxColor = new Color(1f, 1f, 1f, 0.10f);
        [SerializeField] private Color textColor = new Color(0.96f, 0.97f, 0.98f, 1f);
        [SerializeField] private Color doneColor = new Color(0.62f, 0.90f, 0.78f, 0.95f);
        [SerializeField] private Color pendingColor = new Color(1f, 1f, 1f, 0.22f);
        [SerializeField] private Color orbColor = new Color(0.60f, 0.82f, 1f, 1f);

        [Header("Listening orb")]
        [Tooltip("Breaths per second of the orb. Slow on purpose.")]
        [SerializeField, Range(0.1f, 0.8f)] private float orbPulseHz = 0.3f;
        [Tooltip("How much the orb pulses by itself (0.08 = 8%).")]
        [SerializeField, Range(0f, 0.3f)] private float orbPulseAmount = 0.08f;
        [Tooltip("How much the voice can swell the orb. Smoothed, so it never flickers.")]
        [SerializeField, Range(0f, 0.6f)] private float orbVoiceGrowth = 0.22f;
        [Tooltip("Seconds the voice level is smoothed over. Higher is calmer.")]
        [SerializeField, Range(0.1f, 1.5f)] private float orbSmoothing = 0.5f;

        private Canvas canvas;
        private Image panel;
        private Text title;
        private Text body;
        private Text status;
        private Text heard;
        private RectTransform bodyBox;
        private RectTransform statusBox;
        private RectTransform heardBox;
        private RectTransform dotsRow;
        private RectTransform orbRoot;
        private Image orbGlow;
        private Image orbCore;
        private readonly List<Image> dots = new List<Image>();
        private int dotTotal = -1;

        private bool orbWanted;
        private float orbAlpha;
        private float levelTarget;
        private float levelSmooth;
        private float levelVelocity;

        private static Sprite roundedSprite;
        private static Sprite circleSprite;
        private static Sprite softSprite;

        public bool IsVisible { get; private set; }

        /// <summary>Feedback layout: prompt as title, plus dots, orb, status and heard words. Use the Set methods to fill it.</summary>
        public void Show(string titleText, string heardText = "")
        {
            Build();
            ApplyLayout(false);
            Appear();
            title.text = titleText ?? string.Empty;
            SetHeard(heardText);
        }

        /// <summary>Message layout: title, body text and a hint line at the bottom.</summary>
        public void ShowMessage(string titleText, string bodyText, string hint = "")
        {
            Build();
            ApplyLayout(true);
            Appear();
            title.text = titleText ?? string.Empty;
            body.text = bodyText ?? string.Empty;
            SetStatus(hint);
        }

        public void Hide()
        {
            if (canvas != null)
            {
                canvas.enabled = false;
            }
            IsVisible = false;
            orbWanted = false;
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
            statusBox.gameObject.SetActive(!string.IsNullOrEmpty(status.text));
        }

        public void SetHeard(string text)
        {
            Build();
            heard.text = text ?? string.Empty;
            heardBox.gameObject.SetActive(!feedbackHeardHidden && !string.IsNullOrEmpty(heard.text));
        }

        /// <summary>Shows the listening orb. The level (0..1) gently swells it. Pass a negative value to hide it.</summary>
        public void SetLevel(float level01)
        {
            Build();
            orbWanted = level01 >= 0f;
            levelTarget = Mathf.Clamp01(level01);
        }

        private bool feedbackHeardHidden;

        private void Update()
        {
            if (canvas == null || !canvas.enabled)
            {
                return;
            }

            float dt = Time.unscaledDeltaTime;
            orbAlpha = Mathf.MoveTowards(orbAlpha, orbWanted ? 1f : 0f, dt / 0.6f);
            orbRoot.gameObject.SetActive(orbAlpha > 0.01f);
            if (orbAlpha <= 0.01f)
            {
                return;
            }

            levelSmooth = Mathf.SmoothDamp(levelSmooth, orbWanted ? levelTarget : 0f, ref levelVelocity, orbSmoothing);
            float pulse = 1f + orbPulseAmount * Mathf.Sin(2f * Mathf.PI * orbPulseHz * Time.unscaledTime);
            float scale = pulse * (1f + orbVoiceGrowth * levelSmooth);
            orbRoot.localScale = new Vector3(scale, scale, 1f);

            Color glow = orbColor;
            glow.a = 0.28f * orbAlpha;
            orbGlow.color = glow;
            Color core = orbColor;
            core.a = (0.55f + 0.25f * levelSmooth) * orbAlpha;
            orbCore.color = core;
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
            feedbackHeardHidden = message;
            bodyBox.gameObject.SetActive(message);
            dotsRow.gameObject.SetActive(!message);
            if (message)
            {
                orbWanted = false;
                SetAnchors(title.rectTransform, 0.06f, 0.78f, 0.94f, 0.96f);
                SetAnchors(bodyBox, 0.07f, 0.25f, 0.93f, 0.76f);
                SetAnchors(statusBox, 0.14f, 0.06f, 0.86f, 0.18f);
                heardBox.gameObject.SetActive(false);
            }
            else
            {
                SetAnchors(title.rectTransform, 0.06f, 0.76f, 0.94f, 0.96f);
                SetAnchors(statusBox, 0.15f, 0.25f, 0.85f, 0.34f);
                SetAnchors(heardBox, 0.08f, 0.04f, 0.92f, 0.21f);
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
                image.sprite = CircleSprite();
                image.color = pendingColor;
                image.rectTransform.sizeDelta = new Vector2(34f, 34f);
                dots.Add(image);
            }
        }

        private void Build()
        {
            if (canvas != null)
            {
                return;
            }

            if (font == null)
            {
                font = Resources.Load<Font>("Fonts/" + fontResourceName);
                if (font == null)
                {
                    Debug.LogWarning("[Anxineers] Font 'Resources/Fonts/" + fontResourceName + "' not found, using the default font.");
                    font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                }
            }

            var canvasGo = new GameObject("Prompt Canvas");
            canvasGo.transform.SetParent(transform, false);
            canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            canvas.enabled = false;

            var rect = canvas.GetComponent<RectTransform>();
            rect.sizeDelta = size;
            rect.localScale = Vector3.one * worldScale;

            var panelGo = new GameObject("Panel");
            panelGo.transform.SetParent(canvasGo.transform, false);
            panel = panelGo.AddComponent<Image>();
            panel.sprite = RoundedSprite();
            panel.type = Image.Type.Sliced;
            panel.color = panelColor;
            SetAnchors(panel.rectTransform, 0f, 0f, 1f, 1f);

            title = MakeText("Title", canvas.transform, titleFontSize, TextAnchor.MiddleCenter);

            bodyBox = MakeBox("Body Box", canvas.transform);
            body = MakeText("Body", bodyBox, bodyFontSize, TextAnchor.UpperCenter);
            Pad(body.rectTransform, 30f, 24f);

            statusBox = MakeBox("Status Pill", canvas.transform);
            status = MakeText("Status", statusBox, bodyFontSize - 4, TextAnchor.MiddleCenter);
            Pad(status.rectTransform, 24f, 6f);

            heardBox = MakeBox("Heard Box", canvas.transform);
            heard = MakeText("Heard", heardBox, bodyFontSize, TextAnchor.MiddleCenter);
            Pad(heard.rectTransform, 28f, 10f);

            var rowGo = new GameObject("Dots");
            rowGo.transform.SetParent(canvas.transform, false);
            dotsRow = rowGo.AddComponent<RectTransform>();
            SetAnchors(dotsRow, 0.06f, 0.65f, 0.94f, 0.75f);
            var layout = rowGo.AddComponent<HorizontalLayoutGroup>();
            layout.childAlignment = TextAnchor.MiddleCenter;
            layout.spacing = 26f;
            layout.childControlWidth = false;
            layout.childControlHeight = false;
            layout.childForceExpandWidth = false;
            layout.childForceExpandHeight = false;

            // Listening orb: two soft discs, a wide faint glow and a smaller core.
            var orbGo = new GameObject("Listening Orb");
            orbGo.transform.SetParent(canvas.transform, false);
            orbRoot = orbGo.AddComponent<RectTransform>();
            orbRoot.anchorMin = orbRoot.anchorMax = new Vector2(0.5f, 0.5f);
            orbRoot.anchoredPosition = new Vector2(0f, 20f);
            orbRoot.sizeDelta = new Vector2(200f, 200f);
            orbGlow = MakeSoftDisc("Glow", orbRoot, 320f);
            orbCore = MakeSoftDisc("Core", orbRoot, 170f);
            orbRoot.gameObject.SetActive(false);

            bodyBox.gameObject.SetActive(false);
            statusBox.gameObject.SetActive(false);
            heardBox.gameObject.SetActive(false);
        }

        private Image MakeSoftDisc(string objectName, Transform parent, float diameter)
        {
            var go = new GameObject(objectName);
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.sprite = SoftSprite();
            image.raycastTarget = false;
            image.rectTransform.anchorMin = image.rectTransform.anchorMax = new Vector2(0.5f, 0.5f);
            image.rectTransform.anchoredPosition = Vector2.zero;
            image.rectTransform.sizeDelta = new Vector2(diameter, diameter);
            image.color = new Color(orbColor.r, orbColor.g, orbColor.b, 0f);
            return image;
        }

        private RectTransform MakeBox(string objectName, Transform parent)
        {
            var go = new GameObject(objectName);
            go.transform.SetParent(parent, false);
            var image = go.AddComponent<Image>();
            image.sprite = RoundedSprite();
            image.type = Image.Type.Sliced;
            image.color = boxColor;
            image.raycastTarget = false;
            return image.rectTransform;
        }

        private Text MakeText(string objectName, Transform parent, int fontSize, TextAnchor alignment)
        {
            var go = new GameObject(objectName);
            go.transform.SetParent(parent, false);
            var text = go.AddComponent<Text>();
            text.font = font;
            text.fontSize = fontSize;
            text.color = textColor;
            text.alignment = alignment;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.raycastTarget = false;
            SetAnchors(text.rectTransform, 0f, 0f, 1f, 1f);
            return text;
        }

        private static void Pad(RectTransform rt, float horizontal, float vertical)
        {
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = new Vector2(horizontal, vertical);
            rt.offsetMax = new Vector2(-horizontal, -vertical);
        }

        private static void SetAnchors(RectTransform rt, float x0, float y0, float x1, float y1)
        {
            rt.anchorMin = new Vector2(x0, y0);
            rt.anchorMax = new Vector2(x1, y1);
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
        }

        // ---- Procedural sprites (no image assets needed) --------------------------------------------------------

        private static Sprite RoundedSprite()
        {
            if (roundedSprite != null)
            {
                return roundedSprite;
            }
            const int n = 128;
            const float radius = 44f;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            Vector2 half = new Vector2(n / 2f, n / 2f);
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    Vector2 p = new Vector2(x + 0.5f, y + 0.5f) - half;
                    Vector2 q = new Vector2(Mathf.Abs(p.x), Mathf.Abs(p.y)) - (half - Vector2.one * radius);
                    float outside = new Vector2(Mathf.Max(q.x, 0f), Mathf.Max(q.y, 0f)).magnitude;
                    float inside = Mathf.Min(Mathf.Max(q.x, q.y), 0f);
                    float distanceToEdge = outside + inside - radius;
                    float alpha = Mathf.Clamp01(0.5f - distanceToEdge);
                    tex.SetPixel(x, y, new Color(1f, 1f, 1f, alpha));
                }
            }
            tex.Apply();
            roundedSprite = Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect, new Vector4(radius + 4f, radius + 4f, radius + 4f, radius + 4f));
            return roundedSprite;
        }

        private static Sprite CircleSprite()
        {
            if (circleSprite != null)
            {
                return circleSprite;
            }
            const int n = 64;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f));
                    tex.SetPixel(x, y, new Color(1f, 1f, 1f, Mathf.Clamp01(n / 2f - d)));
                }
            }
            tex.Apply();
            circleSprite = Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f), 100f);
            return circleSprite;
        }

        private static Sprite SoftSprite()
        {
            if (softSprite != null)
            {
                return softSprite;
            }
            const int n = 128;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f)) / (n / 2f);
                    float a = Mathf.Clamp01(1f - d);
                    a = a * a * (3f - 2f * a);
                    tex.SetPixel(x, y, new Color(1f, 1f, 1f, a));
                }
            }
            tex.Apply();
            softSprite = Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f), 100f);
            return softSprite;
        }
    }
}
