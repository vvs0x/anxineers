
## Phase 5: room prototype
- Menu `Anxineers/Phase 5/Build Room Scene` copies Sandbox into `RoomPrototype` and builds a 5 x 5 x 2.8 m neutral waiting room from primitives (distortable shader, so the Space distortion also applies).
- `RoomReactionEffect` (Space channel): walls lean in up to 0.5 m, ceiling drops up to 0.35 m, door and window shrink up to 30 %. Only room objects move, never the rig, camera or floor.
- Furniture and lamp are gaze targets (Objects channel, softer drift 0.08 m). Lamp light flickers via the Light effect, within the existing flicker cap.
- Wall-mounted pieces (door, window, frame, shelf, bench) are attached to their wall and are deliberately not gaze targets, to avoid two effects writing the same transform.
- The abstract grounding helper items are removed in the room; grounding runs by voice only there.
- Review: whether wall lean and ceiling drop are acceptable for a clinical audience (they imitate a "closing in" feeling).

## Drive model change (after room test)
- `AnxietyDirector.Drive` now normalizes by the profile's peak: peak intensity = full drive for every effect, everywhere. Gaze only adds a bonus on the part still missing to full, so looking away never lowers the ambient level. The intensity cap still limits it (cap / peak).
- Consequence: the profile's per-effect `maxValue` now sets the strength at peak. Retune if the old gaze-heavy look is wanted.
