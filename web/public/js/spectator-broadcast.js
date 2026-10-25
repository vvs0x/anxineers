import { SpectatorConnection } from './spectator-connection.js';
import { SpectatorCapture } from './spectator-capture.js';

/** Every gallery visit is available to spectators, before and during VR. */
export class SpectatorBroadcast {
  constructor(renderer) {
    this.renderer = renderer; this.ready = false; this.watching = false; this.busy = false; this.lastFrame = 0; this.generation = 0;
    const changeMode = () => { this.generation++; this.errors = 0; this.sendState(); };
    renderer.xr.addEventListener('sessionstart', changeMode);
    renderer.xr.addEventListener('sessionend', changeMode);
    document.addEventListener('visibilitychange', () => this.sendState());
    addEventListener('pagehide', () => this.stop());
    addEventListener('pageshow', () => this.start());
    this.start();
  }
  start() {
    if (this.connection) return;
    this.errors = 0;
    this.connection = new SpectatorConnection({ role: 'publisher',
      onState: state => {
        this.state = state; this.generation++; this.ready = this.watching = false;
        if (state === 'connected') this.sendState();
      },
      onMessage: message => {
        if (message.type === 'connected') { this.id = message.source; return; }
        if (message.type !== 'watching') return;
        this.watching = message.value; this.ready = message.ready;
        if (!this.watching && !this.busy) this.releaseCapture();
      },
    });
  }
  sendState() {
    this.connection?.send({ type: 'state', active: !document.hidden && (this.errors || 0) < 3,
      mode: this.renderer.xr.isPresenting ? 'vr' : 'browser', phase: this.phase || '' });
  }
  frame(time, phase) {
    if (phase !== this.phase) { this.phase = phase; this.sendState(); }
    if (!this.connection || document.hidden || !this.watching || !this.ready || this.busy || this.errors >= 3) return;
    if (time - this.lastFrame < 1000 / 15 || this.connection.socket?.bufferedAmount > 512 * 1024) return;
    const mode = this.renderer.xr.isPresenting ? 'vr' : 'browser';
    if (this.captureMode !== mode) { this.releaseCapture(); this.captureMode = mode; }
    this.capture ||= new SpectatorCapture(this.renderer);
    this.busy = true; this.lastFrame = time;
    const gen = this.generation;
    // Copy synchronously within the XR frame, then encode without blocking rendering.
    this.capture.capture().then(blob => {
      if (gen !== this.generation || document.hidden || !this.ready || !this.watching) return;
      if (blob.size > 512 * 1024) throw Error('The gallery image is too large.');
      this.ready = false; this.errors = 0; this.connection?.send(blob);
    }).catch(error => {
      if (gen !== this.generation) return;
      this.errors = (this.errors || 0) + 1; this.error = error.message;
      if (this.errors >= 3) this.sendState();
    }).finally(() => { this.busy = false; if (!this.watching) this.releaseCapture(); });
  }
  releaseCapture() { this.capture?.dispose(); this.capture = null; }
  stop() {
    this.generation++; this.connection?.close(); this.connection = null; this.ready = this.watching = false;
    if (!this.busy) this.releaseCapture();
  }
}
