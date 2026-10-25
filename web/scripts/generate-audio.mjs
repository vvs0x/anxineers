import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { GUIDE_LINES } from '../public/js/guide-script.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = JSON.parse(await fs.readFile(path.join(root, 'scripts/audio-script.json'), 'utf8'));
const speakerRoles = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const args = new Set(process.argv.slice(2));
const group = process.argv.find(a => a.startsWith('--group='))?.slice(8);
if (group && !['calm', 'anxiety', 'atmosphere', 'guide'].includes(group)) throw Error('Group must be calm, anxiety, atmosphere, or guide');
const groups = group ? [group] : ['calm', 'anxiety', 'atmosphere'];
const idsArg = process.argv.find(a => a.startsWith('--ids='))?.slice(6);
const ids = idsArg ? new Set(idsArg.split(',').map(id => /^\d+$/.test(id.trim()) ? id.trim().padStart(2, '0') : id.trim()).filter(Boolean)) : null;
const limitArg = process.argv.find(a => a.startsWith('--limit='))?.slice(8);
const limit = limitArg === undefined ? Infinity : Number(limitArg);
if (limitArg !== undefined && (!Number.isInteger(limit) || limit < 1)) throw Error('Limit must be a positive integer');
function entriesFor(kind) {
  if (kind === 'guide') return Object.entries(GUIDE_LINES).flatMap(([lang, lines]) => Object.entries(lines).map(([id, text]) => [`${lang}-${id}`, text, { lang, line: id }]));
  if (kind === 'atmosphere') return Object.entries(script[kind]);
  let index = 0;
  return script[kind].flatMap(entry => {
    if (typeof entry === 'string') return [[String(++index).padStart(2, '0'), entry]];
    if (!entry.id || !Array.isArray(entry.lines) || !entry.lines.length
      || !Array.isArray(entry.speakers) || !entry.speakers.length || entry.speakers.some(s => !speakerRoles.includes(s))) {
      throw Error('Conversations need an id, nonempty lines, and A–G speakers.');
    }
    return entry.lines.map((text, turn) => {
      if (typeof text !== 'string' || !text.trim()) throw Error(`Empty line in conversation ${entry.id}`);
      return [String(++index).padStart(2, '0'), text, {
        conversation: entry.id, group: entry.group, turn, speaker: entry.speakers[turn % entry.speakers.length],
        ...(entry.playOnce ? { playOnce: true } : {}), ...(kind === 'calm' ? { tempo: 1.18 } : {}),
      }];
    });
  });
}
const allEntries = groups.flatMap(kind => entriesFor(kind).map(([id, text, dialogue = {}], i) => ({ kind, id, text, i, dialogue })));
if (ids) for (const id of ids) if (!allEntries.some(entry => entry.id === id)) throw Error(`Unknown clip ID for selected groups: ${id}`);
const planned = allEntries.filter(entry => !ids || ids.has(entry.id)).slice(0, limit);
if (args.has('--dry-run')) {
  const ttsCharacters = planned.filter(entry => entry.kind !== 'atmosphere').reduce((n, entry) => n + entry.text.length + (entry.kind === 'calm' ? '[calm] ' : '[whispers] ').length, 0);
  const sfxSeconds = planned.filter(entry => entry.kind === 'atmosphere').length * 30;
  console.log(JSON.stringify({ counts: Object.fromEntries(groups.map(kind => [kind, planned.filter(entry => entry.kind === kind).length])),
    ids: planned.map(({ kind, id }) => `${kind}/${id}`), taggedTtsCharacters: ttsCharacters, sfxSeconds,
    estimatedCreditsPlanning: ttsCharacters + sfxSeconds * 40 }, null, 2));
  console.log('No API calls or .env reads made. Planning estimate uses 1 credit/tagged TTS character and 40/second SFX; account rates can differ. Cached clips cost nothing to reuse.');
  process.exit(0);
}
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
if (!args.has('--voices') && planned.some(entry => entry.dialogue.tempo)) {
  try { execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' }); }
  catch { throw Error('FFmpeg is required to preserve the gallery conversation pace. Set FFMPEG_PATH to its executable.'); }
}
try {
  for (const line of (await fs.readFile(path.join(root, '.env'), 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { if (e.code !== 'ENOENT') throw e; }
const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('Add ELEVENLABS_API_KEY to web/.env first.'); process.exit(1); }
function safeProviderMessage(value) {
  return String(value || '').replaceAll(key, '[redacted]').replace(/(?:xi-api-key|authorization)\s*[:=]\s*[^\s,;}]+/gi, '[redacted header]').slice(0, 350);
}
async function request(endpoint, body) {
  const r = await fetch(`https://api.elevenlabs.io/v1/${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'xi-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    let detail = '';
    try {
      const error = await r.json();
      detail = typeof error.detail === 'string' ? error.detail : error.detail?.message || error.message || error.detail?.status || '';
    } catch { /* Do not echo arbitrary server bodies or request headers. */ }
    throw Error(`ElevenLabs HTTP ${r.status}${detail ? ': ' + safeProviderMessage(detail) : ''}. Completed clips are cached; rerun to resume.`);
  }
  return r;
}
let available;
async function voices() { return available ??= (await (await request('voices')).json()).voices; }
if (args.has('--voices')) { console.table((await voices()).map(v => ({ name: v.name, id: v.voice_id, gender: v.labels?.gender }))); process.exit(0); }
const cast = [];
if (planned.some(entry => ['calm', 'anxiety'].includes(entry.kind))) {
  // Never silently fall back to a female, neutral, duplicated, or unavailable voice.
  const male = (await voices()).filter(v => v.labels?.gender?.toLowerCase() === 'male');
  const preferred = ['Roger', 'Callum', 'Charlie', 'George', 'Liam', 'Eric', 'Brian'];
  const used = new Set();
  for (const [i, role] of speakerRoles.entries()) {
    const configured = process.env[`ELEVENLABS_VOICE_${role}`];
    const selected = male.find(v => v.voice_id === configured && !used.has(v.voice_id))
      || male.find(v => v.name.split(' - ')[0] === preferred[i] && !used.has(v.voice_id))
      || male.find(v => !used.has(v.voice_id));
    if (!selected) throw Error('Seven distinct male ElevenLabs voices are required for the gallery groups.');
    cast[i] = selected; used.add(selected.voice_id);
  }
  console.log('Gallery cast:', cast.map((v, i) => `${speakerRoles[i]}: ${v.name}`).join('; '));
}
const out = path.join(root, 'public/audio/elevenlabs');
await fs.mkdir(out, { recursive: true });
const manifestPath = path.join(out, 'manifest.json');
let manifest = { version: 1, calm: [], anxiety: [], atmosphere: [] };
try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
for (const kind of ['calm', 'anxiety', 'atmosphere', 'guide']) manifest[kind] ||= [];
async function saveManifest() {
  await fs.writeFile(manifestPath + '.tmp', JSON.stringify(manifest, null, 2) + '\n');
  await fs.rename(manifestPath + '.tmp', manifestPath);
}
for (const { kind, id, text, i, dialogue } of planned) {
    const sfx = kind === 'atmosphere';
    const speaker = dialogue.speaker ? speakerRoles.indexOf(dialogue.speaker) : i % cast.length;
    const voice = kind === 'guide' ? 'EXAVITQu4vr4xnSDxMaL' : cast[speaker]?.voice_id;
    const model = kind === 'guide' ? 'eleven_multilingual_v2' : process.env.ELEVENLABS_TTS_MODEL || 'eleven_v3';
    const body = sfx ? { text, model_id: process.env.ELEVENLABS_SFX_MODEL || 'eleven_text_to_sound_v2', duration_seconds: 30, loop: true, prompt_influence: .4 } : {
      text: model === 'eleven_v3' ? `${kind === 'calm' ? '[calm]' : '[whispers]'} ${text}` : text,
      model_id: model, voice_settings: kind === 'guide' ? { stability: .85, similarity_boost: .65, style: 0, speed: .78, use_speaker_boost: false } : { stability: .5, similarity_boost: .75 },
    };
    const endpoint = sfx ? 'sound-generation' : `text-to-speech/${encodeURIComponent(voice)}`;
    const hash = createHash('sha256').update(JSON.stringify({ endpoint, body })).digest('hex').slice(0, 16);
    const filename = `${kind}-${id}-${hash}.mp3`;
    const target = path.join(out, filename);
    const metadataPath = target + '.json';
    let metadata = {};
    try { metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    let cached = false;
    try { cached = (await fs.stat(target)).size > 0; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!cached || args.has('--force')) {
      console.log(`Generating ${kind}/${id}`);
      const response = await request(`${endpoint}?output_format=mp3_44100_128`, body);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || !response.headers.get('content-type')?.startsWith('audio/')) throw Error('Expected nonempty audio from ElevenLabs');
      await fs.writeFile(target + '.tmp', bytes); await fs.rename(target + '.tmp', target);
      const creditCost = Number(response.headers.get('character-cost'));
      metadata = { model, generatedAt: new Date().toISOString(), bytes: bytes.length,
        requestId: response.headers.get('request-id') || response.headers.get('x-request-id') || null,
        ...(response.headers.has('character-cost') && Number.isFinite(creditCost) ? { creditCost } : {}) };
      metadata.model = body.model_id;
      await fs.writeFile(metadataPath + '.tmp', JSON.stringify(metadata, null, 2) + '\n');
      await fs.rename(metadataPath + '.tmp', metadataPath);
    } else console.log(`Cached ${kind}/${id}`);
    let playbackFilename = filename;
    if (dialogue.tempo) {
      playbackFilename = filename.replace('.mp3', '-lively-v1.mp3');
      const pacedTarget = path.join(out, playbackFilename);
      let pacedCached = false;
      try { pacedCached = (await fs.stat(pacedTarget)).size > 0; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!pacedCached || args.has('--force')) {
        execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', target,
          '-filter:a', `atempo=${dialogue.tempo}`, '-codec:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', pacedTarget + '.tmp']);
        await fs.rename(pacedTarget + '.tmp', pacedTarget);
      }
    }
    const clip = { id, text, url: `/audio/elevenlabs/${playbackFilename}`, ...metadata,
      model: body.model_id, ...(sfx ? { durationSeconds: body.duration_seconds, loop: body.loop } : { speaker, voiceId: voice, ...(kind !== 'guide' ? { voiceName: cast[speaker].name, gender: 'male' } : {}) }),
      ...dialogue, ...(kind === 'guide' ? { voiceSettings: body.voice_settings } : {}), ...(dialogue.tempo ? { sourceUrl: `/audio/elevenlabs/${filename}`, bytes: (await fs.stat(path.join(out, playbackFilename))).size } : {}) };
    const existing = manifest[kind].findIndex(entry => entry.id === id);
    if (existing < 0) manifest[kind].push(clip); else manifest[kind][existing] = clip;
    const order = new Map(entriesFor(kind).map(([clipId], index) => [clipId, index]));
    manifest[kind].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    await saveManifest();
}
// Only prune retired lines after a complete successful group generation.
if (!ids && limit === Infinity) {
  for (const kind of groups) {
    const current = new Set(entriesFor(kind).map(([id]) => id));
    manifest[kind] = manifest[kind].filter(clip => current.has(clip.id));
  }
  await saveManifest();
}
console.log('Audio ready. Restart/reload the experience to load the new manifest.');
