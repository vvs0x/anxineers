import * as THREE from 'three';
import { XRPanelInput } from './xr-input.js';

const W = 1024, H = 640, TEXT_SCALE = 3;

/** World-space menus, plus head-following breathing and dice cues in XR. */
export class Panel {
  constructor(scene, camera, renderer, rig) {
    this.camera = camera; this.renderer = renderer; this.rig = rig;
    this.canvas = document.createElement('canvas'); this.canvas.width = W * TEXT_SCALE; this.canvas.height = H * TEXT_SCALE;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(TEXT_SCALE, TEXT_SCALE);
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.mesh.renderOrder = 1000; this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.root = new THREE.Group(); this.root.add(this.mesh); scene.add(this.root);
    // Full surrounding darkness, with no rectangular card or border.
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 12), new THREE.MeshBasicMaterial({ color: 0x08090b, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false }));
    this.backdrop.renderOrder = 999; this.backdrop.visible = false; this.backdrop.frustumCulled = false; this.root.add(this.backdrop);
    this.orb = new THREE.Mesh(new THREE.CircleGeometry(0.06, 64), new THREE.MeshBasicMaterial({ color: 0xbfd9ff, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, toneMapped: false }));
    this.orb.position.set(0, -0.52, 0.01); this.orb.renderOrder = 1001; this.orb.visible = false; this.root.add(this.orb);
    this.distance = 1.25;
    this.orbMode = 'off'; this.orbScale = 1; this.t = 0;
    this.model = null; this.hover = -1; this.buttons = []; this.onPick = null;
    this.ray = new THREE.Raycaster(); this.hits = new Map();
    this.fontFamily = "'Roboto Mono', monospace";
    this.lines = [];
    this.overlay = document.getElementById('session-overlay');
    this.domCard = document.getElementById('session-card');
    this.domTitle = document.getElementById('session-title');
    this.domBody = document.getElementById('session-body');
    this.domStatus = document.getElementById('session-status');
    this.domProgress = document.getElementById('session-progress');
    this.domOrb = document.getElementById('session-orb');
    this.domButtons = document.getElementById('session-buttons');
    this.groundTextures = {};
    const loader = new THREE.TextureLoader();
    for (let n = 1; n <= 5; n++) {
      const texture = loader.load(`/numbers/${n}.png`, () => {
        if (this.model?.groundOnly && this.model.groundCount === n) this._draw();
      }); texture.colorSpace = THREE.SRGBColorSpace;
      this.groundTextures[n] = texture;
    }
    this.domGround = document.createElement('div'); this.domGround.id = 'grounding-cue'; this.domGround.hidden = true;
    this.domDice = document.createElement('button'); this.domDice.id = 'grounding-dice';
    this.domDice.type = 'button';
    this.domDice.onclick = () => this.onPick?.('mic');
    this.domDiceImage = document.createElement('img'); this.domDiceImage.alt = '';
    this.domDice.append(this.domDiceImage);
    this.domGroundLabel = document.createElement('p'); this.domGroundLabel.id = 'grounding-label';
    this.domGroundLabel.setAttribute('aria-live', 'polite');
    this.domContinue = document.createElement('button'); this.domContinue.id = 'grounding-continue'; this.domContinue.type = 'button';
    this.domContinue.onclick = () => this.onPick?.('next');
    this.domGround.append(this.domDice, this.domGroundLabel, this.domContinue); this.overlay?.append(this.domGround);
    this.xrInput = new XRPanelInput(this, renderer, rig, scene);
    this.controllers = this.xrInput.controllers;
    // mouse
    const el = renderer.domElement; this.mouse = new THREE.Vector2(); this.mouseOn = false; let down = null;
    el.addEventListener('pointermove', (e) => { this.mouse.set((e.clientX / el.clientWidth) * 2 - 1, -(e.clientY / el.clientHeight) * 2 + 1); this.mouseOn = true; });
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!this.overlay && down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5 && this.mesh.visible && this.hover >= 0) this._pick(this.hover);
      down = null;
    });

  }

  /** put the panel about 1 m in front of the current head pose, once */
  placeInFront(dist = this.distance) {
    const p = new THREE.Vector3(), d = new THREE.Vector3();
    if (this.renderer.xr.isPresenting) {
      this.rig.updateMatrixWorld(true);
      this.renderer.xr.updateCamera(this.camera);
      const head = this.renderer.xr.getCamera();
      // XR's ArrayCamera is unparented; read its prepared world matrix directly.
      // getWorldPosition() would recompute it without the locomotion rig transform.
      p.setFromMatrixPosition(head.matrixWorld);
      d.set(0, 0, -1).transformDirection(head.matrixWorld);
    } else {
      this.camera.getWorldPosition(p); this.camera.getWorldDirection(d);
    }
    d.y = 0;
    if (d.lengthSq() < 1e-4) d.set(0, 0, -1); d.normalize();
    this.root.position.set(p.x + d.x * dist, p.y - 0.12, p.z + d.z * dist);
    this.root.rotation.set(0, Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z), 0);
  }

  /** model: {title, body, buttons:[{id,label}], dots:{total,done}, status} */
  show(model) { this.backdrop.visible = Boolean(model.opening);
    this.mesh.material.map = this.tex;
    this.mesh.material.needsUpdate = true;
    this.mesh.scale.setScalar(model.groundOnly ? .6 : 1);
    this.mesh.position.set(0, model.groundOnly ? -.6 : 0, model.groundOnly ? .01 : 0); this.model = model; this.mesh.visible = !model.breathOnly; this.hover = -1; this.hits.clear(); this._draw(); }
  hide() { document.body.classList.remove('opening-active', 'breathing-active', 'grounding-active'); this.backdrop.visible = false; this.mesh.visible = false; this.model = null; this.orb.visible = false; this.hover = -1; this.hits.clear(); if (this.overlay) this.overlay.hidden = true; }
  setOrb(mode) {
    this.orbMode = mode; this.orb.visible = mode !== 'off' && Boolean(this.model);
    if (mode === 'breath') this.orb.position.set(0, 0, 0); else this.orb.position.set(0, -0.3, 0.02);
    if (this.domOrb) this.domOrb.hidden = mode === 'off';
  }
  setStatus(text) { if (this.model) { this.model.status = text; this._draw(); } }
  _pick(i) { const b = this.buttons[i]; if (b && !b.disabled && this.onPick) this.onPick(b.id); }

  _wrap(text, maxW, font) {
    const c = this.ctx; c.font = font; const lines = [];
    for (const paragraph of text.split('\n')) {
      let cur = '';
      for (const w of paragraph.split(' ')) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
      if (cur || !paragraph) lines.push(cur);
    }
    return lines;
  }
  _rr(x, y, w, h, r) { const c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  _draw() {
    this._drawDOM();
    const c = this.ctx, m = this.model; c.clearRect(0, 0, W, H); if (!m) return;
    if (m.groundOnly) { this._drawGrounding(); return; }
    if (m.breathOnly) { this.buttons = []; this.tex.needsUpdate = true; return; }
    if (m.opening) { this._drawOpening(); return; }
    c.fillStyle = 'rgba(20,24,30,0.78)'; this._rr(8, 8, W - 16, H - 16, 44); c.fill();
    c.strokeStyle = 'rgba(200,220,255,0.25)'; c.lineWidth = 2; c.stroke();
    c.textAlign = 'center'; c.fillStyle = '#f2f6fb'; c.font = `600 52px ${this.fontFamily}`; c.fillText(m.title || '', W / 2, 100);
    c.fillStyle = '#d5dde8'; let fontSize = 33, bodyLines;
    const bodyHeight = m.status || m.dots ? 190 : 260;
    do {
      bodyLines = this._wrap(m.body || '', W - 120, `400 ${fontSize}px ${this.fontFamily}`);
      if (bodyLines.length * fontSize * 1.4 <= bodyHeight || fontSize <= 22) break;
      fontSize--;
    } while (true);
    let y = 160;
    for (const l of bodyLines) { c.font = `400 ${fontSize}px ${this.fontFamily}`; c.fillText(l, W / 2, y); y += fontSize * 1.4; }
    if (m.status) { c.fillStyle = '#9fc4ff'; c.font = `400 25px ${this.fontFamily}`; this._wrap(m.status, W - 100, c.font).slice(0, 2).forEach((line, i) => c.fillText(line, W / 2, 365 + i * 32)); }
    if (m.dots) {
      const n = m.dots.total, gap = 46, x0 = W / 2 - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) { c.beginPath(); c.arc(x0 + i * gap, 430, 12, 0, 6.283); c.fillStyle = i < m.dots.done ? '#9fc4ff' : 'rgba(255,255,255,0.22)'; c.fill(); }
    }
    this.buttons = []; const bs = m.buttons || [];
    const bw = Math.min(340, (W - 120 - (bs.length - 1) * 30) / Math.max(1, bs.length)), bh = 92, total = bs.length * bw + (bs.length - 1) * 30;
    bs.forEach((b, i) => {
      const x = W / 2 - total / 2 + i * (bw + 30), yb = H - 170; this.buttons.push({ id: b.id, x, y: yb, w: bw, h: bh });
      const highlighted = i === this.hover || (this.renderer.xr.isPresenting && [...this.hits.values()].includes(i));
      c.fillStyle = highlighted ? 'rgba(159,196,255,0.95)' : 'rgba(255,255,255,0.14)'; this._rr(x, yb, bw, bh, 30); c.fill();
      c.fillStyle = highlighted ? '#10151c' : '#f2f6fb'; c.font = `500 34px ${this.fontFamily}`;
      const lines = this._wrap(b.label, bw - 30, c.font); const ly = yb + bh / 2 + 12 - (lines.length - 1) * 20;
      lines.forEach((ln, k) => c.fillText(ln, x + bw / 2, ly + k * 40));
    });
    if (bs.length && this.renderer.xr.isPresenting) {
      c.fillStyle = '#b2c6d6'; c.font = `400 24px ${this.fontFamily}`;
      c.fillText('Point + trigger or pinch · Grip to recenter', W / 2, H - 30);
    }
    this.tex.needsUpdate = true;
  }

  _drawGrounding() {
    const c = this.ctx, m = this.model;
    const dice = { id: 'mic', x: 432, y: 74, w: 160, h: 160 };
    const next = { id: 'next', x: 332, y: 370, w: 360, h: 112 };
    this.buttons = [dice, next];
    const image = this.groundTextures[m.groundCount]?.image;
    if (image?.complete) c.drawImage(image, dice.x, dice.y, dice.w, dice.h);
    // Draw directly on transparency: dice, label, button, with no backing card.
    c.textAlign = 'center'; c.font = `400 36px ${this.fontFamily}`;
    c.shadowColor = '#000'; c.shadowBlur = 6; c.shadowOffsetY = 2;
    c.strokeStyle = '#10151c'; c.lineWidth = 2;
    c.strokeText(m.groundLabel, W / 2, 310); c.fillStyle = '#f2f6fb'; c.fillText(m.groundLabel, W / 2, 310);
    c.shadowBlur = 0; c.shadowOffsetY = 0;
    const hovered = this.hover === 1 || [...this.hits.values()].includes(1);
    c.fillStyle = hovered ? '#5555ff' : '#3020ef'; this._rr(next.x, next.y, next.w, next.h, 56); c.fill();
    c.fillStyle = '#f2f6fb'; c.font = `500 38px ${this.fontFamily}`;
    c.fillText(m.buttons.find(b => b.id === 'next').label, W / 2, 439);
    this.tex.needsUpdate = true;
  }

  _drawOpening() {
    const c = this.ctx, m = this.model;
    c.textAlign = 'center'; c.fillStyle = '#f2f3f5';
    this.buttons = [];
    if (m.warning) {
      c.beginPath(); c.moveTo(512, 95); c.lineTo(602, 250); c.lineTo(422, 250); c.closePath(); c.fill();
      c.fillStyle = '#08090b'; c.font = `700 100px ${this.fontFamily}`; c.fillText('!', 512, 230);
      c.fillStyle = '#f2f3f5'; c.font = `500 48px ${this.fontFamily}`; c.fillText(m.title, 512, 335);
      c.font = `400 42px ${this.fontFamily}`; c.fillText(m.body, 512, 400);
    } else if (m.title) {
      c.font = `500 64px ${this.fontFamily}`; c.fillText(m.title, 512, 335);
    } else {
      const lines = this._wrap(m.body, 860, `400 44px ${this.fontFamily}`);
      lines.forEach((line, i) => c.fillText(line, 512, 255 + i * 62));
    }
    for (const b of m.buttons || []) {
      // 0.1125 m high at 1.25 m: a generous 5.2° ray/pinch target.
      const x = 252, y = 430, w = 520, h = 96;
      this.buttons.push({ id: b.id, disabled: Boolean(b.disabled), x, y, w, h });
      const hovered = !b.disabled && (this.hover === 0 || [...this.hits.values()].includes(0));
      c.globalAlpha = b.disabled ? .55 : 1;
      c.fillStyle = hovered ? '#5555ff' : '#3020ef'; this._rr(x, y, w, h, 48); c.fill();
      c.fillStyle = '#f2f3f5'; c.font = `500 38px ${this.fontFamily}`; c.fillText(b.label, 512, y + 61);
      c.globalAlpha = 1;
    }
    this.tex.needsUpdate = true;
  }

  _drawDOM() {
    if (!this.overlay || !this.model) return;
    const m = this.model;
    this.overlay.classList.toggle('ground-only', Boolean(m.groundOnly));
    document.body.classList.toggle('grounding-active', Boolean(m.groundOnly));
    this.domGround.hidden = !m.groundOnly;
    if (m.groundOnly) {
      this.domDiceImage.src = `/numbers/${m.groundCount}.png`;
      this.domDice.setAttribute('aria-label', `${m.groundCount} things. ${m.status || 'Tap to enable microphone.'}`);
      this.domGroundLabel.textContent = m.groundLabel;
      this.domContinue.textContent = m.buttons.find(b => b.id === 'next').label;
    }
    if (m.breathOnly) { this.domCard?.removeAttribute('aria-labelledby'); this.domCard?.setAttribute('aria-label', 'Breathing circle'); }
    else { this.domCard?.removeAttribute('aria-label'); this.domCard?.setAttribute('aria-labelledby', 'session-title'); }
    this.overlay.classList.toggle('opening', Boolean(m.opening));
    this.overlay.classList.toggle('breath-only', Boolean(m.breathOnly));
    document.body.classList.toggle('breathing-active', Boolean(m.breathOnly));
    document.body.classList.toggle('opening-active', Boolean(m.opening));
    this.domTitle.classList.toggle('warning', Boolean(m.warning));
    this.overlay.hidden = this.renderer.xr.isPresenting || !this.model;
    this.domTitle.textContent = m.title || '';
    this.domBody.textContent = m.body || '';
    this.domStatus.textContent = m.status || ''; this.domStatus.hidden = !m.status;
    this.domProgress.hidden = !m.dots;
    if (m.dots) {
      this.domProgress.textContent = '●'.repeat(m.dots.done) + '○'.repeat(m.dots.total - m.dots.done);
      this.domProgress.setAttribute('aria-label', `${m.dots.done} / ${m.dots.total}`);
    }
    // Preserve keyboard focus while status or breathing copy changes.
    const buttons = (m.groundOnly ? [] : m.buttons || []).filter(b => b.id !== 'exit');
    const key = JSON.stringify(buttons);
    if (this.domButtons.dataset.model !== key) {
      this.domButtons.replaceChildren(...buttons.map(b => {
        const button = document.createElement('button');
        button.textContent = b.label; button.dataset.pick = b.id;
        button.disabled = Boolean(b.disabled);
        button.onclick = () => this.onPick?.(b.id);
        return button;
      }));
      this.domButtons.dataset.model = key;
    }
  }

  hitTest(ray) {
    const hit = ray.intersectObject(this.mesh, false)[0]; if (!hit?.uv) return null;
    const px = hit.uv.x * W, py = (1 - hit.uv.y) * H;
    const index = this.buttons.findIndex(b => !b.disabled && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
    return { index, distance: hit.distance, point: hit.point };
  }

  _uvHit(ray) { return this.hitTest(ray)?.index ?? -1; }

  update(dt) {
    this.t += dt;
    if (this.overlay) {
      this.root.visible = this.renderer.xr.isPresenting;
      this.overlay.hidden = this.renderer.xr.isPresenting || !this.model;
    }
    if ((this.model?.breathOnly || this.model?.groundOnly) && this.renderer.xr.isPresenting) {
      const head = this.renderer.xr.getCamera();
      this.root.position.setFromMatrixPosition(head.matrixWorld);
      this.root.quaternion.setFromRotationMatrix(head.matrixWorld);
      this.root.position.add(new THREE.Vector3(0, 0, -this.distance).applyQuaternion(this.root.quaternion));
    }
    this.xrInput.update(dt);
    if (!this.renderer.xr.isPresenting && this.mesh.visible && this.model) {
      this.root.updateMatrixWorld(true);
      let hover = -1;
      if (!this.overlay && this.mouseOn) { this.ray.setFromCamera(this.mouse, this.camera); hover = this._uvHit(this.ray); }
      if (hover !== this.hover) { this.hover = hover; this._draw(); }
    }
    // orb: listening = slow soft pulse, breath = driven from outside via orbScale
    if (this.orb.visible) {
      const s = this.orbMode === 'breath' ? this.orbScale * 1.4 : 0.6 + 0.1 * Math.sin(this.t * 2.2);
      this.orb.scale.setScalar(s);
      this.orb.material.opacity = this.orbMode === 'breath' ? 0.85 : 0.55 + 0.25 * Math.sin(this.t * 2.2);
      if (this.domOrb) { this.domOrb.style.transform = `scale(${s})`; this.domOrb.style.opacity = this.orb.material.opacity; }
    }
  }
}
