import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import WebSocket from 'ws';
import { createSpectatorRelay } from '../spectator-relay.mjs';

async function fixture(t) {
  const relay = createSpectatorRelay({ heartbeatMs: 1000 });
  const server = http.createServer((_req, res) => res.end('test')); relay.attach(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`, sockets = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); relay.close(); await new Promise(resolve => server.close(resolve)); });
  async function client(hello) {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/spectator/stream', { origin }); sockets.push(socket);
    const messages = [], waits = [];
    const dispatch = message => {
      const i = waits.findIndex(w => w.predicate(message));
      if (i >= 0) { const [w] = waits.splice(i, 1); clearTimeout(w.timer); w.resolve(message); } else messages.push(message);
    };
    socket.on('message', (data, binary) => dispatch(binary ? { binary: true, data } : JSON.parse(data.toString())));
    socket.on('close', (code, reason) => dispatch({ type: 'closed', code, reason: reason.toString() }));
    socket.on('error', () => {});
    const next = (predicate, timeout = 1500) => {
      const i = messages.findIndex(predicate); if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const wait = { predicate, resolve, timer: setTimeout(() => { waits.splice(waits.indexOf(wait), 1); reject(Error('Message timed out')); }, timeout) }; waits.push(wait);
      });
    };
    await once(socket, 'open'); socket.send(JSON.stringify(hello));
    return { socket, next, messages, send: value => socket.send(Buffer.isBuffer(value) ? value : JSON.stringify(value)) };
  }
  return { client };
}
const jpeg = Buffer.from([0xff, 0xd8, 12, 34, 56, 0xff, 0xd9]);
async function viewer(f) {
  const client = await f.client({ type: 'hello', role: 'viewer' });
  await client.next(m => m.type === 'connected');
  client.ready = (source, value = true) => client.send({ type: 'ready', source, value });
  return client;
}
async function publisher(f, active = true, mode = 'browser') {
  const client = await f.client({ type: 'hello', role: 'publisher' });
  client.id = (await client.next(m => m.type === 'connected')).source;
  client.send({ type: 'state', active, phase: 'breathing', mode });
  return client;
}
const image = (client, id) => client.next(m => m.binary && m.data.readUInt32BE(0) === id).then(m => m.data.subarray(4));

test('viewer first: opening a browser page advertises a stream without credentials or VR', async t => {
  const f = await fixture(t), v = await viewer(f), p = await publisher(f);
  await v.next(m => m.type === 'sources' && m.sources.some(s => s.id === p.id && s.active && s.mode === 'browser'));
  v.ready(p.id); await p.next(m => m.type === 'watching' && m.ready);
  p.send(jpeg); assert.deepEqual(await image(v, p.id), jpeg);
});

test('gallery first: a new spectator can discover and watch an existing visit', async t => {
  const f = await fixture(t), p = await publisher(f), v = await viewer(f);
  await v.next(m => m.type === 'sources' && m.sources.some(s => s.id === p.id));
  v.ready(p.id); await p.next(m => m.type === 'watching' && m.ready);
  p.send(jpeg); assert.deepEqual(await image(v, p.id), jpeg);
});

test('simultaneous browser and VR images retain their source IDs and independent backpressure', async t => {
  const f = await fixture(t), v = await viewer(f), a = await publisher(f), b = await publisher(f, true, 'vr');
  const sources = await v.next(m => m.type === 'sources' && m.sources.length === 2 && m.sources.every(s => s.active));
  assert.deepEqual(sources.sources.map(s => s.mode), ['browser', 'vr']);
  for (const p of [a,b]) { v.ready(p.id); await p.next(m => m.type === 'watching' && m.ready); }
  const second = Buffer.from([0xff,0xd8,77,0xff,0xd9]);
  a.send(jpeg); b.send(second);
  assert.deepEqual(await image(v,a.id),jpeg); assert.deepEqual(await image(v,b.id),second);
  v.ready(b.id); await b.next(m => m.type === 'watching' && m.ready);
  b.send(second); assert.deepEqual(await image(v,b.id),second);
  a.send(jpeg); await assert.rejects(imageWithTimeout(v,a.id), /timed out/);
});
const imageWithTimeout = (client,id) => client.next(m => m.binary && m.data.readUInt32BE(0) === id,60);

test('focusing a participant unsubscribes other streams; returning to the grid resumes them', async t => {
  const f = await fixture(t), v = await viewer(f), a = await publisher(f), b = await publisher(f);
  for (const p of [a,b]) { v.ready(p.id); await p.next(m => m.type === 'watching' && m.ready); p.messages.length=0; }
  v.ready(b.id,false); await b.next(m => m.type === 'watching' && !m.value && !m.ready);
  a.send(jpeg); await image(v,a.id); b.send(jpeg); await assert.rejects(imageWithTimeout(v,b.id), /timed out/);
  v.ready(b.id); await b.next(m => m.type === 'watching' && m.ready); b.send(jpeg); await image(v,b.id);
});

test('a slow spectator cannot block another spectator of the same participant', async t => {
  const f = await fixture(t), v = await viewer(f), slow = await viewer(f), p = await publisher(f);
  v.ready(p.id); slow.ready(p.id); await p.next(m => m.type === 'watching' && m.ready);
  p.send(jpeg); await image(v,p.id); await image(slow,p.id); p.messages.length=0;
  v.ready(p.id); await p.next(m => m.type === 'watching' && m.ready); p.send(jpeg);
  await image(v,p.id); await assert.rejects(imageWithTimeout(slow,p.id), /timed out/);
});

test('hidden pages pause, VR mode stays in the same tile, and resuming needs no pairing', async t => {
  const f = await fixture(t), v = await viewer(f), p = await publisher(f);
  v.ready(p.id); await p.next(m => m.type === 'watching' && m.ready);
  p.send({type:'state',active:false,mode:'browser'});
  await v.next(m => m.type==='sources' && m.sources.some(s=>s.id===p.id&&!s.active));
  p.send(jpeg); await assert.rejects(imageWithTimeout(v,p.id),/timed out/);
  p.send({type:'state',active:true,mode:'vr'});
  await v.next(m => m.type==='sources' && m.sources.some(s=>s.id===p.id&&s.active&&s.mode==='vr'));
  p.send(jpeg); await image(v,p.id);
});

test('closing the last spectator stops capture; reopening resumes all available streams', async t => {
  const f = await fixture(t), v = await viewer(f), p = await publisher(f);
  v.ready(p.id); await p.next(m => m.type === 'watching' && m.ready); p.messages.length=0;
  v.socket.close(); await p.next(m => m.type==='watching'&&!m.value&&!m.ready);
  const reopened = await viewer(f); reopened.ready(p.id); await p.next(m => m.type==='watching'&&m.ready);
  p.send(jpeg); await image(reopened,p.id);
});

test('closing a participant removes only that tile; reconnect advertises a new stream', async t => {
  const f = await fixture(t), v = await viewer(f), a = await publisher(f), b = await publisher(f);
  await v.next(m=>m.type==='sources'&&m.sources.length===2); v.messages.length=0;
  a.socket.close(); await v.next(m=>m.type==='sources'&&m.sources.length===1&&m.sources[0].id===b.id);
  const resumed=await publisher(f); assert.notEqual(resumed.id,a.id);
  await v.next(m=>m.type==='sources'&&m.sources.some(s=>s.id===resumed.id&&s.active));
});

test('spectators cannot publish and malformed clients are rejected', async t => {
  const f = await fixture(t), v = await viewer(f);
  v.send(jpeg); assert.equal((await v.next(m => m.type === 'closed')).code,1008);
  for(const hello of [null,{}, {type:'hello',role:'admin'}]) {
    const bad=await f.client(hello); assert.equal((await bad.next(m=>m.type==='closed')).code,1008);
  }
});
