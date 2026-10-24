using System.Collections.Generic;
using UnityEngine;

namespace Anxineers.Gaze
{
    /// <summary>
    /// Registry of active gaze providers. Consumers call <see cref="TryGetRay"/> and never care which provider answered.
    /// </summary>
    public static class GazeSource
    {
        private static readonly List<IGazeProvider> Providers = new List<IGazeProvider>();

        public static void Register(IGazeProvider provider)
        {
            if (provider != null && !Providers.Contains(provider))
            {
                Providers.Add(provider);
            }
        }

        public static void Unregister(IGazeProvider provider)
        {
            Providers.Remove(provider);
        }

        /// <summary>Returns the ray of the valid provider with the highest priority.</summary>
        public static bool TryGetRay(out Ray ray)
        {
            IGazeProvider best = null;
            foreach (IGazeProvider provider in Providers)
            {
                if (provider.IsValid && (best == null || provider.Priority > best.Priority))
                {
                    best = provider;
                }
            }

            if (best == null)
            {
                ray = default;
                return false;
            }

            ray = best.GazeRay;
            return true;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            Providers.Clear();
        }
    }
}
