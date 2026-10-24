# PROJECT_NOTES

Running log: decisions, versions, open questions, test results. Update this instead of re-summarizing in chat.

## Decisions
- Device: Meta Quest 3, no eye tracking. Gaze via `IGazeProvider` (`HeadGazeProvider` default, `EyeGazeProvider` stub).
- Unity 6.3 LTS (6000.3.9f1, installed locally). Project root = repo root (matches `.gitignore`).
- Render pipeline: URP. Input: new Input System only. XR: Unity OpenXR Plugin + Meta XR Core SDK.
- Dev loop: build on Mac (editor, scripts, simulator checks), test PC VR over Quest Link / Air Link on a Windows PC. Link does not run on macOS.
- Standalone Android (Quest 3 APK) stays possible, not optimized yet.
- Assembly definitions: Core, Gaze, Effects, UI, Debug (namespace `Anxineers.<Name>`).
- Git LFS for textures, audio, video, models and splat formats (see `.gitattributes`).
- Branching: Phase 1 work on `feat/phase-1-setup`, conventional commits, not pushed to main without review.

## Verified versions
- Unity 6.3 is an LTS release (Unity blog). Installed here: 6000.3.9f1.
- Unity OpenXR Plugin: 1.16.1 installed (Meta docs recommend 1.15.1 or newer for Unity 6 with Meta XR SDK v74+). Oculus XR Plugin is intentionally not used.
- Meta XR Core SDK: not installed yet. Phase 1 rig uses plain OpenXR and Input System. Install latest via Package Manager and record version here.
- Meta XR Simulator: standalone app, no extra Unity package needed with OpenXR (Asset Store package is deprecated). Extra requirements on macOS, check before relying on it.

## Open questions
- Which Meta XR Core SDK version is installed (fill in).
- Meta XR Simulator on Apple Silicon: works or not (fill in).
- Is git-lfs installed on every team machine (`git lfs install`)?

## Test results
- (none yet)

## XR config (Phase 1)
- XR Plug-in Management: OpenXR enabled on the PC (Standalone) tab. Android tab not configured yet.
- OpenXR interaction profile: Oculus Touch Controller Profile enabled (Standalone).
- Scenes: Boot (loads Sandbox), Sandbox (XR rig, controller spheres, floor grid, 0.5 m cube, 1.8 m pillar), RoomPrototype (empty). Built via menu Anxineers > Phase 1.
- Rig: tracked poses via Input System TrackedPoseDriver, floor tracking origin requested by XRTrackingOrigin. No locomotion.
- Windows graphics API list was changed by Unity during setup (Direct3D11 only for Windows).

## Phase 2 (Core), on branch feat/phase-2-core
- Gaze: `IGazeProvider`, `GazeSource` (picks valid provider with highest priority), `HeadGazeProvider` (default), `EyeGazeProvider` (stub, never valid).
- Core: `AnxietyDirector` (state machine Calm/Build/Peak/Recovery, smoothing, hard cap, `CalmNow`), `AnxietyProfile` (timeline plus per-effect max, curve, rise/fall, gaze weight), `IAnxietyEffect`.
- Effect pattern for Phase 3: `drive = director.Drive(kind, gaze)`, smooth with `EffectSettings.Step`, then `director.Shape(kind, drive)`.
- `GazeTarget`: local value 0..1 from angle (fullAngle to falloffAngle) times dwell. Reports max value to the director.
- Debug: `DebugShortcuts` (1-4 states, Space/gamepad A = calm now, Up/Down = cap), `DebugMouseLook` (editor only, right mouse, off when a headset is present), `GazeValueTint`.
- Editor menus: Anxineers > Tuning Window, Phase 2 > Create Starter Profiles, Phase 2 > Add Core Test Objects To Sandbox.
- Not yet tested in Unity (written on Mac without compiling). Test: see checkpoint in chat.

## Phase 4 (Grounding and breathing), on branch feat/phase-4-grounding
- Design change: the recovery exercise is the 5-4-3-2-1 sensory grounding method (see 5, touch 4, hear 3, smell 2, taste 1), followed by a short breathing ending (3 breaths, 4 s in, 6 s out). Each named item lowers the director intensity.
- Answers are spoken. `VoiceInput` records the mic and sends the clip to ElevenLabs speech-to-text (`scribe_v2`, POST /v1/speech-to-text, header xi-api-key). Fallback: manual mode (Enter = one spoken item).
- API key: env var ELEVENLABS_API_KEY, or menu Anxineers > Voice > Set ElevenLabs API Key (saves UserSettings/elevenlabs.key, git-ignored). Never commit keys. A shipped product needs a backend proxy instead of a key on the device.
- OPEN, needs clinical and data-protection review: user speech leaves the device (third party), consent wording, retention and EU hosting, all prompt wording (placeholder text), any use with people with anxiety.
- New assemblies: Anxineers.Voice (mic, STT) and Anxineers.Session (grounding, breathing, orb). Namespace Anxineers.Session.
- Director got `SetTargetOverride` / `ClearTargetOverride` so guided exercises steer intensity; `SetState` and `CalmNow` clear it.
- Items in the scene (GroundingItem) are optional helpers: see/hear by gaze, touch by controller distance.
- Test shortcuts: G grounding, B breathing, Backspace skip step, Escape stop, Enter = one spoken item (manual mode).
- Unverified: ElevenLabs request details came from docs summaries, check Console for the error body if a request fails.

