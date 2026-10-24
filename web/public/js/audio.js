/** Procedural sound, no audio files. Layers fade in with the Audio channel value 0..1. */
export class ProceduralAudio {
  constructor() { this.ctx = null; this.level = 0; this.master = null; this._hb = 0; this.gain = 0.55; }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);

    // rumble: brown noise through a low pass
    const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110;
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0;
    noise.connect(lp).connect(this.rumble).connect(this.master); noise.start();

    // tone: two close sines, slow beating
    this.tone = ctx.createGain(); this.tone.gain.value = 0;
    for (const f of [58, 59.7]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(this.tone); o.start(); }
    this.tone.connect(this.master);

    // drone: filtered saw with slow LFO on the cutoff
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 82;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 220; lp2.Q.value = 2;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; const lg = ctx.createGain(); lg.gain.value = 70;
    lfo.connect(lg).connect(lp2.frequency); lfo.start();
    this.drone = ctx.createGain(); this.drone.gain.value = 0;
    saw.connect(lp2).connect(this.drone).connect(this.master); saw.start();

    this.hb = ctx.createGain(); this.hb.gain.value = 0; this.hb.connect(this.master);
    this.nextBeat = ctx.currentTime + 1;
  }

  _thump(t, vol, f0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.16);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.hb); o.start(t); o.stop(t + 0.25);
  }

  /** soft two note chime for feedback, e.g. "I heard you" */
  chime() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); const s = t + i * 0.16;
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.08, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, s + 1.1);
      o.connect(g).connect(ctx.destination); o.start(s); o.stop(s + 1.2);
    });
  }

  update(value, dt) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, v = Math.min(1, Math.max(0, value));
    const set = (g, x) => g.gain.setTargetAtTime(x, t, 0.4);
    set(this.master, this.gain);
    set(this.rumble, v * 0.9);
    set(this.tone, Math.max(0, v - 0.2) * 0.06);
    set(this.drone, Math.max(0, v - 0.1) * 0.05);
    set(this.hb, Math.max(0, v - 0.05) * 1.0);
    // heartbeat tempo 58 -> 96 bpm
    const bpm = 58 + 38 * v;
    while (this.nextBeat < t + 0.1) {
      if (v > 0.05) { this._thump(this.nextBeat, 0.5, 70); this._thump(this.nextBeat + 0.24, 0.32, 60); }
      this.nextBeat += 60 / bpm;
    }
  }
}
