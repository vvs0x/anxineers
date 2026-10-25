import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LookControls, orientationQuaternion } from '../public/js/look-controls.js';

const close = (a, b) => assert(a.angleTo(b) < 1e-7, `Quaternion mismatch: ${a.toArray()} / ${b.toArray()}`);
function setup(permission = 'granted') {
  const host = new EventTarget();
  Object.assign(host, { isSecureContext: true, screen: { orientation: { angle: 0 } }, DeviceOrientationEvent: { requestPermission: async () => permission }, setTimeout: fn => (host.timeout = fn), clearTimeout: () => { host.timeout = null; } });
  const element = new EventTarget(); element.classList = { add() {}, remove() {} };
  const camera = new THREE.PerspectiveCamera(), rig = new THREE.Group(); rig.add(camera);
  camera.rotation.order = 'YXZ'; camera.position.y = 1.6;
  let change;
  const controls = new LookControls({ camera, rig, element, host, onChange: (mode, message) => { change = { mode, message }; } });
  const send = (target, type, values) => target.dispatchEvent(Object.assign(new Event(type), values));
  const orient = (alpha, beta = 90, gamma = 0) => { send(host, 'deviceorientation', { alpha, beta, gamma }); controls.update(); };
  const pointer = (type, x, y = 0) => send(element, type, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
  return { host, camera, rig, controls, orient, pointer, change: () => change };
}

test('upright phone, heading, tilt, and screen rotation map to camera axes', () => {
  close(orientationQuaternion(0, 90, 0), new THREE.Quaternion());
  close(orientationQuaternion(90, 90, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
  close(orientationQuaternion(0, 135, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 4));
  for (const angle of [-90, 90, 180]) close(orientationQuaternion(0, 90, 0, angle), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -THREE.MathUtils.degToRad(angle)));
});

test('laptop look moves only during drag and stops on cancel or blur', () => {
  const h = setup(); h.pointer('pointermove', 100); assert.equal(h.rig.rotation.y, 0);
  h.pointer('pointerdown', 100); h.pointer('pointermove', 200, 100);
  assert.equal(h.rig.rotation.y, -.3); assert.equal(h.camera.rotation.x, -.3);
  h.pointer('pointercancel', 200); h.pointer('pointermove', 400); assert.equal(h.rig.rotation.y, -.3);
  h.pointer('pointerdown', 0); h.host.dispatchEvent(new Event('blur')); h.pointer('pointermove', 400); assert.equal(h.rig.rotation.y, -.3);
});

test('permission, calibration, phone turning, recenter and drag fallback preserve position', async () => {
  const h = setup(); await h.controls.enableMotion(); h.orient(40);
  close(h.camera.quaternion, new THREE.Quaternion()); assert.equal(h.controls.motionActive, true);
  h.orient(130); close(h.camera.quaternion, orientationQuaternion(90, 90, 0));
  assert.deepEqual(h.camera.position.toArray(), [0, 1.6, 0]);
  h.controls.recenter(); h.controls.update(); close(h.camera.quaternion, new THREE.Quaternion());
  h.orient(160); const world = h.camera.getWorldQuaternion(new THREE.Quaternion());
  h.controls.useDrag(); close(h.camera.getWorldQuaternion(new THREE.Quaternion()), world);
  h.orient(190); close(h.camera.getWorldQuaternion(new THREE.Quaternion()), world);
});

test('denied, insecure, missing and silent sensors leave usable drag controls', async () => {
  for (const kind of ['denied', 'insecure', 'missing', 'silent']) {
    const h = setup(kind === 'denied' ? 'denied' : 'granted');
    if (kind === 'insecure') h.host.isSecureContext = false;
    if (kind === 'missing') delete h.host.DeviceOrientationEvent;
    await h.controls.enableMotion();
    if (kind === 'silent') { h.orient(null, null, null); assert.equal(h.controls.motionReady, false); h.host.timeout(); }
    assert.equal(h.controls.mode, 'drag'); assert.equal(h.change().mode, 'drag');
    h.pointer('pointerdown', 0); h.pointer('pointermove', 100); assert.equal(h.rig.rotation.y, -.3);
  }
});

test('Android-style events need no permission method and headset tracking has exclusive control in VR', async () => {
  const h = setup(); h.host.DeviceOrientationEvent = {}; await h.controls.enableMotion();
  h.orient(0); h.controls.setXR(true);
  const tracked = new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, .4, -.1)); h.camera.quaternion.copy(tracked);
  h.orient(90); h.pointer('pointerdown', 0); h.pointer('pointermove', 100);
  close(h.camera.quaternion, tracked); assert.equal(h.rig.rotation.y, 0);
  h.controls.setXR(false); h.controls.update(); close(h.camera.quaternion, orientationQuaternion(90, 90, 0));
});

test('a late permission result cannot undo a return to drag', async () => {
  const h = setup(); let resolve;
  h.host.DeviceOrientationEvent.requestPermission = () => new Promise(r => { resolve = r; });
  const pending = h.controls.enableMotion(); h.controls.useDrag(); resolve('granted'); await pending;
  assert.equal(h.controls.mode, 'drag'); assert.equal(h.controls.pending, false);
});
