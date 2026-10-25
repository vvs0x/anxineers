import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { audioMix, conversationMix, groupAttention, focusedConversationGroup, imaginedConversationMix, SpokenLines, speechLoudnessGain, fadeLoopEdges, VoiceAtmosphere } from '../public/js/voice-atmosphere.js';
import { ProceduralAudio } from '../public/js/audio.js';
import { fearMix, fearLayers, FearAtmosphere } from '../public/js/fear-atmosphere.js';

const sampleBuffer = (channels) => ({ numberOfChannels: channels.length, getChannelData: channel => channels[channel] });
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} should be near ${expected}`);

test('resuming a hidden tab schedules one heartbeat instead of replaying missed minutes', () => {
  const audio = new ProceduralAudio();
  audio.ctx = { currentTime: 600 };
  for (const name of ['master', 'rumble', 'tone', 'drone', 'hb']) {
    audio[name] = { gain: { setTargetAtTime() {} } };
  }
  audio.voices = { update() {} };
  audio.nextBeat = 1;
  const beats = [];
  audio._thump = time => beats.push(time);
  audio.update(1, .016, { active: true });
  assert.deepEqual(beats, [600, 600.24]);
  audio.update(1, .016, { active: true });
  assert.equal(beats.length, 2);
});

class FakeParam {
  constructor() { this.value = 0; this.events = []; }
  setTargetAtTime(value, time, constant) { this.value = value; this.events.push({ value, time, constant }); }
  cancelScheduledValues() {}
}
class FakeNode {
  constructor() { this.gain = new FakeParam(); this.pan = new FakeParam(); }
  connect(node) { return node; }
  disconnect() { this.disconnected = true; }
}
class FakeContext {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sources = []; this.decodeCount = new Map(); }
  createGain() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createBiquadFilter() { const node = new FakeNode(); node.frequency = new FakeParam(); node.Q = new FakeParam(); return node; }
  createBufferSource() {
    const source = new FakeNode();
    source.start = () => { source.startTime = this.currentTime; this.sources.push(source); };
    source.stop = (at = this.currentTime) => { source.stopTime = at; };
    return source;
  }
  async decodeAudioData(data) {
    this.decodeCount.set(data.url, (this.decodeCount.get(data.url) || 0) + 1);
    return { duration: data.duration || 2, url: data.url, sampleRate: data.sampleRate, ...(data.channels ? sampleBuffer(data.channels) : {}) };
  }
  advance(seconds) {
    this.currentTime += seconds;
    for (const source of this.sources) {
      if (!source.ended && (this.currentTime >= source.stopTime || (!source.loop && this.currentTime >= source.startTime + source.buffer.duration))) {
        source.ended = true; source.onended?.();
      }
    }
  }
  get speech() { return this.sources.filter(source => !source.loop); }
}
const flags = { active: true, hostile: true, firstPerson: true };
const makeManifest = (count = 12) => ({
  calm: [],
  anxiety: Array.from({ length: count }, (_, i) => ({ id: `line-${i}`, url: `/audio/line-${i}.mp3`, speaker: ['Roger', 'Laura', 'Callum'][i % 3] })),
  atmosphere: [{ id: 'tense', url: '/audio/tense.mp3' }],
});
const audioResponse = (url) => ({ ok: true, arrayBuffer: async () => ({ url }) });
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function fixture(manifest = makeManifest()) {
  const ctx = new FakeContext();
  const fetch = async (url) => url.endsWith('manifest.json') ? { ok: true, json: async () => manifest } : audioResponse(url);
  const layer = new VoiceAtmosphere(ctx, new FakeNode(), { fetch, random: () => .5 });
  await layer.ready;
  return { ctx, layer };
}

test('first-person anxiety begins at low intensity and rises from two to three voices', () => {
  assert.equal(audioMix(0, flags).dialogue, false);
  assert.equal(audioMix(1).dialogue, false, 'first-person presence must be explicit');
  assert.equal(audioMix(.02, flags).dialogue, true);
  assert.equal(audioMix(.02, flags).voices, 2);
  assert.equal(audioMix(.64, flags).voices, 2);
  assert.equal(audioMix(1, flags).voices, 3);
  assert.equal(audioMix(1, flags).dialogueGain, .65);
  assert.equal(audioMix(1, flags).tense, .28);
  assert.ok(audioMix(.02, flags).dialogueGain < audioMix(1, flags).dialogueGain);
  assert.ok(audioMix(.02, flags).interval > audioMix(1, flags).interval);
  for (const blocked of [{ hostile: false }, { firstPerson: false }, { active: false }]) {
    const mix = audioMix(1, { ...flags, ...blocked });
    assert.equal(mix.dialogue, false); assert.equal(mix.tense, 0); assert.equal(mix.voices, 0);
  }
  assert.equal(audioMix(NaN, flags).dialogue, false);
});

test('speech loudness balances quiet voices, measures all channels, and respects gain and peak limits', () => {
  closeTo(speechLoudnessGain(sampleBuffer([[.04, -.04]])), 2.5);
  closeTo(speechLoudnessGain(sampleBuffer([[.03, -.03], [.04, -.04]])), .1 / Math.sqrt((.03 ** 2 + .04 ** 2) / 2));
  assert.equal(speechLoudnessGain(sampleBuffer([[.001, -.001]])), 3);
  assert.equal(speechLoudnessGain(sampleBuffer([[.8, -.8]])), .5);
  const transient = new Float32Array(400); transient[0] = 1;
  assert.equal(speechLoudnessGain(sampleBuffer([transient])), .85, 'a brief peak limits otherwise large RMS gain');
  for (const buffer of [undefined, sampleBuffer([]), sampleBuffer([[]]), sampleBuffer([[0, 0]]), sampleBuffer([[NaN]]), sampleBuffer([[Infinity]])]) {
    assert.equal(speechLoudnessGain(buffer), 1, 'silent or degenerate data is unchanged');
  }
});

test('speech-only normalization is cached and preserved when intensity updates existing voices', async () => {
  const manifest = makeManifest(6), ctx = new FakeContext(), sampleReads = new Map();
  const originalDecode = ctx.decodeAudioData.bind(ctx);
  ctx.decodeAudioData = async (data) => {
    const buffer = await originalDecode(data), getSamples = buffer.getChannelData;
    buffer.getChannelData = (channel) => {
      sampleReads.set(data.url, (sampleReads.get(data.url) || 0) + 1);
      return getSamples(channel);
    };
    return buffer;
  };
  const fetch = async (url) => url.endsWith('manifest.json')
    ? { ok: true, json: async () => manifest }
    : { ok: true, arrayBuffer: async () => ({ url, channels: [[.04, -.04]] }) };
  const layer = new VoiceAtmosphere(ctx, new FakeNode(), { fetch, random: () => .5 });
  await layer.ready;
  assert.equal(layer.loudnessGains.size, manifest.anxiety.length);
  for (const clip of manifest.anxiety) {
    closeTo(layer.loudnessGains.get(clip.url), 2.5);
    assert.equal(sampleReads.get(clip.url), 1, 'sample data is scanned once after decoding');
  }
  assert.equal(sampleReads.has(manifest.atmosphere[0].url), false, 'noise is not analyzed or normalized');
  layer.update(.25, flags);
  const entry = [...layer.playing][0];
  closeTo(entry.target, .65 * Math.sqrt(.25) * 2.5 / Math.sqrt(2));
  layer.update(.81, flags);
  closeTo(entry.target, .65 * Math.sqrt(.81) * 2.5 / Math.sqrt(3));
  closeTo(layer.loops[0].target, .28 * Math.sqrt(.81));
  await layer._loadBuffer(entry.url);
  assert.equal(sampleReads.get(entry.url), 1, 'cached playback never scans the clip again');
  assert.equal(ctx.decodeCount.get(entry.url), 1);
  layer.dispose();
});

test('loop boundary smoothing preserves duration and its interior on every channel', () => {
  const channels = [new Float32Array(2000).fill(.04), new Float32Array(2000).fill(-.03)];
  const buffer = { ...sampleBuffer(channels), sampleRate: 1000, duration: 2 };
  assert.equal(fadeLoopEdges(buffer), buffer);
  assert.equal(buffer.duration, 2);
  for (const [index, channel] of channels.entries()) {
    assert.equal(channel.length, 2000);
    assert.equal(Math.abs(channel[0]), 0);
    assert.equal(Math.abs(channel.at(-1)), 0);
    assert.ok(Math.abs(channel[10]) < Math.abs(channel[20]));
    closeTo(channel[19], index === 0 ? .04 : -.03);
    closeTo(channel[1000], index === 0 ? .04 : -.03);
  }
});

test('only looping SFX receive the boundary fade, once per decoded loop', async () => {
  const manifest = makeManifest(3), ctx = new FakeContext();
  const fetch = async (url) => url.endsWith('manifest.json')
    ? { ok: true, json: async () => manifest }
    : { ok: true, arrayBuffer: async () => ({ url, sampleRate: 1000, channels: [new Float32Array(2000).fill(.04)] }) };
  const layer = new VoiceAtmosphere(ctx, new FakeNode(), { fetch, random: () => .5 });
  await layer.ready;
  const loop = layer.loops[0], samples = loop.source.buffer.getChannelData(0), edge = samples[10];
  assert.equal(samples[0], 0);
  assert.equal(samples.at(-1), 0);
  layer._startLoop(manifest.atmosphere[0], loop.source.buffer);
  assert.equal(samples[10], edge, 'starting an existing loop cannot fade it again');
  assert.equal(layer.loops.length, 1);
  for (const clip of manifest.anxiety) {
    const speech = layer.buffers.get(clip.url).getChannelData(0);
    closeTo(speech[0], .04); closeTo(speech.at(-1), .04);
  }
  layer.dispose();
});

test('voices overlap with distinct speakers, subtle stereo, and a bounded count', async () => {
  const { ctx, layer } = await fixture();
  layer.update(.02, flags);
  assert.equal(layer.playing.size, 1, 'first voice starts immediately');
  ctx.advance(.8); layer.update(.02, flags);
  assert.equal(layer.playing.size, 2, 'a second voice starts before the first ends');
  assert.equal(new Set([...layer.playing].map(e => e.speaker)).size, 2);
  assert.ok([...layer.playing].every(e => Math.abs(e.pan.pan.value) <= .35));
  ctx.advance(.8); layer.update(1, flags);
  assert.equal(layer.playing.size, 3);
  assert.equal(new Set([...layer.playing].map(e => e.speaker)).size, 3);
  layer.update(1, flags); assert.equal(layer.playing.size, 3);
  layer.update(.1, flags); assert.equal(layer.playing.size, 2, 'falling intensity reduces the ceiling');
  layer.dispose();
});

test('all 52 legacy lines play once then fall silent without speaker overlap', async () => {
  const { ctx, layer } = await fixture(makeManifest(52));
  for (let i = 0; i < 1000 && ctx.speech.length < 55; i++) {
    ctx.advance(.1); layer.update(1, flags);
    const entries = [...layer.playing];
    assert.ok(entries.length <= 3);
    assert.equal(new Set(entries.map(e => e.speaker)).size, entries.length);
  }
  assert.equal(ctx.speech.length, 52, 'the exhausted playlist stays silent');
  const urls = ctx.speech.map(source => source.buffer.url);
  assert.equal(new Set(urls.slice(0, 52)).size, 52);
  assert.equal(layer.playing.size, 0);
  layer.dispose();
});

test('exit, grounding/recovery, inactive state, and zero anxiety fade speech and tense noise', async () => {
  for (const [level, options] of [[1, { firstPerson: false }], [1, { hostile: false }], [1, { active: false }], [0, {}]]) {
    const { ctx, layer } = await fixture();
    layer.update(1, flags); ctx.advance(.4); layer.update(1, flags);
    const speech = [...layer.playing];
    assert.ok(speech.length > 0);
    assert.ok(layer.loops[0].target > 0);
    layer.update(level, { ...flags, ...options });
    assert.equal(layer.playing.size, 0);
    assert.equal(layer.loops[0].target, 0);
    assert.ok(layer.loops[0].gain.gain.events.at(-1).constant <= .05);
    for (const entry of speech) {
      assert.equal(entry.gain.gain.events.at(-1).value, 0);
      assert.equal(entry.source.stopTime, ctx.currentTime + .16);
    }
    ctx.advance(1); layer.update(level, { ...flags, ...options });
    assert.equal(layer.playing.size, 0, 'no delayed restart after leaving first-person anxiety');
    layer.dispose();
  }
});

test('streaming starts before all clips decode and does not repeat the only available line', async () => {
  const manifest = makeManifest(6), ctx = new FakeContext(), waiting = [];
  const fetch = async (url) => {
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
    if (url.includes('line-') && !url.includes('line-0.')) return new Promise(resolve => waiting.push(() => resolve(audioResponse(url))));
    return audioResponse(url);
  };
  const layer = new VoiceAtmosphere(ctx, new FakeNode(), { fetch, random: () => .5 });
  await tick();
  assert.equal(layer.manifest.anxiety.length, 6);
  assert.equal(layer.buffers.has(manifest.anxiety[0].url), true);
  assert.ok(layer.buffers.size < 7);
  assert.equal(waiting.length, 3, 'no more than three clip downloads are in flight');
  layer.update(.02, flags); assert.equal(ctx.speech.length, 1);
  ctx.advance(3); layer.update(.02, flags); assert.equal(ctx.speech.length, 1);
  // Release each batch of at most three downloads, then drain subsequent work.
  while (layer.buffers.size < 7) { waiting.splice(0).forEach(resolve => resolve()); await tick(); }
  await layer.ready;
  layer.update(.02, flags); assert.equal(ctx.speech.length, 2);
  assert.notEqual(ctx.speech[0].buffer.url, ctx.speech[1].buffer.url);
  layer.dispose();
});

test('decoded clips are cached and a failed clip does not block the playlist', async () => {
  const manifest = makeManifest(6), ctx = new FakeContext(), calls = new Map();
  const fetch = async (url) => {
    calls.set(url, (calls.get(url) || 0) + 1);
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
    if (url === manifest.anxiety[1].url) return { ok: false };
    return audioResponse(url);
  };
  const layer = new VoiceAtmosphere(ctx, new FakeNode(), { fetch, random: () => .5 });
  await layer.ready;
  await layer._loadBuffer(manifest.anxiety[0].url);
  assert.equal(calls.get(manifest.anxiety[0].url), 1);
  assert.equal(ctx.decodeCount.get(manifest.anxiety[0].url), 1);
  for (let i = 0; i < 160; i++) { ctx.advance(.1); layer.update(1, flags); }
  assert.equal(ctx.speech.length, 5);
  assert.ok(ctx.speech.every(source => source.buffer.url !== manifest.anxiety[1].url));
  layer.dispose();
});

test('an optional calm playlist remains supported without requiring calm assets', async () => {
  const manifest = makeManifest();
  manifest.calm.push({ id: 'calm', url: '/audio/calm.mp3', speaker: 'Laura' });
  const { layer } = await fixture(manifest);
  layer.update(0, { active: true, hostile: false, firstPerson: false });
  assert.equal([...layer.playing][0].kind, 'calm');
  layer.update(.02, flags);
  assert.equal([...layer.playing][0].kind, 'anxiety');
  layer.dispose();
});

test('imagined conversations belong to three groups with distinct casts and unique context-independent lines', async () => {
  const script = JSON.parse(await fs.readFile(new URL('../scripts/audio-script.json', import.meta.url)));
  assert.equal(script.anxiety.length, 10);
  const casts = { front: ['A', 'B'], rear: ['C', 'D', 'E'], seated: ['F', 'G'] };
  const lines = [];
  for (const conversation of script.anxiety) {
    assert.deepEqual(conversation.speakers, casts[conversation.group]);
    assert.equal(conversation.lines.length, 4);
    assert.ok(conversation.playOnce);
    lines.push(...conversation.lines);
  }
  assert.equal(new Set(lines).size, 40);
  assert.ok(lines.every(line => !/looking (again|at us)|phone|smil|standing|coming this way/i.test(line)));
  assert.deepEqual(new Set(script.anxiety.map(c => c.group)), new Set(Object.keys(casts)));
});

test('the gallery script has ten four-turn conversations and one play-once stone question', async () => {
  const script = JSON.parse(await fs.readFile(new URL('../scripts/audio-script.json', import.meta.url)));
  assert.equal(script.calm.length, 10);
  assert.equal(new Set(script.calm.map(conversation => conversation.id)).size, 10);
  for (const conversation of script.calm) {
    assert.equal(conversation.lines.length, 4);
    assert.ok(conversation.lines.every(line => typeof line === 'string' && line.trim()));
    assert.ok(conversation.speakers.length >= 2);
    assert.ok(conversation.speakers.every(speaker => ['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(speaker)));
  }
  assert.ok(script.calm.every(conversation => conversation.playOnce));
  const stoneQuestions = script.calm.flatMap(conversation => conversation.lines).filter(line => /stone.*concrete.*\?/i.test(line));
  assert.equal(stoneQuestions.length, 1);
  assert.equal(script.calm.find(conversation => conversation.id === 'material').lines[0], stoneQuestions[0]);
});

 test('floating is calm even at peak; judgments grow only near people', () => {
  const floating = audioMix(1, { ...flags, firstPerson: false });
  assert.equal(floating.tense, 0);
  assert.equal(floating.dialogue, false);
  assert.equal(floating.calmDialogue, true);
  assert.equal(audioMix(1, { ...flags, proximity: 0 }).dialogueGain, 0);
  assert.ok(audioMix(1, { ...flags, proximity: .2 }).dialogueGain < audioMix(1, { ...flags, proximity: .9 }).dialogueGain);
 });
 test('gaze-dependent speech stops when the viewer turns away', async () => {
  const { layer, ctx } = await fixture({ ...makeManifest(), anxiety: [{ id: 'gaze', url: '/audio/gaze.mp3', text: "He's looking at us again.", speaker: 'A' }] });
  layer.update(1, { ...flags, lookingAtPerson: false });
  assert.equal(layer.playing.size, 0);
  layer.update(1, { ...flags, lookingAtPerson: true });
  assert.equal(layer.playing.size, 1);
  layer.update(1, { ...flags, lookingAtPerson: false });
  assert.equal(layer.playing.size, 0);
  assert.ok(ctx.speech[0].stopTime < .2);
 });


const galleryOptions = () => ({
  active: true, hostile: false, firstPerson: false,
  listener: { position: { x: 0, z: 0 }, forward: { x: 0, z: -1 } },
  conversationGroups: [
    { id: 'front', position: { x: 1, z: -1 } },
    { id: 'rear', position: { x: -8, z: -2 } },
    { id: 'seated', position: { x: 3, z: 2 } },
  ],
});
const conversationManifest = (ids = ['material', 'light', 'room', 'shape', 'texture', 'balance', 'scale', 'view', 'space', 'shadow']) => ({
  ...makeManifest(),
  calm: ids.flatMap(conversation => Array.from({ length: 3 }, (_, turn) => ({
    id: `${conversation}-${turn}`, url: `/audio/${conversation}-${turn}.mp3`,
    conversation, turn, speaker: ['A', 'B', 'A'][turn], playOnce: conversation === 'material',
  }))),
});

test('normal exploration conversations restart on each visit despite saved played-line history', async () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const manifest = conversationManifest(['material', 'light', 'room']);
  const saved = new SpokenLines(storage);
  for (const clip of manifest.calm) saved.mark(clip);
  const before = JSON.stringify([...data]);
  for (let visit = 0; visit < 2; visit++) {
    const ctx = new FakeContext();
    const fetch = async url => url.endsWith('manifest.json') ? { ok: true, json: async () => manifest } : audioResponse(url);
    const layer = new VoiceAtmosphere(ctx, new FakeNode(), { fetch, storage, random: () => .5 });
    await layer.ready;
    layer.update(0, galleryOptions());
    assert.equal(layer.playing.size, 3, 'all three gallery groups speak without entering first person');
    assert.ok([...layer.playing].every(entry => entry.kind === 'calm' && entry.target > 0));
    for (let i = 0; i < 250; i++) { ctx.advance(.1); layer.update(0, galleryOptions()); }
    assert.equal(ctx.speech.length, manifest.calm.length, 'normal dialogue plays once per visit');
    assert.equal(new Set(ctx.speech.map(source => source.buffer.url)).size, manifest.calm.length);
    layer.dispose();
  }
  assert.equal(JSON.stringify([...data]), before, 'normal conversations do not rewrite persistent judgment history');
});

test('ten conversations finish once through live groups with ordered overlapping replies', async () => {
  const manifest = conversationManifest();
  // Playback follows numeric turns even when the manifest arrives in another order.
  manifest.calm.reverse();
  const { layer, ctx } = await fixture(manifest), options = galleryOptions();
  const seen = new Set(), records = [], byUrl = new Map(manifest.calm.map(clip => [clip.url, clip]));
  let maximum = 0;
  function update() {
    layer.update(0, options);
    const groups = new Map();
    for (const entry of layer.playing) {
      const clip = byUrl.get(entry.url);
      const group = groups.get(entry.group) || new Set();
      group.add(clip.conversation); groups.set(entry.group, group);
      if (!seen.has(entry.source)) {
        seen.add(entry.source);
        records.push({ ...clip, group: entry.group, time: ctx.currentTime, duration: entry.source.buffer.duration });
      }
    }
    assert.ok([...groups.values()].every(group => group.size === 1), 'a group finishes its dialogue before switching');
    assert.equal(new Set([...groups.values()].flatMap(group => [...group])).size, groups.size, 'groups never share a simultaneous conversation');
    maximum = Math.max(maximum, layer.playing.size);
  }
  for (let i = 0; i < 40; i++) { ctx.advance(.02); update(); }
  const near = [...layer.playing].find(entry => entry.group === 'front');
  const far = [...layer.playing].find(entry => entry.group === 'rear');
  assert.ok(near.target > far.target * 3);
  assert.ok(near.pan.pan.value > 0 && far.pan.pan.value < 0);
  options.listener.position = { x: -8, z: -1 }; update();
  assert.ok(far.target > near.target * 3, 'dominant group follows listener position');
  options.conversationGroups[1].position = { x: -8, z: -2.5 }; update();
  closeTo(far.target, .28, 'speaker position follows its live visitor group');
  for (let i = 0; i < 4000 && records.filter(record => record.turn === 0).length < 28; i++) {
    ctx.advance(.02); update();
  }
  assert.ok(maximum >= 4 && maximum <= 6, 'three groups have bounded natural reply overlap');
  const starts = records.filter(record => record.turn === 0).map(record => record.conversation);
  assert.equal(starts.length, 10, 'all topics are consumed exactly once');
  assert.equal(new Set(starts.slice(0, 10)).size, 10, 'every conversation starts before any repeats');
  assert.equal(new Set(records.map(record => record.url)).size, records.length);
  assert.equal(starts.filter(id => id === 'material').length, 1, 'stone question plays only once');
  let overlappingReplies = 0;
  for (const group of options.conversationGroups) {
    const history = records.filter(record => record.group === group.id);
    for (let index = 0; index < history.length; index++) {
      const current = history[index], previous = history[index - 1];
      if (current.turn === 0) continue;
      assert.equal(current.conversation, previous.conversation);
      assert.equal(current.turn, previous.turn + 1, 'replies retain authored turn order');
      if (current.time - previous.time < previous.duration) overlappingReplies++;
    }
    assert.ok(new Set(history.map(record => record.conversation)).size > 1, 'physical groups draw from the shared pool');
  }
  assert.ok(overlappingReplies > 0);
  layer.dispose();
});

test('play-once conversation progress survives first-person and inactive mode changes', async () => {
  const manifest = conversationManifest(['material', 'light', 'room']);
  const { layer, ctx } = await fixture(manifest), options = galleryOptions();
  for (let i = 0; i < 10; i++) { ctx.advance(.1); layer.update(0, options); }
  assert.equal(ctx.speech.filter(source => source.buffer.url === '/audio/material-0.mp3').length, 1);
  layer.update(.8, flags);
  assert.ok([...layer.playing].every(entry => entry.kind === 'anxiety'));
  ctx.advance(1);
  layer.update(0, { active: false });
  assert.equal(layer.playing.size, 0);
  ctx.advance(2);
  layer.update(0, options);
  for (let i = 0; i < 600; i++) {
    ctx.advance(.1);
    if (i === 100 || i === 300) layer.update(.8, flags);
    else if (i === 101 || i === 301) layer.update(0, { active: false });
    else layer.update(0, options);
  }
  const material = ctx.speech.filter(source => source.buffer.url.includes('/material-')).map(source => source.buffer.url);
  assert.deepEqual(material, [0, 1, 2].map(turn => `/audio/material-${turn}.mp3`), 'an interrupted question never restarts, and replies resume once in order');
  assert.equal(ctx.speech.filter(source => source.buffer.url === '/audio/light-0.mp3').length, 1, 'every other conversation is also play-once');
  layer.dispose();
});

test('pending conversations stay in the rotation and failed dialogues do not play orphaned replies', async () => {
  const manifest = conversationManifest(['ready', 'pending', 'failed']);
  const ctx = new FakeContext(), waiting = [];
  const fetch = async url => {
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
    if (url === '/audio/pending-1.mp3') return new Promise(resolve => waiting.push(() => resolve(audioResponse(url))));
    if (url === '/audio/failed-1.mp3') return { ok: false };
    return audioResponse(url);
  };
  const layer = new VoiceAtmosphere(ctx, new FakeNode(), { fetch, random: () => .5 });
  await tick();
  const options = galleryOptions();
  for (let i = 0; i < 200; i++) { ctx.advance(.1); layer.update(0, options); }
  assert.deepEqual(ctx.speech.map(source => source.buffer.url), [0, 1, 2].map(turn => `/audio/ready-${turn}.mp3`), 'ready dialogue does not repeat while an unused conversation is pending');
  assert.equal(waiting.length, 1);
  waiting[0](); await layer.ready;
  for (let i = 0; i < 100; i++) { ctx.advance(.1); layer.update(0, options); }
  const urls = ctx.speech.map(source => source.buffer.url);
  assert.ok(urls.includes('/audio/pending-0.mp3'));
  assert.ok(urls.every(url => !url.includes('/failed-')));
  assert.equal(urls.filter(url => url === '/audio/ready-0.mp3').length, 1, 'ready dialogue never repeats after pending dialogue finishes');
  layer.dispose();
});

test('old conversation manifests retain authored order and removed groups stop speaking', async () => {
  const manifest = conversationManifest(['front', 'rear', 'seated']);
  for (const clip of manifest.calm) delete clip.turn;
  const { layer, ctx } = await fixture(manifest), options = galleryOptions();
  for (let i = 0; i < 60; i++) { ctx.advance(.1); layer.update(0, options); }
  for (const id of ['front', 'rear', 'seated']) {
    assert.deepEqual(ctx.speech.filter(source => source.buffer.url.includes(`/${id}-`)).slice(0, 3).map(source => source.buffer.url), [0, 1, 2].map(turn => `/audio/${id}-${turn}.mp3`));
  }
  layer.update(0, { ...options, conversationGroups: [] });
  assert.equal(layer.playing.size, 0, 'no anonymous fallback replays spatial conversation clips');
  layer.dispose();
});
test('spatial conversation panning follows camera orientation without changing distance gain',()=>{
 const p={x:2,z:-2},listener={position:{x:0,z:0},forward:{x:0,z:-1}};
 const a=conversationMix(p,listener),b=conversationMix(p,{...listener,forward:{x:0,z:1}});
 closeTo(a.gain,b.gain);closeTo(a.pan,-b.pan);
});

test('Fear Viewer synth and wind overlap only during active first-person anxiety', () => {
  const options={active:true,hostile:true,firstPerson:true};
  const faint=fearMix(.01,options), peak=fearMix(1,options);
  assert(faint.synth>0&&faint.wind>0); assert(peak.synth>faint.synth&&peak.wind>faint.wind);
  for(const blocked of [{active:false},{hostile:false},{firstPerson:false}])
    assert.deepEqual(fearMix(1,{...options,...blocked}),{level:0,synth:0,wind:0});
  assert.deepEqual(fearMix(NaN,options),{level:0,synth:0,wind:0});
  assert.deepEqual(fearMix(5,options),peak);
});
test('Fear mix shares the master guide duck and stops with the same phase flags as voices', () => {
  const audio=new ProceduralAudio(), calls=[];audio.ctx={currentTime:0};audio.nextBeat=99;
  for(const name of ['master','rumble','tone','drone','hb'])audio[name]={gain:new FakeParam()};
  audio.voices={update(){}};audio.fear={update:(...args)=>calls.push(args)};
  const flags={active:true,hostile:false,firstPerson:false};audio.guideActive=true;
  audio.update(1,.1,flags);
  closeTo(audio.master.gain.value,audio.gain*.16);
  assert.equal(calls.length,1);assert.equal(calls[0][0],0);assert.equal(calls[0][2],flags);
});

test('group gaze includes empty space around people and fades smoothly when turning away', () => {
  const group = { position: { x: 0, y: 0, z: -3 }, radius: 1.1 };
  const listener = { position: { x: 0, y: 1.6, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  const angled = degrees => ({ ...listener, forward: { x: Math.sin(degrees * Math.PI / 180), y: 0, z: -Math.cos(degrees * Math.PI / 180) } });
  assert.equal(groupAttention(group, angled(25)).focus, 1, 'gaps and space beside the group are inside its gaze area');
  const middle = groupAttention(group, angled(45)).focus;
  assert.ok(middle > 0 && middle < 1);
  assert.equal(groupAttention(group, angled(100)).focus, 0);
  assert.ok(imaginedConversationMix(group, listener, 1).gain > imaginedConversationMix(group, angled(100), 1).gain * 9);
  assert.ok(imaginedConversationMix({ position: { x: 0, z: -20 } }, listener, 1, false).gain > .02, 'distant background groups remain audible');
});

const groupedAnxiety = () => ({ calm: [], atmosphere: [], anxiety: ['front', 'rear', 'seated'].flatMap((group, index) =>
  Array.from({length: 4}, (_, turn) => ({ id: `${group}-${turn}`, url: `/audio/${group}-${turn}.mp3`,
    conversation: `${group}-thoughts`, group, turn, text: `${group} imagined sentence ${turn}.`, speaker: `${group}-${turn % (index === 1 ? 3 : 2)}` }))) });
const focusedOptions = () => ({ ...flags, listener: { position: {x:0,y:1.6,z:0}, forward: {x:0,y:0,z:-1} },
  conversationGroups: [
    {id:'front',position:{x:0,z:-2},radius:.8},
    {id:'rear',position:{x:2,z:0},radius:.8},
    {id:'seated',position:{x:-2,z:0},radius:.8},
  ] });

test('three imagined groups retain their own exchanges and focus changes live gain, not playback position', async () => {
  const manifest = groupedAnxiety(), {ctx, layer} = await fixture(manifest), options = focusedOptions();
  for(let i=0;i<10;i++){ctx.advance(.1);layer.update(1, options);}
  const entries = [...layer.playing];
  assert.equal(entries.length,3);
  const front=entries.find(e=>e.group==='front'), rear=entries.find(e=>e.group==='rear');
  assert.ok(front.target > rear.target * 9);
  options.listener.forward={x:1,y:0,z:0}; layer.update(1,options);
  assert.ok(rear.target > front.target * 9);
  assert.equal(ctx.speech.length,3, 'turning toward another group does not restart a sentence');
  for(let i=0;i<400;i++){ctx.advance(.1);layer.update(1,options);}
  const played=ctx.speech.map(source=>manifest.anxiety.find(c=>c.url===source.buffer.url));
  assert.equal(played.length,12);
  assert.equal(new Set(played.map(c=>c.text)).size,12);
  for(const group of options.conversationGroups) assert.deepEqual(played.filter(c=>c.group===group.id).map(c=>c.turn),[0,1,2,3]);
  assert.equal(layer.playing.size,0,'exhausted groups remain silent');
  layer.dispose();
});

test('every new session restores all voices, while interruptions inside a session never repeat lines', async () => {
  const manifest=JSON.parse(await fs.readFile(new URL('../public/audio/elevenlabs/manifest.json',import.meta.url)));
  const savedData=new Map(),storage={getItem:k=>savedData.get(k),setItem:(k,v)=>savedData.set(k,v)};
  const oldHistory=new SpokenLines(storage);
  for(const kind of ['calm','anxiety']) for(const clip of manifest[kind]) oldHistory.mark(clip);
  const ctx=new FakeContext(),fetch=async url=>url.endsWith('manifest.json')?{ok:true,json:async()=>manifest}:audioResponse(url);
  const layer=new VoiceAtmosphere(ctx,new FakeNode(),{fetch,storage,random:()=>.5});await layer.ready;
  const decoded=ctx.decodeCount.size;
  for(let run=0;run<2;run++){
    layer.resetSession();
    assert.equal(layer.consumedConversations.size,0);
    for(const kind of ['calm','anxiety']){
      const offset=ctx.speech.length, options=kind==='calm'?galleryOptions():focusedOptions(),level=kind==='calm'?0:1;
      layer.update(level,options);
      assert.equal(new Set([...layer.playing].map(e=>e.group)).size,3);
      ctx.advance(.5);layer.update(level,{...options,active:false});
      for(let i=0;i<1200;i++){ctx.advance(.1);layer.update(level,options);}
      const clips=ctx.speech.slice(offset).map(source=>manifest[kind].find(c=>c.url===source.buffer.url));
      assert.equal(clips.length,manifest[kind].length,`run ${run} restores every ${kind} line`);
      assert.equal(new Set(clips.map(c=>c.text)).size,clips.length,'no repeats within a session');
      assert.equal(new Set(clips.map(c=>c.voiceId)).size,7,'all seven male voices are available each run');
    }
  }
  assert.equal(ctx.decodeCount.size,decoded,'replay reuses decoded recordings');
  layer.dispose();
  const fresh=new VoiceAtmosphere(ctx,new FakeNode(),{fetch,storage});await fresh.ready;
  fresh.update(1,focusedOptions());assert.equal(fresh.playing.size,3,'a page reload ignores old visitor history too');fresh.dispose();
});

test('storage failure still prevents repeats during the current visit', async () => {
  const history=new SpokenLines({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}});
  const clip={text:'A distinct sentence.',url:'/a.mp3'};
  history.mark(clip);assert.equal(history.has(clip),true);
});

test('generated gallery recordings match all authored turns and seven distinct male speakers', async () => {
  const script=JSON.parse(await fs.readFile(new URL('../scripts/audio-script.json',import.meta.url)));
  const manifest=JSON.parse(await fs.readFile(new URL('../public/audio/elevenlabs/manifest.json',import.meta.url)));
  const voices=new Map(), texts=new Set();
  for(const kind of ['calm','anxiety']) {
    const expected=script[kind].flatMap(c=>c.lines.map((text,turn)=>({text,turn,group:c.group,conversation:c.id,speaker:c.speakers[turn%c.speakers.length]})));
    assert.equal(manifest[kind].length,40);
    for(const [i,clip] of manifest[kind].entries()) {
      for(const key of ['text','turn','group','conversation','speaker']) assert.equal(clip[key],expected[i][key]);
      assert.equal(clip.gender,'male'); assert.equal(texts.has(clip.text),false);texts.add(clip.text);
      if(voices.has(clip.speaker))assert.equal(voices.get(clip.speaker),clip.voiceId);
      voices.set(clip.speaker,clip.voiceId);
      assert.ok((await fs.stat(new URL(`../public${clip.url}`,import.meta.url))).size>0);
    }
  }
  assert.equal(voices.size,7);assert.equal(new Set(voices.values()).size,7);
});

test('current judgments and tense ambience fade during calming without new dialogue or a sudden stop',async()=>{
 const {ctx,layer}=await fixture();layer.update(1,flags);
 const voice=[...layer.playing][0],initial=voice.target,loop=layer.loops[0],noise=loop.target;
 const calming={...flags,hostile:false,settling:true,settlingSeconds:14};
 layer.update(1,calming);assert.equal(voice.target,initial);assert.equal(loop.target,noise);assert.equal(voice.source.stopTime,undefined);
 // Keep this simulated long utterance active to verify its entire release envelope.
 voice.source.buffer.duration=30;
 ctx.advance(7);layer.update(.5,calming);closeTo(voice.target,initial*.5);closeTo(loop.target,noise*.5);
 assert.equal(ctx.speech.length,1,'no new anxious or calm conversations during the transition');
 ctx.advance(7);layer.update(0,calming);closeTo(voice.target,0);closeTo(loop.target,0);
 layer.update(0,{...flags,hostile:false});assert.equal(layer.playing.size,0);
 layer.dispose();
});

test('fear textures overlap in pairs, each has rests, and Tone parts never all run together',()=>{
 const present={synth:0,wind:0,movement:0};let overlaps=0;
 for(let time=0;time<96;time+=.1){
  const layers=fearLayers(time,1),active=['synth','wind','movement'].filter(key=>layers[key]>.001);
  assert(active.length<=2);if(active.length===2)overlaps++;
  for(const key of active)present[key]++;
  assert(layers.parts.length<=2);
 }
 assert(overlaps>50);for(const count of Object.values(present))assert(count>100&&count<800);
 assert(!fearLayers(10,.2).parts.includes('stabs'));
 assert(fearMix(.5,{...flags,hostile:false,settling:true}).synth>0);
});

test('provided fear recordings decode, freeze their current combination during recovery, and stop outside first person',async()=>{
 const ctx=new FakeContext(),starts=[],parts=[];
 const engine={setParts(value){parts.push(value);},async start(){starts.push(1);},stop(){starts.push(0);},dispose(){}};
 const fear=new FearAtmosphere(ctx,new FakeNode(),{fetch:async url=>audioResponse(url),load:async()=>({createFearSoundscape:()=>engine})});
 await fear.recordingsReady;assert.equal(fear.sources.length,2);
 assert(fear.sources.some(source=>source.buffer.url==='/audio/fear/wind.mp3'));
 assert(fear.sources.some(source=>source.buffer.url==='/audio/fear/movement.mp3'));
 for(let i=0;i<240;i++){ctx.advance(.1);fear.update(1,.1,flags);}await fear.loading;
 const time=fear.time,layers=fear.layers,wind=fear.wind.gain.value,movement=fear.movement.gain.value;
 fear.update(.5,.1,{...flags,hostile:false,settling:true});
 assert.equal(fear.time,time);assert.equal(fear.layers,layers);assert(fear.wind.gain.value<wind);assert(fear.movement.gain.value<movement);
 assert(!parts.at(-1).includes('stabs'));
 fear.update(1,.1,{...flags,firstPerson:false});assert.equal(fear.level,0);assert.equal(fear.wind.gain.value,0);assert.equal(fear.movement.gain.value,0);assert.equal(starts.at(-1),0);
 fear.dispose();
});

test('guide ducking takes time during settling instead of abruptly removing the room sound',()=>{
 const audio=new ProceduralAudio();audio.ctx={currentTime:0};audio.nextBeat=99;audio.guideActive=true;audio.voices={update(){}};
 for(const name of ['master','rumble','tone','drone','hb'])audio[name]={gain:new FakeParam()};
 audio.update(1,.1,{...flags,settling:true});assert.equal(audio.master.gain.events.at(-1).constant,1.8);
});


test('all groups keep talking even far away while exactly one visible group stays clear', async () => {
  const {ctx, layer} = await fixture(groupedAnxiety()), options = focusedOptions();
  options.proximity = 0;
  options.conversationGroups = [
    {id:'front',position:{x:0,z:-20},inView:true},
    {id:'rear',position:{x:4,z:-12},inView:true},
    {id:'seated',position:{x:-20,z:10},inView:false},
  ];
  layer.update(.1, options);
  assert.equal(layer.playing.size,3, 'all groups start without waiting for approach or gaze');
  assert.equal(layer.focusedGroup,'front');
  const entries = [...layer.playing];
  assert.equal(entries.filter(e=>e.filter.frequency.value===8000).length,1);
  assert.equal(entries.filter(e=>e.filter.frequency.value===850).length,2);
  assert.ok(entries.every(e=>e.target>0));
  const front=entries.find(e=>e.group==='front'), rear=entries.find(e=>e.group==='rear');
  assert.ok(front.target>=rear.target*9);
  options.listener.forward={x:4,y:0,z:-12};
  layer.update(.1, options);
  assert.equal(layer.focusedGroup,'rear');
  assert.equal(rear.filter.frequency.value,8000);
  assert.equal(front.filter.frequency.value,850);
  assert.ok(rear.target>=front.target*9);
  assert.equal(ctx.speech.length,3,'focus changes do not restart or replace the speech');
  ctx.advance(1.9); layer.update(.1,options);
  assert.equal(ctx.speech.length,6,'every group continues into its next reply');
  assert.equal(new Set([...layer.playing].map(e=>e.group)).size,3);
  options.conversationGroups.forEach(g=>g.inView=false);layer.update(.1,options);
  assert.equal(layer.focusedGroup,null);
  assert.ok([...layer.playing].every(e=>e.target>0&&e.filter.frequency.value===850), 'looking at empty space leaves all conversations running and muffled');
  layer.dispose();
});

test('exclusive conversation focus tolerates small head movements between adjacent groups', () => {
  const listener={position:{x:0,y:1.6,z:0},forward:{x:0,y:0,z:-1}};
  const groups=[{id:'left',position:{x:-.1,z:-4},inView:true},{id:'right',position:{x:.1,z:-4},inView:true}];
  assert.equal(focusedConversationGroup(groups,listener,'right'),'right');
  listener.forward={x:-.7,y:0,z:-1};
  assert.equal(focusedConversationGroup(groups,listener,'right'),'right','tiny angular separation stays stable');
  groups[0].position.x=-3;
  assert.equal(focusedConversationGroup(groups,listener,'right'),'left');
  groups[0].inView=false;
  assert.equal(focusedConversationGroup(groups,listener,'left'),'right');
});


test('third-person hover preview is capped at thirty percent without hostile speech',()=>{
 const preview=audioMix(1,{active:true,firstPerson:false,preview:1});
 closeTo(preview.tense,.28*.3);assert.equal(preview.dialogue,false);assert.equal(preview.calmDialogue,true);
 assert.equal(audioMix(0,{active:true,firstPerson:false,preview:0}).tense,0);
});
