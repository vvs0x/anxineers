# Anxineers

WebXR health-education tool about anxiety. A calm 3D room that reacts to where you look (head gaze). Two uses: **Empathy** (med students and therapists feel what anxiety does to perception) and **Regulation** (people with anxiety practise settling). Runs in the Quest 3 browser, works with any 3D mesh environment, voice by ElevenLabs through a local Node server.

The earlier Unity version is frozen in `unity-archive/`. Active work is in `web/`.

## Run

```bash
cd web
npm install
cp .env.example .env      # add ELEVENLABS_API_KEY later, voice is step 3
npm start
```

Open `http://localhost:8080` on the Mac for the desktop test (mouse look, debug keys).

### Quest 3

* **USB (recommended, works anywhere):** install adb (`brew install android-platform-tools`), enable developer mode, connect the headset, then `adb reverse tcp:8080 tcp:8080`. In the Quest browser open `http://localhost:8080`. Localhost counts as a secure context, so WebXR works.
* **Wi-Fi:** open the `https://<mac-ip>:8443` address that `npm start` prints. Accept the self-signed certificate warning once. Mac and headset must be on the same network.

Press **Enter VR**.

### Controls

Desktop: drag to look, `1` calm, `2` build, `3` peak, `4` recovery, `Space` calm now, `Up/Down` cap, `P` next profile, `H` hide debug text.
Quest: `A/X` calm now, `B/Y` start build or reset.
URL options: `?profile=Debug_Fast&cap=0.9&autostart=1&env=brutalist`.

## Use your own environment

Add a folder `web/public/environments/<id>/` with a `.fbx`, `.glb` or `.gltf` and an `env.json` (see `brutalist/env.json`). Mesh roles (wall, ceiling, floor, light, object) are found by name hints, `roles` adds hints, `overrides` assigns single meshes, `exclude` removes meshes. Statues and stands are grouped by proximity automatically; objects outside the room are hidden. Then open `?env=<id>`.

The brutalist model file lives at `web/public/environments/brutalist/model.fbx`. Check its licence before any public use.

## Layout

```
web/server.js            static files, HTTP and HTTPS, /api/stt (ElevenLabs proxy)
web/public/js/           director, gaze, environment, effects, audio, main
web/public/environments/ environment folders
web/test/headless.cjs    Playwright smoke test with screenshots (needs the server running)
docs/SAFETY_REVIEW.md    clinical and data protection checklist
PROJECT_NOTES.md         decisions and open items
```

## Status

1. Environment and effects in WebXR with head gaze: **done**, untested on the headset.
2. Session flow (consent, mode, cap, breathing, grounding): next.
3. ElevenLabs voice (grounding answers): after that.
