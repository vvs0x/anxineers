using System;
using Anxineers.Core;
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
        }

        [Serializable]
        public class ShrinkEntry
        {
            public Transform target;
        }

        [Header("Walls")]
        [Tooltip("How far each wall moves toward the room center at full effect, in meters. Keep it small so nothing reaches the user.")]
        [SerializeField, Range(0f, 1f)] private float wallInwardMeters = 0.5f;

        [Header("Ceiling")]
        [SerializeField, Range(0f, 0.8f)] private float ceilingDropMeters = 0.35f;
        [SerializeField] private Transform ceiling;

        [Header("Exit")]
        [Tooltip("How much doors and windows shrink at full effect (0.3 = 30% smaller).")]
        [SerializeField, Range(0f, 0.6f)] private float exitShrink = 0.3f;

        [Header("Targets")]
        [SerializeField] private Transform roomCenter;
        [SerializeField] private WallEntry[] walls = new WallEntry[0];
        [SerializeField] private ShrinkEntry[] exits = new ShrinkEntry[0];

        private Vector3[] wallBase;
        private Vector3[] wallDir;
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

            float wallOffset = wallInwardMeters * value;
            for (int i = 0; i < walls.Length; i++)
            {
                WallEntry w = walls[i];
                if (w == null || w.wall == null)
                {
                    continue;
                }
                Vector3 offset = wallDir[i] * wallOffset;
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
                ceiling.position = ceilingBase + Vector3.down * (ceilingDropMeters * value);
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
