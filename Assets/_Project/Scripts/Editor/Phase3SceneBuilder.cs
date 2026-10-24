using System.IO;
using Anxineers.Core;
using Anxineers.Effects;
using Anxineers.Gaze;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// Adds the Phase 3 effect modules to the Sandbox scene, each on its own child object so it can be toggled
    /// and tuned independently. Safe to run again, it replaces its own objects.
    /// </summary>
    public static class Phase3SceneBuilder
    {
        private const string SandboxPath = "Assets/_Project/Scenes/Sandbox.unity";
        private const string RootName = "Anxiety Effects";

        [MenuItem("Anxineers/Phase 3/Add Effects To Sandbox")]
        public static void AddEffects()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return;
            }

            var scene = EditorSceneManager.OpenScene(SandboxPath);

            GameObject old = GameObject.Find(RootName);
            if (old != null)
            {
                Object.DestroyImmediate(old);
            }

            var root = new GameObject(RootName);
            Child(root, "Effect Vision").AddComponent<VisionEffect>();
            var light = Child(root, "Effect Light").AddComponent<LightEffect>();
            Child(root, "Effect Objects").AddComponent<ObjectBehaviorEffect>();

            GameObject sun = GameObject.Find("Directional Light");
            if (sun != null)
            {
                var so = new SerializedObject(light);
                SerializedProperty lights = so.FindProperty("flickerLights");
                lights.arraySize = 1;
                lights.GetArrayElementAtIndex(0).objectReferenceValue = sun.GetComponent<Light>();
                so.ApplyModifiedPropertiesWithoutUndo();
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            UnityEngine.Debug.Log("[Anxineers] Phase 3 effects added to Sandbox (Vision, Light, Objects).");
        }

        [MenuItem("Anxineers/Phase 3/Add Space And Audio To Sandbox")]
        public static void AddSpaceAndAudio()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return;
            }

            var scene = EditorSceneManager.OpenScene(SandboxPath);

            GameObject root = GameObject.Find(RootName);
            if (root == null)
            {
                root = new GameObject(RootName);
            }

            DestroyChild(root, "Effect Space");
            DestroyChild(root, "Effect Audio");
            DestroyIfExists("Distortion Test Room");

            Child(root, "Effect Space").AddComponent<SpaceDistortionEffect>();
            Child(root, "Effect Audio").AddComponent<AudioEffect>();

            Shader shader = Shader.Find("Anxineers/Distortable Lit");
            if (shader == null)
            {
                UnityEngine.Debug.LogError("[Anxineers] Shader 'Anxineers/Distortable Lit' not found. Check the Console for shader compile errors.");
            }
            else
            {
                Material mat = GetWallMaterial(shader);
                var room = new GameObject("Distortion Test Room");
                MakeWall(room, mat, "Wall Left", new Vector3(-4f, 1.5f, 4f), new Vector3(0.1f, 3f, 8f));
                MakeWall(room, mat, "Wall Right", new Vector3(4f, 1.5f, 4f), new Vector3(0.1f, 3f, 8f));
                MakeWall(room, mat, "Wall End", new Vector3(0f, 1.5f, 8f), new Vector3(8f, 3f, 0.1f));
            }

            foreach (GazeTarget gt in Object.FindObjectsByType<GazeTarget>(FindObjectsSortMode.None))
            {
                if (gt.GetComponent<GazeAudioSwell>() == null)
                {
                    gt.gameObject.AddComponent<GazeAudioSwell>();
                }
            }

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            UnityEngine.Debug.Log("[Anxineers] Space distortion, audio and a test room added to Sandbox.");
        }

        private static void MakeWall(GameObject parent, Material mat, string name, Vector3 position, Vector3 scale)
        {
            var wall = GameObject.CreatePrimitive(PrimitiveType.Cube);
            wall.name = name;
            wall.transform.SetParent(parent.transform, false);
            wall.transform.position = position;
            wall.transform.localScale = scale;
            wall.GetComponent<Renderer>().sharedMaterial = mat;
        }

        private static Material GetWallMaterial(Shader shader)
        {
            const string path = "Assets/_Project/Art/Materials/DistortableWall.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat != null)
            {
                mat.shader = shader;
                return mat;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            mat = new Material(shader);
            mat.SetColor("_BaseColor", new Color(0.62f, 0.64f, 0.66f));
            AssetDatabase.CreateAsset(mat, path);
            return mat;
        }

        private static void DestroyChild(GameObject root, string name)
        {
            Transform child = root.transform.Find(name);
            if (child != null)
            {
                Object.DestroyImmediate(child.gameObject);
            }
        }

        private static void DestroyIfExists(string name)
        {
            GameObject existing = GameObject.Find(name);
            if (existing != null)
            {
                Object.DestroyImmediate(existing);
            }
        }

        private static GameObject Child(GameObject parent, string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            return go;
        }
    }
}
