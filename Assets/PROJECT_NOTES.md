
## Phase 4c: session flow
- SessionController: Consent, Intro, Cap select (thumbstick or arrows, trigger or Enter to confirm), Running, Ending. Key S starts it.
- Running: Build, Peak, then Recovery starts the grounding (5-4-3-2-1) and breathing at the end. Hard max length `maxSessionSeconds` (default 1200 s) triggers calm now.
- CalmNowInput: A or X on either controller calls CalmNow; grounding stops and short breathing starts without steering the director. Session then ends.
- Note: if a profile has PeakHoldSeconds = 0 the Peak never ends by itself, so grounding only starts via max length or calm now.
- All consent/intro/cap/end texts are placeholders and need clinical review.
