using System.IO;
using Anxineers.Voice;
using UnityEditor;
using UnityEngine;

namespace Anxineers.EditorTools
{
    /// <summary>
    /// Stores the ElevenLabs API key in UserSettings/elevenlabs.key, which is git-ignored and never committed.
    /// Alternatively set the ELEVENLABS_API_KEY environment variable before starting Unity.
    /// </summary>
    public class ElevenLabsKeyWindow : EditorWindow
    {
        private string key = string.Empty;

        [MenuItem("Anxineers/Voice/Set ElevenLabs API Key")]
        public static void Open()
        {
            var window = GetWindow<ElevenLabsKeyWindow>(true, "ElevenLabs API Key", true);
            window.minSize = new Vector2(420f, 130f);
        }

        private void OnGUI()
        {
            EditorGUILayout.HelpBox(
                "The key is saved only on this computer in UserSettings/elevenlabs.key (git-ignored). Never paste it into chat, code or the repo.",
                MessageType.Info);

            string path = VoiceKeys.EditorKeyPath();
            bool exists = File.Exists(path);
            EditorGUILayout.LabelField("Current", exists ? "key file present" : "no key file");

            key = EditorGUILayout.PasswordField("New key", key);

            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(key)))
                {
                    if (GUILayout.Button("Save"))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(path));
                        File.WriteAllText(path, key.Trim());
                        key = string.Empty;
                        GUI.FocusControl(null);
                        UnityEngine.Debug.Log("[Anxineers] ElevenLabs key saved to UserSettings.");
                    }
                }
                using (new EditorGUI.DisabledScope(!exists))
                {
                    if (GUILayout.Button("Remove saved key"))
                    {
                        File.Delete(path);
                    }
                }
            }
        }
    }
}
