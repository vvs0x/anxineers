using System.IO;
using Anxineers.Core;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// One-click builder for the Phase 1 scenes: Boot, Sandbox (XR rig, hands, floor grid) and an empty RoomPrototype.
    /// Safe to run again, it overwrites the three scene files and reuses existing materials.
    /// </summary>
    public static class Phase1SceneBuilder
    {
        private const string ScenesDir = "Assets/_Project/Scenes";
        private const string MaterialsDir = "Assets/_Project/Art/Materials";
        private const string BootPath = ScenesDir + "/Boot.unity";
        private const string SandboxPath = ScenesDir + "/Sandbox.unity";
        private const string RoomPath = ScenesDir + "/RoomPrototype.unity";

        [MenuItem("Anxineers/Phase 1/Build Boot, Sandbox and RoomPrototype Scenes")]
        public static void BuildAll()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return;
            }

            Directory.CreateDirectory(ScenesDir);
            Directory.CreateDirectory(MaterialsDir);
            AssetDatabase.Refresh();

            BuildBoot();
            BuildSandbox();
            BuildRoomPrototype();

            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene(BootPath, true),
                new EditorBuildSettingsScene(SandboxPath, true),
                new EditorBuildSettingsScene(RoomPath, true),
            };

            AssetDatabase.SaveAssets();
            EditorSceneManager.OpenScene(SandboxPath);
            UnityEngine.Debug.Log("[Anxineers] Phase 1 scenes built and added to Build Settings (Boot, Sandbox, RoomPrototype).");
        }

        private static void BuildBoot()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("Boot").AddComponent<BootLoader>();
            EditorSceneManager.SaveScene(scene, BootPath);
        }

        private static void BuildRoomPrototype()
        {
            // Intentionally empty placeholder, filled in Phase 5.
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorSceneManager.SaveScene(scene, RoomPath);
        }

        private static void BuildSandbox()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // Light
            var lightGo = new GameObject("Directional Light");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1f;
            lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            // Rig: head + two controllers, all driven by tracked poses. No locomotion.
            var rig = new GameObject("XR Rig");
            rig.AddComponent<XRTrackingOrigin>();

            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            camGo.transform.SetParent(rig.transform, false);
            camGo.transform.localPosition = new Vector3(0f, 1.6f, 0f); // editor preview only, tracking overrides it
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.08f, 0.09f, 0.10f);
            cam.nearClipPlane = 0.05f;
            camGo.AddComponent<AudioListener>();
            Bind(camGo.AddComponent<TrackedPoseDriver>(),
                "<XRHMD>/centerEyePosition", "<XRHMD>/centerEyeRotation", "<XRHMD>/trackingState");

            BuildHand(rig.transform, "LeftHand", "{LeftHand}", GetMaterial("Hand_Left", new Color(0.25f, 0.6f, 1f)));
            BuildHand(rig.transform, "RightHand", "{RightHand}", GetMaterial("Hand_Right", new Color(1f, 0.45f, 0.25f)));

            // Floor and scale references
            var floorMat = GetMaterial("Floor", new Color(0.18f, 0.19f, 0.2f));
            var gridMat = GetMaterial("Grid", new Color(0.55f, 0.58f, 0.6f));
            var refMat = GetMaterial("Reference", new Color(0.8f, 0.8f, 0.75f));

            var floor = GameObject.CreatePrimitive(PrimitiveType.Plane); // 10 x 10 m
            floor.name = "Floor";
            floor.GetComponent<Renderer>().sharedMaterial = floorMat;

            var grid = new GameObject("FloorGrid");
            for (int i = -5; i <= 5; i++)
            {
                MakeBar(grid.transform, gridMat, new Vector3(0f, 0.002f, i), new Vector3(10f, 0.004f, 0.01f));
                MakeBar(grid.transform, gridMat, new Vector3(i, 0.002f, 0f), new Vector3(0.01f, 0.004f, 10f));
            }

            MakeBox("Reference Cube 0.5m", refMat, new Vector3(2f, 0.25f, 3f), new Vector3(0.5f, 0.5f, 0.5f));
            MakeBox("Reference Pillar 1.8m", refMat, new Vector3(-2f, 0.9f, 3f), new Vector3(0.4f, 1.8f, 0.4f));

            EditorSceneManager.SaveScene(scene, SandboxPath);
        }

        private static void BuildHand(Transform parent, string name, string usage, Material mat)
        {
            var hand = new GameObject(name);
            hand.transform.SetParent(parent, false);
            Bind(hand.AddComponent<TrackedPoseDriver>(),
                "<XRController>" + usage + "/devicePosition",
                "<XRController>" + usage + "/deviceRotation",
                "<XRController>" + usage + "/trackingState");

            var palm = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            palm.name = "Palm";
            palm.transform.SetParent(hand.transform, false);
            palm.transform.localScale = Vector3.one * 0.07f;
            palm.GetComponent<Renderer>().sharedMaterial = mat;
            Object.DestroyImmediate(palm.GetComponent<Collider>());

            var pointer = GameObject.CreatePrimitive(PrimitiveType.Cube); // shows forward direction
            pointer.name = "Forward";
            pointer.transform.SetParent(hand.transform, false);
            pointer.transform.localPosition = new Vector3(0f, 0f, 0.07f);
            pointer.transform.localScale = new Vector3(0.025f, 0.025f, 0.09f);
            pointer.GetComponent<Renderer>().sharedMaterial = mat;
            Object.DestroyImmediate(pointer.GetComponent<Collider>());
        }

        private static void Bind(TrackedPoseDriver driver, string positionPath, string rotationPath, string statePath)
        {
            driver.positionInput = new InputActionProperty(
                new InputAction("Position", InputActionType.Value, positionPath, expectedControlType: "Vector3"));
            driver.rotationInput = new InputActionProperty(
                new InputAction("Rotation", InputActionType.Value, rotationPath, expectedControlType: "Quaternion"));
            driver.trackingStateInput = new InputActionProperty(
                new InputAction("Tracking State", InputActionType.Value, statePath, expectedControlType: "Integer"));
        }

        private static void MakeBar(Transform parent, Material mat, Vector3 pos, Vector3 scale)
        {
            var bar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            bar.name = "GridLine";
            bar.transform.SetParent(parent, false);
            bar.transform.localPosition = pos;
            bar.transform.localScale = scale;
            bar.GetComponent<Renderer>().sharedMaterial = mat;
            Object.DestroyImmediate(bar.GetComponent<Collider>());
        }

        private static void MakeBox(string name, Material mat, Vector3 pos, Vector3 scale)
        {
            var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            box.name = name;
            box.transform.position = pos;
            box.transform.localScale = scale;
            box.GetComponent<Renderer>().sharedMaterial = mat;
        }

        private static Material GetMaterial(string name, Color color)
        {
            string path = MaterialsDir + "/" + name + ".mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat != null)
            {
                return mat;
            }
            mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            mat.SetColor("_BaseColor", color);
            AssetDatabase.CreateAsset(mat, path);
            return mat;
        }
    }
}
