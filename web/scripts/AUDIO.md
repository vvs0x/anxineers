# ElevenLabs soundscape

Set `ELEVENLABS_API_KEY` in `web/.env` for local generation. Never put the key or `.env` inside `public/`, browser JavaScript, or the deployed site. The local gallery server serves the generated audio files and manifest directly; no ElevenLabs key is needed for browser playback. Requires Node 20+, no extra packages.

From `anxineers-brutalist/web`:

```sh
npm run audio:plan -- --group=anxiety
npm run audio:plan -- --group=atmosphere --ids=tense

# Generate and audition one phrase first; this uses credits.
npm run audio:generate -- --group=anxiety --limit=1

# Complete all 40 imagined conversation lines, reusing the pilot, and one 30-second noise loop.
npm run audio:generate -- --group=anxiety
npm run audio:generate -- --group=atmosphere --ids=tense
```

Planning reads neither `.env` nor the API and reports selected clips and an approximate credit estimate. Generation uses account credits. These commands generate only the 40 anxiety lines and the `tense` loop; they leave calm speech ungenerated. Calling `audio:generate` without a group instead selects every entry in the script, including optional calm material.

The gallery cast uses seven distinct male voices: Roger and Callum for the front group, Charlie, George and Liam for the rear group, and Eric and Brian for the seated group. This applies to both calm and imagined conversations. Voice gender is checked against the account's ElevenLabs metadata. `ELEVENLABS_VOICE_A` through `ELEVENLABS_VOICE_G` can override a role only with an available, distinct male voice; invalid or duplicate overrides fall back to a suitable male voice. `npm run audio:voices` lists names, IDs and genders. The separate guide retains Sarah.

There are ten four-turn imagined conversations about the blue person and ten four-turn calm conversations about the sculptures, exhibition and everyday work. Each conversation declares `group`, its fixed speaker roles, and ordered turns. Imagined lines avoid claims about current gaze, smiling, a phone, or other unobserved actions. Anxiety speech uses `[whispers]` with Eleven v3. The tense effect remains indistinct internal crowd murmur, without intelligible words or music. `ELEVENLABS_TTS_MODEL` and `ELEVENLABS_SFX_MODEL` override the default models.

Use `--limit=N` for the first N selected clips or `--ids=01,03` for particular IDs. Generate the calm set with `npm run audio:generate -- --group=calm`. FFmpeg preserves its 1.18× conversational pace without raising pitch; set `FFMPEG_PATH` if necessary. On this machine the existing executable is `/private/tmp/gallery-audio-tools/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1`. Original recordings and paced copies are cached. A complete successful group generation prunes retired IDs from that manifest group; partial runs retain resumable progress.

Each physical group owns its conversations and keeps taking turns regardless of distance or attention, with short natural reply overlaps. Exactly one visible group is focused: the group closest to the centre of the view, with a six-degree dead band to prevent rapid switching from tiny head movements. Generous member bounds and both XR eye projections still count as visible; an exact cursor hit is unnecessary. The focused group is clear (8 kHz low-pass) and approximately ten times louder than an equally distant background group. The other two remain audible through an 850 Hz low-pass filter. Gain, filtering and stereo position ease as the head turns without restarting any sentence. If no group is visible, all remain muffled. Distance softens the mix but never pauses a group. This applies to calm sculpture conversations as well as imagined first-person conversations; calming still fades the current judgments without starting new ones.

All gallery sentences play at most once per session. Both normal conversations and imagined judgments use in-memory text history. Each accepted Start/replay clears both histories and conversation progress, restoring all three groups and all seven male voices without redownloading the recordings. A fresh page also starts with the full library, ignoring legacy `gallery-spoken-lines-v1` storage. Switching perspective, hiding the tab or pausing within a session does not reset the history or repeat a sentence. Exhausted dialogue remains silent until the next session; ambience continues. The stone-or-concrete question is authored only once per session.
Output is `public/audio/elevenlabs/manifest.json`, MP3s and generation metadata. The manifest is saved atomically after every clip, merging by ID and preserving other groups. Files are cached by voice, text, model and settings. Rerun the same command after an interruption to reuse completed clips; `--force` regenerates and incurs new usage. Reload the browser after generation and include the generated directory when deploying.

Playback begins after user interaction. Floating and other third-person views stay calm, with no imagined judgments or tense layer. First-person anxiety adds the imagined group conversations; Calm Now, recovery and exit fade those voices out. Speech buffers are measured once after decoding and balanced toward −20 dBFS RMS with bounded gain and peak headroom. The generated noise stays underneath speech and its loop edges fade over 20 ms. Missing generated audio leaves the procedural sound available. Dialogue remains English regardless of UI language.

