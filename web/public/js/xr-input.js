import * as THREE from 'three';

/** One input slot per XR source. Native selection, trigger and pinch share one latch. */
export class XRPanelInput {
  constructor(panel, renderer, rig, scene) {
    Object.assign(this, { panel, renderer, rig });
    this.settings = { rayLength: 5, pinchDistance: .022, pinchHysteresis: .012, showHands: true, debug: false };
    this.time = 0; this.lastPickTime = -Infinity; this.lastEvent = 'Waiting for XR input';
    this.ray = new THREE.Raycaster(); this.origin = new THREE.Vector3(); this.direction = new THREE.Vector3();
    this.jointGeometry = new THREE.SphereGeometry(1, 8, 6);
    this.controllers = [0, 1].map(index => {
      const c = renderer.xr.getController(index), hand = renderer.xr.getHand(index);
      rig.add(c, hand);
      const material = new THREE.MeshBasicMaterial({ color: index ? 0xb4baff : 0x9cffe0, depthTest: false, depthWrite: false, toneMapped: false });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: material.color, depthTest: false, depthWrite: false, toneMapped: false }));
      line.renderOrder = 11001; line.visible = false; c.add(line);
      const dot = new THREE.Mesh(this.jointGeometry, material); dot.scale.setScalar(.008); dot.renderOrder = 11002; dot.visible = false; c.add(dot);
      const entry = { c, hand, line, dot, material, source: null, nativeDown: false, triggerDown: false,
        pinching: false, fired: false, hit: -1, joints: new Map(), selections: 0, lastEvent: 'disconnected' };
      c.addEventListener('connected', event => { this.reset(entry); entry.source = event.data; entry.lastEvent = 'connected'; });
      c.addEventListener('disconnected', () => { this.reset(entry); entry.source = null; this.panel.hits.delete(c); });
      c.addEventListener('selectstart', event => {
        // Selecting Continue may hide the panel immediately. Keep later scene
        // listeners from interpreting that same press as a floor teleport.
        if (panel.mesh.visible) event.uiConsumed = true;
        entry.nativeDown = true; this.activate(entry, 'select');
      });
      c.addEventListener('selectend', () => { entry.nativeDown = false; });
      c.addEventListener('squeezestart', () => { if (panel.mesh.visible) panel.placeInFront(); });
      return entry;
    });
    this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = 256;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.debugMesh = new THREE.Mesh(new THREE.PlaneGeometry(.75, .1875), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.debugMesh.renderOrder = 12000; this.debugMesh.visible = false; this.debugMesh.frustumCulled = false; scene.add(this.debugMesh);
    renderer.xr.addEventListener('sessionend', () => { for (const entry of this.controllers) { this.reset(entry); entry.source = null; } });
  }

  reset(entry) {
    entry.nativeDown = entry.triggerDown = entry.pinching = entry.fired = false;
    entry.hit = -1; entry.line.visible = entry.dot.visible = false; entry.lastEvent = 'disconnected';
    for (const mesh of entry.joints.values()) mesh.visible = false;
  }

  cast(entry) {
    if (!entry.source || !entry.c.visible || !this.panel.mesh.visible || !this.panel.model) return null;
    entry.c.updateWorldMatrix(true, false); this.panel.root.updateWorldMatrix(true, true);
    this.origin.setFromMatrixPosition(entry.c.matrixWorld);
    this.direction.set(0, 0, -1).transformDirection(entry.c.matrixWorld);
    this.ray.set(this.origin, this.direction); this.ray.far = this.settings.rayLength;
    return this.panel.hitTest(this.ray);
  }

  activate(entry, method) {
    if (!this.renderer.xr.isPresenting || !entry.source || entry.fired) return;
    // Recast the initiating hand at selection time; never use the other hand's hover.
    entry.fired = true;
    const hit = this.cast(entry), button = hit && this.panel.buttons[hit.index];
    entry.lastEvent = `${method}: ${button?.id || 'miss'}`;
    this.lastEvent = `${entry.source.handedness} ${entry.lastEvent}`;
    if (button && this.time - this.lastPickTime > .35) {
      this.lastPickTime = this.time; entry.selections++;
      this.panel._pick(hit.index);
      entry.source.gamepad?.hapticActuators?.[0]?.pulse?.(.25, 35)?.catch?.(() => {});
    }
  }

  update(dt) {
    this.time += dt;
    const xr = this.renderer.xr.isPresenting;
    let hover = -1, changed = false;
    for (const entry of this.controllers) {
      const { c, hand, source, line, dot } = entry;
      if (!xr || !source) { line.visible = dot.visible = false; this.panel.hits.delete(c); continue; }
      const index = hand.joints?.['index-finger-tip'], thumb = hand.joints?.['thumb-tip'];
      const jointTracked = !!(source.hand && hand.visible && index?.visible && thumb?.visible);
      entry.jointTracked = jointTracked;
      if (!c.visible && !jointTracked) entry.nativeDown = false;
      if (jointTracked) {
        const distance = index.position.distanceTo(thumb.position);
        entry.pinching = distance <= this.settings.pinchDistance + (entry.pinching ? this.settings.pinchHysteresis : 0);
      } else entry.pinching = false;
      entry.triggerDown = !source.hand && !!source.gamepad?.buttons[0]?.pressed;
      if (entry.pinching || entry.triggerDown) this.activate(entry, entry.pinching ? 'pinch' : 'trigger');
      if (!entry.nativeDown && !entry.pinching && !entry.triggerDown) entry.fired = false;

      const hit = this.cast(entry); entry.hit = hit?.index ?? -1;
      changed ||= this.panel.hits.get(c) !== entry.hit;
      this.panel.hits.set(c, entry.hit);
      if (entry.hit >= 0) hover = entry.hit;
      line.visible = c.visible && (this.panel.mesh.visible || this.settings.debug);
      line.scale.z = hit?.distance ?? this.settings.rayLength;
      line.material.color.setHex(entry.hit >= 0 ? 0x66ffb3 : source.hand ? 0xb4baff : 0x9fc4ff);
      dot.visible = line.visible && !!hit; dot.position.z = -(hit?.distance ?? 1) + .003;
      dot.material.color.copy(line.material.color);
      // Joint spheres use live XRHand poses, and disappear on tracking loss.
      for (const [name, joint] of Object.entries(hand.joints || {})) {
        if (!entry.joints.has(name)) {
          const mesh = new THREE.Mesh(this.jointGeometry, entry.material); mesh.renderOrder = 11000;
          joint.add(mesh); entry.joints.set(name, mesh);
        }
        const mesh = entry.joints.get(name);
        mesh.visible = !!source.hand && hand.visible && joint.visible && this.settings.showHands;
        mesh.scale.setScalar(joint.jointRadius || .007);
      }
    }
    if (xr && this.panel.model && (hover !== this.panel.hover || changed)) { this.panel.hover = hover; this.panel._draw(); }
    this.debugMesh.visible = xr && this.settings.debug;
    if (this.debugMesh.visible) {
      const head = this.renderer.xr.getCamera();
      this.debugMesh.position.set(0, -.40, -.85).applyMatrix4(head.matrixWorld);
      this.debugMesh.quaternion.setFromRotationMatrix(head.matrixWorld);
      const text = this.diagnostics();
      if (text !== this.lastDebugText) {
        const ctx = this.context; ctx.clearRect(0, 0, 1024, 256); ctx.fillStyle = '#101820ee'; ctx.fillRect(0, 0, 1024, 256);
        ctx.fillStyle = '#c9f9e5'; ctx.font = "24px 'Roboto Mono', monospace";
        text.split('\n').forEach((line, i) => ctx.fillText(line, 20, 34 + i * 40));
        this.texture.needsUpdate = true; this.lastDebugText = text;
      }
    }
  }

  diagnostics() {
    const xr = this.renderer.xr, session = xr.getSession();
    const lines = [xr.isPresenting ? `XR ${session?.visibilityState || 'active'} · sources ${session?.inputSources?.length ?? 0}` : 'XR inactive · enter VR to test inputs'];
    for (const entry of this.controllers) {
      const source = entry.source;
      lines.push(source ? `${source.handedness} ${source.hand ? 'hand' : 'controller'} · ray ${entry.c.visible ? 'tracked' : 'lost'} · joints ${entry.jointTracked ? 'tracked' : '—'}` : 'Input slot: disconnected');
      if (source) lines.push(`  hit ${this.panel.buttons[entry.hit]?.id || '—'} · ${entry.lastEvent} · picks ${entry.selections}`);
    }
    lines.push('Aim + trigger / pinch · grip recenters menu');
    return lines.join('\n');
  }
}
