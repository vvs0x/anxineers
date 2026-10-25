import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EmbodimentJourney } from '../public/js/experience.js';
import { Session } from '../public/js/session.js';
import { AnxietyDirector } from '../public/js/director.js';

function setup({ xr = false, motion = false } = {}) {
  const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  scene.add(rig); rig.add(camera);
  const trackingPosition = new THREE.Vector3(.3, 1.72, -.2), trackingRotation = new THREE.Quaternion();
  const xrCamera = new THREE.ArrayCamera(); xrCamera.cameras = [new THREE.PerspectiveCamera()];
  const renderer = { xr: { isPresenting: xr, getCamera: () => xrCamera, updateCamera: cam => {
    rig.updateMatrixWorld(true); cam.position.copy(trackingPosition); cam.quaternion.copy(trackingRotation); cam.updateMatrixWorld(true);
    xrCamera.matrixWorld.copy(cam.matrixWorld);
  } } };
  const eye = new THREE.Vector3(-1.1, 1.7, 2.1);
  const character = { embodied: false, resetCount: 0, reset() { this.embodied = false; this.resetCount++; }, setPoseMode(mode) { this.poseMode = mode; }, setEmbodied(v) { this.embodied = v; }, getEyePosition(out) { return out.copy(eye); }, getForward(out) { return out.set(1, 0, 0); } };
  const panel = { mesh: { visible: false }, show(model) { this.model = model; this.mesh.visible = true; }, hide() { this.mesh.visible = false; this.model = null; }, setStatus(text) { if (this.model) this.model.status = text; }, placeInFront() {}, setOrb() {}, _draw() {} };
  const env = { spawn: { x: 2, z: 2.2, yawDeg: 90 }, floorY: 0 };
  const director = new AnxietyDirector();
  const session = new Session({ observationSeconds:12, director, panel, voice: { available: false, cancel() {} } });
  const motionState = { active: motion };
  const journey = new EmbodimentJourney({ scene, camera, rig, renderer, character, env, panel, isMotionActive: () => motionState.active });
  function frame(dt) {
    scene.updateMatrixWorld(true);
    if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
    session.update(dt); journey.update(dt, session); scene.updateMatrixWorld(true);
    if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
    director.update(dt);
  }
  return { scene, rig, camera, renderer, trackingPosition, character, eye, panel, session, journey, director, frame, motionState };
}
function closeVec(actual, expected, message) { assert(actual.distanceTo(expected) < 1e-8, `${message}: ${actual.toArray()} != ${expected.toArray()}`); }

test('phone tracking remains live during the fade and at the embodied handoff', () => {
  const h = setup({ motion: true });
  h.camera.rotation.set(.2, .4, -.1, 'YXZ');
  const orientation = h.camera.quaternion.clone();
  h.session.startRun(); h.frame(12); h.frame(2.1);
  assert(h.journey.fadeMaterial.uniforms.amount.value > .99);
  assert(h.camera.quaternion.angleTo(orientation) < 1e-7);
  closeVec(h.camera.getWorldPosition(new THREE.Vector3()), h.eye, 'Phone reaches character eye');
  h.camera.rotation.y += .3; const turned = h.camera.quaternion.clone();
  h.frame(1.9); assert.equal(h.session.phase, 'running');
  assert(h.camera.quaternion.angleTo(turned) < 1e-7);
});

test('switching from phone motion to drag during the fade does not jump the camera', () => {
  const h = setup({ motion: true }); h.session.startRun(); h.frame(12); h.frame(1);
  const position = h.rig.position.clone(); h.motionState.active = false; h.frame(.1);
  closeVec(h.rig.position, position, 'Drag transition starts from current position');
  assert.equal(h.journey.fade.visible, false);
  h.frame(3); assert.equal(h.session.phase, 'running');
  closeVec(h.camera.getWorldPosition(new THREE.Vector3()), h.eye, 'Drag still reaches character eye');
});

test('desktop is calm through observation and transition, then starts anxiety inside the body', () => {
  const h = setup(); h.session.startRun(); h.frame(11.9);
  assert.equal(h.session.phase, 'observing'); assert.equal(h.director.intensity, 0); assert.equal(h.journey.embodied, false);
  h.frame(.2); assert.equal(h.session.phase, 'embodying'); assert.equal(h.director.intensity, 0);
  h.frame(3.8); assert.equal(h.session.phase, 'embodying'); assert.equal(h.director.intensity, 0);
  h.frame(.1); assert.equal(h.session.phase, 'running'); assert(h.director.intensity > 0); assert.equal(h.character.embodied, true);
  closeVec(h.camera.getWorldPosition(new THREE.Vector3()), h.eye, 'Camera reaches character eye');
});

