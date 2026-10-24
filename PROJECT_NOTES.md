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
