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

Session: consent, intro, mode (understand anxiety or practise settling), maximum intensity, then the room builds up. After the peak comes 5-4-3-2-1 grounding (answer out loud or press Next), then three slow breaths and the end screen. Hard limit 20 minutes.

Desktop: drag to look, click buttons, `Space` calm now. Quest: point with a controller and press the trigger, `A/X` calm now. Saying "stop" during grounding also calms the room.
URL options: `?lang=de|en`, `?env=brutalist`, `?debug=1` (debug text, keys `1` calm, `2` build, `3` peak, `4` recovery, `Up/Down` cap, `P` profile, `H` hide, `B/Y` start or reset), `?skip=1&mode=edu|reg&cap=0.9&profile=Debug_Fast` (jump straight into the run).

## Netlify (optional, easiest for the headset)

Netlify gives a real HTTPS address, so the Quest just opens a URL: no Mac running, no adb, no certificate warning. In Netlify: import the repo, set **Base directory** to `web`, leave the build command empty, add `ELEVENLABS_API_KEY` under environment variables. `netlify.toml` serves `public/`, loads three.js from the jsDelivr CDN and runs `/api/stt` and `/api/status` as Netlify Functions. The address is public: protect it (Netlify password protection or an unguessable site name) and check the model licence first.

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

1. Environment and effects in WebXR with head gaze: **done**.
2. Session flow (consent, mode, cap, breathing, grounding, in-world panels): **done**.
3. ElevenLabs voice (grounding answers, "stop"): **done**, falls back to buttons without key or microphone.

All tested headless only (`npm test` with the server running). Not yet tested on the Quest.
