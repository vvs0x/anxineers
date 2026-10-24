using System;

namespace Anxineers.Voice
{
    /// <summary>
    /// Counts how many separate things a user named in one sentence. Deliberately lenient: grounding is not a test,
    /// so any spoken answer counts as at least one item.
    /// </summary>
    public static class SpeechParser
    {
        private static readonly string[] Separators = { ",", ";", ".", "\n", " and ", " und ", " et ", " y ", " e ", " plus " };

        public static int CountItems(string text)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return 0;
            }

            string[] parts = text.Split(Separators, StringSplitOptions.RemoveEmptyEntries);
            int count = 0;
            foreach (string part in parts)
            {
                if (part.Trim().Length >= 2)
                {
                    count++;
                }
            }
            return Math.Max(1, count);
        }
    }
}
