import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadEnvironment, makeFxUniforms, updateEnvironmentGeometry } from '../public/js/environment.js';
import { loadRearSculpture } from '../public/js/sculpture.js';
import { loadSeating } from '../public/js/seating.js';
import { SignalCharacter } from '../public/js/character.js';
import { VisitorNavigation } from '../public/js/visitor-navigation.js';
import { RoomExploration } from '../public/js/exploration.js';
import { EmbodimentJourney } from '../public/js/experience.js';
import { loadVisitors } from '../public/js/visitors.js';

GLTFLoader.prototype.loadAsync = async function (url) {
  const b = fs.readFileSync(new URL('../public' + url, import.meta.url));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(() => ({
    name: 'NODE_TEXTURE_DECODER', loadTexture: () => Promise.resolve(new THREE.Texture()),
  })).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
const scene = new THREE.Scene(), fx = makeFxUniforms();
const config = JSON.parse(fs.readFileSync(new URL('../public/environments/brutalist/env.json', import.meta.url)));
const env = await loadEnvironment('/environments/brutalist/', config, scene, fx);
await loadRearSculpture(env, fx);
const seating = await loadSeating(scene, env);
const character = new SignalCharacter(scene, await new GLTFLoader().loadAsync('/characters/signal/remy.glb'), new THREE.Texture(),
  { position: seating.position, yaw: seating.yaw, seatHeight: seating.height });
fx.uCenter.value.set(seating.position.x, seating.position.z);
const visitors = { navigation: new VisitorNavigation(env, fx, seating, character), visitors: [] };
const camera = new THREE.PerspectiveCamera(70, 16 / 9, .05, 80), rig = new THREE.Group();
camera.position.y = 1.6; rig.add(camera); scene.add(rig);
const renderer = { xr: { isPresenting: false } }, panel = { mesh: { visible: false }, placeInFront() {} };
let tracked = false;
const exploration = new RoomExploration({ scene, camera, rig, renderer, env, character, visitors, panel, isTracked: () => tracked });
const journey = new EmbodimentJourney({ scene, camera, rig, renderer, env, character, panel, exploration });
const session = { phase: 'observing', phaseTime: 0, phaseDuration: 12 };
function frame(dt = .1) { journey.update(dt, session); scene.updateMatrixWorld(true); character.update(dt, .3); }
frame();
assert(exploration.stops.length >= 3, 'The real room supplies multiple clear tour viewpoints');
assert.notEqual(exploration.navigation.obstacles, visitors.navigation.obstacles, 'Viewer navigation must not overwrite crowd obstacles');
let distance = 0;
for (let i = 0; i < 900; i++) {
  if (i === 120) { session.phase = 'embodying'; session.phaseDuration = 4; }
  if (i === 160) session.phase = 'running';
  const before = exploration.position.clone(); frame(); distance += before.distanceTo(exploration.position);
  assert(exploration.navigation.clear(exploration.position), `Clear floor throughout guided travel, frame ${i}`);
  assert.equal(character.embodied, false, 'The guided tour never hides the head or enters the body');
  assert(character.scribble.group.visible, 'Anxiety line is always visible');
}
assert(distance > 5, `The guide travels through the room (${distance.toFixed(2)}m)`);
exploration.guided = false; frame();
const paused = rig.position.clone();
for (let i = 0; i < 20; i++) frame();
assert(rig.position.distanceTo(paused) < 1e-8, 'Pause stops the tour and bobbing');
const beforeTeleport = exploration.position.clone();
assert(exploration.nextStop(), 'One-button teleport finds another clear viewpoint');
assert(exploration.position.distanceTo(beforeTeleport) > .8);
const landing = exploration.position.clone();
assert(!exploration.teleport(new THREE.Vector3(999, env.floorY, 999)), 'Outside-room teleport is rejected');
assert(!exploration.teleport(character.root.position), 'Landing inside Signal is rejected');
assert(exploration.position.equals(landing), 'Invalid teleport does not move the viewer');
const ray = new THREE.Raycaster(new THREE.Vector3(landing.x, env.floorY + 1.6, landing.z), new THREE.Vector3(0, -1, 0));
assert(exploration.pick(ray), 'A visible clear floor patch can be selected');
panel.mesh.visible = true;
assert(!exploration.teleport(exploration.navigation.toWorld(exploration.stops[0])), 'Menus suppress locomotion');
assert.equal(exploration.pick(ray), null);
panel.mesh.visible = false;

// All surviving waypoints also work with the room at maximum contraction.
fx.uLeanK.value = .12; updateEnvironmentGeometry(env, fx); exploration.refresh();
for (const stop of exploration.stops.filter(p => exploration.navigation.clear(p))) {
  assert(exploration.teleport(exploration.navigation.toWorld(stop)), 'Teleport follows the contracted room coordinates');
  frame();
  const world = exploration.navigation.toWorld(exploration.position), eye = camera.getWorldPosition(new THREE.Vector3());
  assert(Math.hypot(world.x - eye.x, world.z - eye.z) < 1e-7);
}

// Trackers retain head orientation and physical translation; the guide owns only the rig.
tracked = true; renderer.xr.isPresenting = true;
camera.position.set(.2, 1.7, -.1); camera.rotation.set(.15, .6, -.05);
frame(); assert.equal(exploration.guided, false, 'VR enters stationary; floating is opt-in');
const orientation = camera.quaternion.clone(), rigBefore = rig.position.clone();
camera.position.x += .2; frame();
assert(camera.quaternion.angleTo(orientation) < 1e-7, 'Floating never overwrites headset orientation');
assert(rig.position.distanceTo(rigBefore) < 1e-7, 'Real head movement is not cancelled by rig compensation');
assert.equal(camera.position.x, .4);
session.phase = 'breathing'; frame(); const calmPosition = rig.position.clone();
exploration.keys.add('KeyW'); exploration.impulse.set(1, 1); frame();
assert(rig.position.equals(calmPosition), 'Calm stops all floating and manual travel');
assert.equal(exploration.keys.size, 0);
assert.equal(exploration.enabled, false);
console.log(`PASS exploration: ${exploration.stops.length} real-gallery viewpoints, ${distance.toFixed(1)}m guided travel, free look, pause, floor picking, rejected landings, contraction, live XR pose, Calm cancellation.`);

// Repeat with the live crowd, so its personal-space obstacles participate too.
fx.uLeanK.value = 0; updateEnvironmentGeometry(env, fx);
const crowd = await loadVisitors(scene, env, fx, seating, character);
exploration.visitors = crowd; exploration.navigation = exploration.createNavigation();
tracked = false; renderer.xr.isPresenting = false; camera.position.set(0, 1.6, 0);
session.phase = 'observing'; exploration.guided = true; frame();
let crowdDistance = 0;
for (let i = 0; i < 600; i++) {
  const before = exploration.position.clone();
  frame(); crowdDistance += before.distanceTo(exploration.position);
  crowd.update(.1, camera.getWorldPosition(new THREE.Vector3()));
}
assert(crowdDistance > 2, `The tour progresses among the live crowd (${crowdDistance.toFixed(2)}m)`);
exploration.keys.add('KeyQ'); const oldHeight = exploration.height; frame();
assert(exploration.height < oldHeight, 'Manual control changes floating height');
assert(exploration.hold > 3, 'Manual input temporarily yields the guide');
exploration.clearInput(); for (let i = 0; i < 45; i++) frame();
assert.equal(exploration.hold, 0, 'Guidance resumes after the visitor releases control');
assert.equal(exploration.guided, true);
console.log(`PASS exploration with ${crowd.visitors.length} live visitors: ${crowdDistance.toFixed(1)}m travel; manual height and automatic guide resumption.`);
exploration.active = false; journey.phase = null; session.phase = 'running'; frame();
assert.equal(journey.embodied, true, 'His viewpoint still enters the body when explicitly chosen');
exploration.active = true; journey.phase = null; frame();
assert.equal(journey.embodied, false, 'Return to floating restores the full character');
assert(camera.getWorldPosition(new THREE.Vector3()).distanceTo(character.getEyePosition()) > 1.8);
console.log('PASS explicit viewpoint switching: original embodiment and return to third-person exploration.');

// Looking away remains possible through movement and teleportation.
exploration.guided = false;
const beforeLook = camera.getWorldQuaternion(new THREE.Quaternion());
assert(exploration.steer(900, 100));
const freeLook = camera.getWorldQuaternion(new THREE.Quaternion());
assert(beforeLook.angleTo(freeLook) > 1, 'Dragging freely turns away from Signal');
for (let i = 0; i < 60; i++) frame();
assert(camera.getWorldQuaternion(new THREE.Quaternion()).angleTo(freeLook) < 1e-7, 'Frames never pull the camera back toward Signal');
assert(exploration.nextStop());
assert(camera.getWorldQuaternion(new THREE.Quaternion()).angleTo(freeLook) < 1e-7, 'Teleport preserves the chosen view');
console.log('PASS free exploration: drag turns freely and orientation survives updates and teleportation.');

// Exercise the button's cinematic path, including cancellation and comfort mode.
const floatingPosition = rig.position.clone(), floatingRotation = camera.getWorldQuaternion(new THREE.Quaternion());
session.phase = 'running';
journey.switchView(session);
assert(journey.viewTransition && !exploration.enabled);
journey.switchView(session); // Repeated input must not reverse a handoff.
assert.equal(exploration.active, false);
frame(.1);
assert(rig.position.distanceTo(floatingPosition) < .02, 'Departure eases in');
for (let i = 0; i < 30; i++) frame(.1);
assert.equal(journey.viewTransition, null);
assert.equal(journey.embodied, true);
assert(camera.getWorldPosition(new THREE.Vector3()).distanceTo(character.getEyePosition()) < .03, 'Cinematic landing reaches actual eye geometry');
journey.switchView(session);
for (let i = 0; i < 28; i++) frame(.1);
assert.equal(journey.embodied, false);
assert(camera.getWorldQuaternion(new THREE.Quaternion()).angleTo(floatingRotation) < 1e-6, 'Return restores floating orientation');
assert(rig.position.distanceTo(floatingPosition) < .03, 'Return restores floating location');
exploration.reducedMotion = true;
journey.switchView(session); const comfortStart = rig.position.clone();
frame(.1); frame(.1);
assert(rig.position.equals(comfortStart), 'Reduced motion fades without camera travel');
session.phase = 'breathing'; frame();
assert.equal(journey.viewTransition, null); assert.equal(journey.fade.visible, false);
for (let i = 0; i < 30; i++) frame();
assert(rig.position.equals(comfortStart), 'Calm cancels any pending relocation');
console.log('PASS cinematic viewpoint transitions: eased departure, eye contact, return pose, repeat guard, reduced motion, cancellation.');
