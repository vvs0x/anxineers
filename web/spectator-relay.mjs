import { WebSocketServer, WebSocket } from 'ws';

const json = (socket, value) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };

/** Every gallery page is a source. Viewers acknowledge each stream independently. */
export function createSpectatorRelay({ maxClients = 48, heartbeatMs = 20_000 } = {}) {
  const viewers = new Map(), publishers = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024, perMessageDeflate: false });
  let nextId = 1;
  const state = () => ({ type: 'sources', sources: [...publishers.values()].map(({ id, active, phase, mode }) => ({ id, active, phase, mode })) });
  const notifyViewers = () => { const value = state(); for (const socket of viewers.keys()) json(socket, value); };
  function notifyPublisher(socket) {
    const publisher = publishers.get(socket); if (!publisher) return;
    const subscriptions = [...viewers.values()].map(viewer => viewer.get(publisher.id));
    json(socket, { type: 'watching', value: publisher.active && subscriptions.some(Boolean),
      ready: publisher.active && subscriptions.some(subscription => subscription?.ready) });
  }
  const notifyPublishers = () => { for (const socket of publishers.keys()) notifyPublisher(socket); };
  wss.on('connection', socket => {
    let role = null;
    socket.alive = true;
    const helloTimer = setTimeout(() => socket.close(1008, 'Viewer or gallery role required'), 5000);
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (data, binary) => {
      if (!role) {
        if (binary || data.length > 1024) return socket.close(1008, 'Invalid connection');
        let hello; try { hello = JSON.parse(data.toString()); } catch { return socket.close(1008, 'Invalid connection'); }
        if (!hello || hello.type !== 'hello' || !['viewer', 'publisher'].includes(hello.role)) return socket.close(1008, 'Invalid connection');
        role = hello.role; clearTimeout(helloTimer);
        if (role === 'viewer') viewers.set(socket, new Map());
        else publishers.set(socket, { id: nextId++, active: false, phase: '', mode: 'browser' });
        json(socket, { type: 'connected', source: publishers.get(socket)?.id });
        if (role === 'viewer') json(socket, state()); else notifyViewers();
        notifyPublishers(); return;
      }
      if (binary) {
        if (role !== 'publisher') return socket.close(1008, 'Viewer is read-only');
        if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) return socket.close(1008, 'JPEG required');
        const publisher = publishers.get(socket); if (!publisher.active) return;
        // Prefix every image with its source ID so simultaneous streams stay separate.
        const frame = Buffer.allocUnsafe(data.length + 4); frame.writeUInt32BE(publisher.id); data.copy(frame, 4);
        for (const [viewerSocket, subscriptions] of viewers) {
          const subscription = subscriptions.get(publisher.id);
          if (!subscription?.ready || viewerSocket.readyState !== WebSocket.OPEN) continue;
          if (viewerSocket.bufferedAmount > 2 * 1024 * 1024) { viewerSocket.terminate(); continue; }
          subscription.ready = false; viewerSocket.send(frame, { binary: true });
        }
        notifyPublisher(socket); return;
      }
      if (data.length > 1024) return socket.close(1008, 'Invalid message');
      let message; try { message = JSON.parse(data.toString()); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (role === 'viewer' && message.type === 'ready') {
        const entry = [...publishers].find(([, publisher]) => publisher.id === message.source);
        if (!entry) return;
        const subscriptions = viewers.get(socket);
        if (message.value === true) subscriptions.set(message.source, { ready: true });
        else subscriptions.delete(message.source);
        notifyPublisher(entry[0]);
      } else if (role === 'publisher' && message.type === 'state') {
        const publisher = publishers.get(socket);
        const active = message.active === true, phase = typeof message.phase === 'string' ? message.phase.slice(0, 32) : '';
        const mode = message.mode === 'vr' ? 'vr' : 'browser';
        if (publisher.active === active && publisher.phase === phase && publisher.mode === mode) return;
        publisher.active = active; publisher.phase = phase; publisher.mode = mode;
        notifyViewers(); notifyPublisher(socket);
      }
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (role === 'publisher') {
        const id = publishers.get(socket)?.id; publishers.delete(socket);
        for (const subscriptions of viewers.values()) subscriptions.delete(id);
        notifyViewers();
      } else if (role === 'viewer') { viewers.delete(socket); notifyPublishers(); }
    });
  });
  const timer = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
  }, heartbeatMs);
  timer.unref();
  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/api/spectator/stream') return socket.destroy();
      let origin; try { origin = new URL(req.headers.origin); } catch { return socket.destroy(); }
      if (origin.host !== req.headers.host) return socket.destroy();
      if (wss.clients.size >= maxClients) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
      wss.handleUpgrade(req, socket, head, client => wss.emit('connection', client));
    });
  }
  return { attach, close() { clearInterval(timer); for (const socket of wss.clients) socket.terminate(); wss.close(); viewers.clear(); publishers.clear(); } };
}
