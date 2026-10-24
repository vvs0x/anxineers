using Anxineers.Effects;
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

        private static GameObject Child(GameObject parent, string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            return go;
        }
    }
}
