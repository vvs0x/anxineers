namespace Anxineers.Core
{
    /// <summary>High-level phase of a session. Drives where the director steers the global intensity.</summary>
    public enum AnxietyState
    {
        Calm,
        Build,
        Peak,
        Recovery,
    }

    /// <summary>The independent effect channels. Each has its own settings in the profile.</summary>
    public enum EffectKind
    {
        Space,
        Vision,
        Audio,
        Light,
        Objects,
    }
}
