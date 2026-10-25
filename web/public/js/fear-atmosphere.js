import { fadeLoopEdges } from './voice-atmosphere.js';
const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export function fearMix(value, { active = true, hostile = true, firstPerson = false, settling = false } = {}) {
  const level = active && (hostile || settling) && firstPerson ? clamp01(value) : 0;
  return { level, synth: .42 * Math.sqrt(level), wind: .09 * Math.sqrt(level) };
}
const smooth = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const windowGain = (t, start, end) => smooth((t - start) / 3) * smooth((end - t) / 3);

/** Pairs overlap for several seconds; all three textures never play together. */
export function fearLayers(time, level = 1) {
  const t = ((time % 48) + 48) % 48;
  const parts = t % 24 < 8 ? ['cluster', 'sub'] : t % 24 < 16 ? ['sub', 'stabs'] : ['cluster'];
  return {
    synth: Math.max(windowGain(t, 0, 18), windowGain(t, 32, 48)),
    wind: windowGain(t, 8, 28), movement: windowGain(t, 22, 42),
    parts: parts.filter(part => part !== 'stabs' || level > .55),
  };
}

/** The user's Fear Viewer instruments, Wind, and Things moving on the room bus. */
export class FearAtmosphere {
  constructor(ctx, destination, { load = () => import('./vendor/fear-soundscape.js'), fetch: fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
    this.ctx = ctx; this.engine = null; this.loading = null; this.failed = false;
    this.wanted = false; this.level = 0; this.time = 0; this.load = load;
    this.synthBus = ctx.createGain(); this.synthBus.gain.value = 0; this.synthBus.connect(destination);
    this.sources = []; this.disposed = false;
    for (const name of ['wind', 'movement']) {
      this[name] = ctx.createGain(); this[name].gain.value = 0;
      this[`${name}Pan`] = ctx.createStereoPanner();
      this[name].connect(this[`${name}Pan`]).connect(destination);
    }
    this.recordingsReady = Promise.all(['wind', 'movement'].map(async name => {
      try {
        const response = await fetcher(`/audio/fear/${name}.mp3`);
        if (!response.ok) throw Error(`Missing ${name} recording`);
        const buffer = fadeLoopEdges(await ctx.decodeAudioData(await response.arrayBuffer()));
        if (this.disposed) return;
        const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
        source.connect(this[name]); source.start(); this.sources.push(source);
      } catch (error) { console.info('Fear recording unavailable:', error.message); }
    }));
  }
  ensureEngine() {
    if (this.engine || this.loading || this.failed || this.disposed) return;
    this.loading = this.load().then(({ createFearSoundscape }) => {
      if (this.disposed) return;
      this.engine = createFearSoundscape(this.ctx, this.synthBus);
      this.engine.setParts(this.layers?.parts || []);
      if (this.wanted) return this.engine.start();
    }).catch(error => { this.failed = true; console.info('Fear instruments unavailable; recordings remain active.', error.message); });
  }
  update(value, dt, options = {}) {
    if (this.disposed) return;
    const mix = fearMix(value, options), active = mix.level > 0;
    if (active && !options.settling) this.time += Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
    // Freeze the current combination during calming, then let its volume settle.
    if (!options.settling || !this.layers) this.layers = fearLayers(this.time, mix.level);
    this.level = mix.level;
    const t = this.ctx.currentTime, layers = this.layers;
    this.synthBus.gain.setTargetAtTime(mix.synth * layers.synth, t, active ? .8 : .3);
    this.wind.gain.setTargetAtTime(mix.wind * 2 * layers.wind, t, active ? .8 : .3);
    this.movement.gain.setTargetAtTime(.16 * Math.sqrt(mix.level) * layers.movement, t, active ? .8 : .3);
    this.windPan.pan.setTargetAtTime(.6 * Math.sin(this.time * .23), t, .6);
    this.movementPan.pan.setTargetAtTime(.5 * Math.sin(this.time * .17 + 2), t, .6);
    const parts = layers.synth > 0 ? layers.parts.filter(part => !options.settling || part !== 'stabs') : [];
    this.engine?.setParts(parts);
    if (active !== this.wanted) {
      this.wanted = active;
      if (active) {
        if (this.engine) this.engine.start().catch(error => console.info('Fear soundscape could not resume.', error.message));
        else this.ensureEngine();
      } else this.engine?.stop();
    }
  }
  dispose() {
    this.disposed = true; this.engine?.dispose();
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    for (const node of [this.synthBus, this.wind, this.movement, this.windPan, this.movementPan]) node.disconnect();
  }
}
