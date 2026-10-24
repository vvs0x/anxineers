# Safety and review checklist

Status: draft by the developers. Nothing here is clinically validated. This tool is educational, makes no therapeutic claims and is not a medical device.

## Built-in safety rules (verify on every build)
- [ ] No artificial locomotion. The user never moves unless they move themselves.
- [ ] The camera, the head tracking and the horizon are never moved or tilted by any effect. Only the environment and screen-space overlays change.
- [ ] "Calm now" (A or X on either controller, Space on keyboard) works at any moment: stops grounding, ramps intensity down fast, starts a short breathing exercise.
- [ ] Intensity never exceeds the cap the user chose before the session.
- [ ] Hard maximum session length (default 20 min) ends the experience with calm now behaviour.
- [ ] Consent and intro screens come before any effect. The user chooses the cap before anything intense happens.
- [ ] No strobing: light flicker is capped to a low frequency and small amplitude. Check the flicker values against photosensitivity guidance before use.
- [ ] Release builds have no keyboard shortcut that raises intensity or the cap. Test shortcuts exist only in the editor and development builds.

## Needs clinical review before real users
- [ ] All consent, intro, exercise and end texts (they are placeholders).
- [ ] The 5-4-3-2-1 grounding flow and the breathing pace (4 s in, 6 s out, 3 breaths).
- [ ] The strength and kind of effects: tunnel vision, desaturation, lamp flicker, heartbeat and high tone, walls closing in, ceiling lowering, door shrinking, room breathing, blur.
- [ ] Who may use it (exclusion criteria, for example panic disorder, epilepsy, pregnancy, motion sickness) and whether a facilitator must be present.
- [ ] How the Regulation mode differs from the Education mode and whether it is appropriate without supervision.
- [ ] Debrief and what the user sees at the end.

## Data protection review
- [ ] Voice answers are sent to ElevenLabs (third party) for speech to text. Needs a data processing agreement, a decision on EU hosting or zero retention, and clear consent wording.
- [ ] The API key is stored on the PC (environment variable or a local file). Never commit it.
- [ ] No other personal data is stored. Confirm that nothing from the session is logged to disk.

## Technical checks on the headset PC
- [ ] Quest Link works with OpenXR, Vulkan or D3D12, HDR on in the URP asset, Render Graph on.
- [ ] Gaussian splat frame rate holds above 72 fps in the headset. Reduce splat count with Tools/decimate_splat.py if not.
- [ ] Gaze: head gaze only. The eye tracking provider is a stub.
- [ ] Meta XR Core SDK is not installed. Record the version if added later.
