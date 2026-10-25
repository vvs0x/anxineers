/** Automatically reconnect after Wi-Fi interruptions or a gallery server restart. */
export class SpectatorConnection {
  constructor({ role, onMessage, onState }) {
    Object.assign(this, { role, onMessage, onState });
    this.closed = false; this.attempt = 0; this.connect();
  }
  connect() {
    if (this.closed) return;
    const url = new URL('/api/spectator/stream', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.onState?.('connecting');
    const ws = this.socket = new WebSocket(url); ws.binaryType = 'blob';
    ws.onopen = () => this.send({ type: 'hello', role: this.role });
    ws.onmessage = event => {
      if (this.socket !== ws || this.closed) return;
      if (typeof event.data === 'string') {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'connected') { this.attempt = 0; this.onState?.('connected'); }
        this.onMessage?.(message);
      } else this.onMessage?.(event.data);
    };
    ws.onerror = () => {};
    ws.onclose = event => {
      if (this.closed || this.socket !== ws) return;
      this.onState?.('reconnecting');
      this.timer = setTimeout(() => this.connect(), Math.min(10000, 750 * 2 ** Math.min(this.attempt++, 4)));
    };
  }
  send(value) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(value instanceof Blob ? value : JSON.stringify(value)); return true;
  }
  close() { this.closed = true; clearTimeout(this.timer); this.socket?.close(1000, 'Sharing ended'); }
}
