using Anxineers.Core;
using UnityEditor;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// Live tuning window for Play Mode: state buttons, calm now, intensity cap, profile swap/duplicate/save,
    /// and the full profile inspector so curves and speeds can be tweaked while the scene runs.
    /// </summary>
    public class AnxietyTuningWindow : EditorWindow
    {
        private Vector2 scroll;
        private UnityEditor.Editor profileEditor;

        [MenuItem("Anxineers/Tuning Window")]
        public static void Open()
        {
            GetWindow<AnxietyTuningWindow>("Anxiety Tuning");
        }

        private void OnInspectorUpdate()
        {
            Repaint();
        }

        private void OnDisable()
        {
            if (profileEditor != null)
            {
                DestroyImmediate(profileEditor);
            }
        }

        private void OnGUI()
        {
            AnxietyDirector director = AnxietyDirector.Instance;
            if (director == null)
            {
                EditorGUILayout.HelpBox(
                    "Enter Play Mode in a scene with an AnxietyDirector (Sandbox, after running Anxineers > Phase 2 > Add Core Test Objects).",
                    MessageType.Info);
                return;
            }

            scroll = EditorGUILayout.BeginScrollView(scroll);

            EditorGUILayout.LabelField("State", director.State.ToString(), EditorStyles.boldLabel);
            DrawBar("Intensity (final)", director.Intensity);
            DrawBar("Raw intensity", director.RawIntensity);
            DrawBar("Target", director.TargetIntensity);
            DrawBar("Gaze", director.GlobalGaze);
            EditorGUILayout.LabelField("Time in state", director.TimeInState.ToString("0.0") + " s");

            EditorGUILayout.Space();
            using (new EditorGUILayout.HorizontalScope())
            {
                foreach (AnxietyState state in System.Enum.GetValues(typeof(AnxietyState)))
                {
                    if (GUILayout.Button(state.ToString()))
                    {
                        director.SetState(state);
                    }
                }
            }

            Color previous = GUI.backgroundColor;
            GUI.backgroundColor = new Color(1f, 0.55f, 0.45f);
            if (GUILayout.Button("CALM NOW", GUILayout.Height(28)))
            {
                director.CalmNow();
            }
            GUI.backgroundColor = previous;

            director.AutoAdvance = EditorGUILayout.Toggle("Auto advance", director.AutoAdvance);
            float cap = EditorGUILayout.Slider("Intensity cap", director.IntensityCap, 0f, 1f);
            if (!Mathf.Approximately(cap, director.IntensityCap))
            {
                director.SetIntensityCap(cap);
            }

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Profile", EditorStyles.boldLabel);
            var picked = (AnxietyProfile)EditorGUILayout.ObjectField("Active profile", director.Profile, typeof(AnxietyProfile), false);
            if (picked != null && picked != director.Profile)
            {
                director.SetProfile(picked);
            }

            AnxietyProfile profile = director.Profile;
            string path = profile != null ? AssetDatabase.GetAssetPath(profile) : string.Empty;
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(path)))
                {
                    if (GUILayout.Button("Duplicate as new profile"))
                    {
                        string copy = AssetDatabase.GenerateUniqueAssetPath(path);
                        if (AssetDatabase.CopyAsset(path, copy))
                        {
                            director.SetProfile(AssetDatabase.LoadAssetAtPath<AnxietyProfile>(copy));
                        }
                    }
                    if (GUILayout.Button("Save profile"))
                    {
                        EditorUtility.SetDirty(profile);
                        AssetDatabase.SaveAssets();
                    }
                }
            }

            if (profile != null)
            {
                UnityEditor.Editor.CreateCachedEditor(profile, null, ref profileEditor);
                profileEditor.OnInspectorGUI();
            }

            EditorGUILayout.EndScrollView();
        }

        private static void DrawBar(string label, float value)
        {
            Rect rect = EditorGUILayout.GetControlRect();
            EditorGUI.ProgressBar(rect, Mathf.Clamp01(value), label + "  " + value.ToString("0.00"));
        }
    }
}
