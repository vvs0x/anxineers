using UnityEngine;

namespace Anxineers.Gaze
{
    /// <summary>
    /// Source of a gaze ray in world space. Everything else in the project only talks to this interface
    /// (through <see cref="GazeSource"/>), so head gaze can be swapped for eye gaze without code changes.
    /// </summary>
    public interface IGazeProvider
    {
        /// <summary>Higher priority wins when several providers are valid.</summary>
        int Priority { get; }

        /// <summary>False when the provider has no usable data this frame.</summary>
        bool IsValid { get; }

        /// <summary>World-space ray from the eyes/head along the gaze direction.</summary>
        Ray GazeRay { get; }
    }
}
