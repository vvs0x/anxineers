import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadEnvironment, makeFxUniforms, updateEnvironmentGeometry } from '../public/js/environment.js';
import { loadRearSculpture } from '../public/js/sculpture.js';
import { loadSeating } from '../public/js/seating.js';
import { SignalCharacter } from '../public/js/character.js';
import { AnxietyDirector } from '../public/js/director.js';
import { PROFILES } from '../public/js/profiles.js';
import { Effects } from '../public/js/effects.js';
import { GazeCursor } from '../public/js/gaze.js';
import { WallCollisionSystem } from '../public/js/wall-collisions.js';

// Exercise the production GLB's exact meshes, materials, hierarchy and BVH.
// Only bitmap decoding is replaced because this geometry test has no GPU/DOM.
GLTFLoader.prototype.loadAsync = async function (url) {
  const b = fs.readFileSync(new URL('../public' + url, import.meta.url));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(() => ({
    name: 'NODE_TEXTURE_DECODER', loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  return loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};

const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-5,
  `${message}: ${actual} != ${expected}`);
const config = JSON.parse(fs.readFileSync(new URL('../public/environments/brutalist/env.json', import.meta.url)));
assert.equal(config.file, 'room-baked.glb', 'Audit the active baked gallery');
const scene = new THREE.Scene(), fx = makeFxUniforms();
const env = await loadEnvironment('/environments/brutalist/', config, scene, fx);
// The entire authored panel primitive must remain one fixed ceiling. Previously
// 33,240 small triangles moved as walls while only 428 large triangles stayed
// with the ceiling, tearing visible triangular holes through the same slab.
const authored = (await new GLTFLoader().loadAsync('/environments/brutalist/' + config.file)).scene;
const originalPanels = authored.getObjectByName('Plane008_1');
const ceilingPanels = env.roomMeshes.find(mesh => mesh.name === 'Plane008_1');
assert(originalPanels && ceilingPanels, 'Actual authored ceiling panel primitive is present');
assert.equal(ceilingPanels.userData.environmentRole, 'ceiling');
assert.equal(ceilingPanels.geometry.index?.count ?? ceilingPanels.geometry.attributes.position.count,
  originalPanels.geometry.index?.count ?? originalPanels.geometry.attributes.position.count,
  'All ceiling panel triangles and bevels stay together, independent of triangle size');
assert(!env.roomMeshes.some(mesh => mesh.name === 'Plane008_1 ceiling'), 'No partial ceiling triangle split remains');
assert(env.roomMeshes.filter(mesh => mesh.userData.environmentRole === 'ceiling')
  .every(mesh => mesh.geometry.boundingBox.min.y > 3.55), 'Lower wall lintels remain attached to moving walls');
const sculpture = await loadRearSculpture(env, fx), seating = await loadSeating(scene, env);
const character = new SignalCharacter(scene, await new GLTFLoader().loadAsync('/characters/signal/remy.glb'),
  new THREE.Texture(), { position: seating.position, yaw: seating.yaw, seatHeight: seating.height });
character.setPoseMode('embodied');
const seatedEye = character.getEyePosition();
const camera = new THREE.PerspectiveCamera(); camera.position.copy(seatedEye); scene.add(camera);
const director = new AnxietyDirector(PROFILES.Education_Light);
director.setCap(1); director.intensity = 0; director.setState('Calm');
// A previously saturated channel must neither lower the ceiling nor mask outward travel.
director.smoothed.Space = 1;
const effects = new Effects(scene, director, env, fx, camera, config.strength);
fx.uCenter.value.set(seating.position.x, seating.position.z);
scene.updateMatrixWorld(true);
const cursor = new GazeCursor(scene, env);
const gaze = { origin: seatedEye.clone(), direction: new THREE.Vector3(-1, 0, 0) };
const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
const direction = {
  west: new THREE.Vector3(-1, 0, 0), north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0),
};
const poses = {
  seated: seatedEye,
  observer: new THREE.Vector3(config.spawn.x, env.floorY + 1.88, config.spawn.z),
};
function visibleHit(origin, heading) {
  ray.set(origin, heading);
  return ray.intersectObjects(env.raycastMeshes, false).find(hit => {
    for (let node = hit.object; node; node = node.parent) if (!node.visible) return false;
    const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
    const material = materials[hit.face?.materialIndex || 0];
    return material?.visible !== false && !(material?.transparent && material.opacity < .15);
  });
}
function snapshot() {
  return Object.fromEntries(Object.entries(poses).map(([name, origin]) => [name,
    Object.fromEntries(Object.entries(direction).map(([heading, vector]) => {
      const hit = visibleHit(origin, vector);
      assert(hit, `${name} ${heading}: actual gallery surface must be visible`);
      return [heading, { mesh: hit.object, point: hit.point.clone(), distance: hit.distance }];
    })),
  ]));
}
function frames(count, heading) {
  gaze.direction.copy(direction[heading]);
  for (let i = 0; i < count; i++) { cursor.update(gaze, 1 / 60); effects.update(1 / 60, gaze); }
}

// The authored walls.panels.001 contains both vertical concrete and a ceiling
// primitive. The real triangle normal must distinguish them for gaze dwell.
gaze.direction.copy(direction.up); cursor.update(gaze, 1);
assert.equal(gaze.hitRole, 'ceiling', 'Looking up at the actual horizontal ceiling must not count as looking at a wall');
assert.equal(gaze.hitMesh.userData.sourceObject, 'walls.panels.001');
frames(90, 'up'); close(fx.uLeanK.value, 0, 'Calm overview never starts wall contraction');
gaze.direction.copy(direction.west); cursor.update(gaze, 1);
assert.equal(gaze.hitRole, 'wall', 'The same authored object has actual vertical wall faces');
assert.equal(gaze.hitMesh.userData.sourceObject, 'walls.panels.001');

director.intensity = 1; director.setState('Peak');
const before = snapshot();
const verticalBounds = env.roomMeshes.map(mesh => new THREE.Box3().setFromObject(mesh));
const positionVersions = env.roomMeshes.map(mesh => mesh.geometry.attributes.position.version);
frames(240, 'west');
close(director.level, 1, 'The measured movement happens at full anxiety');
close(fx.uLeanK.value, .3, 'One second gaze followed by three seconds reaches the inward peak');
close(fx.uDrop.value, 0, 'Ceiling never drops at peak');
const peak = snapshot(), report = [];
assert.equal(env.wallCollisions.bodies.length, env.objectGroups.length + seating.chairs.length,
  'Effects registers every real sculpture, pedestal and all eleven seats with its collision solver');
assert(!env.wallCollisions.get(seating.chairs[0]).fixed, 'Occupied seats slide on wall contact');
for (const body of env.wallCollisions.bodies) {
  const bounds = new THREE.Box3().setFromObject(body.object).expandByScalar(-.001);
  for (const wall of env.roomMeshes.filter(mesh => mesh.userData.environmentRole === 'wall')) {
    assert(!wall.geometry.boundsTree.intersectsBox(bounds, new THREE.Matrix4().copy(wall.matrixWorld).invert()),
      `Effects integration: ${body.object.name} crosses actual ${wall.name} triangles`);
  }
}
for (const [name] of Object.entries(poses)) {
  for (const heading of ['west', 'north', 'south']) {
    const a = before[name][heading], b = peak[name][heading];
    assert.equal(b.mesh, a.mesh, `${name} ${heading}: compare the same visible authored wall`);
    close(b.point.y, a.point.y, `${name} ${heading}: wall ray stays at viewer eye height`);
    const inward = a.distance - b.distance;
    assert(inward > (heading === 'west' ? 1 : heading === 'north' ? .5 : .1), `${name} ${heading}: visible inward displacement (${inward}m)`);
    report.push(`${name} ${heading} ${(inward * 100).toFixed(1)}cm`);
  }
  assert(peak[name].up.point.distanceTo(before[name].up.point) < 1e-5, `${name}: actual visible ceiling stays fixed`);
}
env.roomMeshes.forEach((mesh, i) => {
  const b = new THREE.Box3().setFromObject(mesh),role=mesh.userData.environmentRole;
  if(['floor','ceiling','light','exterior'].includes(role)){
    assert(b.equals(verticalBounds[i]), `${role}: entire surface stays fixed in all axes`);
  }else{
    close(b.min.y,verticalBounds[i].min.y,'Wall bottom stays at its authored height');
    close(b.max.y,verticalBounds[i].max.y,'Wall top stays at its authored height');
  }
});
assert.deepEqual(env.roomMeshes.map(mesh => mesh.geometry.attributes.position.version), positionVersions,
  'Contraction uses mesh transforms without vertex buffer uploads');
assert(env.objectGroups.includes(sculpture), 'The added Nike sculpture participates in rigid object transport');
assert(sculpture.group.position.x < sculpture.base.x, 'The real added sculpture moves inward with the gallery');

// Hold through both blackouts, then start the outward half from maximum.
effects.blackout.elapsed=56;effects.blackout.runId=0;
for(let i=0;i<180;i++){effects.blackout.elapsed+=1/60;frames(1,'up');} close(fx.uLeanK.value, 0, 'The outward half completely restores the footprint');
const restored = snapshot();
for (const name of Object.keys(poses)) for (const heading of Object.keys(direction)) {
  assert(restored[name][heading].point.distanceTo(before[name][heading].point) < 1e-5,
    `${name} ${heading}: actual gallery ray returns to the original visible surface`);
}
for(let i=0;i<180;i++){effects.blackout.elapsed+=1/60;frames(1,'up');} close(fx.uLeanK.value, .3, 'Cycle repeats without a second wall gaze');
director.setState('Recovery'); frames(121, 'up');
close(fx.uLeanK.value, 0, 'Recovery releases actual gallery transforms');
close(fx.uDrop.value, 0, 'Recovery also preserves ceiling height');
console.log('PASS actual textured gallery at 100% anxiety:', report.join('; ') + '.');
console.log(`Seated eye ${seatedEye.toArray().map(x => x.toFixed(3)).join(', ')}; visible ceiling ${before.seated.up.point.y.toFixed(3)}m; stays fixed at peak. Real wall/ceiling roles, repeat/outward/recovery and sculpture transport verified.`);

// Independent contact audit against the actual wall triangles. Keep furniture
// at its authored rest position until a moving wall or another body contacts it.
for (const object of env.objectGroups) { object.group.position.copy(object.base); object.group.scale.setScalar(1); }
scene.updateMatrixWorld(true);
const contacts = new WallCollisionSystem(env, fx);
for (const object of env.objectGroups) contacts.add(object.group, { base: object.base });
seating.chairs.forEach((chair, i) => contacts.add(chair, { fixed: i === 0 }));
const rest = new Map(contacts.bodies.map(body => [body.object, body.object.getWorldPosition(new THREE.Vector3())]));
const roomWalls = env.roomMeshes.filter(mesh => mesh.userData.environmentRole === 'wall');
function verifySolidContacts(label) {
  scene.updateMatrixWorld(true);
  for (const body of contacts.bodies) {
    const bounds = new THREE.Box3().setFromObject(body.object);
    close(bounds.min.y, body.base.y + body.bottom * Math.abs(body.object.scale.y / body.startScale.y), `${label} ${body.object.name}: floor anchor`);
    // Leave 1mm of tolerance at authored boundaries, but no solver-derived
    // gap/contact values: query the production BVHs against world bounds.
    bounds.expandByScalar(-.001);
    for (const wall of roomWalls) assert(!wall.geometry.boundsTree.intersectsBox(bounds, new THREE.Matrix4().copy(wall.matrixWorld).invert()),
      `${label}: ${body.object.name} crosses actual ${wall.name} triangles`);
  }
  assert(seating.chairs[0].getWorldPosition(new THREE.Vector3()).distanceTo(rest.get(seating.chairs[0])) < 1e-5,
    `${label}: occupied seat stays fixed at the embodiment pivot`);
}
function collisionFrame(k) {
  fx.uLeanK.value = k; updateEnvironmentGeometry(env, fx); contacts.update(1 / 60);
}
collisionFrame(0); verifySolidContacts('calm');
for (const body of contacts.bodies) assert(body.object.getWorldPosition(new THREE.Vector3()).distanceTo(rest.get(body.object)) < 1e-5,
  `${body.object.name}: no calm teleport`);
for (let frame = 1; frame <= 180; frame++) {
  collisionFrame(.12 * (.5 - .5 * Math.cos(Math.PI * frame / 180)));
  if (frame % 15 === 0) verifySolidContacts('inward ' + frame);
}
const pushes = contacts.bodies.map(body => ({ name: body.object.name,
  metres: body.object.getWorldPosition(new THREE.Vector3()).distanceTo(rest.get(body.object)),
})).filter(body => body.metres > .01);
assert(pushes.some(body => body.metres > .5), 'Real wall-adjacent furniture is pushed by at least half a metre');
assert(sculpture.group.getWorldPosition(new THREE.Vector3()).distanceTo(rest.get(sculpture.group)) < 1e-5,
  'Uncontacted Nike sculpture stays in place instead of sliding with the floor');
for (const object of [...env.objectGroups, ...env.seatGazeObjects]) {
  const growth = object.gazeGrowth === false ? 0 : object.kind === 'chair' ? .3 : object.kind === 'table' ? .08 : .2;
  object.group.scale.setScalar(1 + growth);
  if (object.occupied) object.group.scale.y = 1;
  for (let frame = 0; frame < 30; frame++) collisionFrame(.12);
  verifySolidContacts(`${Math.round(growth * 100)}% growth ${object.group.name}`);
  object.group.scale.setScalar(1);
  for (let frame = 0; frame < 30; frame++) collisionFrame(.12);
}
for (let frame = 1; frame <= 180; frame++) {
  collisionFrame(.12 * (.5 + .5 * Math.cos(Math.PI * frame / 180)));
  if (frame % 15 === 0) verifySolidContacts('outward ' + frame);
}
for (let frame = 0; frame < 240; frame++) collisionFrame(0);
verifySolidContacts('restored');
for (const body of contacts.bodies) assert(body.object.getWorldPosition(new THREE.Vector3()).distanceTo(rest.get(body.object)) < 1e-4,
  `${body.object.name}: returns to its original position after outward travel`);
console.log('PASS actual wall/furniture contact:', JSON.stringify(pushes.map(body => ({ ...body, metres: +body.metres.toFixed(3) }))),
  `${contacts.bodies.length} real bodies; ${contacts.stats.wallTriangles} source wall triangles; ${contacts.stats.cachedContacts} cached contact intervals; all individual chair/table/sculpture growth cases clear of actual wall triangles; occupied seat fixed; calm positions restored.`);
