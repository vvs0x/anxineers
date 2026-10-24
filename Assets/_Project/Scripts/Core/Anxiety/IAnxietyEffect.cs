namespace Anxineers.Core
{
    /// <summary>
    /// An independent, toggleable effect module. Implementations register with the director and are ticked
    /// every frame after the director has updated its intensity.
    /// Typical Tick: drive = director.Drive(Kind, gaze01); smooth it with the profile's rise/fall speeds;
    /// value = director.Shape(Kind, smoothedDrive); apply value to shader, volume, audio, lights or objects.
    /// </summary>
    public interface IAnxietyEffect
    {
        EffectKind Kind { get; }

        bool Enabled { get; }

        /// <param name="director">Source of intensity, cap and profile settings.</param>
        /// <param name="gaze01">Global gaze level 0..1 (the strongest GazeTarget this frame).</param>
        /// <param name="deltaTime">Frame time in seconds.</param>
        void Tick(AnxietyDirector director, float gaze01, float deltaTime);
    }
}
