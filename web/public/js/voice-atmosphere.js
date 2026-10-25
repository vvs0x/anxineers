import { settlingGain } from './settling.js';

/** Cached ElevenLabs audio. No keys or paid generation requests in the browser. */
export function audioMix(level, { active = true, hostile = true, firstPerson = false, calmSpeech = true, proximity = 1, preview = 0 } = {}) {
  const v = firstPerson ? Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0)) : 0;
  const dialogue = active && hostile && firstPerson && v > 0 && proximity > 0;
  return {
    calm: active ? .24 * (1 - v) : 0,
    tense: active && hostile && firstPerson ? .28 * Math.sqrt(v) : active ? .28*Math.min(.3,Math.max(0,preview)) : 0,
    dialogue,
    calmDialogue: active && calmSpeech && !dialogue && v < .25,
    interval: .8 - .5 * v,
    voices: dialogue ? (v >= .65 ? 3 : 2) : 0,
    dialogueGain: dialogue ? .65 * Math.sqrt(v) * Math.max(0, Math.min(1, proximity)) ** 2 : 0,
  };
}

/** Listener-relative stereo and smooth distance falloff for real gallery groups. */
export function conversationMix(position, listener = {}) {
  const origin=listener.position||{x:0,y:1.6,z:0},forward=listener.forward||{x:0,y:0,z:-1};
  const dx=position.x-origin.x,dz=position.z-origin.z,distance=Math.hypot(dx,dz);
  const pan=distance>.01?Math.max(-.9,Math.min(.9,(-forward.z*dx+forward.x*dz)/distance)) : 0;
  return {pan,gain:.28/(1+(Math.max(0,distance-1)/3)**2)};
}

/** Visible groups get full attention. The cone is a fallback for callers without a camera. */
export function groupAttention(group, listener = {}) {
  const origin = listener.position || { x: 0, y: 1.6, z: 0 };
  const forward = listener.forward || { x: 0, y: 0, z: -1 };
  const dx = group.position.x - origin.x, dz = group.position.z - origin.z;
  const dy = (group.position.y || 0) + 1.25 - (origin.y ?? 1.6);
  const distance = Math.hypot(dx, dz), length = Math.hypot(dx, dy, dz);
  const radius = Math.max(.65, group.radius || 0);
  const dot = (dx * forward.x + dy * (forward.y || 0) + dz * forward.z)
    / Math.max(.001, length * Math.hypot(forward.x, forward.y || 0, forward.z));
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const edgeAngle = Math.max(0, angle - Math.atan2(radius, Math.max(.1, length)));
  const raw = Math.max(0, Math.min(1, (40 - edgeAngle * 180 / Math.PI) / 28));
  const focus = typeof group.inView === 'boolean' ? Number(group.inView) : raw * raw * (3 - 2 * raw);
  const proximity = Math.max(0, Math.min(1, 1 - Math.max(0, distance - radius - 1.3) / 4));
  return { focus, proximity, distance, angle };
}

/** Choose one visible group, preferring the centre of the view with a small
 * dead band so tiny head movements do not flicker between adjacent groups. */
export function focusedConversationGroup(groups, listener, previous = null) {
  const candidates = groups.map(group => ({ id: group.id, ...groupAttention(group, listener) }))
    .filter(group => group.focus > 0).sort((a, b) => a.angle - b.angle);
  const best = candidates[0], current = candidates.find(group => group.id === previous);
  if (!best) return null;
  return current && current.angle <= best.angle + Math.PI / 30 ? current.id : best.id;
}

export function imaginedConversationMix(group, listener, level, focused) {
  const spatial = conversationMix(group.position, listener);
  const attention = groupAttention(group, listener);
  const focus = focused === undefined ? attention.focus : Number(focused);
  // Every group remains audible even across the room. Focus is the dominant
  // difference; distance must never silence or stop a background conversation.
  return { ...spatial, ...attention, focus, cutoff: 850 + 7150 * focus,
    gain: .65 * Math.sqrt(Math.max(0, Math.min(1, level)))
      * (.55 + .45 * attention.proximity) * (.1 + .9 * focus) / Math.sqrt(3) };
}

function browserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
const HISTORY_KEY = 'gallery-spoken-lines-v1';
const lineKey = clip => (clip.text || clip.url).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Authored line history only; no gaze, microphone, or visitor information. */
export class SpokenLines {
  constructor(storage = browserStorage()) { this.storage = storage; this.used = new Set(); this.refresh(); }
  refresh() {
    try {
      const raw = this.storage?.getItem(HISTORY_KEY) || '[]';
      if (raw !== this.snapshot) { for (const key of JSON.parse(raw)) this.used.add(key); this.snapshot = raw; }
    } catch { /* Memory still prevents repeats during this visit. */ }
  }
  has(clip) { return this.used.has(lineKey(clip)); }
  mark(clip) {
    this.refresh(); this.used.add(lineKey(clip));
    try { this.storage?.setItem(HISTORY_KEY, JSON.stringify([...this.used])); } catch { /* Storage can be unavailable in private browsing. */ }
  }
}

// Measure once after decode, across all channels. Balance the recorded voices
// near -20 dBFS RMS while retaining headroom for a clip's loudest syllable.
export function speechLoudnessGain(buffer) {
  if (!Number.isInteger(buffer?.numberOfChannels) || buffer.numberOfChannels < 1
    || typeof buffer.getChannelData !== 'function') return 1;
  let sumSquares = 0, count = 0, peak = 0;
  try {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        if (!Number.isFinite(sample)) return 1;
        sumSquares += sample * sample; count++;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
  } catch { return 1; }
  if (!count || peak < 1e-8 || !Number.isFinite(sumSquares)) return 1;
  const rms = Math.sqrt(sumSquares / count);
  return Math.min(Math.max(.5, Math.min(3, .1 / rms)), .85 / peak);
}

// Keep the loop's duration intact, but bring both sides of its boundary to zero
// over 20 ms. The original file and all speech buffers remain untouched.
export function fadeLoopEdges(buffer) {
  if (!Number.isFinite(buffer?.sampleRate) || buffer.sampleRate <= 0
    || !Number.isInteger(buffer.numberOfChannels) || typeof buffer.getChannelData !== 'function') return buffer;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    const frames = Math.min(Math.round(buffer.sampleRate * .02), Math.floor(samples.length / 2));
    for (let i = 0; i < frames; i++) {
      const gain = frames === 1 ? 0 : .5 - .5 * Math.cos(Math.PI * i / (frames - 1));
      samples[i] *= gain; samples[samples.length - 1 - i] *= gain;
    }
  }
  return buffer;
}

const clipList = (value) => Array.isArray(value) ? value.filter(c => c && typeof c.url === 'string') : [];

