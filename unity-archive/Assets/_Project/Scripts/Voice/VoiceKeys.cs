using System.IO;
using UnityEngine;

namespace Anxineers.Voice
{
    /// <summary>
    /// Finds the ElevenLabs API key without it ever being part of the repo. Order: environment variable
    /// ELEVENLABS_API_KEY (or XI_API_KEY), then the git-ignored file UserSettings/elevenlabs.key in the editor,
    /// then elevenlabs.key in the persistent data path (development convenience only).
    /// A shipped product must not hold the key on the device: use a backend that forwards the audio.
    /// </summary>
    public static class VoiceKeys
    {
        public const string KeyFileName = "elevenlabs.key";

        public static string GetElevenLabsKey()
        {
            string key = System.Environment.GetEnvironmentVariable("ELEVENLABS_API_KEY");
            if (string.IsNullOrWhiteSpace(key))
            {
                key = System.Environment.GetEnvironmentVariable("XI_API_KEY");
            }
            if (string.IsNullOrWhiteSpace(key))
            {
                key = ReadFile(EditorKeyPath());
            }
            if (string.IsNullOrWhiteSpace(key))
            {
                key = ReadFile(Path.Combine(Application.persistentDataPath, KeyFileName));
            }
            return string.IsNullOrWhiteSpace(key) ? null : key.Trim();
        }

        /// <summary>Path of the git-ignored key file next to the Unity project (UserSettings folder).</summary>
        public static string EditorKeyPath()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "UserSettings", KeyFileName));
        }

        private static string ReadFile(string path)
        {
            try
            {
                return File.Exists(path) ? File.ReadAllText(path) : null;
            }
            catch (System.Exception)
            {
                return null;
            }
        }
    }
}
