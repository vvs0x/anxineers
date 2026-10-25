# Anxineers

WebXR health-education tool about anxiety. A calm 3D room that reacts to where you look (head gaze). Two uses: **Empathy** (med students and therapists feel what anxiety does to perception) and **Regulation** (people with anxiety practise settling). Runs in the Quest 3 browser, works with any 3D mesh environment, voice by ElevenLabs through a local Node server.

The earlier Unity version is frozen in `unity-archive/`. Active work is in `web/`.

## Signal character integration

This branch combines `feat/brutalist-room` (592b77b) with the existing Signal character. The brutalist model, original materials, lighting/audio effects, consent, grounding, breathing, and voice/manual fallback are retained. Startup now goes from consent to the introduction and straight into the room, without mode or intensity selection.

After selecting Start, the viewer floats through the gallery in third person. Signal stays framed on desktop, with a live companion view whenever tracking, furniture, or a narrow viewport hides him. His anxiety line stays visible even at zero intensity, moving gently at rest and gaining energy with anxiety. Twelve calm seconds and a four-second settling interval precede the anxiety build. The optional **His viewpoint** control retains the original embodiment journey and head clipping; **Return to floating** restores the external view.

Walls close horizontally around the character while the ceiling, ceiling fixtures and floor remain fixed; wall heights do not stretch. Complete ceiling panels stay together so contraction cannot pull their triangles apart. The large central table is present in its original position. During anxiety, the currently visible chair grows by up to 30%, the table by 8%, and the original small sculptures by 20%; the rear Nike statue and its plinth keep their original scale. Furniture remains supported and moves only through its own effect or wall contact. BVH hit testing preserves the original model geometry and materials.

The red dot is **head-directed gaze**, not eye tracking: Quest 3 does not contain eye-tracking hardware. Gaze remains local; no gaze history is recorded. A/X on Quest or Space / Calm now on desktop still stops the experience.

Current delivery: the laptop's local Wi-Fi server. Quest uses `https://<laptop-ip>:8443`; the laptop spectator page is `http://localhost:8080/spectator.html`. Cloudflare and Netlify are retired. Follow [AGENTS.md](AGENTS.md) and [the shared instructions](../AGENTS.md).

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

Session: consent, intro, mode (understand anxiety or practise settling), maximum intensity, then the room builds up. After 12 calm seconds and a four-second settling interval, anxiety builds while the external floating view continues. His viewpoint is optional. After the peak comes 5-4-3-2-1 grounding (answer out loud or press Next), then three slow breaths and the end screen. Hard limit 20 minutes.

The participant browser view fills the screen and hides desktop toolbars, developer controls, stage labels, diagnostic overlays, and the Calm button. Beginning the experience requests full screen where supported. The opening/warning, breathing circle, and grounding cues remain, matching the VR experience; narration, background voices and ambience remain enabled. Laptop: drag to look and use the in-scene viewpoint target; `Space` still calms the experience. Phone/tablet: drag to look. Optional motion and tuning controls are available through `?dev=1`. Quest: **Enter VR** appears during the opening only on browsers that support immersive VR; move your head naturally and point with a controller or hand to interact.
URL options: `?lang=de|en`, `?env=brutalist`, `?debug=1` (debug text, keys `1` calm, `2` build, `3` peak, `4` recovery, `Up/Down` cap, `P` profile, `H` hide, `B/Y` start or reset), `?skip=1&mode=edu|reg&cap=0.9&profile=Debug_Fast` (jump straight into the run).

## Local Wi-Fi and the laptop mirror

Run `npm start` from `web/`, and keep the laptop awake and connected. The startup output and `/api/status` list the HTTPS address to open on Quest 3, currently `https://10.4.25.20:8443`. Both devices need **eth-visitors** Wi-Fi. The address may change after switching networks. Typing the laptop IP with port 8080 redirects to HTTPS 8443, because Quest VR requires a secure origin. A normal local development certificate warning appears on the headset the first time; handle it there before entering VR.

