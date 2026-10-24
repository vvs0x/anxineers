using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Anxineers.Effects;
using Anxineers.Gaze;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// Adds the splat environment to RoomPrototype. It works without compile time access to the splat package (reflection).
    ///
    /// Parts mode (preferred): if Assets/_Project/Splats/parts/manifest.json exists (made by Tools/split_splat.py), the scan is
    /// built from separate parts, so walls, ceiling and objects can move on their own, like the blockout room:
    ///   - walls lean in (also extra when looked at), the ceiling lowers, wall-mounted objects move with their wall,
    ///   - free objects drift, pulse and creep toward the user when looked at.
    /// Single mode: otherwise the one hall asset is used and only the whole room is squashed.
    /// Safe to run again, it rebuilds its own objects.
    /// </summary>
    public static class Phase6SplatBuilder
    {
        private const string RoomPath = "Assets/_Project/Scenes/RoomPrototype.unity";
        private const string EnvName = "Splat Environment";
        private const string PartsDir = "Assets/_Project/Splats/parts";
        private const string AssetDir = "Assets/Gaussians/3D";

        [Serializable] private class PartInfo
        {
            public string name;
            public string file;
            public string kind;
            public int count;
            public float[] centre;
            public float[] size;
            public string attach_to;
        }

        [Serializable] private class Manifest { public PartInfo[] parts; }

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
            // scene.ply was captured y-down, so it is turned upside down. It is a floor plan with several rooms. The user stands
            // in the big open hall at splat position (x 0.5, z 2.5), floor at splat y 0.5. With a 180 degree turn on X the offset
            // becomes (-x, 0.5, +z). Tune freely.
            splat.transform.localPosition = new Vector3(-0.5f, 0.5f, 2.5f);
            splat.transform.localRotation = Quaternion.Euler(180f, 0f, 0f);

            Type rendererType = FindType("GaussianSplat3DRenderer");
            var renderers = new List<Component>();
            bool partsMode = rendererType != null && File.Exists(PartsDir + "/manifest.json");

            GameObject room = GameObject.Find("Waiting Room");
            GameObject fx = GameObject.Find("Anxiety Effects");
            if (fx == null) fx = new GameObject("Anxiety Effects");
            RemoveChild(fx, "Effect Splat");
            RemoveChild(fx, "Effect Splat Room");
            RemoveChild(fx, "Effect Splat Objects");

            if (rendererType == null)
            {
                UnityEngine.Debug.LogWarning("[Anxineers] No splat renderer type found. Install the splat package first (see PROJECT_NOTES.md), then run this menu item again.");
            }
            else if (partsMode)
            {
                BuildParts(splat, rendererType, renderers, fx, room);
            }
            else
            {
                Component comp = splat.AddComponent(rendererType);
                renderers.Add(comp);
                bool assigned = AssignAsset(comp);
                UnityEngine.Debug.Log("[Anxineers] Single splat mode (no parts manifest). Splat asset " + (assigned ? "assigned." : "NOT assigned, assign it on the 'Splat' object."));
            }

            var switcher = env.AddComponent<SplatEnvironment>();
            var so = new SerializedObject(switcher);
            so.FindProperty("blockoutRoot").objectReferenceValue = room != null ? room.transform : null;
            so.FindProperty("splatRoot").objectReferenceValue = pivot;
            so.FindProperty("mode").enumValueIndex = rendererType != null ? (int)EnvironmentMode.Splat : (int)EnvironmentMode.Primitives;
            so.ApplyModifiedPropertiesWithoutUndo();

            // Whole-room effect: breathing, blur and (a little) squash.
            var fxGo = new GameObject("Effect Splat");
            fxGo.transform.SetParent(fx.transform, false);
            var reaction = fxGo.AddComponent<SplatReactionEffect>();
            var rso = new SerializedObject(reaction);
            rso.FindProperty("pivot").objectReferenceValue = pivot.transform;
            SerializedProperty list = rso.FindProperty("splatRenderers");
            list.arraySize = renderers.Count;
            for (int i = 0; i < renderers.Count; i++)
            {
                list.GetArrayElementAtIndex(i).objectReferenceValue = renderers[i];
            }
            if (partsMode)
            {
                // Walls and ceiling move on their own now, so the whole-room squash only adds a little.
                rso.FindProperty("horizontalSquash").floatValue = 0.06f;
                rso.FindProperty("verticalSquash").floatValue = 0.04f;
            }
            rso.ApplyModifiedPropertiesWithoutUndo();

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            UnityEngine.Debug.Log("[Anxineers] Splat environment added" + (partsMode ? " (parts mode)" : "") + ". Press V in Play Mode to cycle Splat, Primitives, Both.");
        }

        private static void BuildParts(GameObject splat, Type rendererType, List<Component> renderers, GameObject fx, GameObject room)
        {
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(PartsDir + "/manifest.json"));
            if (manifest == null || manifest.parts == null || manifest.parts.Length == 0)
            {
                UnityEngine.Debug.LogError("[Anxineers] parts/manifest.json is empty or unreadable.");
                return;
            }

            // 1. Splat assets for every part (imported once, Medium quality).
            foreach (PartInfo p in manifest.parts)
            {
                if (FindPartAsset(p) == null)
                {
                    ImportPart(p);
                }
            }

            // 2. One child object per part, positioned at the part's own centre (scan coordinates, the parent turns them upright).
            var byName = new Dictionary<string, GameObject>();
            foreach (PartInfo p in manifest.parts)
            {
                UnityEngine.Object asset = FindPartAsset(p);
                if (asset == null)
                {
                    UnityEngine.Debug.LogError("[Anxineers] No splat asset for part " + p.name + ". Skipped.");
                    continue;
                }
                var go = new GameObject(p.name);
                go.transform.SetParent(splat.transform, false);
                go.transform.localPosition = new Vector3(p.centre[0], p.centre[1], p.centre[2]);
                Component comp = go.AddComponent(rendererType);
                var cso = new SerializedObject(comp);
                SerializedProperty prop = cso.FindProperty("m_Asset");
                if (prop != null) prop.objectReferenceValue = asset;
                cso.ApplyModifiedPropertiesWithoutUndo();
                renderers.Add(comp);
                byName[p.name] = go;

                if (p.kind != "floor" && p.kind != "misc")
                {
                    var box = go.AddComponent<BoxCollider>();
                    box.size = new Vector3(p.size[0], p.size[1], p.size[2]);
                    box.isTrigger = true;
                }
            }

            // 3. One group so all parts sort together (correct blending between walls and objects).
            Type groupType = FindType("GaussiansGroup");
            if (groupType != null)
            {
                Component group = splat.AddComponent(groupType);
                MethodInfo add = groupType.GetMethod("AddHierarchy", BindingFlags.Public | BindingFlags.Instance);
                if (add != null) add.Invoke(group, null);
            }

            // 4. Gaze targets and effects.
            var wallEntries = new List<(GameObject wall, List<Transform> mounted)>();
            var freeTargets = new List<GazeTarget>();
            foreach (PartInfo p in manifest.parts)
            {
                if (!byName.TryGetValue(p.name, out GameObject go)) continue;
                if (p.kind.StartsWith("wall_") || p.kind == "ceiling")
                {
                    GazeTarget gt = go.AddComponent<GazeTarget>();
                    var gso = new SerializedObject(gt);
                    // Walls are big, so a wide cone counts as "looking at it". They do not feed the global gaze, only their own lean.
                    gso.FindProperty("fullAngle").floatValue = 25f;
                    gso.FindProperty("falloffAngle").floatValue = 60f;
                    gso.FindProperty("reportToDirector").boolValue = false;
                    gso.ApplyModifiedPropertiesWithoutUndo();
                }
                if (p.kind.StartsWith("wall_"))
                {
                    wallEntries.Add((go, new List<Transform>()));
                }
            }

            foreach (PartInfo p in manifest.parts)
            {
                if (p.kind != "object" || !byName.TryGetValue(p.name, out GameObject go)) continue;
                bool mounted = false;
                if (!string.IsNullOrEmpty(p.attach_to) && byName.TryGetValue(p.attach_to, out GameObject wallGo))
                {
                    foreach (var entry in wallEntries)
                    {
                        if (entry.wall == wallGo) { entry.mounted.Add(go.transform); mounted = true; }
                    }
                }
                if (!mounted)
                {
                    freeTargets.Add(go.AddComponent<GazeTarget>());
                }
            }

            // Whole-room lean: walls, mounted objects and ceiling.
            var roomFxGo = new GameObject("Effect Splat Room");
            roomFxGo.transform.SetParent(fx.transform, false);
            var roomFx = roomFxGo.AddComponent<RoomReactionEffect>();
            var so = new SerializedObject(roomFx);
            Transform center = room != null ? room.transform.Find("Room Center") : null;
            so.FindProperty("roomCenter").objectReferenceValue = center;
            so.FindProperty("wallInwardMeters").floatValue = 0.8f;
            so.FindProperty("wallInwardFraction").floatValue = 0.3f;
            so.FindProperty("wallGazeExtraMeters").floatValue = 0.5f;
            so.FindProperty("ceilingDropMeters").floatValue = 0.5f;
            so.FindProperty("exitShrink").floatValue = 0f;
            if (byName.TryGetValue("ceiling", out GameObject ceilingGo))
            {
                so.FindProperty("ceiling").objectReferenceValue = ceilingGo.transform;
                so.FindProperty("ceilingGaze").objectReferenceValue = ceilingGo.GetComponent<GazeTarget>();
            }
            SerializedProperty walls = so.FindProperty("walls");
            walls.arraySize = wallEntries.Count;
            for (int i = 0; i < wallEntries.Count; i++)
            {
                SerializedProperty e = walls.GetArrayElementAtIndex(i);
                e.FindPropertyRelative("wall").objectReferenceValue = wallEntries[i].wall.transform;
                e.FindPropertyRelative("gaze").objectReferenceValue = wallEntries[i].wall.GetComponent<GazeTarget>();
                SerializedProperty att = e.FindPropertyRelative("attached");
                att.arraySize = wallEntries[i].mounted.Count;
                for (int j = 0; j < wallEntries[i].mounted.Count; j++)
                {
                    att.GetArrayElementAtIndex(j).objectReferenceValue = wallEntries[i].mounted[j];
                }
            }
            so.ApplyModifiedPropertiesWithoutUndo();

            // Free objects: drift, pulse and creep toward the user when looked at.
            var objFxGo = new GameObject("Effect Splat Objects");
            objFxGo.transform.SetParent(fx.transform, false);
            var objFx = objFxGo.AddComponent<ObjectBehaviorEffect>();
            var oso = new SerializedObject(objFx);
            oso.FindProperty("driftMeters").floatValue = 0.15f;
            oso.FindProperty("pulseAmount").floatValue = 0.12f;
            oso.FindProperty("approachMeters").floatValue = 0.6f;
            SerializedProperty targets = oso.FindProperty("targets");
            targets.arraySize = freeTargets.Count;
            for (int i = 0; i < freeTargets.Count; i++)
            {
                targets.GetArrayElementAtIndex(i).objectReferenceValue = freeTargets[i];
            }
            oso.ApplyModifiedPropertiesWithoutUndo();

            // The blockout furniture effect must only touch the blockout furniture, not the splat parts.
            ObjectBehaviorEffect blockoutObjects = null;
            Transform blockoutFx = fx.transform.Find("Effect Objects");
            if (blockoutFx != null) blockoutObjects = blockoutFx.GetComponent<ObjectBehaviorEffect>();
            if (blockoutObjects != null && room != null)
            {
                GazeTarget[] own = room.GetComponentsInChildren<GazeTarget>(true);
                var bso = new SerializedObject(blockoutObjects);
                SerializedProperty bt = bso.FindProperty("targets");
                bt.arraySize = own.Length;
                for (int i = 0; i < own.Length; i++)
                {
                    bt.GetArrayElementAtIndex(i).objectReferenceValue = own[i];
                }
                bso.ApplyModifiedPropertiesWithoutUndo();
            }

            UnityEngine.Debug.Log("[Anxineers] Splat parts built: " + manifest.parts.Length + " parts, " + wallEntries.Count + " walls, " + freeTargets.Count + " free objects.");
        }

        private static UnityEngine.Object FindPartAsset(PartInfo p)
        {
            string name = Path.GetFileNameWithoutExtension(p.file);
            string[] guids = AssetDatabase.FindAssets(name + " t:ScriptableObject", new[] { "Assets/Gaussians" });
            foreach (string guid in guids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (Path.GetFileNameWithoutExtension(path) == name)
                {
                    return AssetDatabase.LoadMainAssetAtPath(path);
                }
            }
            return null;
        }

        /// <summary>Imports one part with the Medium quality preset, using the package's importer through reflection.</summary>
        private static void ImportPart(PartInfo p)
        {
            Type importer = FindType("GaussianSplat3DImporter");
            Type settingsType = FindType("GaussianSplat3DImportSettings");
            Type assetType = FindType("GaussianSplat3DAsset");
            if (importer == null || settingsType == null || assetType == null)
            {
                UnityEngine.Debug.LogError("[Anxineers] Could not find the splat importer types.");
                return;
            }

            object pos = Enum.Parse(assetType.GetNestedType("VectorFormat"), "Norm11");
            object scale = Enum.Parse(assetType.GetNestedType("VectorFormat"), "Norm11");
            object color = Enum.Parse(assetType.GetNestedType("ColorFormat"), "Norm8x4");
            object sh = Enum.Parse(assetType.GetNestedType("SHFormat"), "Norm6");
            object settings = Activator.CreateInstance(settingsType, pos, scale, color, sh);

            Directory.CreateDirectory(AssetDir);
            string source = Path.GetFullPath(PartsDir + "/" + p.file);
            MethodInfo import = importer.GetMethod("Import", BindingFlags.Public | BindingFlags.Static);
            EditorUtility.DisplayProgressBar("Anxineers", "Importing " + p.name, 0.5f);
            try
            {
                import.Invoke(null, new object[] { source, AssetDir, settings, false });
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogError("[Anxineers] Import of " + p.file + " failed: " + (e.InnerException ?? e));
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
            AssetDatabase.Refresh();
        }

        private static bool AssignAsset(Component renderer)
        {
            // Single mode: use the first splat asset created by the package under Assets/Gaussians/3D.
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

        private static void RemoveChild(GameObject parent, string name)
        {
            Transform t = parent.transform.Find(name);
            if (t != null) UnityEngine.Object.DestroyImmediate(t.gameObject);
        }

        private static Type FindType(string simpleName)
        {
            foreach (Assembly asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type[] types;
                try { types = asm.GetTypes(); } catch (ReflectionTypeLoadException e) { types = e.Types; }
                foreach (Type t in types)
                {
                    if (t != null && t.Name == simpleName && !t.IsAbstract) return t;
                }
            }
            return null;
        }
    }
}
