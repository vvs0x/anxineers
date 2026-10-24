using System;
using System.Linq;
using Anxineers.Effects;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// Adds the splat environment wiring to RoomPrototype. It works without any splat package installed: it creates the
    /// pivot objects, the switch and the reaction effect. If a splat renderer component is found in the project (by type name)
    /// it is added to the "Splat" object; the splat asset is then assigned by hand (see PROJECT_NOTES.md).
    /// Safe to run again, it rebuilds its own objects.
    /// </summary>
    public static class Phase6SplatBuilder
    {
        private const string RoomPath = "Assets/_Project/Scenes/RoomPrototype.unity";
        private const string EnvName = "Splat Environment";

        [MenuItem("Anxineers/Phase 6/Add Splat Environment To Room")]
        public static void Build()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return;
            }

            var scene = EditorSceneManager.OpenScene(RoomPath);

            GameObject stale = GameObject.Find(EnvName);
            while (stale != null)
            {
                UnityEngine.Object.DestroyImmediate(stale);
                stale = GameObject.Find(EnvName);
            }

            var env = new GameObject(EnvName);
            var pivot = new GameObject("Splat Pivot");
            pivot.transform.SetParent(env.transform, false);
            pivot.transform.position = Vector3.zero; // the user's standing spot, on the floor

            var splat = new GameObject("Splat");
            splat.transform.SetParent(pivot.transform, false);
            // Values found for the first test scene (scene.ply): it was captured y-down, so it is turned upside down.
            // It is a floor plan with several rooms. The user stands in the big open hall at splat position
            // (x 0.5, z 2.5), floor at splat y 0.5. With a 180 degree turn on X the offset becomes (-x, 0.5, +z). Tune freely.
            splat.transform.localPosition = new Vector3(-0.5f, 0.5f, 2.5f);
            splat.transform.localRotation = Quaternion.Euler(180f, 0f, 0f);

            Component splatComponent = null;
            Type rendererType = FindRendererType();
            if (rendererType != null)
            {
                Component comp = splat.AddComponent(rendererType);
                splatComponent = comp;
                bool assigned = AssignAsset(comp);
                UnityEngine.Debug.Log("[Anxineers] Added splat renderer component: " + rendererType.FullName + (assigned
                    ? ", splat asset assigned." : ". Assign your splat asset on the 'Splat' object."));
            }
            else
            {
                UnityEngine.Debug.LogWarning("[Anxineers] No splat renderer type found. Install the splat package first (see PROJECT_NOTES.md), then run this menu item again.");
            }

            var switcher = env.AddComponent<SplatEnvironment>();
            var so = new SerializedObject(switcher);
            GameObject room = GameObject.Find("Waiting Room");
            so.FindProperty("blockoutRoot").objectReferenceValue = room != null ? room.transform : null;
            so.FindProperty("splatRoot").objectReferenceValue = pivot;
            so.FindProperty("mode").enumValueIndex = rendererType != null ? (int)EnvironmentMode.Splat : (int)EnvironmentMode.Primitives;
            so.ApplyModifiedPropertiesWithoutUndo();

            GameObject fx = GameObject.Find("Anxiety Effects");
            if (fx == null) fx = new GameObject("Anxiety Effects");
            Transform old = fx.transform.Find("Effect Splat");
            if (old != null) UnityEngine.Object.DestroyImmediate(old.gameObject);
            var fxGo = new GameObject("Effect Splat");
            fxGo.transform.SetParent(fx.transform, false);
            var reaction = fxGo.AddComponent<SplatReactionEffect>();
            var rso = new SerializedObject(reaction);
            rso.FindProperty("pivot").objectReferenceValue = pivot.transform;
            rso.FindProperty("splatRenderer").objectReferenceValue = splatComponent;
            rso.ApplyModifiedPropertiesWithoutUndo();

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            UnityEngine.Debug.Log("[Anxineers] Splat environment added. Press V in Play Mode to cycle Splat, Primitives, Both.");
        }

        private static bool AssignAsset(Component renderer)
        {
            // Use the first splat asset created by the package under Assets/Gaussians/3D.
            string[] guids = AssetDatabase.FindAssets("scene_hall t:ScriptableObject", new[] { "Assets/Gaussians" });
            if (guids.Length == 0)
            {
                guids = AssetDatabase.FindAssets("scene_sample_500k t:ScriptableObject", new[] { "Assets/Gaussians" });
            }
            if (guids.Length == 0)
            {
                guids = AssetDatabase.FindAssets("t:ScriptableObject", new[] { "Assets/Gaussians" });
            }
            foreach (string guid in guids)
            {
                UnityEngine.Object asset = AssetDatabase.LoadMainAssetAtPath(AssetDatabase.GUIDToAssetPath(guid));
                if (asset == null) continue;
                var so = new SerializedObject(renderer);
                SerializedProperty prop = so.FindProperty("m_Asset");
                if (prop == null) return false;
                prop.objectReferenceValue = asset;
                so.ApplyModifiedPropertiesWithoutUndo();
                if (prop.objectReferenceValue != null) return true;
            }
            return false;
        }

        private static Type FindRendererType()
        {
            foreach (Type t in TypeCache.GetTypesDerivedFrom<MonoBehaviour>())
            {
                if (t.IsAbstract || t.IsGenericType) continue;
                string n = t.Name;
                // The package also has a 2D renderer and benchmark classes, so ask for the 3D one by exact name.
                if (n == "GaussianSplat3DRenderer")
                {
                    return t;
                }
            }
            return null;
        }
    }
}