test('cancelled desktop transition does not resume or teleport later; replay returns to calm observer', () => {
  const h = setup(); h.session.startRun(); h.frame(12); h.frame(1);
  const stopped = h.rig.position.clone(); h.session.calmNow(); h.frame(.1);
  closeVec(h.rig.position, stopped, 'Cancel keeps current rig');
  h.frame(31); assert.equal(h.session.phase, 'grounding');
  for (let i = 0; i < 5; i++) h.session.pick('next');
  assert.equal(h.session.phase, 'end'); closeVec(h.rig.position, stopped, 'No delayed handoff');
  h.session.pick('again'); h.frame(0);
  assert.equal(h.session.phase, 'consent'); assert.equal(h.journey.embodied, false); assert.equal(h.character.embodied, false);
  closeVec(h.rig.position, h.journey.observer, 'Replay returns to observer'); assert.equal(h.director.intensity, 0);
});

test('VR handoff compensates tracked local head offset without forcing tracked orientation', () => {
  const h = setup({ xr: true }); h.session.startRun(); h.frame(12); h.frame(2.1);
  assert.equal(h.session.phase, 'embodying'); assert.equal(h.journey.embodied, true); assert.equal(h.director.intensity, 0);
  closeVec(h.camera.getWorldPosition(new THREE.Vector3()), h.eye, 'XR head at character eye');
  closeVec(h.camera.position, h.trackingPosition, 'Tracked local position remains untouched');
  assert(h.journey.fadeMaterial.uniforms.amount.value > .99);
});

test('VR physical movement after midpoint handoff is preserved when anxiety begins', () => {
  const h = setup({ xr: true }); h.session.startRun(); h.frame(12); h.frame(2.1);
  const handoffRig = h.rig.position.clone();
  h.trackingPosition.x += .2; h.frame(1);
  const movedHead = h.camera.getWorldPosition(new THREE.Vector3());
  assert(movedHead.distanceTo(h.eye) > .19);
  h.frame(.9); assert.equal(h.session.phase, 'running');
  closeVec(h.rig.position, handoffRig, 'Running must not realign a second time');
  closeVec(h.camera.getWorldPosition(new THREE.Vector3()), movedHead, 'Physical movement stays live');
});

test('Calm Now after VR midpoint leaves the tracked view in place and suppresses anxiety', () => {
  const h = setup({ xr: true }); h.session.startRun(); h.frame(12); h.frame(2.1);
  const handoffRig = h.rig.position.clone(); h.session.calmNow(); h.frame(.1); h.frame(5);
  assert.equal(h.session.phase, 'breathing'); assert.equal(h.director.intensity, 0); assert.equal(h.journey.fade.visible, false);
  closeVec(h.rig.position, handoffRig, 'No cancelled transition jump');
});


test('tracked POV follows sitting body motion without erasing the participant head movement', () => {
  const h=setup({xr:true});h.session.startRun();h.frame(12);
  h.character.openingActive=true;
  const standingEye=h.eye.clone();
  h.character.updateOpening=(elapsed,duration)=>{
    const p=Math.max(0,Math.min(1,(elapsed/duration-.75)/.25));
    h.eye.copy(standingEye).add(new THREE.Vector3(0,-.55*p,0));
    h.character.openingActive=p<1;
  };
  h.frame(2.1);assert(h.journey.embodied);
  const handoffEye=h.eye.clone(),handoffHead=h.camera.getWorldPosition(new THREE.Vector3());
  h.trackingPosition.x+=.2;h.frame(1.9);
  assert.equal(h.session.phase,'running');assert(h.director.intensity>0);
  assert(h.character.openingActive,'Anxiety begins before the sit is complete');
  const expected=handoffHead.clone().add(h.eye.clone().sub(handoffEye)).add(new THREE.Vector3(.2,0,0).applyQuaternion(h.rig.quaternion));
  closeVec(h.camera.getWorldPosition(new THREE.Vector3()),expected,'Tracked movement and body descent add independently');
  h.frame(2);assert.equal(h.character.openingActive,false);
});