Before delivery, verify 40 calm and 40 anxiety entries against the script, their group and speaker assignments, seven distinct male voice IDs, and nonempty referenced MP3s. Run `npm run test:audio`, then verify local HTTP and Wi-Fi HTTPS delivery as required by AGENTS.md. Automated checks do not establish physical Quest playback.

API references: [Speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [Sound effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert). Paid generation runs locally, never through a public endpoint.

## The calm guide

`node scripts/generate-audio.mjs --group=guide` generates the English and German guide from `public/js/guide-script.js`, using Sarah (`EXAVITQu4vr4xnSDxMaL`), Multilingual v2, and a slower 0.78 speech speed, 0.85 stability, zero style exaggeration and no speaker boost. It preserves the existing atmosphere and visitor recordings. Cached clips play through a centered, separate audio bus at a softer normalized level. The breathing invitation uses shorter, unhurried phrases and reassures the listener that they can follow their own pace. While the guide speaks, the room bus falls to 16% of its normal gain and returns smoothly afterward; while listening it uses 22%.

The opening's **Begin with sound** gesture unlocks playback and preloads the three opening recordings. The greeting is only “Welcome.” (“Willkommen.” in German); the title is not narrated. The button changes to an enabled Start while it plays. After the greeting ends, a 0.35-second beat leads to the warning; after the warning ends, a 0.55-second beat leads to the headset reminder. New warning/reminder text appears 0.2 seconds before its matching narration. Start stays enabled throughout the greeting, warning and reminder. Pressing it immediately cancels current and queued narration and begins the experience (or waits only for unfinished room assets). Without a press, the reminder screen waits indefinitely. Replay uses the same welcome-button flow. Without narration, the warning gets three seconds of reading time.

The guide introduces breathing as the experience begins to settle. Anxiety intensity, room lighting and wall contraction ease out from their current values over fourteen seconds; a current darkness wave fades out over six seconds. Already-playing judgments finish or fade without starting fresh sentences, while the tense atmosphere fades and the calm room tone returns. Guide ducking takes 1.8 seconds during this handoff instead of cutting the background immediately. Only a centered circle is visible during breathing, in desktop/mobile and XR. The three breathing cycles start after the invitation ends, then lead to the five grounding steps. Calm Now during recovery skips the remaining grounding. Hints appear only on request or after a microphone response is silent, and refer to the gallery for sight/hearing and the real surroundings for touch/smell/taste.

Microphone input is optional and activated only by **Use microphone**. The existing `/api/stt` endpoint is used when its server key is configured; otherwise compatible browsers use `SpeechRecognition`/`webkitSpeechRecognition`. Both can send audio to a transcription service. Nothing is recorded while the guide is speaking. Current-step item counts are approximate, so the participant explicitly says **ready**, **next**, or **done** to advance; **stop** begins the closing breath. Partial lists accumulate, repeated items do not count twice, and Next remains available if recognition fails or permission is declined. The application does not persist recordings or transcripts. See [browser recognition support and service behavior](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

Validate guide assets, narration timing, focus, and microphone flow with `node --test test/guide-node.mjs test/session-node.mjs test/journey-node.mjs test/audio-node.mjs test/xr-input.mjs`.

## Supplied fear layers

The source instruments come from `art-hack/fear-viewer 09.25.57/source/soundscapes/engine.js`. `npm run audio:build-fear` bundles their adapted Tone.js engine locally. The user's `art-hack/Wind.m4a` and `art-hack/Things moving.m4a` are prepared with `npm run audio:prepare-fear` (set `FFMPEG_PATH` as above). The originals stay intact; public MP3s are loudness-balanced to −24 LUFS with −6 dB true-peak headroom and soft recording edges.

During first-person anxiety, a 48-second score crossfades among the Tone instruments, recorded wind and recorded movement. Each texture has rests, and no more than two are featured together. Tone's cluster, sub and stabs also alternate in smaller combinations; stabs require higher anxiety. When calming starts, the current combination is held and fades with recovery; no new texture or stab is introduced. Floating stays free of these fear layers. The shared room bus allows the guide to stay audible over the transition.

`test/audio-node.mjs`, `test/choreography.mjs`, `test/wall-gaze.mjs` and `test/pov-blackout.mjs` cover the gradual handoff, pairwise overlap, provided recording loading and the no-new-judgments rule. Regenerated guide metadata records the delivery settings in the manifest.
