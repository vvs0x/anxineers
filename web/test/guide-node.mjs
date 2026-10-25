import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Guide } from '../public/js/guide.js';
import { GUIDE_LINES } from '../public/js/guide-script.js';
import { Voice, groundingResponse, parseItems } from '../public/js/voice.js';
import { ProceduralAudio } from '../public/js/audio.js';

test('every authored guide line has a nonempty Sarah recording in both languages', async () => {
  const root = new URL('../public/', import.meta.url);
  const manifest = JSON.parse(await fs.readFile(new URL('audio/elevenlabs/manifest.json', root), 'utf8'));
  for (const [lang, lines] of Object.entries(GUIDE_LINES)) for (const [id, text] of Object.entries(lines)) {
    const clip = manifest.guide.find(c => c.id === `${lang}-${id}`);
    assert(clip, `${lang}-${id}`); assert.equal(clip.text, text); assert.equal(clip.voiceId, 'EXAVITQu4vr4xnSDxMaL');
    assert((await fs.stat(new URL(clip.url.slice(1), root))).size > 1000);
    assert.equal(clip.voiceSettings.speed,.78); assert.equal(clip.voiceSettings.style,0); assert.equal(clip.voiceSettings.stability,.85);
  }
});

test('grounding distinguishes readiness, help and stopping from named objects', () => {
  for (const value of ['ready', "I'm ready", 'next please', 'fertig', 'weiter']) assert.equal(groundingResponse(value).type, 'ready');
  assert.equal(groundingResponse("I don't know what to say").type, 'help');
  assert.equal(groundingResponse("I can't smell anything").type, 'unavailable');
  assert.equal(groundingResponse('stop').type, 'stop');
  assert.equal(groundingResponse('a stop sign').type, 'items');
  assert.equal(groundingResponse('a calm person').type, 'items');
  assert.equal(parseItems('a chair, a lamp, a sculpture, a person and a wall').count, 5);
  assert.equal(parseItems('um, okay').count, 0);
  assert.deepEqual(parseItems('I see a chair and a chair').items, ['chair', 'chair']);
  assert.deepEqual(groundingResponse("a chair, a light, I'm ready"), {type:'items',items:['chair','light']});
  assert.equal(groundingResponse('I want to stop').type, 'stop');
});

test('native recognition returns the spoken list and cancellation resolves without stale text', async () => {
  let instance;
  class Recognition {
    constructor() { instance = this; }
    start() {}
    abort() { this.aborted = true; }
  }
  const voice = new Voice(); voice.available = true; voice.backend = 'browser'; voice.Recognition = Recognition;
  const result = voice.listen({ maxMs: 100, silenceMs: 5 });
  instance.onresult({ results: [[{ transcript: 'a chair, a light and a sculpture' }]] });
  assert.equal(await result, 'a chair, a light and a sculpture'); assert(instance.aborted);
  const cancelled = voice.listen({ maxMs: 100 }); voice.cancel();
  assert.equal(await cancelled, null); assert(instance.aborted);
});

test('native permission and network errors become a manual fallback; silence is not readiness', async () => {
  let instance;
  class Recognition { constructor() { instance = this; } start() {} abort() {} }
  const voice = new Voice(); voice.available = true; voice.backend = 'browser'; voice.Recognition = Recognition;
  let result = voice.listen({ maxMs: 100 }); instance.onerror({ error: 'not-allowed' }); assert.equal(await result, null);
  result = voice.listen({ maxMs: 100 }); instance.onerror({ error: 'no-speech' }); assert.equal(await result, '');
});

test('guide playback ducks the background and cancellation releases focus', async t => {
  const sources = [];
  const node = () => ({ gain: { value: 0 }, connect(n) { return n; }, disconnect() {} });
  const audio = { start() {}, ctx: { destination: {}, async resume() {}, async decodeAudioData() { return { duration: 1 }; }, createGain: node,
    createBufferSource() { const source = { ...node(), start() { sources.push(this); }, stop() { this.onended?.(); } }; return source; } } };
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('manifest.json')
    ? { ok: true, json: async () => ({ guide: [{ id: 'en-welcome', text: GUIDE_LINES.en.welcome, url: '/welcome.mp3' }] }) }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  const guide = new Guide(audio);
  assert.equal(await guide.speak('welcome'), false); assert.equal(sources.length, 0);
  guide.unlock(); const playing = guide.speak('welcome');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.guideActive, true); assert.equal(sources.length, 1);
  guide.cancel(); assert.equal(await playing, false); assert.equal(audio.guideActive, false);
});

test('gallery stays audible at 16 percent while the separate guide bus speaks', () => {
  const gain = () => ({ gain: { setTargetAtTime(value) { this.value = value; } } });
  const audio = new ProceduralAudio();
  audio.ctx = { currentTime: 0 }; audio.master = gain(); audio.voices = { update() {} };
  for (const key of ['rumble', 'tone', 'drone', 'hb']) audio[key] = gain();
  audio.nextBeat = 100; audio.guideActive = true;
  audio.update(0, .1, { active: true, firstPerson: false }); assert.equal(audio.master.gain.value, audio.gain * .16);
  assert(audio.master.gain.value > 0);
  audio.guideActive = false; audio.update(0, .1, { active: true, firstPerson: false }); assert.equal(audio.master.gain.value, audio.gain);
});

test('the welcome narration does not read the title or add an introduction', () => {
  assert.equal(GUIDE_LINES.en.welcome, 'Welcome.');
  assert.equal(GUIDE_LINES.de.welcome, 'Willkommen.');
});

test('spoken enumerations and unpunctuated noun lists count without splitting descriptions',()=>{
 assert.equal(parseItems('One a chair two a table three a lamp four a wall five a person').count,5);
 assert.equal(parseItems('a chair a table a lamp a wall and a person').count,5);
 assert.deepEqual(parseItems('a picture on the wall and a cup of coffee').items,['picture on the wall','cup of coffee']);
});
