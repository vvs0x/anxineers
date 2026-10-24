using System;

namespace Anxineers.Voice
{
    /// <summary>Encodes mono float samples as a 16-bit PCM WAV file in memory.</summary>
    public static class WavEncoder
    {
        public static byte[] Encode(float[] samples, int sampleRate)
        {
            int dataBytes = samples.Length * 2;
            byte[] wav = new byte[44 + dataBytes];

            WriteAscii(wav, 0, "RIFF");
            WriteInt(wav, 4, 36 + dataBytes);
            WriteAscii(wav, 8, "WAVE");
            WriteAscii(wav, 12, "fmt ");
            WriteInt(wav, 16, 16);
            WriteShort(wav, 20, 1);          // PCM
            WriteShort(wav, 22, 1);          // mono
            WriteInt(wav, 24, sampleRate);
            WriteInt(wav, 28, sampleRate * 2);
            WriteShort(wav, 32, 2);
            WriteShort(wav, 34, 16);
            WriteAscii(wav, 36, "data");
            WriteInt(wav, 40, dataBytes);

            int offset = 44;
            for (int i = 0; i < samples.Length; i++)
            {
                short value = (short)Math.Max(short.MinValue, Math.Min(short.MaxValue, (int)(samples[i] * 32767f)));
                wav[offset++] = (byte)(value & 0xFF);
                wav[offset++] = (byte)((value >> 8) & 0xFF);
            }
            return wav;
        }

        private static void WriteAscii(byte[] b, int offset, string s)
        {
            for (int i = 0; i < s.Length; i++)
            {
                b[offset + i] = (byte)s[i];
            }
        }

        private static void WriteInt(byte[] b, int offset, int v)
        {
            b[offset] = (byte)(v & 0xFF);
            b[offset + 1] = (byte)((v >> 8) & 0xFF);
            b[offset + 2] = (byte)((v >> 16) & 0xFF);
            b[offset + 3] = (byte)((v >> 24) & 0xFF);
        }

        private static void WriteShort(byte[] b, int offset, int v)
        {
            b[offset] = (byte)(v & 0xFF);
            b[offset + 1] = (byte)((v >> 8) & 0xFF);
        }
    }
}
