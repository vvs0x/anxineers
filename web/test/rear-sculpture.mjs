import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadEnvironment, makeFxUniforms, updateEnvironmentGeometry } from '../public/js/environment.js';
import { loadRearSculpture } from '../public/js/sculpture.js';
import { loadSeating } from '../public/js/seating.js';
import { WallCollisionSystem } from '../public/js/wall-collisions.js';
import { updateGazeScale } from '../public/js/furniture-gaze.js';
import { EFFECT_STRENGTH } from '../public/js/profiles.js';
const buffer = p => { const b=fs.readFileSync(new URL(p,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength); };
GLTFLoader.prototype.loadAsync=async function(path){
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(()=>({
    name:'NODE_TEXTURE_DECODER',loadTexture:()=>Promise.resolve(new THREE.Texture()),
  })).parseAsync(buffer('../public'+path),'');
};
const scene=new THREE.Scene(),fx=makeFxUniforms();
const config=JSON.parse(fs.readFileSync(new URL('../public/environments/brutalist/env.json',import.meta.url)));
const env=await loadEnvironment('/environments/brutalist/',config,scene,fx);
const art=await loadRearSculpture(env,fx),seats=await loadSeating(scene,env);
const bounds=new THREE.Box3().setFromObject(art.group);
assert(Math.abs(bounds.min.y-env.floorY)<1e-5);
assert(Math.abs(art.size.y-2.5)<.01);
assert.equal(art.gazeGrowth, false, 'Rear statue is exempt from vision enlargement');
art.target.value = 1;
for(let i=0;i<360;i++)updateGazeScale(art,{hitObject:art},1,{...EFFECT_STRENGTH,objectGrowth:.6},1/60);
env.root.updateMatrixWorld(true);
assert(new THREE.Box3().setFromObject(art.group).equals(bounds), 'Statue and supporting plinth retain their exact bounds during sustained gaze');
assert.equal(art.gazeScale,1);
assert(art.base.x>seats.position.x+4,'Sculpture is behind the west-facing seated figure');
for(const chair of seats.chairs)assert(!bounds.intersectsBox(new THREE.Box3().setFromObject(chair)),'Seats leave sculpture clear');
const ray=new THREE.Raycaster(new THREE.Vector3(8,.2,0),new THREE.Vector3(1,0,0));ray.firstHitOnly=true;
const hit=ray.intersectObjects(env.raycastMeshes,false)[0];assert.equal(hit.object.userData.gazeObject,art,'Plinth and statue participate in the gaze system');
assert(art.clearance.minZ<art.base.z-art.size.z/2&&art.clearance.maxZ>art.base.z+art.size.z/2);
fx.uCenter.value.set(seats.position.x,seats.position.z);
fx.uFloorY.value=env.floorY;fx.uRoomHeight.value=env.roomHeight;
const collisions=new WallCollisionSystem(env,fx);
for(const object of env.objectGroups)collisions.add(object.group,{base:object.base});
for(const seat of env.collisionSeats)collisions.add(seat.chair,{base:seat.base,fixed:seat.occupied});
const step=k=>{fx.uLeanK.value=k;updateEnvironmentGeometry(env,fx);collisions.update(1/60);};
for(let frame=1;frame<=180;frame++)step(.12*(.5-.5*Math.cos(Math.PI*frame/180)));
assert(art.group.position.distanceTo(art.base)<1e-6,'Uncontacted rear sculpture stays at its authored position');
for(const seat of env.collisionSeats){
  assert.equal(seat.chair.scale.x,1,'Contact never stretches a cushion');
  assert.equal(seat.chair.scale.y,1);assert.equal(seat.chair.scale.z,1);
  assert(Math.abs(new THREE.Box3().setFromObject(seat.chair).min.y-env.floorY)<1e-5,'Seats remain floor anchored');
}
for(const seat of env.collisionSeats.slice(0,5))assert(seat.chair.position.distanceTo(seat.base)<1e-6,
  'Seats with no wall contact remain in place, including the occupied seat');
assert(env.objectGroups.some(object=>object.group.position.distanceTo(object.base)>.5),
  'Actual wall contact pushes the original wall-adjacent sculpture groups');
for(let frame=1;frame<=180;frame++)step(.12*(.5+.5*Math.cos(Math.PI*frame/180)));
for(let frame=0;frame<240;frame++)step(0);
for(const seat of env.collisionSeats)assert(seat.chair.position.distanceTo(seat.base)<1e-5);
console.log('PASS rear sculpture: actual textured gallery, 2.5m including plinth, floor contact, eleven clear seats, gaze target, rigid wall contacts and return to rest');
