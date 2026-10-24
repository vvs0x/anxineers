
## Phase 5: room prototype
- Menu `Anxineers/Phase 5/Build Room Scene` copies Sandbox into `RoomPrototype` and builds a 5 x 5 x 2.8 m neutral waiting room from primitives (distortable shader, so the Space distortion also applies).
- `RoomReactionEffect` (Space channel): walls lean in up to 0.8 m, ceiling drops up to 0.5 m, door and window shrink up to 40 %. Only room objects move, never the rig, camera or floor.
- Furniture and lamp are gaze targets (Objects channel, very soft drift 0.03 m, pulse 5 %). Lamp light flickers via the Light effect, within the existing flicker cap.
- Wall-mounted pieces (door, window, frame, shelf, bench) are attached to their wall and are deliberately not gaze targets, to avoid two effects writing the same transform.
- The abstract grounding helper items are removed in the room; grounding runs by voice only there.
- Review: whether wall lean and ceiling drop are acceptable for a clinical audience (they imitate a "closing in" feeling).

## Drive model change (after room test)
- `AnxietyDirector.Drive` now normalizes by the profile's peak: peak intensity = full drive for every effect, everywhere. Gaze only adds a bonus on the part still missing to full, so looking away never lowers the ambient level. The intensity cap still limits it (cap / peak).
- Consequence: the profile's per-effect `maxValue` now sets the strength at peak. Retune if the old gaze-heavy look is wanted.

## Phase 6: Gaussian splat (PC tethered only, no standalone)
- Renderer candidate: ninjamode/Unity-VR-Gaussian-Splatting (MIT, Unity 6000.3+, URP, single-pass instanced, Quest 3 listed). aras-p's plugin is reported not to work for VR on Unity 6.3. Versions unverified until tested on the PC.
- Install: Package Manager > Add package from git URL `https://github.com/ninjamode/Unity-VR-Gaussian-Splatting.git`. Create the asset with Tools > Gaussians > 3D > Create Splat Asset. Add "Gaussian Splat 3D URP Feature" to the URP renderer asset (keep Render Graph on).
- Wiring (no package dependency): `SplatEnvironment` (V key cycles Splat / Primitives / Both), `SplatReactionEffect` (Space channel; squashes the splat pivot toward the user: walls in up to 30 %, ceiling down up to 15 %). Menu: `Anxineers/Phase 6/Add Splat Environment To Room`.
- Test scene: `Assets/_Project/Splats/scene_sample_500k.ply` is a 500k splat sample of the user's `scene.ply` (5.67M splats, 318 MB, too big for git; keep the original outside the repo). Scene was captured y-down: the builder rotates it 180 degrees on X and offsets it (-0.57, 0.5, -0.26). Roughly 11 x 9 x 2.8 m, scale unverified.
- The splat file only has DC colour (no f_rest SH bands). If the importer demands them, convert or add zeroed bands.
- Open: non-uniform scale on the splat renderer is untested; invisible blockout furniture still acts as gaze targets in Splat mode (small gaze bonus only); real-room alignment and collision/boundary are not handled.
