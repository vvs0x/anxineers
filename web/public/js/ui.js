import * as THREE from 'three';

const W = 1024, H = 640;

/** World-space panel drawn on a canvas. Pointer: controller rays in XR, mouse on desktop. Placed once, never follows the head. */
export class Panel {
  constructor(scene, camera, renderer, rig) {
    this.camera = camera; this.renderer = renderer; this.rig = rig;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, toneMapped: false }));
    this.mesh.renderOrder = 1000; this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.root = new THREE.Group(); this.root.add(this.mesh); scene.add(this.root);
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 32, 20), new THREE.MeshBasicMaterial({ color: 0xbfd9ff, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }));
    this.orb.position.set(0, -0.52, 0.01); this.orb.renderOrder = 1001; this.orb.visible = false; this.root.add(this.orb);
    this.orbMode = 'off'; this.orbScale = 1; this.t = 0;
    this.model = null; this.hover = -1; this.buttons = []; this.onPick = null;
    this.ray = new THREE.Raycaster(); this.hits = new Map();
    this.fontFamily = 'CalycesInc, system-ui, -apple-system, Segoe UI, sans-serif';
    this.lines = [];
    // controllers
    this.controllers = [0, 1].map((i) => {
      const c = renderer.xr.getController(i); rig.add(c);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.55, depthTest: false }));
      line.scale.z = 0.5; line.renderOrder = 1002; c.add(line);
      c.addEventListener('selectstart', () => { if (this.mesh.visible && this.hover >= 0) this._pick(this.hover); });
      return { c, line };
    });
    // mouse
    const el = renderer.domElement; this.mouse = new THREE.Vector2(); this.mouseOn = false; let down = null;
    el.addEventListener('pointermove', (e) => { this.mouse.set((e.clientX / el.clientWidth) * 2 - 1, -(e.clientY / el.clientHeight) * 2 + 1); this.mouseOn = true; });
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5 && this.mesh.visible && this.hover >= 0) this._pick(this.hover);
      down = null;
    });
    document.fonts?.load('32px CalycesInc').catch(() => {});
  }

  /** put the panel about 1 m in front of the current head pose, once */
  placeInFront(dist = 1.0) {
    const p = new THREE.Vector3(), d = new THREE.Vector3();
    this.camera.getWorldPosition(p); this.camera.getWorldDirection(d); d.y = 0;
    if (d.lengthSq() < 1e-4) d.set(0, 0, -1); d.normalize();
    this.root.position.set(p.x + d.x * dist, p.y - 0.05, p.z + d.z * dist);
    this.root.rotation.y = Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z);
  }

  /** model: {title, body, buttons:[{id,label}], dots:{total,done}, status} */
  show(model) { this.model = model; this.mesh.visible = true; this.hover = -1; this._draw(); }
  hide() { this.mesh.visible = false; this.model = null; this.orb.visible = false; }
  setOrb(mode) {
    this.orbMode = mode; this.orb.visible = mode !== 'off' && this.mesh.visible;
    if (mode === 'breath') this.orb.position.set(0, -0.07, 0.02); else this.orb.position.set(0, -0.3, 0.02);
  }
  setStatus(text) { if (this.model) { this.model.status = text; this._draw(); } }
  _pick(i) { const b = this.buttons[i]; if (b && this.onPick) this.onPick(b.id); }

  _wrap(text, maxW, font) {
    const c = this.ctx; c.font = font; const words = text.split(' '); const lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  }
  _rr(x, y, w, h, r) { const c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  _draw() {
    const c = this.ctx, m = this.model; c.clearRect(0, 0, W, H); if (!m) return;
    c.fillStyle = 'rgba(20,24,30,0.78)'; this._rr(8, 8, W - 16, H - 16, 44); c.fill();
    c.strokeStyle = 'rgba(200,220,255,0.25)'; c.lineWidth = 2; c.stroke();
    c.textAlign = 'center'; c.fillStyle = '#f2f6fb'; c.font = `600 52px ${this.fontFamily}`; c.fillText(m.title || '', W / 2, 100);
    c.fillStyle = '#d5dde8'; const bf = `400 33px ${this.fontFamily}`; let y = 170;
    for (const l of this._wrap(m.body || '', W - 160, bf)) { c.font = bf; c.fillText(l, W / 2, y); y += 46; }
    if (m.status) { c.fillStyle = '#9fc4ff'; c.font = `400 30px ${this.fontFamily}`; c.fillText(m.status, W / 2, Math.max(y + 20, 380)); }
    if (m.dots) {
      const n = m.dots.total, gap = 46, x0 = W / 2 - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) { c.beginPath(); c.arc(x0 + i * gap, 430, 12, 0, 6.283); c.fillStyle = i < m.dots.done ? '#9fc4ff' : 'rgba(255,255,255,0.22)'; c.fill(); }
    }
    this.buttons = []; const bs = m.buttons || [];
    const bw = Math.min(340, (W - 120 - (bs.length - 1) * 30) / Math.max(1, bs.length)), bh = 92, total = bs.length * bw + (bs.length - 1) * 30;
    bs.forEach((b, i) => {
      const x = W / 2 - total / 2 + i * (bw + 30), yb = H - 170; this.buttons.push({ id: b.id, x, y: yb, w: bw, h: bh });
      c.fillStyle = i === this.hover ? 'rgba(159,196,255,0.95)' : 'rgba(255,255,255,0.14)'; this._rr(x, yb, bw, bh, 30); c.fill();
      c.fillStyle = i === this.hover ? '#10151c' : '#f2f6fb'; c.font = `500 34px ${this.fontFamily}`;
      const lines = this._wrap(b.label, bw - 30, c.font); const ly = yb + bh / 2 + 12 - (lines.length - 1) * 20;
      lines.forEach((ln, k) => c.fillText(ln, x + bw / 2, ly + k * 40));
    });
    this.tex.needsUpdate = true;
  }

  _uvHit(ray) {
    const h = ray.intersectObject(this.mesh, false)[0]; if (!h || !h.uv) return -1;
    const px = h.uv.x * W, py = (1 - h.uv.y) * H;
    return this.buttons.findIndex((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }

  update(dt) {
    this.t += dt;
    if (this.mesh.visible && this.model) {
      this.root.updateMatrixWorld(true);
      let hover = -1; const xr = this.renderer.xr.isPresenting;
      if (xr) {
        for (const { c, line } of this.controllers) {
          const o = new THREE.Vector3(), d = new THREE.Vector3(0, 0, -1);
          c.getWorldPosition(o); d.transformDirection(c.matrixWorld);
          this.ray.set(o, d); const h = this._uvHit(this.ray);
          line.visible = true; if (h >= 0) hover = h;
        }
      } else if (this.mouseOn) { this.ray.setFromCamera(this.mouse, this.camera); hover = this._uvHit(this.ray); }
      if (hover !== this.hover) { this.hover = hover; this._draw(); }
    } else for (const { line } of this.controllers) line.visible = false;
    // orb: listening = slow soft pulse, breath = driven from outside via orbScale
    if (this.orb.visible) {
      const s = this.orbMode === 'breath' ? this.orbScale * 1.4 : 0.6 + 0.1 * Math.sin(this.t * 2.2);
      this.orb.scale.setScalar(s);
      this.orb.material.opacity = this.orbMode === 'breath' ? 0.85 : 0.55 + 0.25 * Math.sin(this.t * 2.2);
    }
  }
}
