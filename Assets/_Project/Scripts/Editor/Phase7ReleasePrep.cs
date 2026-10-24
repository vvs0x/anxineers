using System.IO;
using Anxineers.Core;
using Anxineers.Session;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// Release preparation: assigns the experience profiles, makes the room start the guided session on launch, points the Boot
    /// scene at the room, and builds the Windows player for the headset PC (Quest over Link).
    /// </summary>
    public static class Phase7ReleasePrep
    {
        private const string BootPath = "Assets/_Project/Scenes/Boot.unity";
        private const string RoomPath = "Assets/_Project/Scenes/RoomPrototype.unity";
        private const string ProfilesDir = "Assets/_Project/Profiles";

        [MenuItem("Anxineers/Phase 7/Prepare Room For Release")]
        public static void Prepare()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                return;
            }

            var education = AssetDatabase.LoadAssetAtPath<AnxietyProfile>(ProfilesDir + "/Education_Light.asset");
            var regulation = AssetDatabase.LoadAssetAtPath<AnxietyProfile>(ProfilesDir + "/Regulation_Gentle.asset");
            if (education == null || regulation == null)
            {
                UnityEngine.Debug.LogError("[Anxineers] Profiles not found in " + ProfilesDir + ". Run Anxineers > Phase 2 first.");
                return;
            }

            var room = EditorSceneManager.OpenScene(RoomPath);
            var session = Object.FindFirstObjectByType<SessionController>();
            if (session == null)
            {
                UnityEngine.Debug.LogError("[Anxineers] No SessionController in RoomPrototype. Run the Phase 4 menu item first.");
                return;
            }
            var so = new SerializedObject(session);
            so.FindProperty("educationProfile").objectReferenceValue = education;
            so.FindProperty("regulationProfile").objectReferenceValue = regulation;
            so.FindProperty("autoBegin").boolValue = true;
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorSceneManager.MarkSceneDirty(room);
            EditorSceneManager.SaveScene(room);

            var boot = EditorSceneManager.OpenScene(BootPath);
            var loader = Object.FindFirstObjectByType<BootLoader>();
            if (loader != null)
            {
                var bso = new SerializedObject(loader);
                bso.FindProperty("firstScene").stringValue = "RoomPrototype";
                bso.ApplyModifiedPropertiesWithoutUndo();
                EditorSceneManager.MarkSceneDirty(boot);
                EditorSceneManager.SaveScene(boot);
            }

            EditorBuildSettings.scenes = new[]
            {
                new EditorBuildSettingsScene(BootPath, true),
                new EditorBuildSettingsScene(RoomPath, true),
            };
            UnityEngine.Debug.Log("[Anxineers] Release prep done: profiles assigned, session starts on launch, Boot loads RoomPrototype, build scenes set.");
        }

        [MenuItem("Anxineers/Phase 7/Build Windows Player")]
        public static void BuildWindows()
        {
            Directory.CreateDirectory("Builds");
            var options = new BuildPlayerOptions
            {
                scenes = new[] { BootPath, RoomPath },
                locationPathName = "Builds/Anxineers/Anxineers.exe",
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None,
            };
            BuildReport report = BuildPipeline.BuildPlayer(options);
            UnityEngine.Debug.Log("[Anxineers] Build " + report.summary.result + " (" + report.summary.totalErrors + " errors) at " + options.locationPathName);
        }
    }
}
