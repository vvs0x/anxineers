import { PROFILES, EFFECT_DEFAULTS, KINDS } from './profiles.js';

export const STATES = ['Calm', 'Build', 'Peak', 'Recovery'];
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Global anxiety intensity 0..1 with a small state machine, a hard cap and an override for guided exercises. */
export class AnxietyDirector {
  constructor(profile = PROFILES.Education_Light) {
    this.profile = { ...profile };
    this.settings = JSON.parse(JSON.stringify(EFFECT_DEFAULTS));
    this.cap = 0.5;
    this.intensity = 0;
    this.state = 'Calm';
    this.stateTime = 0;
    this.override = null;       // number | null, forces the target level (grounding, breathing)
    this.recoverySecondsOverride = null;
    this.smoothed = {};         // per kind smoothed channel value
    for (const k of KINDS) this.smoothed[k] = 0;
    this.listeners = new Set();
    this._recoveryFrom = 0;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }

  setProfile(p) { this.profile = { ...p }; this._emit(); }
  setCap(c) { this.cap = clamp01(c); this._emit(); }

  setState(s) {
    this.state = s; this.stateTime = 0;
    if (s === 'Recovery') this._recoveryFrom = this.intensity;
    this._emit();
  }
  startBuild() { this.setState('Build'); }
  /** Stop the build and fall to calm. seconds overrides the profile's recovery time. */
  calmNow(seconds = 4) {
    this.recoverySecondsOverride = seconds;
    this.override = null;
    this.setState('Recovery');
  }
  reset() { this.intensity = 0; this.override = null; this.recoverySecondsOverride = null; this.setState('Calm'); }
  setTargetOverride(v) { this.override = v == null ? null : clamp01(v); }

  get level() { return Math.min(this.intensity, this.cap); }
  get peakNormalized() { return this.profile.peak > 0 ? clamp01(this.level / this.profile.peak) : 0; }

  update(dt) {
    const p = this.profile;
    this.stateTime += dt;
    if (this.override != null) {
      // move towards the override at a gentle rate
      const d = this.override - this.intensity;
      const step = Math.sign(d) * Math.min(Math.abs(d), dt * 0.25);
      this.intensity += step;
    } else {
      switch (this.state) {
        case 'Calm': this.intensity = Math.max(0, this.intensity - dt * 0.3); break;
        case 'Build':
          this.intensity = Math.min(p.peak, this.intensity + (p.peak / Math.max(0.1, p.build)) * dt);
          if (this.intensity >= p.peak - 1e-4) this.setState('Peak');
          break;
        case 'Peak':
          this.intensity = p.peak;
          if (this.stateTime >= p.hold) this.setState('Recovery');
          break;
        case 'Recovery': {
          const dur = this.recoverySecondsOverride ?? p.recovery;
          const rate = Math.max(this._recoveryFrom, 0.05) / Math.max(0.1, dur);
          this.intensity = Math.max(0, this.intensity - rate * dt);
          if (this.intensity <= 0) { this.recoverySecondsOverride = null; this.setState('Calm'); }
          break;
        }
      }
    }
    // smooth channels with rise/fall limits so nothing jumps
    for (const k of KINDS) {
      const s = this.settings[k];
      const target = this.rawChannel(k, this._gaze?.[k] ?? 0);
      const cur = this.smoothed[k];
      const d = target - cur;
      const lim = (d > 0 ? s.riseSpeed : s.fallSpeed) * dt;
      this.smoothed[k] = cur + Math.sign(d) * Math.min(Math.abs(d), lim);
    }
  }

  /** gaze values per kind come from the gaze system each frame */
  setGaze(byKind) { this._gaze = byKind; }

  /**
   * Channel value 0..1 for a kind. Normalised by the profile peak so the peak equals the full effect everywhere.
   * Gaze fills a share of the missing part, it never subtracts.
   */
  rawChannel(kind, gaze) {
    const s = this.settings[kind];
    const base = this.peakNormalized;
    const capNorm = this.profile.peak > 0 ? clamp01(this.cap / this.profile.peak) : 0;
    const active = clamp01(this.level / 0.12);                 // no gaze effect while the room is calm
    const bonus = (1 - base) * clamp01(gaze) * s.gazeWeight * active;
    let v = clamp01(base + bonus);
    v = Math.min(v, Math.min(1, capNorm * 1.5));              // gaze may add a bit, never beyond 1.5x of the cap
    return Math.pow(v, s.exponent) * s.maxValue;
  }

  channel(kind) { return this.smoothed[kind]; }
}
