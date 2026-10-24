using System;
using Anxineers.Core;
using Anxineers.Gaze;
using UnityEngine;

namespace Anxineers.Effects
{
    /// <summary>
    /// Room specific space effect: walls lean slowly toward the room center, the ceiling lowers, and doors and windows
    /// shrink so the exit feels further away. Only room objects move. The camera, the rig and the horizon are never touched.
    /// Uses the Space channel of the profile, so it follows the same intensity, cap and calm now as every other effect.
    /// </summary>
    public class RoomReactionEffect : EffectBase
    {
        [Serializable]
        public class WallEntry
        {
            public Transform wall;
            [Tooltip("Things mounted on this wall (door, window, frames). They move with it.")]
            public Transform[] attached;
            [Tooltip("Optional. Looking at this wall makes it lean in extra.")]
            public GazeTarget gaze;
        }

        [Serializable]
        public class ShrinkEntry
        {
            public Transform target;
        }

        [Header("Walls")]
        [Tooltip("How far each wall moves toward the room center at full effect, in meters. Keep it small so nothing reaches the user.")]
        [SerializeField, Range(0f, 1.2f)] private float wallInwardMeters = 0.8f;

        [Tooltip("Large rooms: each wall also moves this fraction of its own distance to the room center (0.3 = 30%). The larger of the two values is used.")]
        [SerializeField, Range(0f, 0.6f)] private float wallInwardFraction = 0f;

        [Tooltip("Extra meters a wall leans in while the user looks at it (scaled by the effect value).")]
        [SerializeField, Range(0f, 2f)] private float wallGazeExtraMeters = 0.3f;

        [Header("Ceiling")]
        [SerializeField, Range(0f, 0.8f)] private float ceilingDropMeters = 0.5f;
        [SerializeField] private Transform ceiling;
        [Tooltip("Optional. Looking at the ceiling lowers it extra.")]
        [SerializeField] private GazeTarget ceilingGaze;
        [SerializeField, Range(0f, 1f)] private float ceilingGazeExtraMeters = 0.2f;

        [Header("Exit")]
        [Tooltip("How much doors and windows shrink at full effect (0.3 = 30% smaller).")]
        [SerializeField, Range(0f, 0.6f)] private float exitShrink = 0.4f;

        [Header("Targets")]
        [SerializeField] private Transform roomCenter;
        [SerializeField] private WallEntry[] walls = new WallEntry[0];
        [SerializeField] private ShrinkEntry[] exits = new ShrinkEntry[0];

        private Vector3[] wallBase;
        private Vector3[] wallDir;
        private float[] wallDistance;
        private Vector3[][] attachedBase;
        private Vector3 ceilingBase;
        private Vector3[] exitPos;
        private Vector3[] exitScale;
        private bool captured;

        public override EffectKind Kind => EffectKind.Space;

        protected override void OnEnable()
        {
            base.OnEnable();
            Capture();
        }

        /// <summary>Remember the neutral pose of everything this effect moves.</summary>
        [ContextMenu("Capture neutral pose")]
        public void Capture()
        {
            ResetEffect();
            Vector3 center = roomCenter != null ? roomCenter.position : Vector3.zero;

            wallBase = new Vector3[walls.Length];
            wallDir = new Vector3[walls.Length];
            wallDistance = new float[walls.Length];
            attachedBase = new Vector3[walls.Length][];
            for (int i = 0; i < walls.Length; i++)
            {
                WallEntry w = walls[i];
                if (w == null || w.wall == null)
                {
                    attachedBase[i] = new Vector3[0];
                    continue;
                }
                wallBase[i] = w.wall.position;
                Vector3 toCenter = center - w.wall.position;
                toCenter.y = 0f;
                // Snap to the dominant horizontal axis so walls lean straight in.
                wallDir[i] = Mathf.Abs(toCenter.x) > Mathf.Abs(toCenter.z)
                    ? new Vector3(Mathf.Sign(toCenter.x), 0f, 0f)
                    : new Vector3(0f, 0f, Mathf.Sign(toCenter.z));
                wallDistance[i] = Mathf.Abs(Vector3.Dot(toCenter, wallDir[i]));

                int count = w.attached != null ? w.attached.Length : 0;
                attachedBase[i] = new Vector3[count];
                for (int j = 0; j < count; j++)
                {
                    attachedBase[i][j] = w.attached[j] != null ? w.attached[j].position : Vector3.zero;
                }
            }

            if (ceiling != null)
            {
                ceilingBase = ceiling.position;
            }

            exitPos = new Vector3[exits.Length];
            exitScale = new Vector3[exits.Length];
            for (int i = 0; i < exits.Length; i++)
            {
                if (exits[i] != null && exits[i].target != null)
                {
                    exitPos[i] = exits[i].target.position;
                    exitScale[i] = exits[i].target.localScale;
                }
            }
            captured = true;
        }

        protected override void Apply(float value, AnxietyDirector director, float deltaTime)
        {
            if (!captured)
            {
                return;
            }

            for (int i = 0; i < walls.Length; i++)
            {
                WallEntry w = walls[i];
                if (w == null || w.wall == null)
                {
                    continue;
                }
                float meters = Mathf.Max(wallInwardMeters, wallInwardFraction * wallDistance[i]) * value;
                float gaze = w.gaze != null ? w.gaze.Value : 0f;
                meters += wallGazeExtraMeters * gaze * value;
                Vector3 offset = wallDir[i] * meters;
                w.wall.position = wallBase[i] + offset;
                for (int j = 0; j < attachedBase[i].Length; j++)
                {
                    if (w.attached[j] != null)
                    {
                        w.attached[j].position = attachedBase[i][j] + offset;
                    }
                }
            }

            if (ceiling != null)
            {
                float ceilingGazeValue = ceilingGaze != null ? ceilingGaze.Value : 0f;
                float drop = ceilingDropMeters * value + ceilingGazeExtraMeters * ceilingGazeValue * value;
                ceiling.position = ceilingBase + Vector3.down * drop;
            }

            for (int i = 0; i < exits.Length; i++)
            {
                if (exits[i] == null || exits[i].target == null)
                {
                    continue;
                }
                float k = exitShrink * value;
                Vector3 s = exitScale[i];
                exits[i].target.localScale = new Vector3(s.x * (1f - k), s.y * (1f - k), s.z);
                // The exit follows its wall, so only correct the height to keep its bottom edge on the floor.
                Vector3 p = exits[i].target.position;
                p.y = exitPos[i].y - s.y * k * 0.5f;
                exits[i].target.position = p;
            }
        }

        protected override void ResetEffect()
        {
            if (!captured)
            {
                return;
            }
            for (int i = 0; i < walls.Length; i++)
            {
                WallEntry w = walls[i];
                if (w == null || w.wall == null)
                {
                    continue;
                }
                w.wall.position = wallBase[i];
                for (int j = 0; j < attachedBase[i].Length; j++)
                {
                    if (w.attached[j] != null)
                    {
                        w.attached[j].position = attachedBase[i][j];
                    }
                }
            }
            if (ceiling != null)
            {
                ceiling.position = ceilingBase;
            }
            for (int i = 0; i < exits.Length; i++)
            {
                if (exits[i] != null && exits[i].target != null)
                {
                    exits[i].target.position = exitPos[i];
                    exits[i].target.localScale = exitScale[i];
                }
            }
        }
    }
}
