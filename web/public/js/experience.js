import * as THREE from 'three';

const smooth = (t) => THREE.MathUtils.smoothstep(t, 0, 1);
const OBSERVER_PHASES = new Set(['idle', 'consent', 'intro', 'ready', 'mode', 'cap', 'declined', 'observing']);

/** Keeps the story camera separate from the existing anxiety/session machinery. */
export class EmbodimentJourney {
  constructor({ scene, camera, rig, renderer, character, env, panel, exploration = null, isMotionActive = () => false }) {
    Object.assign(this, { scene, camera, rig, renderer, character, env, panel });
    this.isMotionActive = isMotionActive;
    this.exploration = exploration;
    this.wasTracked = this.trackedView;
    this.observer = new THREE.Vector3(env.spawn.x, env.floorY + .28, env.spawn.z);
    this.observerYaw = THREE.MathUtils.degToRad(env.spawn.yawDeg);
    this.phase = null; this.embodied = false; this.transitionStartT = 0; this.xrChanged = false; this.t = 0;
    this.eye = new THREE.Vector3(); this.head = new THREE.Vector3();
    this.start = new THREE.Vector3(); this.end = new THREE.Vector3();
    this.startRot = new THREE.Quaternion(); this.endRot = new THREE.Quaternion();
    this.startCameraRot = new THREE.Quaternion(); this.identity = new THREE.Quaternion();
    this.fadeMaterial = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { amount: { value: 0 } },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: 'uniform float amount; void main(){gl_FragColor=vec4(.025,.03,.035,amount);}'
    });
    this.fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMaterial);
    this.fade.frustumCulled = false; this.fade.renderOrder = 20000; this.fade.visible = false; scene.add(this.fade);
    this.resetObserver();
  }
  get trackedView() { return this.renderer.xr.isPresenting || this.isMotionActive(); }
  resetObserver() {
    this.sittingDuration = 0; this.sittingElapsed = 0;
    this.character.reset(); this.embodied = false; this.fade.visible = false;
    this.rig.position.copy(this.observer); this.rig.rotation.set(0, this.observerYaw, 0);
    if (!this.renderer.xr.isPresenting) this.camera.position.set(0, 1.6, 0);
    if (!this.trackedView) this.camera.rotation.set(-.08, 0, 0, 'YXZ');
    this.scene.updateMatrixWorld(true);
  }
  onXRChange() { this.xrChanged = true; }
  alignEye() {
    this.character.getEyePosition(this.eye);
    const forward = this.character.getForward(new THREE.Vector3());
    this.rig.rotation.set(0, Math.atan2(-forward.x, -forward.z), 0);
    this.scene.updateMatrixWorld(true);
    if (this.renderer.xr.isPresenting) this.renderer.xr.updateCamera(this.camera);
    else if (!this.isMotionActive()) this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.getWorldPosition(this.head);
    this.rig.position.add(this.eye.clone().sub(this.head));
    this.scene.updateMatrixWorld(true);
    if (this.renderer.xr.isPresenting) this.renderer.xr.updateCamera(this.camera);
    this.character.setEmbodied(true); this.embodied = true;
  }
  beginTransition(startT = 0) {
    this.transitionStartT = startT;
    this.character.setPoseMode('embodied');
    this.start.copy(this.rig.position); this.startRot.copy(this.rig.quaternion); this.startCameraRot.copy(this.camera.quaternion);
    this.character.getEyePosition(this.eye);
    const forward = this.character.getForward(new THREE.Vector3());
    this.endRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-forward.x, -forward.z));
    this.end.copy(this.eye).sub(this.camera.position.clone().applyQuaternion(this.endRot));
  }
  switchView(session) {
    if (this.viewTransition || !this.exploration || !['observing', 'exploring', 'embodying', 'running'].includes(session.phase)) return;
    const returning = !this.exploration.active;
    if(session.freeExplore && !returning)session.elapsed=0;
    if(session.freeExplore)this.exploration.guided=false;
    if (!returning) this.floatPose = { rotation: this.rig.quaternion.clone(), look: this.camera.quaternion.clone() };
    const from = { position: this.rig.position.clone(), rotation: this.rig.quaternion.clone(), look: this.camera.quaternion.clone() };
    this.exploration.enabled = false; this.exploration.clearInput();
    this.exploration.active = returning;
    this.viewTransition = { returning, from, elapsed: 0, duration: this.trackedView || this.exploration.reducedMotion ? 1.2 : 2.8, handedOff: false };
    if (!returning && session.phase !== 'running') session._setPhase('embodying', this.viewTransition.duration);
    this.phase = session.phase;
  }
  updateViewTransition(dt, session) {
    const v = this.viewTransition;
    if (!['observing', 'exploring', 'embodying', 'running'].includes(session.phase)) {
      this.viewTransition = null; this.fade.visible = false; this.phase = session.phase;
      if (this.panel.mesh.visible) this.panel.placeInFront();
      return;
    }
    v.elapsed += dt;
    const t = Math.min(1, v.elapsed / v.duration);
    const stationary = this.trackedView || this.exploration.reducedMotion;
    // Full black covers relocation through the body and any room geometry.
    this.fade.visible = true;
    this.fadeMaterial.uniforms.amount.value = smooth(Math.min(t / .3, (1 - t) / .3));
    if (t >= .5 && !v.handedOff) {
      if (v.returning) {
        this.character.setEmbodied(false); this.embodied = false;
        if (!this.trackedView && this.floatPose) {
          this.rig.quaternion.copy(this.floatPose.rotation); this.camera.quaternion.copy(this.floatPose.look);
        }
        this.exploration.refresh();
        const nav = this.exploration.navigation;
        if (!nav.clear(this.exploration.position)) {
          const id = nav.nearest(this.exploration.position);
          if (id >= 0) this.exploration.position.copy(nav.point(id));
        }
        this.exploration.captureTracking(); this.exploration.placeCamera();
        this.exploration.hold = 3; this.exploration.path = [];
      } else { this.character.setPoseMode('embodied'); this.alignEye(); }
      v.to = { position: this.rig.position.clone(), rotation: this.rig.quaternion.clone(), look: this.camera.quaternion.clone() };
      v.handedOff = true;
    }
    if (!stationary) {
      // Gentle departure and arrival, with the central relocation hidden.
      if (!v.handedOff) {
        const destination = v.returning ? this.exploration.navigation.toWorld(this.exploration.position) : this.character.getEyePosition(this.eye).clone().sub(this.camera.position.clone().applyQuaternion(v.from.rotation));
        this.rig.position.lerpVectors(v.from.position, destination, .18 * smooth(t / .5));
      } else {
        const k = smooth((t - .5) / .5);
        const approach = v.from.position.clone().sub(v.to.position).multiplyScalar(.08 * (1 - k));
        this.rig.position.copy(v.to.position).add(approach);
        this.rig.quaternion.slerpQuaternions(v.from.rotation, v.to.rotation, .9 + .1 * k);
        this.camera.quaternion.slerpQuaternions(v.from.look, v.to.look, .9 + .1 * k);
      }
    }
    this.phase = session.phase; this.wasTracked = this.trackedView;
    if (t >= 1) { this.viewTransition = null; this.fade.visible = false; }
  }
  // The observation covers the walk and turn. Sitting spans the camera
  // handoff plus two seconds inside his body, so anxiety begins mid-descent.
  updateSitting(dt, session) {
    if (!session.showcase || !this.character.openingActive) return;
    if (!this.sittingDuration && session.phase === 'embodying') {
      this.sittingTransitionSeconds = session.phaseDuration;
      this.sittingDuration = this.sittingTransitionSeconds + 2;
    }
    if (!this.sittingDuration) return;
    const previousEye = this.character.getEyePosition(new THREE.Vector3());
    if (session.phase === 'embodying') this.sittingElapsed = session.phaseTime;
    else if (session.phase === 'running') this.sittingElapsed = this.sittingTransitionSeconds + session.phaseTime;
    else this.sittingElapsed += dt;
    const progress = Math.min(1, this.sittingElapsed / this.sittingDuration);
    this.character.updateOpening((.75 + .25 * progress) * session.observationSeconds, session.observationSeconds);
    // Move only by the animated body delta. Never overwrite physical head
    // translation or orientation after the tracked handoff.
    if (this.embodied) this.rig.position.add(this.character.getEyePosition(new THREE.Vector3()).sub(previousEye));
  }
  update(dt, session) {
    this.t += dt;
    if (session.phase !== 'observing') this.updateSitting(dt, session);
    if (this.viewTransition) { this.updateViewTransition(dt, session); return; }
    const phase = session.phase;
    if(session.freeExplore && this.exploration && phase==='observing'){
      if(this.phase!==phase){this.resetObserver();this.exploration.active=true;this.exploration.beginPullback();}
      this.exploration.updatePullback(session);this.phase=phase;return;
    }
    if(session.freeExplore && phase==='exploring')this.exploration.guided=false;
    if(session.showcase && this.exploration){
      if(phase==='observing'){
        if(this.phase!==phase){this.resetObserver();this.character.updateOpening?.(0,session.observationSeconds);this.exploration.active=true;this.exploration.beginShowcase();}
        this.character.setEmbodied(false);this.embodied=false;
        this.character.updateOpening?.(.75 * session.phaseTime,session.observationSeconds);
        this.exploration.updateShowcase(dt,session);
        this.phase=phase;this.wasTracked=this.trackedView;return;
      }
      if(phase==='embodying' && this.phase!==phase){this.exploration.active=false;this.exploration.enabled=false;this.exploration.clearInput();}
    }

    // The floating tour owns the third-person camera. The original embodiment
    // handoff is retained when the visitor explicitly chooses his viewpoint.
    if (this.exploration?.active) {
      if (phase !== this.phase && ['consent', 'observing'].includes(phase)) {
        this.resetObserver(); this.exploration.reset();
        if (this.panel.mesh.visible) this.panel.placeInFront();
      }
      this.embodied = false; this.character.setEmbodied(false); this.fade.visible = false;
      this.exploration.update(dt, session);
      if (this.xrChanged && (!this.renderer.xr.isPresenting || this.renderer.xr.getCamera().cameras.length)) {
        if (this.panel.mesh.visible) this.panel.placeInFront();
        this.xrChanged = false;
      }
      this.phase = phase; this.wasTracked = this.trackedView;
      return;
    }
    if (phase === 'embodying' && this.phase === phase && this.wasTracked && !this.trackedView) {
      this.beginTransition(session.phaseTime / Math.max(.001, session.phaseDuration));
      this.fade.visible = false;
    }
    this.wasTracked = this.trackedView;
    if (phase !== this.phase) {
      if (OBSERVER_PHASES.has(phase) && (this.embodied || phase === 'consent' || phase === 'observing')) {
        this.resetObserver();
        if (this.panel.mesh.visible) this.panel.placeInFront();
      }
      if (phase === 'embodying') this.beginTransition();
      if (phase === 'running' && (!this.trackedView || !this.embodied)) this.alignEye();
      if (phase !== 'embodying') this.fade.visible = false;
      // Calm Now during a transition keeps the current view; no deferred camera jump.
      if (this.phase === 'embodying' && phase !== 'running' && this.panel.mesh.visible) this.panel.placeInFront();
      this.phase = phase;
    }
    if (this.xrChanged) {
      if (!this.renderer.xr.isPresenting || this.renderer.xr.getCamera().cameras.length) {
        if (phase === 'embodying' && !this.renderer.xr.isPresenting) this.beginTransition(session.phaseTime / Math.max(.001, session.phaseDuration));
        else if (this.embodied) this.alignEye();
        else if (OBSERVER_PHASES.has(phase)) this.resetObserver();
        if (this.panel.mesh.visible) this.panel.placeInFront();
        this.xrChanged = false;
      }
    }
    if (phase === 'observing' && !this.trackedView) this.rig.position.y = this.observer.y + .035 * Math.sin(this.t * .65);
    if (phase === 'embodying') {
      this.character.getEyePosition(this.eye);
      this.end.copy(this.eye).sub(this.camera.position.clone().applyQuaternion(this.endRot));
      const t = THREE.MathUtils.clamp(session.phaseTime / Math.max(.001, session.phaseDuration), 0, 1);
      if (this.trackedView) {
        // Fade through relocation on a phone or headset while keeping physical look live.
        this.fade.visible = true; this.fadeMaterial.uniforms.amount.value = smooth(Math.min(t / .38, (1 - t) / .38));
        if (t >= .5 && !this.embodied) this.alignEye();
      } else {
        const k = smooth((t - this.transitionStartT) / Math.max(.001, 1 - this.transitionStartT));
        this.rig.position.lerpVectors(this.start, this.end, k);
        this.rig.quaternion.slerpQuaternions(this.startRot, this.endRot, k);
        this.camera.quaternion.slerpQuaternions(this.startCameraRot, this.identity, k);
        if (t > .93 && !this.embodied) { this.character.setEmbodied(true); this.embodied = true; }
      }
    }
  }
}
