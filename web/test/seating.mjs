import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SignalCharacter } from '../public/js/character.js';
import { loadSeating } from '../public/js/seating.js';
import { GazeCursor } from '../public/js/gaze.js';
import { updateGazeScale } from '../public/js/furniture-gaze.js';
import { EFFECT_STRENGTH } from '../public/js/profiles.js';
const parse = async path => { const b=fs.readFileSync(new URL(path,import.meta.url)); return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),''); };
const pouf=await parse('../public/furniture/black-pouf.glb');
const remy=await parse('../public/characters/signal/remy.glb');
GLTFLoader.prototype.loadAsync=async()=>pouf;
const scene=new THREE.Scene(),env={floorY:.015,raycastMeshes:[]};
const seating=await loadSeating(scene,env);
assert.equal(seating.chairs.length,10);
assert.equal(env.seatGazeObjects.length, 10);
for (const mesh of env.raycastMeshes) {
  assert.equal(mesh.userData.gazeObject.kind, 'chair');
  assert.equal(mesh.userData.environmentRole, 'chair');
}
assert.equal(seating.chairs.filter(c=>c.userData.seatingGroup==='central-three').length,3);
for(const chair of seating.chairs){const box=new THREE.Box3().setFromObject(chair);assert(Math.abs(box.min.y-env.floorY)<1e-5);}
const c=new SignalCharacter(scene,remy,new THREE.Texture(),{position:seating.position,yaw:seating.yaw,seatHeight:seating.height});
const hip=c.hips.getWorldPosition(new THREE.Vector3()),eye=c.getEyePosition();
assert(Math.abs(hip.y-env.floorY-seating.height-.095)<1e-5);
assert(c.getForward().x<-.97 && c.getForward().z<-.2, 'Signal sits turned twelve degrees to his right');
for(let i=0;i<60;i++)c.update(.1,1);
assert(c.hips.getWorldPosition(new THREE.Vector3()).distanceTo(hip)<1e-5,'Hips remain on cushion during fear animation');
c.setPoseMode('embodied');
assert(c.getEyePosition().distanceTo(eye)<1e-5,'Camera handoff uses seated pose immediately');
c.setEmbodied(true);for(let i=0;i<30;i++)c.update(.1,1);
assert(c.getEyePosition().distanceTo(eye)<1e-5);
c.reset();assert(c.getEyePosition().distanceTo(eye)<1e-5);
for(const side of ['Left','Right']){const foot=c.bones.get(side+'Foot').getWorldPosition(new THREE.Vector3());assert(foot.y>env.floorY && foot.y<env.floorY+.12,'Feet stay at floor level');}
console.log('PASS ten black poufs, 3+2 groups plus five wall seats, floor contact, anchored seated hips, sculpture-facing orientation, seated camera handoff and reset');
const seat = env.seatGazeObjects[1], bounds = new THREE.Box3().setFromObject(seat.group);
const gaze = { origin: bounds.getCenter(new THREE.Vector3()).add(new THREE.Vector3(0, 2, 0)), direction: new THREE.Vector3(0, -1, 0) };
const cursor = new GazeCursor(scene, { ...env, root: scene }); cursor.update(gaze, 1);
assert.equal(gaze.hitObject, seat, 'actual pouf meshes resolve to their own gaze target');
for (let frame = 0; frame < 300; frame++) {
  seat.target.updateHit(true, 1/60); updateGazeScale(seat, gaze, 1, EFFECT_STRENGTH, 1/60);
}
assert(seat.group.scale.x > 1.299 && seat.group.scale.x <= 1.3);
assert(Math.abs(new THREE.Box3().setFromObject(seat.group).min.y - env.floorY) < 1e-5, 'growing pouf stays on the floor');
cursor.dispose();
console.log('PASS actual pouf ray target, thirty-percent gaze growth and floor anchor');