Show participants the [join QR page](https://10.4.25.20:8443/join.html), or download the [PNG](https://10.4.25.20:8443/join-qr.png) / [SVG](https://10.4.25.20:8443/join-qr.svg). The QR opens the experience at `https://10.4.25.20:8443`; participants must share the laptop's Wi-Fi. All agents must update and verify this experience URL, as required in both AGENTS.md files. If its address changes, install `qrcode[pil]` in a Python virtual environment, run `python scripts/generate-join-qr.py https://<new-ip>:8443` from `web/`, decode-check the new QR, and update the instructions and links together.

1. On the laptop (or another device on the same Wi-Fi), open `https://<laptop-ip>:8443/spectator.html`. The host laptop can also use [Laptop view](http://localhost:8080/spectator.html).
2. Open the gallery in any browser, including Quest Browser. The visit appears automatically in the spectator grid, even before **Enter VR** or **Start**. No pairing codes or sharing buttons are needed.
3. Everyone appears in a separate tile. Select a tile to enlarge their view, then use **Everyone** or **Escape** to return to the grid. **Full screen** keeps these controls available.
4. Entering VR switches that participant's existing tile to the left-eye headset image; exiting VR resumes their browser view. Background tabs pause. Refreshing or reconnecting resumes sharing automatically. Sound stays on the participant's device; spectators cannot move their camera or operate their controls.

The mirror copies the rendered canvas and paints the browser's live opening text, controls, breathing circle and grounding dice over it. In VR it copies the already-rendered left-eye framebuffer. It does not run a second gallery simulation or move scene objects. Capture is capped at 15 frames per second with a maximum image edge of 960 pixels. Every participant's frames carry a source ID, and each spectator acknowledges each stream independently, so images stay in the correct tiles and a slow stream does not stall others. Frames are forwarded in memory and never saved. Capture only runs when a visible spectator requests that stream; enlarging a tile suspends requests for the other tiles on that spectator page.

Static edits in `web/public/` are immediately available. Refresh both clients to load changed modules or assets. Backend changes require restarting only the identified gallery server. Do not start a tunnel or publish to Netlify. The local server and Wi-Fi stay running after verification.

Run `npm run test:spectator` for relay checks. `npm run test:spectator:browser` uses multiple Playwright browser clients and real WebGL2 targets to verify browser opening and breathing cues, simultaneous streams, grid/focus/full-screen controls, mobile layout, browser–VR transitions, left-eye cropping, antialiasing resolve, state restoration, pause/resume, reconnects, and capture stopping when no viewers request frames. These tests do not replace a physical Quest check.

References: [Meta's local headset setup](https://developers.meta.com/vr/documentation/iwsdk/guides/02-testing-experience/), [WebXR framebuffer lifetime](https://immersive-web.github.io/webxr/#opaque-framebuffer).

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

`npm test` runs the asset, shader-assembly, gaze/geometry, session, and camera-journey checks without a browser. `npm run test:browser` retains the original optional Playwright suite (requires Playwright and server); those legacy scenarios may need timings adjusted for the new observation phase. The room rendered successfully in Safari, including the red gaze marker. No physical Quest test has been performed. Voice endpoints are preserved; voice transcription needs ELEVENLABS_API_KEY on Netlify, otherwise manual Next remains available.

## Original materials and wall gaze

The web room uses PBR textures baked from the original `brutalist_A_final.blend` procedural materials, with separate glass and window frames, and the authored HDR World and Sun. The source Blender file is not modified. `scripts/bake_brutalist_materials.py` and `scripts/export-brutalist-lighting.py` reproduce these web assets. Browser lighting uses a single bounded shadow map; it preserves the source light direction/color and materials but does not reproduce Cycles path-traced indirect light exactly.

During Build/Peak, one uninterrupted second of head gaze on an unobstructed vertical wall starts a repeating horizontal cycle: three seconds inward to 12% contraction, then three seconds fully outward. The floor and ceiling keep their height. Looking at a prop, floor or ceiling does not count as wall dwell. The cycle stops and returns smoothly to rest during Recovery/Calm, and calm observation never triggers it. Use `?debug=1` to inspect hit role, wall dwell and contraction percentage.

Walls push rigid furniture only when they make contact. The contact solver uses finite sections of the actual wall triangles, including openings and internal walls, and passes pushes through adjacent objects. Original props, the rear sculpture and all unoccupied poufs participate; the rear sculpture is exempt from gaze growth; the occupied seat stays fixed and keeps its cushion height while its footprint grows. Props ease back toward their original positions as space opens. Actual GLB tests verify horizontal wall displacement, unchanged ceiling height, no new wall crossings, inward/outward cycles and restoration.

## Cross-device verification

`npm test` includes orientation-axis/screen-rotation, motion permission/fallback, recenter, pointer cancellation, XR input priority, and tracked camera handoff checks. `node test/devices.cjs [baseURL] [screenshotDirectory]` runs the desktop/mobile browser flow with Playwright: native buttons, simulated iPhone permission denial/grant and phone rotation, narrow portrait and landscape layouts, drag, Calm now, breathing and replay. Install Playwright separately for this optional browser check; set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome.

Verified in Chrome with desktop, 390×844, 320×568 and 844×390 viewports; no page or shader errors. Sensor events and permission results were simulated. Actual iOS/Android sensor behavior, headset stereo/tracking and device frame rate still require hardware verification. Motion and immersive VR need HTTPS; phone motion changes view orientation, not physical position.

Legacy Netlify site: `still-here-room` (`4c0ee7df-64a3-4c73-bd9a-aa39d4ce1026`). It is not the current delivery target; use the local Wi-Fi server above.

### Developer settings and VR input

Use `?dev=1` to reveal **Developer settings** and the optional browser controls. In that developer view, the top-right button or `D` opens the panel. The desktop side panel has live sliders for session/breathing timings, intensity, chair/table/sculpture growth, gaze response, wall movement, vision, lighting, audio, channel response, menu distance, ray reach, pinch thresholds, exposure and visitor speeds. Values save in this browser; **Reset defaults** restores the defaults. Startup and replay preserve these developer settings. Default breathing remains three cycles at two seconds in and three seconds out.

Before entering VR, enable **Show diagnostics in headset** in the panel (also enabled by `?debug=1`). Both controllers and tracked hands have rays that reach the menu, green button-hit feedback and a hit dot. Trigger or thumb/index pinch selects; grip recenters the menu. Tracked joints are shown by default. Hand tracking is requested as an optional XR feature, so controllers remain usable on devices without it. The diagnostic readout reports source type, ray/joint tracking, targeted button and the last selection or miss. A held gesture cannot advance multiple screens.

`npm test` includes simulated XR ray transforms, per-hand selection, native/trigger/pinch deduplication, tracking loss/reconnect, and furniture growth checks. `node test/developer-browser.cjs` uses Playwright and a server on port 8080 to check the actual sliders, persistence/reset, startup buttons, and desktop/mobile layout. Physical headset input still needs a hardware retest.

## Floating and teleporting

The guided tour moves at 0.28 m/s between up to six reachable viewpoints on the gallery floor grid. **Pause floating / Resume floating** controls the guide. Drag or WASD to steer; Q/E changes height. Steering suspends guidance for four seconds, then the tour continues. Click/tap visible clear floor to teleport, or use **Teleport elsewhere** (T). Teleporting holds the guide for six seconds. F toggles floating. Walls, furniture, other visitors and Signal's personal space reject unsafe landings; floor coordinates follow room contraction. Calm now, session panels and loss of window focus clear movement input. Reduced-motion preferences start with floating paused.

In VR, trigger on clear floor teleports, the left stick steers, left-stick click toggles guided motion, and right-stick click selects another viewpoint. VR begins stationary. Physical head orientation and translation remain live; the small companion view keeps Signal and his line visible when looking elsewhere. These controls have geometry/unit coverage, but require a physical headset check for comfort and device input behavior.

`node test/exploration.mjs` exercises the actual gallery GLB: multiple viewpoints, extended guided travel, character framing, pause, floor selection, invalid landings, contracted coordinates, tracked pose and Calm cancellation.

## Conversation group and visitors

Seven shadow visitors share the gallery, in addition to Signal. Their resting arrangement is two seated on poufs, two conversing in front of Signal with their backs toward him, and three conversing beside the rear sculpture. Head and arm gestures stay subtle. After a long pause, a pair exchanges places across the seated, front and rear groups; walking duties rotate. One steps aside to a clear waiting place before the other passes, avoiding head-on deadlocks in narrow aisles. Every completed exchange restores the two–two–three arrangement.

People and furniture must remain physically supported. Actual skinned sole points anchor standing/walking figures to the floor. Seated leg IK keeps both feet down while the hips rest on the cushion, including sit/stand transitions. Each foot has a contact shadow, and moving figures cast refreshed directional shadows. Detached body trails are removed. Furniture scaling preserves its underside height even with a centered import pivot. The camera can float; physical bodies cannot. This is also a standing project rule in the workspace `AGENTS.md`.

The crowd checks other visitors, furniture, the viewer and the moving room. Reserved visitor seats remain anchored, and the walkers yield before moving props reach their body clearance. Avatars reuse the two existing models.

`test/visitors.mjs` simulates four minutes of exchanges followed by a minute of contracting walls. It checks the seven-person formation, rotating exchanges, maximum two travellers, pauses, back-facing front pair, seat/sole geometry, separation and furniture clearance. `test/wall-collisions.mjs` checks growth anchored to actual supporting geometry. Optional browser smoke check: `node test/crowd-browser.cjs [baseURL] [screenshotDirectory]` validates the rendered crowd, first exchange and rear wall in laptop and phone viewports.

## Generated voices and atmosphere

The ElevenLabs pipeline adds calm conversation, ambient loops, and 52 whispered anxiety lines. Put your key in `web/.env`, then run `npm run audio:generate` from `web/`. See [audio setup](web/scripts/AUDIO.md) for voice selection, caching, and deployment.

Normal group conversations play during observation and free exploration. Their played-line history resets on a new page visit, while still avoiding repeated dialogue within that visit. Saved imagined-judgment history is separate, so prior testing cannot permanently silence the normal gallery conversations. The guide continues to lower the background mix while speaking.

### Supplied Brutalist Baked textures

The active room asset is `web/public/environments/brutalist/room-baked.glb`. Run `python3 scripts/import-brutalist-baked.py` to rebuild it from the sibling `brutalist_baked/model.glb` and the preserved `room-textured.glb`. It imports baked UVs and color maps for 19 matching architectural and prop objects while retaining the current gallery's node transforms, lighting fixtures, and separate glass/frame materials. The rear closure reuses the baked concrete panels. Textures are embedded, so no external `tex/` requests are needed.

## Current choreography (default settings)

The startup title lasts 3 seconds, followed by a 5-second trigger warning. The headset reminder then waits for **Start**. The times below begin at that click; saved Developer settings can change the durations.

| Since Start | Since entering POV | Event |
| --- | --- | --- |
| 0:00–0:10 | — | Ten-second floating preview. Signal walks left to right, reaches his chair and sits. |
| 0:10–0:14 | — | Transition into the seated Signal's POV; anxiety remains off. |
| 0:14–0:24 | 0:00–0:10 | Anxiety and wall contraction rise from 0% to full strength; wind, Fear Viewer tones and the existing anxiety voices overlap. |
| 0:24–0:36 | 0:10–0:22 | Two complete 30% wall pulses, three seconds outward and three inward each. |
| 0:36–0:44 | 0:22–0:30 | Walls hold fully inward, building anticipation. |
| 0:44–0:48 | 0:30–0:34 | First gradual fade to full darkness with walls held inward. |
| 0:48–0:52 | 0:34–0:38 | Gradually restore the anxious room lighting. |
| 0:52–0:56 | 0:38–0:42 | Second gradual fade to full darkness, still holding the walls. |
| 0:56–1:00 | 0:42–0:46 | Gradually restore visibility. |
| 1:00–1:10 | 0:46–0:56 | Continue the inward hold for ten seconds after the blackouts. |
| 1:10–2:30 | 0:56–2:16 | Normal 30% wall pulses resume; anxiety stays at 100%. |
| 2:30 | 2:16 | Begin breathing. Subsequent breathing/grounding narration is managed separately. |

**Breathing begins after Start** is an absolute active-session cutoff (default 150 seconds), independent of changes to the overview or embodiment durations. The table assumes uninterrupted POV. The blackout clock counts only settled POV time; floating, transitions and hidden tabs pause it. Leaving POV during darkness or pressing Calm now clears the cue. Replay resets both waves. Each wave uses a cosine envelope with zero slope at clear/dark endpoints: four seconds down and four seconds up, with no hard cut or dark hold.

Developer settings exposes **POV blackout → Seconds in POV before darkness / One dark-light wave / Darkness waves** and a live POV clock. Old saved 50% caps, 12% wall amplitudes and two-second blackout settings are migrated to this choreography; unrelated settings remain. Ordinary room dimming remains capped at 60% so lighting cannot accidentally extinguish outside the scheduled waves. Reduced-motion mode preserves a stationary overview; tracked views keep physical head/phone orientation live while the virtual rig circles.

Other actions are reactive, rather than fixed timeline events:

- Walls move steadily inward with the ten-second anxiety ramp, reaching the slider maximum of 30% contraction. Two complete pulses lead into the close hold through both blackout waves and ten more seconds; then three-second outward / three-second inward cycles resume without a jump. Developer settings → Walls → **Hold inward after blackouts** adjusts this pause; changing blackout timing moves the wall hold with it. Calming releases the walls over 2 seconds. The ceiling stays fixed.
- Gaze enlargement remains active during calm preview, floating, wall holds, pulses and blackouts. Looking at a prop builds its gaze response over 1.5 seconds; looking away releases it over 2.5 seconds, with additional scale smoothing. Chairs grow up to 30%, the large table 8%, and the original small sculptures 20%. The rear Nike sculpture stays at its original scale.
- Calm conversations run during observation/floating. In POV, the local Fear Viewer Tone.js soundscape (dissonant clusters, sub-bass and intermittent stabs), moving filtered-noise wind, heartbeat and overlapping anxiety voices follow intensity; some lines depend on looking at a person and proximity. Clip durations and selection affect their exact timestamps.
- The crowd currently has its own scene clock, starting when the room is ready, including time spent on the introduction screens. Its first exchange is attempted at four seconds on that clock; subsequent exchanges wait four to six seconds after the previous exchange completes. Path length, obstacles and visitor speed change completion times; at most two visitors travel at once. This clock is not synchronized with Start or reset on replay.
- **Calm now** interrupts the running sequence immediately and begins breathing. The separate breathing/grounding workflow owns what happens after this handoff.

`node --test test/pov-blackout.mjs` verifies cue boundaries, pause/cancel/replay and custom timings. `node test/pov-browser.cjs [baseURL] [outputDirectory]` uses Playwright and the real animation loop to verify visible first-person rendering with legacy maximum dimming, two smooth darkness waves during POV 30–46 seconds, restoration and Calm Now cancellation.
