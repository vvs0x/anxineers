using System.IO;
using Anxineers.Effects;
using Anxineers.Gaze;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// Builds the room prototype: copies the Sandbox (rig, director, effects, session flow) into RoomPrototype, removes the
    /// abstract test content and adds a neutral waiting room made of primitives. Safe to run again, it rebuilds the scene.
    /// The user stands at the origin and looks along +Z. The room is 5 x 5 m, 2.8 m high.
    /// </summary>
    public static class Phase5RoomBuilder
    {
        private const string SandboxPath = "Assets/_Project/Scenes/Sandbox.unity";
        private const string RoomPath = "Assets/_Project/Scenes/RoomPrototype.unity";
        private const string RoomRoot = "Waiting Room";

        private const float Half = 2.5f;
        private const float Height = 2.8f;
        private const float Thick = 0.1f;

        private static readonly string[] RemoveNames =
        {
            "Distortion Test Room", "Gaze Targets", "Grounding Items", "Floor", "FloorGrid",
            "Reference Cube 0.5m", "Reference Pillar 1.8m", RoomRoot,
        };

        [MenuItem("Anxineers/Phase 5/Build Room Scene")]
        public static void Build()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return;
            }

            AssetDatabase.CopyAsset(SandboxPath, RoomPath);
            AssetDatabase.Refresh();
            var scene = EditorSceneManager.OpenScene(RoomPath);

            foreach (string n in RemoveNames)
            {
                GameObject old = GameObject.Find(n);
                while (old != null)
                {
                    Object.DestroyImmediate(old);
                    old = GameObject.Find(n);
                }
            }

            Shader shader = Shader.Find("Anxineers/Distortable Lit");
            if (shader == null)
            {
                UnityEngine.Debug.LogError("[Anxineers] Shader 'Anxineers/Distortable Lit' not found.");
                return;
            }

            Material wallMat = Mat("RoomWall", shader, new Color(0.78f, 0.78f, 0.74f));
            Material floorMat = Mat("RoomFloor", shader, new Color(0.45f, 0.40f, 0.35f));
            Material ceilMat = Mat("RoomCeiling", shader, new Color(0.86f, 0.86f, 0.84f));
            Material woodMat = Mat("RoomWood", shader, new Color(0.55f, 0.40f, 0.28f));
            Material fabricMat = Mat("RoomFabric", shader, new Color(0.30f, 0.38f, 0.45f));
            Material doorMat = Mat("RoomDoor", shader, new Color(0.40f, 0.30f, 0.22f));
            Material glassMat = Mat("RoomWindow", shader, new Color(0.70f, 0.82f, 0.92f));
            Material plantMat = Mat("RoomPlant", shader, new Color(0.25f, 0.45f, 0.28f));

            var root = new GameObject(RoomRoot);

            // Shell. Floor is not moved by the effect, so it stays a solid reference under the user.
            Box(root, "Floor", floorMat, new Vector3(0f, -Thick / 2f, 0f), new Vector3(2f * Half + 0.4f, Thick, 2f * Half + 0.4f));
            GameObject ceiling = Box(root, "Ceiling", ceilMat, new Vector3(0f, Height + Thick / 2f, 0f), new Vector3(2f * Half + 0.4f, Thick, 2f * Half + 0.4f));
            GameObject wallFar = Box(root, "Wall Far", wallMat, new Vector3(0f, Height / 2f, Half + Thick / 2f), new Vector3(2f * Half + 0.4f, Height, Thick));
            GameObject wallBack = Box(root, "Wall Back", wallMat, new Vector3(0f, Height / 2f, -Half - Thick / 2f), new Vector3(2f * Half + 0.4f, Height, Thick));
            GameObject wallLeft = Box(root, "Wall Left", wallMat, new Vector3(-Half - Thick / 2f, Height / 2f, 0f), new Vector3(Thick, Height, 2f * Half + 0.4f));
            GameObject wallRight = Box(root, "Wall Right", wallMat, new Vector3(Half + Thick / 2f, Height / 2f, 0f), new Vector3(Thick, Height, 2f * Half + 0.4f));

            // Door on the far wall, window on the left wall. Both sit slightly proud of the wall.
            GameObject door = Box(root, "Door", doorMat, new Vector3(1.2f, 1.0f, Half - 0.03f), new Vector3(0.95f, 2.0f, 0.06f));
            GameObject window = Box(root, "Window", glassMat, new Vector3(-Half + 0.03f, 1.55f, 0.6f), new Vector3(0.06f, 1.1f, 1.5f));

            // Furniture. Everything here gets a GazeTarget so the room reacts to where the user looks.
            Gaze(Box(root, "Table", woodMat, new Vector3(0f, 0.38f, 1.7f), new Vector3(1.4f, 0.76f, 0.7f)));
            Gaze(Box(root, "Chair Left", fabricMat, new Vector3(-0.9f, 0.25f, 1.7f), new Vector3(0.45f, 0.5f, 0.45f)));
            Gaze(Box(root, "Chair Right", fabricMat, new Vector3(0.9f, 0.25f, 1.7f), new Vector3(0.45f, 0.5f, 0.45f)));
            // Wall-mounted pieces are not gaze targets: they move with their wall instead of drifting on their own.
            GameObject shelf = Box(root, "Shelf", woodMat, new Vector3(-1.5f, 0.9f, Half - 0.2f), new Vector3(1.0f, 1.8f, 0.35f));
            GameObject frame = Box(root, "Picture Frame", glassMat, new Vector3(0.0f, 1.7f, Half - 0.03f), new Vector3(0.7f, 0.5f, 0.05f));
            GameObject bench = Box(root, "Bench", fabricMat, new Vector3(Half - 0.35f, 0.22f, -0.8f), new Vector3(0.5f, 0.44f, 1.6f));

            GameObject plant = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            plant.name = "Plant";
            plant.transform.SetParent(root.transform, false);
            plant.transform.position = new Vector3(-1.4f, 0.6f, -1.3f);
            plant.transform.localScale = new Vector3(0.5f, 0.7f, 0.5f);
            plant.GetComponent<Renderer>().sharedMaterial = plantMat;
            Gaze(plant);

            // Lamp: a small warm light on the table that the Light effect can flicker softly.
            GameObject lamp = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            lamp.name = "Lamp";
            lamp.transform.SetParent(root.transform, false);
            lamp.transform.position = new Vector3(0.5f, 0.93f, 1.7f);
            lamp.transform.localScale = new Vector3(0.14f, 0.17f, 0.14f);
            lamp.GetComponent<Renderer>().sharedMaterial = Mat("RoomLamp", shader, new Color(0.95f, 0.85f, 0.6f));
            var lampLightGo = new GameObject("Lamp Light");
            lampLightGo.transform.SetParent(lamp.transform, false);
            lampLightGo.transform.localPosition = new Vector3(0f, 2.5f, 0f);
            Light lampLight = lampLightGo.AddComponent<Light>();
            lampLight.type = LightType.Point;
            lampLight.color = new Color(1f, 0.82f, 0.55f);
            lampLight.intensity = 1.2f;
            lampLight.range = 5f;
            Gaze(lamp);

            // Soften the sun so the room feels like an interior.
            GameObject sun = GameObject.Find("Directional Light");
            Light sunLight = null;
            if (sun != null)
            {
                sunLight = sun.GetComponent<Light>();
                if (sunLight != null) sunLight.intensity = 0.6f;
            }

            // Effects: room reaction on the Space channel, softer object drift, lamp flicker.
            GameObject fx = GameObject.Find("Anxiety Effects");
            if (fx == null) fx = new GameObject("Anxiety Effects");
            Transform old = fx.transform.Find("Effect Room");
            if (old != null) Object.DestroyImmediate(old.gameObject);
            var roomFx = new GameObject("Effect Room");
            roomFx.transform.SetParent(fx.transform, false);
            var room = roomFx.AddComponent<RoomReactionEffect>();
            var so = new SerializedObject(room);
            so.FindProperty("ceiling").objectReferenceValue = ceiling.transform;
            var centerGo = new GameObject("Room Center");
            centerGo.transform.SetParent(root.transform, false);
            centerGo.transform.position = new Vector3(0f, 1.4f, 0f);
            so.FindProperty("roomCenter").objectReferenceValue = centerGo.transform;
            SetWalls(so, new[] { wallFar, wallBack, wallLeft, wallRight },
                new[] { new[] { door.transform, frame.transform, shelf.transform }, new Transform[0], new[] { window.transform }, new[] { bench.transform } });
            SerializedProperty exits = so.FindProperty("exits");
            exits.arraySize = 2;
            exits.GetArrayElementAtIndex(0).FindPropertyRelative("target").objectReferenceValue = door.transform;
            exits.GetArrayElementAtIndex(1).FindPropertyRelative("target").objectReferenceValue = window.transform;
            so.ApplyModifiedPropertiesWithoutUndo();

            ObjectBehaviorEffect objects = fx.GetComponentInChildren<ObjectBehaviorEffect>();
            if (objects != null)
            {
                var oso = new SerializedObject(objects);
                oso.FindProperty("driftMeters").floatValue = 0.08f;
                oso.FindProperty("pulseAmount").floatValue = 0.12f;
                oso.ApplyModifiedPropertiesWithoutUndo();
            }

            LightEffect lightFx = fx.GetComponentInChildren<LightEffect>();
            if (lightFx != null)
            {
                var lso = new SerializedObject(lightFx);
                SerializedProperty lights = lso.FindProperty("flickerLights");
                lights.arraySize = sunLight != null ? 2 : 1;
                lights.GetArrayElementAtIndex(0).objectReferenceValue = lampLight;
                if (sunLight != null) lights.GetArrayElementAtIndex(1).objectReferenceValue = sunLight;
                lso.ApplyModifiedPropertiesWithoutUndo();
            }

            // The distortion shader's own space effect works on the same walls, so the Room effect only adds the lean.
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            EditorBuildSettingsAdd(RoomPath);
            UnityEngine.Debug.Log("[Anxineers] RoomPrototype built. Press Play: keys 1-4 for states, S for the full session. Walls lean in and the ceiling lowers with intensity.");
        }

        private static void SetWalls(SerializedObject so, GameObject[] walls, Transform[][] attached)
        {
            SerializedProperty arr = so.FindProperty("walls");
            arr.arraySize = walls.Length;
            for (int i = 0; i < walls.Length; i++)
            {
                SerializedProperty e = arr.GetArrayElementAtIndex(i);
                e.FindPropertyRelative("wall").objectReferenceValue = walls[i].transform;
                SerializedProperty att = e.FindPropertyRelative("attached");
                att.arraySize = attached[i].Length;
                for (int j = 0; j < attached[i].Length; j++)
                {
                    att.GetArrayElementAtIndex(j).objectReferenceValue = attached[i][j];
                }
            }
        }

        private static void EditorBuildSettingsAdd(string path)
        {
            var list = new System.Collections.Generic.List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            foreach (var s in list)
            {
                if (s.path == path) return;
            }
            list.Add(new EditorBuildSettingsScene(path, true));
            EditorBuildSettings.scenes = list.ToArray();
        }

        private static GameObject Box(GameObject parent, string name, Material mat, Vector3 position, Vector3 scale)
        {
            GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent.transform, false);
            go.transform.position = position;
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = mat;
            return go;
        }

        private static void Gaze(GameObject go)
        {
            if (go.GetComponent<GazeTarget>() == null)
            {
                go.AddComponent<GazeTarget>();
            }
        }

        private static Material Mat(string name, Shader shader, Color color)
        {
            string path = "Assets/_Project/Art/Materials/" + name + ".mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat != null)
            {
                mat.shader = shader;
                mat.SetColor("_BaseColor", color);
                return mat;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            mat = new Material(shader);
            mat.SetColor("_BaseColor", color);
            AssetDatabase.CreateAsset(mat, path);
            return mat;
        }
    }
}
