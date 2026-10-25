import { drawSpectatorOverlay } from './spectator-overlay.js';

/** Copies the browser canvas or rendered left eye, without moving the scene. */
export class SpectatorCapture {
  constructor(renderer, { maxEdge = 960, quality = .7 } = {}) {
    this.renderer = renderer; this.gl = renderer.getContext(); this.maxEdge = maxEdge; this.quality = quality;
    this.canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { alpha: false });
  }
  target(width, height) {
    const gl = this.gl, fbo = gl.createFramebuffer(), color = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, color); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo); gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Could not prepare the spectator image.');
    return { fbo, color };
  }
  resize(eyeWidth, eyeHeight) {
    const gl = this.gl;
    if (this.eyeWidth === eyeWidth && this.eyeHeight === eyeHeight) return;
    this.dispose(); this.eyeWidth = eyeWidth; this.eyeHeight = eyeHeight;
    const scale = Math.min(1, this.maxEdge / Math.max(eyeWidth, eyeHeight));
    this.width = Math.max(1, Math.round(eyeWidth * scale)); this.height = Math.max(1, Math.round(eyeHeight * scale));
    this.resolve = this.target(eyeWidth, eyeHeight); this.small = this.target(this.width, this.height);
    this.pack = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pack);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.width * this.height * 4, gl.STREAM_READ);
    this.pixels = new Uint8Array(this.width * this.height * 4);
    this.image = new ImageData(this.width, this.height);
    this.canvas.width = this.width; this.canvas.height = this.height;
  }
  async capture() {
    if (!this.renderer.xr.isPresenting) return this.captureBrowser();
    const renderer = this.renderer, gl = this.gl, eye = renderer.xr.getCamera().cameras[0];
    if (!eye?.viewport || gl.isContextLost()) throw Error('Waiting for a headset frame.');
    const v = eye.viewport, rt = renderer.getRenderTarget();
    // Three 0.180 resolves XR projection layers into this FBO after render().
    // Reading DRAW_FRAMEBUFFER_BINDING instead can read discarded MSAA samples.
    const source = (rt && renderer.properties.get(rt).__webglFramebuffer) || renderer.xr.getBaseLayer()?.framebuffer;
    if (!source || Array.isArray(source)) throw Error('This headset framebuffer cannot be mirrored.');
    const state = {
      read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
      buffer: gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING), renderbuffer: gl.getParameter(gl.RENDERBUFFER_BINDING),
      scissor: gl.isEnabled(gl.SCISSOR_TEST), alignment: gl.getParameter(gl.PACK_ALIGNMENT),
      rowLength: gl.getParameter(gl.PACK_ROW_LENGTH), skipRows: gl.getParameter(gl.PACK_SKIP_ROWS), skipPixels: gl.getParameter(gl.PACK_SKIP_PIXELS),
    };
    let sync;
    try {
      this.resize(Math.round(v.z), Math.round(v.w));
      gl.disable(gl.SCISSOR_TEST);
      // Resolve at the original eye size first: MSAA cannot resolve and resize in one blit.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolve.fbo);
      gl.blitFramebuffer(v.x, v.y, v.x + v.z, v.y + v.w, 0, 0, this.eyeWidth, this.eyeHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.resolve.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.small.fbo);
      gl.blitFramebuffer(0, 0, this.eyeWidth, this.eyeHeight, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.small.fbo); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pack);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1); gl.pixelStorei(gl.PACK_ROW_LENGTH, 0); gl.pixelStorei(gl.PACK_SKIP_ROWS, 0); gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
      gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      if (gl.getError() !== gl.NO_ERROR) throw Error('The headset image could not be copied. Exit and re-enter VR.');
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    } finally {
      // Restore raw GL bindings exactly, leaving Three's own state cache valid.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.read); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.draw);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, state.buffer); gl.bindRenderbuffer(gl.RENDERBUFFER, state.renderbuffer);
      if (state.scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
      gl.pixelStorei(gl.PACK_ALIGNMENT, state.alignment); gl.pixelStorei(gl.PACK_ROW_LENGTH, state.rowLength);
      gl.pixelStorei(gl.PACK_SKIP_ROWS, state.skipRows); gl.pixelStorei(gl.PACK_SKIP_PIXELS, state.skipPixels);
    }
    if (!sync) throw Error('Could not capture the headset frame.');
    try {
      await new Promise((resolve, reject) => {
        const started = performance.now();
        const poll = () => {
          if (gl.isContextLost()) return reject(Error('The headset renderer was paused.'));
          const result = gl.clientWaitSync(sync, 0, 0);
          if (result === gl.WAIT_FAILED || performance.now() - started > 1500) return reject(Error('Headset image capture timed out.'));
          if (result === gl.TIMEOUT_EXPIRED) setTimeout(poll, 4); else resolve();
        }; poll();
      });
      const previous = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
      try { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pack); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels); }
      finally { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previous); }
    } finally { gl.deleteSync(sync); }
    // WebGL rows start at the bottom; the laptop image must remain upright.
    const stride = this.width * 4;
    for (let row = 0; row < this.height; row++) this.image.data.set(this.pixels.subarray((this.height - row - 1) * stride, (this.height - row) * stride), row * stride);
    this.context.putImageData(this.image, 0, 0);
    return this.encode();
  }
  captureBrowser() {
    const width = innerWidth, height = innerHeight, scale = Math.min(1, this.maxEdge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const context = this.context, canvas = this.renderer.domElement, rect = canvas.getBoundingClientRect();
    context.save(); context.scale(w / width, h / height);
    context.fillStyle = '#0c0d0f'; context.fillRect(0, 0, width, height);
    // Copy now, inside the render callback, before WebGL discards its drawing buffer.
    context.drawImage(canvas, rect.x, rect.y, rect.width, rect.height);
    drawSpectatorOverlay(context);
    context.restore();
    return this.encode();
  }
  encode() {
    if (this.canvas.convertToBlob) return this.canvas.convertToBlob({ type: 'image/jpeg', quality: this.quality });
    return new Promise((resolve, reject) => this.canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Image encoding failed.')), 'image/jpeg', this.quality));
  }
  dispose() {
    const gl = this.gl;
    for (const target of [this.resolve, this.small]) if (target) { gl.deleteFramebuffer(target.fbo); gl.deleteRenderbuffer(target.color); }
    if (this.pack) gl.deleteBuffer(this.pack);
    this.resolve = this.small = this.pack = null; this.eyeWidth = this.eyeHeight = 0;
  }
}
