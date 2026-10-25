import * as THREE from 'three';

const radians = THREE.MathUtils.degToRad;
const back = new THREE.Vector3(0, 0, 1);
const phoneToCamera = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const screenRotation = new THREE.Quaternion();

// Device axes are Z-X-Y; a camera looks through the back of the upright phone.
export function orientationQuaternion(alpha, beta, gamma, screenAngle = 0, target = new THREE.Quaternion()) {
  euler.set(radians(beta), radians(alpha), -radians(gamma), 'YXZ');
  return target.setFromEuler(euler).multiply(phoneToCamera)
    .multiply(screenRotation.setFromAxisAngle(back, -radians(screenAngle)));
}

export class LookControls {
  constructor({ camera, rig, element, canDrag = () => true, onDrag = null, onChange = () => {}, host = window }) {
    Object.assign(this, { camera, rig, element, canDrag, onChange, host });
    this.mode = 'drag'; this.xr = false; this.motionReady = false; this.pending = false;
    this.sensor = new THREE.Quaternion(); this.offset = new THREE.Quaternion();
    this.savedCamera = new THREE.Quaternion();
    this.pointer = null; this.timer = null; this.request = 0;
    this.onOrientation = (event) => {
      if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;
      const angle = host.screen?.orientation?.angle ?? host.orientation ?? 0;
      orientationQuaternion(event.alpha, event.beta, event.gamma, angle, this.sensor);
      if (!this.motionReady) {
        this.motionReady = true;
        // Retain the current view when permission resolves; subsequent motion is relative to it.
        this.offset.copy(this.xr ? this.savedCamera : camera.quaternion).multiply(this.sensor.clone().invert());
        host.clearTimeout(this.timer);
        this.onChange('motion', 'Move your phone to look around.');
      }
    };
    element.addEventListener('pointerdown', (event) => {
      if (this.mode !== 'drag' || this.xr || !canDrag() || event.isPrimary === false || event.button !== 0) return;
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture?.(event.pointerId);
      element.classList.add('dragging');
    });
    element.addEventListener('pointermove', (event) => {
      if (!this.pointer || event.pointerId !== this.pointer.id) return;
      const dx = event.clientX - this.pointer.x, dy = event.clientY - this.pointer.y;
      this.pointer.x = event.clientX; this.pointer.y = event.clientY;
      if (this.mode !== 'drag' || this.xr || !canDrag()) return;
      if (onDrag?.(dx, dy)) return;
      rig.rotation.y -= dx * .003;
      const pitch = THREE.MathUtils.clamp(camera.rotation.x - dy * .003, -Math.PI / 2, Math.PI / 2);
      camera.rotation.set(pitch, 0, 0, 'YXZ');
    });
    const release = () => { this.pointer = null; element.classList.remove('dragging'); };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(name, release);
    host.addEventListener('blur', release);
  }

  get motionActive() { return this.mode === 'motion' && this.motionReady && !this.xr; }

  async enableMotion() {
    if (this.pending || this.xr) return;
    const api = this.host.DeviceOrientationEvent;
    if (!this.host.isSecureContext || !api) {
      this.onChange('drag', this.host.isSecureContext ? 'Motion is unavailable here. Drag to look around.' : 'Open the HTTPS link to use phone motion. You can still drag.');
      return;
    }
    const request = ++this.request;
    this.pending = true; this.onChange('pending', 'Allow motion access to look around with your phone.');
    try {
      // iOS requires this call directly inside the button's user gesture.
      const permission = typeof api.requestPermission === 'function' ? await api.requestPermission() : 'granted';
      if (request !== this.request) return;
      if (permission !== 'granted') {
        this.onChange('drag', 'Motion access was not allowed. You can drag, or enable motion access in your browser settings.');
        return;
      }
      this.mode = 'motion'; this.motionReady = false; this.pointer = null;
      this.element.classList.remove('dragging');
      this.host.addEventListener('deviceorientation', this.onOrientation);
      this.onChange('waiting', 'Move your phone to start looking around.');
      this.timer = this.host.setTimeout(() => {
        if (!this.motionReady) this.useDrag('No motion data received. Drag to look around, or try phone motion again.');
      }, 5000);
    } catch {
      if (request === this.request) this.useDrag('Motion could not start. Drag to look around, or try again.');
    } finally {
      if (request === this.request) this.pending = false;
    }
  }

  useDrag(message = 'Drag to look around.') {
    ++this.request; this.pending = false;
    this.host.removeEventListener('deviceorientation', this.onOrientation);
    this.host.clearTimeout(this.timer);
    if (this.motionActive) {
      // Move the local heading into the rig before returning to pitch-only drag.
      const angles = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.rig.rotation.y += angles.y;
      this.camera.rotation.set(THREE.MathUtils.clamp(angles.x, -Math.PI / 2, Math.PI / 2), 0, 0, 'YXZ');
    }
    this.mode = 'drag'; this.motionReady = false;
    this.onChange('drag', message);
  }

  recenter() {
    if (!this.motionActive) return;
    this.offset.copy(this.sensor).invert();
    this.camera.quaternion.identity();
  }

  setXR(active) {
    this.pointer = null; this.element.classList.remove('dragging');
    if (active) this.savedCamera.copy(this.camera.quaternion);
    else this.camera.quaternion.copy(this.savedCamera);
    this.xr = active;
  }

  update() {
    if (this.motionActive) this.camera.quaternion.copy(this.offset).multiply(this.sensor);
  }
}
