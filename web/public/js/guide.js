import { GUIDE_LINES } from './guide-script.js';
import { speechLoudnessGain } from './voice-atmosphere.js';

/** Centered, recorded Sarah narration, on a separate bus from the gallery. */
export class Guide {
  constructor(audio, lang = 'en') {
    this.audio = audio; this.lang = GUIDE_LINES[lang] ? lang : 'en';
    this.unlocked = false; this.enabled = true; this.generation = 0;
    this.buffers = new Map(); this.pending = new Map();
    this.ready = fetch('/audio/elevenlabs/manifest.json', { signal: AbortSignal.timeout(10000) })
      .then(r => r.ok ? r.json() : {}).then(m => m.guide || []).catch(() => []);
  }
  unlock() {
    this.unlocked = true; this.audio.start();
    // Prepare the short opening sequence together so screen changes do not wait
    // for the next recording's download. Playback still follows the session.
    if (this.enabled && this.audio.ctx) this.ready.then(clips => Promise.all(
      ['welcome', 'warning', 'reminder'].map(id => {
        const clip = clips.find(c => c.id === `${this.lang}-${id}` && c.text === GUIDE_LINES[this.lang][id]);
        return clip ? this.loadBuffer(clip.url).catch(() => null) : null;
      })
    )).catch(() => {});
  }
  async loadBuffer(url) {
    if (this.buffers.has(url)) return this.buffers.get(url);
    if (this.pending.has(url)) return this.pending.get(url);
    const pending = (async () => {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw Error('Guide audio unavailable');
      const buffer = await this.audio.ctx.decodeAudioData(await r.arrayBuffer());
      this.buffers.set(url, buffer); return buffer;
    })();
    this.pending.set(url, pending);
    try { return await pending; } finally { this.pending.delete(url); }
  }
  cancel() {
    this.generation++;
    this.finish?.(false);
    this.finish = null;
    try { this.source?.stop(); } catch { /* Already ended. */ }
    this.source = null;
    if (this.utterance) { globalThis.speechSynthesis?.cancel(); this.utterance = null; }
    this.audio.guideActive = false;
  }
  async speak(id) {
    this.cancel();
    if (!this.enabled || !this.unlocked) return false;
    const gen = this.generation, text = GUIDE_LINES[this.lang][id];
    if (!text) return false;
    this.audio.guideActive = true;
    try {
      const clips = await this.ready;
      const clip = clips.find(c => c.id === `${this.lang}-${id}` && c.text === text);
      const ctx = this.audio.ctx;
      if (clip && ctx) {
        const buffer = await this.loadBuffer(clip.url);
        if (gen !== this.generation) return false;
        await ctx.resume();
        if (gen !== this.generation) return false;
        return await new Promise(resolve => {
          const source = ctx.createBufferSource(), gain = ctx.createGain();
          gain.gain.value = Math.min(2.5, speechLoudnessGain(buffer) * 1.1);
          source.buffer = buffer; source.connect(gain).connect(ctx.destination);
          const timer = setTimeout(() => done(false), (buffer.duration + 3) * 1000);
          const done = value => { clearTimeout(timer); source.disconnect(); gain.disconnect(); if (this.finish === done) this.finish = null; resolve(value); };
          source.onended = () => done(true); this.finish = done; this.source = source; source.start();
        });
      }
      return await this.fallback(text, gen);
    } catch {
      return await this.fallback(text, gen);
    } finally {
      if (gen === this.generation) this.audio.guideActive = false;
    }
  }
  fallback(text, gen) {
    if (gen !== this.generation || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return false;
    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(text), synth = globalThis.speechSynthesis;
      const voices = synth.getVoices().filter(v => v.lang.startsWith(this.lang));
      utterance.voice = voices.find(v => /samantha|sarah|karen|moira|jenny|aria|anna|katja|female/i.test(v.name)) || voices[0] || null;
      utterance.lang = this.lang; utterance.rate = .76; utterance.volume = .9;
      const timer = setTimeout(() => { synth.cancel(); done(false); }, Math.max(12000, text.length * 120));
      const done = value => { clearTimeout(timer); if (this.finish === done) this.finish = null; resolve(value); };
      utterance.onend = () => done(true); utterance.onerror = () => done(false);
      this.finish = done; this.utterance = utterance; synth.speak(utterance);
    });
  }
}
