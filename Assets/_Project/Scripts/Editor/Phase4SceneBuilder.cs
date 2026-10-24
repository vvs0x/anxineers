using System.IO;
using Anxineers.Gaze;
using Anxineers.Session;
using Anxineers.UI;
using Anxineers.Voice;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// Adds the grounding exercise, short breathing ending, voice input, prompt panel and helper objects to the Sandbox.
    /// Safe to run again, it replaces its own objects.
    /// </summary>
    public static class Phase4SceneBuilder
    {
        private const string SandboxPath = "Assets/_Project/Scenes/Sandbox.unity";
        private const string RootName = "Grounding And Breathing";
        private const string ItemsName = "Grounding Items";
        private const string OrbName = "Breathing Orb";

        [MenuItem("Anxineers/Phase 4/Add Grounding And Breathing To Sandbox")]
        public static void Build()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return;
            }

            var scene = EditorSceneManager.OpenScene(SandboxPath);
            DestroyIfExists(RootName);
            DestroyIfExists(ItemsName);
            DestroyIfExists(OrbName);

            var root = new GameObject(RootName);
            root.AddComponent<VoiceInput>();
            root.AddComponent<PromptPanel>();
            root.AddComponent<BreathingExercise>();
            root.AddComponent<GroundingExercise>();
            root.AddComponent<SessionShortcuts>();
            root.AddComponent<SessionController>();
            root.AddComponent<CalmNowInput>();

            var orb = new GameObject(OrbName);
            var visual = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            visual.name = "Orb Visual";
            Object.DestroyImmediate(visual.GetComponent<Collider>());
            visual.transform.SetParent(orb.transform, false);
            visual.GetComponent<Renderer>().sharedMaterial = GetMaterial("BreathingOrb", new Color(0.45f, 0.75f, 0.95f));
            orb.AddComponent<BreathingOrb>();

            BuildItems();

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            UnityEngine.Debug.Log("[Anxineers] Grounding and breathing added to Sandbox. Play, then press G (grounding) or B (breathing). Enter = one spoken item in manual voice mode.");
        }

        private static void BuildItems()
        {
            var root = new GameObject(ItemsName);
            Material seeMat = GetMaterial("GroundingItem", new Color(0.35f, 0.4f, 0.45f));

            // 5 things to see: spheres in a wide arc at head height.
            float[] seeAngles = { -75f, -40f, 0f, 40f, 75f };
            float[] seeHeights = { 1.9f, 1.3f, 2.1f, 1.4f, 1.8f };
            for (int i = 0; i < seeAngles.Length; i++)
            {
                GameObject go = MakeItem(root, "See " + (i + 1), PrimitiveType.Sphere, GroundingSense.See, seeMat,
                    OnArc(seeAngles[i], 2.6f, seeHeights[i]), 0.3f);
                go.AddComponent<GazeTarget>();
            }

            // 4 things to touch: small cubes within arm's reach in front of the user.
            float[] touchAngles = { -35f, -12f, 12f, 35f };
            float[] touchHeights = { 1.0f, 1.25f, 1.25f, 1.0f };
            for (int i = 0; i < touchAngles.Length; i++)
            {
                MakeItem(root, "Touch " + (i + 1), PrimitiveType.Cube, GroundingSense.Touch, seeMat,
                    OnArc(touchAngles[i], 0.5f, touchHeights[i]), 0.12f);
            }

            // 3 things to hear: quiet sound sources around and behind the user.
            float[] hearAngles = { -110f, 110f, 180f };
            float[] hearHz = { 130f, 165f, 98f };
            for (int i = 0; i < hearAngles.Length; i++)
            {
                GameObject go = MakeItem(root, "Hear " + (i + 1), PrimitiveType.Cube, GroundingSense.Hear, seeMat,
                    OnArc(hearAngles[i], 2.8f, 1.5f), 0.25f);
                go.AddComponent<GazeTarget>();
                AudioSource src = go.AddComponent<AudioSource>();
                src.clip = Effects.ProceduralAudio.DroneLoop(hearHz[i]);
                src.loop = true;
                src.playOnAwake = false;
                src.spatialBlend = 1f;
                src.volume = 0.12f;
                src.maxDistance = 10f;
                src.rolloffMode = AudioRolloffMode.Linear;
            }
        }

        private static GameObject MakeItem(GameObject parent, string name, PrimitiveType type, GroundingSense sense,
            Material mat, Vector3 position, float size)
        {
            GameObject go = GameObject.CreatePrimitive(type);
            go.name = name;
            go.transform.SetParent(parent.transform, false);
            go.transform.position = position;
            go.transform.localScale = Vector3.one * size;
            go.GetComponent<Renderer>().sharedMaterial = mat;

            var item = go.AddComponent<GroundingItem>();
            var so = new SerializedObject(item);
            so.FindProperty("sense").enumValueIndex = (int)sense;
            so.ApplyModifiedPropertiesWithoutUndo();
            return go;
        }

        private static Vector3 OnArc(float angleDegrees, float radius, float height)
        {
            float rad = angleDegrees * Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(rad) * radius, height, Mathf.Cos(rad) * radius);
        }

        private static Material GetMaterial(string name, Color color)
        {
            string path = "Assets/_Project/Art/Materials/" + name + ".mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat != null)
            {
                return mat;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            mat.SetColor("_BaseColor", color);
            AssetDatabase.CreateAsset(mat, path);
            return mat;
        }

        private static void DestroyIfExists(string name)
        {
            GameObject existing = GameObject.Find(name);
            if (existing != null)
            {
                Object.DestroyImmediate(existing);
            }
        }

        [MenuItem("Anxineers/Phase 4/Add Session Flow To Existing Grounding Object")]
        public static void AddSessionFlow()
        {
            GroundingExercise g = Object.FindFirstObjectByType<GroundingExercise>();
            if (g == null)
            {
                Debug.LogError("[Anxineers] No 'Grounding And Breathing' object found. Run the Phase 4 builder first.");
                return;
            }
            GameObject go = g.gameObject;
            if (go.GetComponent<SessionController>() == null) go.AddComponent<SessionController>();
            if (go.GetComponent<CalmNowInput>() == null) go.AddComponent<CalmNowInput>();
            UnityEditor.EditorUtility.SetDirty(go);
            UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(go.scene);
            Debug.Log("[Anxineers] Session flow added. Save the scene (Cmd+S), press Play, press S.");
        }
    }
}