## Phase 4c: session flow
- SessionController: Consent, Intro, Cap select (thumbstick or arrows, trigger or Enter to confirm), Running, Ending. Key S starts it.
- Running: Build, Peak, then Recovery starts the grounding (5-4-3-2-1) and breathing at the end. Hard max length `maxSessionSeconds` (default 1200 s) triggers calm now.
- CalmNowInput: A or X on either controller calls CalmNow; grounding stops and short breathing starts without steering the director. Session then ends.
- Note: if a profile has PeakHoldSeconds = 0 the Peak never ends by itself, so grounding only starts via max length or calm now.
- All consent/intro/cap/end texts are placeholders and need clinical review.

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
- Test scene: `Assets/_Project/Splats/scene_sample_500k.ply` is a 500k splat sample of the user's `scene.ply` (5.67M splats, 318 MB, too big for git; keep the original outside the repo). Scene was captured y-down: the builder rotates it 180 degrees on X and offsets it (-0.5, 0.5, 2.5) so the user stands in the big open hall (the scene is a multi-room floor plan, the first centre guess was inside a wall). Editor-only WASD walking added to DebugMouseLook (right mouse held). Roughly 11 x 9 x 2.8 m, scale unverified.
- The splat file only has DC colour (no f_rest SH bands). If the importer demands them, convert or add zeroed bands.
- Open: non-uniform scale on the splat renderer is untested; invisible blockout furniture still acts as gaze targets in Splat mode (small gaze bonus only); real-room alignment and collision/boundary are not handled.

### Splat effect update
- Splat mode switching now moves the splat to a hidden layer (31, removed from all camera masks) instead of disabling the renderer, to avoid the renderer's OnDisable/OnEnable churn that left the splat stuck.
- `SplatReactionEffect` also breathes the room (up to 3 % at 0.15 Hz) and grows the splat size (blur) via reflection on `m_SplatScale`, squash raised to 40 % / 20 %.
- The splat renders before transparents and before post processing, so vignette and colour effects do apply to it. Lamp, furniture and light flicker have no effect on a splat (no real lighting or objects).

### Denser splat
- `Tools/decimate_splat.py` cuts the original 5.67M splat `scene.ply` to a chosen size, optionally cropped to a box. Hall box used: `--box -6 6 -2.6 0.9 -0.4 4.8` gives 3.0M splats, of which the 2.5M most important are kept (140 MB). Output `scene_hall_*` files and their generated assets are git-ignored, so every machine (also the headset PC) must run the script on its copy of the original.
- Create the splat asset with the Medium preset. The High preset on the 500k sample produced a screen full of green floating splats (cause not understood).

## Phase 7: polish
- SessionController now has a mode screen (Understand anxiety = Education_Light, Practise settling = Regulation_Gentle) before the cap screen. Profiles are assigned by `Anxineers/Phase 7/Prepare Room For Release`, which also turns on autoBegin, points Boot at RoomPrototype and sets the build scenes.
- `Anxineers/Phase 7/Build Windows Player` builds Windows x64 to `Builds/Anxineers/`. Untested. Standalone Android is dropped (always tethered).
- Release builds keep only calm now (Space, controller buttons) and Escape. State and cap shortcuts and the test keys are editor and development build only.
- `SAFETY_REVIEW.md` lists safety checks, open clinical review items and data protection items.

### UI restyle
- `PromptPanel`: translucent rounded boxes (procedural sprites), round dots, panel placed 1.0 m in front of the user (was 1.6 m, ended up behind walls), canvas scale 0.0007 m per unit.
- Listening level bar replaced by a soft pulsing orb (0.3 Hz, voice level smoothed over 0.5 s so it never flickers).
- Font: `Assets/_Project/Resources/Fonts/CalycesInc-Regular` (.ttf or .otf, not in the repo until the user adds it, check the font licence before committing). Falls back to the built-in font with a console warning.
