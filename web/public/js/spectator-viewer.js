import { SpectatorConnection } from './spectator-connection.js';

const byId = id => document.getElementById(id);
const grid = byId('grid'), waiting = byId('waiting'), status = byId('connection'), tiles = new Map();
let connection, connected = false, generation = 0, focused = null;
fetch('/api/status', { signal: AbortSignal.timeout(5000) }).then(r => r.json()).then(info => {
  const url = info.headsetUrls?.[0] || location.origin;
  byId('gallery-link').href = url; byId('gallery-link').textContent = url;
  byId('gallery-address').hidden = false;
}).catch(() => {});
const labels = { consent: 'Opening', intro: 'Warning', ready: 'Ready to begin', observing: 'In the gallery', embodying: 'Changing perspective', running: 'Inside the experience', breathing: 'Breathing', grounding: 'Grounding', end: 'Settled' };
function wanted(tile) { return connected && !document.hidden && tile.source.active && (focused === null || focused === tile.source.id); }
function ready(tile) { connection?.send({ type: 'ready', source: tile.source.id, value: wanted(tile) }); }
function pause(tile, text) { tile.element.classList.remove('live'); tile.element.classList.add('stale'); tile.status.textContent = text; }
function updateStatus() {
  const count = tiles.size;
  status.textContent = !connected ? 'Connecting…' : count ? `${count} participant${count === 1 ? '' : 's'} connected` : 'Waiting for visitors';
  status.classList.toggle('live', connected && [...tiles.values()].some(tile => tile.element.classList.contains('live')));
  waiting.hidden = count > 0; grid.hidden = !count;
}
function focusView(id, restoreFocus = false) {
  const previous = focused; focused = tiles.has(id) ? id : null;
  document.body.classList.toggle('focused-view', focused !== null);
  grid.classList.toggle('focused', focused !== null); byId('back').hidden = focused === null;
  byId('hint').textContent = focused === null ? 'Select a view to enlarge it.' : 'Watching one participant · Escape returns to everyone.';
  for (const tile of tiles.values()) {
    tile.element.hidden = focused !== null && tile.source.id !== focused;
    tile.element.setAttribute('aria-expanded', String(focused === tile.source.id));
    ready(tile);
  }
  if (focused !== null) tiles.get(focused).element.focus({ preventScroll: true });
  else if (restoreFocus) tiles.get(previous)?.element.focus();
}
function makeTile(source) {
  const element = document.createElement('button'); element.type = 'button'; element.className = 'tile stale'; element.dataset.source = source.id;
  element.setAttribute('aria-label', `Enter participant ${source.id}'s view`); element.setAttribute('aria-expanded', 'false');
  const preview = document.createElement('span'); preview.className = 'preview';
  const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
  const state = document.createElement('span'); state.className = 'tile-status'; state.textContent = 'Connecting to their view…';
  preview.append(canvas, state);
  const caption = document.createElement('span'); caption.className = 'caption';
  const description = document.createElement('span'), name = document.createElement('span'), details = document.createElement('span'), enter = document.createElement('span');
  name.className = 'name'; name.textContent = `Participant ${source.id}`; details.className = 'details';
  enter.className = 'enter'; enter.textContent = 'Enter view ↗'; description.append(name, details); caption.append(description, enter); element.append(preview, caption);
  const tile = { source, element, canvas, context: canvas.getContext('2d', { alpha: false }), status: state, details, lastFrame: 0, generation: 0 };
  element.onclick = () => { if (focused !== source.id) focusView(source.id); };
  tiles.set(source.id, tile); grid.append(element); return tile;
}
function updateSources(sources) {
  const ids = new Set(sources.map(source => source.id));
  for (const [id, tile] of tiles) if (!ids.has(id)) { tile.generation++; tile.element.remove(); tiles.delete(id); }
  if (focused !== null && !tiles.has(focused)) focusView(null);
  for (const source of sources) {
    let tile = tiles.get(source.id);
    const changed = !tile || tile.source.active !== source.active || tile.source.mode !== source.mode;
    tile ||= makeTile(source); tile.source = source;
    tile.details.textContent = `${source.mode === 'vr' ? 'VR headset' : 'Browser'}${labels[source.phase] ? ' · ' + labels[source.phase] : ''}`;
    tile.element.hidden = focused !== null && focused !== source.id;
    if (changed) { tile.generation++; tile.lastFrame = 0; pause(tile, source.active ? 'Connecting to their view…' : 'Their page is paused'); ready(tile); }
  }
  updateStatus();
}
async function receiveFrame(blob) {
  const gen = generation;
  if (blob.size < 8) return;
  const id = new DataView(await blob.slice(0, 4).arrayBuffer()).getUint32(0), tile = tiles.get(id);
  if (gen !== generation || !tile) return;
  if (!wanted(tile)) { ready(tile); return; }
  const tileGen = tile.generation; let image;
  try {
    image = await createImageBitmap(blob.slice(4));
    if (gen !== generation || tileGen !== tile.generation || !wanted(tile)) return;
    if (tile.canvas.width !== image.width || tile.canvas.height !== image.height) { tile.canvas.width = image.width; tile.canvas.height = image.height; }
    tile.context.drawImage(image, 0, 0); tile.lastFrame = performance.now();
    tile.element.classList.remove('stale'); tile.element.classList.add('live'); updateStatus();
  } catch { if (gen === generation && tileGen === tile.generation) pause(tile, 'Waiting for the next image…'); }
  finally { image?.close(); if (gen === generation && tileGen === tile.generation) ready(tile); }
}
function start() {
  if (connection && !connection.closed) return;
  connection = new SpectatorConnection({ role: 'viewer',
    onState: state => {
      generation++; connected = state === 'connected';
      if (connected) { for (const tile of tiles.values()) tile.element.remove(); tiles.clear(); focusView(null); }
      else for (const tile of tiles.values()) pause(tile, 'Reconnecting automatically…');
      updateStatus();
    },
    onMessage: message => { if (message instanceof Blob) receiveFrame(message); else if (message.type === 'sources') updateSources(message.sources); },
  });
}
byId('back').onclick = () => focusView(null, true);
byId('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { status.textContent = 'Use your browser’s full-screen option.'; }
};
addEventListener('keydown', event => {
  if (event.key === 'Escape' && focused !== null) focusView(null, true);
  if (event.key.toLowerCase() === 'f' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) byId('fullscreen').click();
});
document.addEventListener('visibilitychange', () => { for (const tile of tiles.values()) ready(tile); });
addEventListener('pagehide', () => connection?.close());
addEventListener('pageshow', start);
setInterval(() => {
  for (const tile of tiles.values()) if (wanted(tile) && tile.lastFrame && performance.now() - tile.lastFrame > 4000) pause(tile, 'Waiting for their page to resume…');
  updateStatus();
}, 1000);
start();