export class VoiceAtmosphere {
  constructor(ctx, destination, { random = Math.random, fetch: fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
    this.history = new SpokenLines(null);
    // Both kinds start fresh for each participant; no persistent exclusion list.
    this.calmHistory = new SpokenLines(null);
    this.ctx = ctx; this.destination = destination; this.random = random; this.fetch = fetcher;
    this.buffers = new Map(); this.failed = new Set(); this.pending = new Map();
    this.speechUrls = new Set(); this.loudnessGains = new Map();
    this.playing = new Set(); this.loops = []; this.bags = { calm: [], anxiety: [] };
    this.lastPlayed = { calm: null, anxiety: null }; this.speakerPositions = new Map();
    this.conversations = new Map(); this.conversationPool = new Map();
    this.consumedConversations = new Set();
    this.next = 0; this.kind = null; this.manifest = null; this.disposed = false;
    this.ready = this.load().catch(e => console.info('ElevenLabs audio unavailable; using procedural sound.', e.message));
  }

  resetSession() {
    this.stopVoices();
    this.history = new SpokenLines(null); this.calmHistory = new SpokenLines(null);
    this.conversations.clear(); this.consumedConversations.clear();
    this.bags = { calm: [], anxiety: [] }; this.lastPlayed = { calm: null, anxiety: null };
    this.kind = null; this.focusedGroup = null; this.recovery = null; this.lookingAtPerson = false;
    this.next = this.ctx.currentTime;
  }

  async load() {
    const response = await this.fetch('/audio/elevenlabs/manifest.json');
    if (!response.ok || this.disposed) return;
    const data = await response.json();
    const speech = (kind) => clipList(data[kind]).map((c, i) => ({ ...c, speaker: String(c.speaker ?? c.voiceId ?? i % 3) }));
    // Publish the complete playlist before decoding. Playback can begin with the
    // first available clips without cycling a small, partially loaded subset.
    this.manifest = { calm: speech('calm'), anxiety: speech('anxiety'), atmosphere: clipList(data.atmosphere) };
    for (const kind of ['calm', 'anxiety']) for (const clip of this.manifest[kind]) {
      if (!clip.conversation) continue;
      const key = `${kind}:${clip.conversation}`;
      let conversation = this.conversationPool.get(key);
      if (!conversation) {
        conversation = { id: key, kind, group: clip.group, clips: [] };
        this.conversationPool.set(key, conversation);
      }
      conversation.clips.push(clip);
    }
    for (const conversation of this.conversationPool.values()) {
      // Older manifests lack turn numbers; their authored array order remains valid.
      conversation.clips.sort((a, b) => (a.turn ?? this.manifest[conversation.kind].indexOf(a)) - (b.turn ?? this.manifest[conversation.kind].indexOf(b)));
    }
    this.speechUrls = new Set([...this.manifest.anxiety, ...this.manifest.calm].map(clip => clip.url));
    for (const clip of [...this.manifest.anxiety, ...this.manifest.calm]) {
      if (!this.speakerPositions.has(clip.speaker)) {
        const positions = [-.32, .30, .04];
        this.speakerPositions.set(clip.speaker, positions[this.speakerPositions.size % positions.length]);
      }
    }
    const clips = [...this.manifest.atmosphere, ...this.manifest.calm, ...this.manifest.anxiety];
    let next = 0;
    // Three workers bound network and decode pressure on a mobile headset.
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < clips.length && !this.disposed) {
        const clip = clips[next++];
        const buffer = await this._loadBuffer(clip.url);
        if (buffer && this.manifest.atmosphere.includes(clip)) this._startLoop(clip, buffer);
      }
    }));
  }

  async _loadBuffer(url) {
    if (this.buffers.has(url)) return this.buffers.get(url);
    if (this.pending.has(url)) return this.pending.get(url);
    const pending = (async () => {
      try {
        const response = await this.fetch(url);
        if (!response.ok) throw new Error('Audio clip unavailable');
        const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
        if (this.disposed) return null;
        if (this.speechUrls.has(url)) this.loudnessGains.set(url, speechLoudnessGain(buffer));
        this.buffers.set(url, buffer); return buffer;
      } catch {
        this.failed.add(url); return null;
      } finally { this.pending.delete(url); }
    })();
    this.pending.set(url, pending);
    return pending;
  }

  _startLoop(clip, buffer) {
    if (this.disposed || this.loops.some(loop => loop.url === clip.url)) return;
    fadeLoopEdges(buffer);
    const source = this.ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
    const gain = this.ctx.createGain(); gain.gain.value = 0;
    source.connect(gain).connect(this.destination); source.start();
    this.loops.push({ id: clip.id, url: clip.url, gain, source, target: 0 });
  }

  _shuffle(clips) {
    const bag = [...clips];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  _eligible(clip, kind, playing = false) {
    if (!playing && this._history(kind).has(clip)) return false;
    if (kind !== 'anxiety') return true;
    const text = clip.text || '';
    if (/phone|smile|coming this way|what he said|say that|doing it again/i.test(text)) return false;
    return !/looked at us|looking over here|looking at us|looking again/i.test(text) || this.lookingAtPerson === true;
  }

  _history(kind) { return kind === 'calm' ? this.calmHistory : this.history; }

  _nextClip(kind) {
    let bag = this.bags[kind].filter(c => !this.failed.has(c.url));
    if (!bag.some(c => this._eligible(c, kind))) bag = [];
    if (!bag.length) {
      const clips = this.manifest[kind].filter(c => !this.failed.has(c.url));
      bag = kind === 'calm' ? [...clips] : this._shuffle(clips);
    }
    this.bags[kind] = bag;
    const occupied = [...this.playing].filter(e => e.kind === kind);
    const index = bag.findIndex(c => this._eligible(c, kind) && this.buffers.has(c.url) && c.url !== this.lastPlayed[kind]
      && !occupied.some(e => e.speaker === c.speaker || e.url === c.url));
    if (index < 0) return null;
    // Undecoded clips stay in this bag. Do not repeat the first downloaded line
    // while the rest of the 52-line crowd is still arriving.
    const [clip] = bag.splice(index, 1); this.lastPlayed[kind] = clip.url;
    return clip;
  }

  _stopEntry(entry) {
    const t = this.ctx.currentTime;
    entry.gain.gain.cancelScheduledValues(t);
    entry.gain.gain.setTargetAtTime(0, t, .035);
    try { entry.source.stop(t + .16); } catch { /* Already ended naturally. */ }
    this.playing.delete(entry);
  }

  stopVoices(kind) {
    for (const entry of [...this.playing]) if (!kind || entry.kind === kind) this._stopEntry(entry);
  }

  _play(clip, kind, mix, t, group = null) {
    const source = this.ctx.createBufferSource(); source.buffer = this.buffers.get(clip.url);
    const pan = this.ctx.createStereoPanner();
    // Group conversations follow their world position; legacy ungrouped clips
    // keep a restrained listener-relative pan.
    pan.pan.value = group ? group.pan : (this.speakerPositions.get(clip.speaker) || 0) + (this.random() - .5) * .06;
    const gain = this.ctx.createGain(); gain.gain.value = 0;
    const target = group ? group.gain * (this.loudnessGains.get(clip.url) ?? 1) : kind === 'anxiety'
      ? mix.dialogueGain * (this.loudnessGains.get(clip.url) ?? 1) / Math.sqrt(mix.voices) : (group?.gain ?? .19) * (this.loudnessGains.get(clip.url) ?? 1);
    gain.gain.setTargetAtTime(target, t, .045);
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass';
    filter.Q.value = .5; filter.frequency.value = group?.cutoff ?? 8000;
    source.connect(filter).connect(pan).connect(gain).connect(this.destination);
    const entry = { kind, speaker: clip.speaker, url: clip.url, clip, source, gain, pan, filter, target, group: group?.id, turn: group?.turn, conversation: group?.conversation };
    this.playing.add(entry);
    source.onended = () => { this.playing.delete(entry); source.disconnect(); filter.disconnect(); pan.disconnect(); gain.disconnect(); };
    source.start(); this._history(kind).mark(clip);
    // Short lines still overlap: schedule a different speaker before this clip
    // ends, while respecting the two/three-voice ceiling and distinct speakers.
    this.next = t + (kind === 'anxiety'
      ? Math.min(mix.interval, Math.max(.12, source.buffer.duration * (mix.voices === 3 ? .28 : .45)))
      : source.buffer.duration + .15 + this.random() * .2);
    return entry;
  }

  _nextConversation(kind, group) {
    const available = conversation => conversation.kind === kind
      && (!conversation.group || conversation.group === group)
      && !this.consumedConversations.has(conversation.id)
      && conversation.clips.some(clip => !this._history(kind).has(clip))
      && !conversation.clips.some(clip => this.failed.has(clip.url));
    const occupied = new Set([...this.conversations.values()].map(state => state.conversation?.id));
    return [...this.conversationPool.values()].find(conversation => available(conversation)
      && !occupied.has(conversation.id) && conversation.clips.every(clip => this.buffers.has(clip.url))) || null;
  }

  _updateConversations(t, options, kind, level) {
    if (![...this.conversationPool.values()].some(conversation => conversation.kind === kind)) return false;
    const groups = options.conversationGroups || [];
    const liveGroups = new Set(groups.map(group => group.id));
    this.focusedGroup = focusedConversationGroup(groups, options.listener, this.focusedGroup);
    for (const entry of [...this.playing]) {
      if (entry.kind === kind && !liveGroups.has(entry.group)) this._stopEntry(entry);
    }
    for (const group of groups) {
      const key = `${kind}:${group.id}`;
      let state = this.conversations.get(key);
      if (!state) {
        state = { conversation: null, turn: 0, next: t };
        this.conversations.set(key, state);
      }
      const spatial = imaginedConversationMix(group, options.listener, kind === 'anxiety' ? level : 1, group.id === this.focusedGroup);
      if (kind === 'calm') spatial.gain *= .28 * Math.sqrt(3) / .65;
      const entries = [...this.playing].filter(entry => entry.kind === kind && entry.group === group.id);
      for (const entry of entries) {
        const gain = spatial.gain * (this.loudnessGains.get(entry.url) ?? 1);
        entry.gain.gain.setTargetAtTime(gain, t, .22); entry.target = gain;
        entry.pan.pan.setTargetAtTime(spatial.pan, t, .18);
        entry.filter.frequency.setTargetAtTime(spatial.cutoff, t, .22);
      }
      if (state.conversation) {
        while (state.turn < state.conversation.clips.length && this._history(kind).has(state.conversation.clips[state.turn])) state.turn++;
        if (state.turn >= state.conversation.clips.length) {
          if (entries.length) continue;
          state.conversation = null; state.next = t + .12 + this.random() * .12;
        }
      }
      // All groups continue their exchanges; looking only changes the mix.
      if (t < state.next || entries.length >= 2) continue;
      if (!state.conversation) {
        state.conversation = this._nextConversation(kind, group.id); state.turn = 0;
        if (state.conversation) this.consumedConversations.add(state.conversation.id);
      }
      if (!state.conversation) continue;
      const conversation = state.conversation;
      while (state.turn < conversation.clips.length && this._history(kind).has(conversation.clips[state.turn])) state.turn++;
      const clip = conversation.clips[state.turn];
      if (!clip || !this._eligible(clip, kind) || entries.some(entry => entry.speaker === clip.speaker)) continue;
      const entry = this._play(clip, kind, {}, t, { id: group.id, conversation: conversation.id, turn: state.turn, ...spatial });
      state.turn++;
      state.next = t + Math.max(.3, entry.source.buffer.duration - .18 + this.random() * .08);
    }
    return true;
  }

  settle(t, seconds) {
    if (!this.recovery) this.recovery = { start: t,
      voices: new Map([...this.playing].map(entry => [entry, entry.target])),
      loops: new Map(this.loops.map(loop => [loop, loop.target])) };
    const fade = settlingGain(t - this.recovery.start, seconds);
    // Let the current sentences finish, with no new judgments during guidance.
    for (const entry of this.playing) {
      const target = (this.recovery.voices.get(entry) || 0) * fade;
      entry.gain.gain.setTargetAtTime(target, t, .3); entry.target = target;
    }
    for (const loop of this.loops) {
      const from = this.recovery.loops.get(loop) || 0;
      loop.target = loop.id === 'calm' ? from + (.24 - from) * (1 - fade) : from * fade;
      loop.gain.gain.setTargetAtTime(loop.target, t, .4);
    }
  }

  update(level, options = {}) {
    if (this.disposed) return;
    if (options.settling && options.active && options.firstPerson) { this.settle(this.ctx.currentTime, options.settlingSeconds); return; }
    this.recovery = null;
    this.history.refresh();
    this.lookingAtPerson = options.lookingAtPerson === true;
    for (const entry of [...this.playing]) if (!this._eligible(entry.clip || {}, entry.kind, true)) this._stopEntry(entry);
    const mix = audioMix(level, options.conversationGroups?.length ? { ...options, proximity: 1 } : options), t = this.ctx.currentTime;
    for (const loop of this.loops) {
      const target = mix[loop.id] || 0;
      if (Math.abs(target - loop.target) > .0001) {
        loop.gain.gain.setTargetAtTime(target, t, target === 0 ? .045 : .3); loop.target = target;
      }
    }
    const kind = mix.dialogue ? 'anxiety' : mix.calmDialogue ? 'calm' : null;
    if (kind !== this.kind) {
      this.stopVoices(); this.kind = kind; this.next = t;
    }
    if (!mix.dialogue) this.stopVoices('anxiety');
    if (!kind) { this.stopVoices(); return; }
    if (!this.manifest || this.ctx.state !== 'running') return;
    if(this._updateConversations(t,options,kind,level))return;
    const maxVoices = kind === 'anxiety' ? mix.voices : 1;
    const entries = [...this.playing].filter(e => e.kind === kind);
    for (const entry of entries.slice(maxVoices)) this._stopEntry(entry);
    for (const entry of this.playing) if (entry.kind === 'anxiety') {
      const target = mix.dialogueGain * (this.loudnessGains.get(entry.url) ?? 1) / Math.sqrt(maxVoices);
      if (Math.abs(target - entry.target) > .001) { entry.gain.gain.setTargetAtTime(target, t, .15); entry.target = target; }
    }
    if (t < this.next || this.playing.size >= maxVoices) return;
    const clip = this._nextClip(kind);
    if (clip) this._play(clip, kind, mix, t);
  }

  dispose() {
    this.disposed = true; this.stopVoices();
    for (const loop of this.loops) {
      try { loop.source.stop(); } catch { /* Already stopped. */ }
      loop.source.disconnect(); loop.gain.disconnect();
    }
    this.loops = []; this.buffers.clear(); this.loudnessGains.clear(); this.speechUrls.clear();
  }
}
