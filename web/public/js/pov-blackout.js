import { settlingGain } from './settling.js';

/** Two slow darkness waves per run, measured only while settled in first-person POV. */
export class PovBlackout {
  constructor() {
    this.afterSeconds = 30;
    this.durationSeconds = 8; // four seconds down, four seconds up
    this.count = 2;
    this.runId = null;
    this.elapsed = 0;
    this.amount = 0;
    this.finished = false;
  }

  update(dt, { active = false, runId = 0, settling = false } = {}) {
    if (settling) {
      if (!this.settling) { this.settling = { from: this.amount, elapsed: 0 }; }
      else this.settling.elapsed += Math.max(0, dt);
      this.runId = runId; this.finished = true;
      this.amount = this.settling.from * settlingGain(this.settling.elapsed, 6);
      return this.amount;
    }
    this.settling = null;
    if (runId !== this.runId) {
      this.runId = runId;
      this.elapsed = 0;
      this.amount = 0;
      this.finished = false;
    }
    if (!active) {
      // Floating or a view transition immediately restores vision; calming uses the fade above.
      // An interrupted blackout is consumed, rather than resuming on return.
      if (this.amount > 0) this.finished = true;
      this.amount = 0;
      return 0;
    }
    this.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
    const end = this.afterSeconds + this.durationSeconds * this.count;
    if (this.elapsed + 1e-9 >= end) this.finished = true;
    const local = this.elapsed - this.afterSeconds;
    this.amount = !this.finished && this.durationSeconds > 0 && local > 0
      ? .5 - .5 * Math.cos(2 * Math.PI * (local % this.durationSeconds) / this.durationSeconds) : 0;
    return this.amount;
  }
}
