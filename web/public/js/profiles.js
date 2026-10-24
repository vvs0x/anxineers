// Anxiety profiles and per-channel effect defaults. Everything here is tunable at runtime.
export const KINDS = ['Space', 'Vision', 'Audio', 'Light', 'Objects'];

export const PROFILES = {
  Education_Light:  { id: 'Education_Light',  label: 'Understand anxiety (light)', peak: 0.5, build: 90,  hold: 30, recovery: 45 },
  Education_Strong: { id: 'Education_Strong', label: 'Understand anxiety (strong)', peak: 0.9, build: 60,  hold: 20, recovery: 40 },
  Regulation_Gentle:{ id: 'Regulation_Gentle',label: 'Practise settling',          peak: 0.4, build: 120, hold: 15, recovery: 90 },
  Debug_Fast:       { id: 'Debug_Fast',       label: 'Debug (fast)',               peak: 0.9, build: 6,   hold: 4,  recovery: 6  },
};

// maxValue scales the channel. gazeWeight: how much looking at a target can fill the missing part.
// riseSpeed/fallSpeed: units per second the smoothed channel value may move.
export const EFFECT_DEFAULTS = {
  Space:   { maxValue: 1, gazeWeight: 0.4, exponent: 1.0, riseSpeed: 0.5, fallSpeed: 0.8 },
  Vision:  { maxValue: 1, gazeWeight: 0.5, exponent: 1.0, riseSpeed: 0.5, fallSpeed: 0.8 },
  Audio:   { maxValue: 1, gazeWeight: 0.5, exponent: 1.0, riseSpeed: 0.5, fallSpeed: 0.8 },
  Light:   { maxValue: 1, gazeWeight: 0.3, exponent: 1.0, riseSpeed: 0.5, fallSpeed: 0.8 },
  Objects: { maxValue: 1, gazeWeight: 0.8, exponent: 1.0, riseSpeed: 0.5, fallSpeed: 0.8 },
};

// Concrete strengths at full channel value (1.0). Tuned in the environment config as well.
export const EFFECT_STRENGTH = {
  vignetteMax: 0.55,       // 0..1 opacity of the dark edge at full value
  vignetteInner: 0.45,     // radius where the darkening starts (fraction of half screen)
  desaturateMax: 0.55,     // 0..1 colour removal
  coolShiftMax: 0.12,      // tint towards blue/grey
  flickerDepth: 0.22,      // max light dip, low frequency, never a strobe
  flickerHz: 1.6,          // slow
  ambientDim: 0.25,        // overall lights dimming at full value
  wallLeanFraction: 0.30,  // fraction of horizontal distance, capped by wallLeanMeters
  wallLeanMeters: 0.8,
  wallGazeExtraMeters: 0.4,
  ceilingDropMeters: 0.5,
  objDrift: 0.15, objPulse: 0.12, objApproach: 0.6,
  audioGain: 0.55,
};
