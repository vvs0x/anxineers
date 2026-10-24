using Anxineers.Core;
using UnityEditor;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>Creates the three starter AnxietyProfile assets if they do not exist yet.</summary>
    public static class StarterProfiles
    {
        public const string ProfilesDir = "Assets/_Project/Profiles";

        [MenuItem("Anxineers/Phase 2/Create Starter Profiles")]
        public static void CreateFromMenu()
        {
            EnsureAll();
            AssetDatabase.SaveAssets();
            UnityEngine.Debug.Log("[Anxineers] Starter profiles ready in " + ProfilesDir);
        }

        /// <summary>Returns Education light, Education strong and Regulation gentle, creating missing ones.</summary>
        public static AnxietyProfile[] EnsureAll()
        {
            System.IO.Directory.CreateDirectory(ProfilesDir);
            AssetDatabase.Refresh();
            return new[]
            {
                Ensure("Education_Light", peak: 0.5f, build: 90f, hold: 30f, recovery: 45f),
                Ensure("Education_Strong", peak: 0.9f, build: 60f, hold: 20f, recovery: 40f),
                Ensure("Regulation_Gentle", peak: 0.4f, build: 120f, hold: 15f, recovery: 90f),
            };
        }

        private static AnxietyProfile Ensure(string name, float peak, float build, float hold, float recovery)
        {
            string path = ProfilesDir + "/" + name + ".asset";
            var existing = AssetDatabase.LoadAssetAtPath<AnxietyProfile>(path);
            if (existing != null)
            {
                return existing;
            }

            var profile = ScriptableObject.CreateInstance<AnxietyProfile>();
            profile.ResetToDefaults(Mathf.Max(0.4f, peak));
            profile.Configure(peak, build, hold, recovery);
            AssetDatabase.CreateAsset(profile, path);
            return profile;
        }
    }
}
