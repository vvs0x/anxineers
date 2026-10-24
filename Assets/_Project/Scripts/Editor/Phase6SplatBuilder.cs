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
            // Values found for the first test scene (scene.ply): it was captured y-down, so it is turned upside down,
            // and moved so that the floor sits at y = 0 and the middle of the room around the user. Tune freely.
            splat.transform.localPosition = new Vector3(-0.57f, 0.5f, -0.26f);
            splat.transform.localRotation = Quaternion.Euler(180f, 0f, 0f);

            Type rendererType = FindRendererType();
            if (rendererType != null)
            {
                splat.AddComponent(rendererType);
                UnityEngine.Debug.Log("[Anxineers] Added splat renderer component: " + rendererType.FullName + ". Assign your splat asset on the 'Splat' object.");
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
            rso.ApplyModifiedPropertiesWithoutUndo();

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            UnityEngine.Debug.Log("[Anxineers] Splat environment added. Press V in Play Mode to cycle Splat, Primitives, Both.");
        }

        private static Type FindRendererType()
        {
            foreach (Type t in TypeCache.GetTypesDerivedFrom<MonoBehaviour>())
            {
                if (t.IsAbstract || t.IsGenericType) continue;
                string n = t.Name;
                if (n.IndexOf("Splat", StringComparison.OrdinalIgnoreCase) >= 0
                    && n.IndexOf("Renderer", StringComparison.OrdinalIgnoreCase) >= 0
                    && n.IndexOf("Editor", StringComparison.OrdinalIgnoreCase) < 0)
                {
                    return t;
                }
            }
            return null;
        }
    }
}
