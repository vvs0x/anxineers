namespace Anxineers.Voice
{
    /// <summary>Outcome of one listen request.</summary>
    public struct SpeechResult
    {
        public bool Success;
        public string Text;
        public string Error;

        public static SpeechResult Ok(string text) => new SpeechResult { Success = true, Text = text ?? string.Empty };

        public static SpeechResult Fail(string error) => new SpeechResult { Success = false, Text = string.Empty, Error = error };
    }
}
