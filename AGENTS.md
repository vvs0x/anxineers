# Gallery agent instructions

Read and follow [the shared instructions](../AGENTS.md) before updating this gallery, including the physical-support and focused-read rules.

The gallery now runs directly on the laptop over Wi-Fi. The user explicitly abandoned Cloudflare tunnels on 2026-10-25; this supersedes previous tunnel and Netlify delivery instructions.

- Work in the active `web/` checkout and preserve other changes.
- **Every agent must deliver gallery updates to https://10.4.25.20:8443 and verify that URL serves the changed files.** Do not finish with only a separate preview. If the laptop's Wi-Fi IP changes, confirm it and update both AGENTS.md files and the join QR/page together.
- Keep the gallery server running on HTTP 8080 and HTTPS 8443.
- Use **eth-visitors** Wi-Fi for the laptop and participant devices. Confirm the current Wi-Fi IP before reporting the experience URL.
- Quest: `https://<laptop-wifi-ip>:8443`. Laptop mirror: `http://localhost:8080/spectator.html`.
- The spectator page automatically shows every open gallery browser in a grid, before and during VR. Clicking a tile opens an enlarged view; Everyone/Escape returns to the grid. No pairing codes or participant controls. Support either opening order, multiple participants and spectators, and automatic reconnection.
- Keep the participant web view free of browser-only buttons, toolbars, HUD and developer overlays. Preserve the opening, breathing and grounding cues shared with VR, and all guide/background/ambient audio. Browser controls are opt-in with `?dev=1`; headset entry remains available during setup.
- Normal conversations must play during exploration. Both normal conversations and imagined judgments reset on every accepted Start/replay and fresh visit, restoring all three groups and seven voices. No sentence repeats within the same session, including perspective switches and pauses. Ignore legacy persistent played-line history so earlier visitors cannot silence later sessions. Preserve guide ducking and head-direction group focus.
- Static changes need only a browser refresh. Restart only the identified gallery server for backend changes.
- Participant join display: `/join.html`; QR files: `/join-qr.png` and `/join-qr.svg`. The QR opens the experience root URL. Regenerate with `web/scripts/generate-join-qr.py` and verify decoding when the address changes.
- Do not start a Cloudflare tunnel or deploy to Netlify unless explicitly requested.
- Follow the parent instructions for IP detection, certificates, process identification, verification, and physical support.
