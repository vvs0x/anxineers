using System.IO;
using Anxineers.Core;
using Anxineers.DebugTools;
using Anxineers.Gaze;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// Adds the Phase 2 test setup to the Sandbox scene: an AnxietyDirector with shortcuts, head gaze on the camera,
    /// and five GazeTarget cubes in an arc in front of the user. Safe to run again, it replaces its own objects.
    /// </summary>
    public static class Phase2SceneBuilder
    {
        private const string SandboxPath = "Assets/_Project/Scenes/Sandbox.unity";
        private const string MaterialPath = "Assets/_Project/Art/Materials/GazeTarget.mat";
        private const string DirectorName = "Anxiety Director";
        private const string TargetsName = "Gaze Targets";

        [MenuItem("Anxineers/Phase 2/Add Core Test Objects To Sandbox")]
        public static void AddCoreTestObjects()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return;
            }

            var scene = EditorSceneManager.OpenScene(SandboxPath);
            AnxietyProfile[] profiles = StarterProfiles.EnsureAll();

            DestroyIfExists(DirectorName);
            DestroyIfExists(TargetsName);

            var directorGo = new GameObject(DirectorName);
            var director = directorGo.AddComponent<AnxietyDirector>();
            director.SetProfile(profiles[0]);
            directorGo.AddComponent<DebugShortcuts>();

            GameObject cam = GameObject.Find("Main Camera");
            if (cam != null)
            {
                if (cam.GetComponent<HeadGazeProvider>() == null)
                {
                    cam.AddComponent<HeadGazeProvider>();
                }
                if (cam.GetComponent<DebugMouseLook>() == null)
                {
                    cam.AddComponent<DebugMouseLook>();
                }
            }
            else
            {
                UnityEngine.Debug.LogWarning("[Anxineers] No 'Main Camera' found in Sandbox. Run Phase 1 builder first.");
            }

            Material mat = GetMaterial();
            var root = new GameObject(TargetsName);
            float[] angles = { -60f, -30f, 0f, 30f, 60f };
            for (int i = 0; i < angles.Length; i++)
            {
                float rad = angles[i] * Mathf.Deg2Rad;
                var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
                cube.name = "Gaze Target " + (i + 1);
                cube.transform.SetParent(root.transform, false);
                cube.transform.position = new Vector3(Mathf.Sin(rad) * 3f, 1.6f, Mathf.Cos(rad) * 3f);
                cube.transform.localScale = Vector3.one * 0.4f;
                cube.GetComponent<Renderer>().sharedMaterial = mat;
                cube.AddComponent<GazeTarget>();
                cube.AddComponent<GazeValueTint>();
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            UnityEngine.Debug.Log("[Anxineers] Phase 2 test objects added to Sandbox.");
        }

        private static void DestroyIfExists(string name)
        {
            GameObject existing = GameObject.Find(name);
            if (existing != null)
            {
                Object.DestroyImmediate(existing);
            }
        }

        private static Material GetMaterial()
        {
            var mat = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (mat != null)
            {
                return mat;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(MaterialPath));
            mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            mat.SetColor("_BaseColor", new Color(0.30f, 0.38f, 0.45f));
            AssetDatabase.CreateAsset(mat, MaterialPath);
            return mat;
        }
    }
}
