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
- Unity OpenXR Plugin: Meta docs recommend 1.15.1 for Unity 6 with Meta XR SDK v74+. Confirm in Package Manager.
- Meta XR Core SDK: not pinned. Install the latest via Package Manager (Asset Store "My Assets" or Meta's npm registry). Record the version here after install.
- Meta XR Simulator: standalone app, no extra Unity package needed with OpenXR (Asset Store package is deprecated). Extra requirements on macOS, check before relying on it.

## Open questions
- Which Meta XR Core SDK version is installed (fill in).
- Meta XR Simulator on Apple Silicon: works or not (fill in).
- Is git-lfs installed on every team machine (`git lfs install`)?

## Test results
- (none yet)
