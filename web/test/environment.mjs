import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {loadEnvironment,makeFxUniforms,updateEnvironmentGeometry,deformEnvironmentPoint} from '../public/js/environment.js';
import {HeadGaze,GazeCursor} from '../public/js/gaze.js';
import {Effects} from '../public/js/effects.js';
import {AnxietyDirector} from '../public/js/director.js';
import {PROFILES} from '../public/js/profiles.js';
globalThis.window={innerWidth:1000,innerHeight:1000};
const bytes=fs.readFileSync(new URL('../public/environments/brutalist/model.fbx',import.meta.url));
FBXLoader.prototype.loadAsync=async function(){return this.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
const config=JSON.parse(fs.readFileSync(new URL('../public/environments/brutalist/env.json',import.meta.url)));
if (config.file.endsWith('.glb')) {
  const glb = fs.readFileSync(new URL('../public/environments/brutalist/' + config.file, import.meta.url));
  // Keep the actual GLB geometry/material definitions; only image decoding is
  // replaced in this non-GPU test. The browser verifies the rendered maps.
  GLTFLoader.prototype.loadAsync = async function () {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(() => ({
      name: 'NODE_TEXTURE_DECODER',
      loadTexture: () => Promise.resolve(new THREE.Texture()),
    }));
    return loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  };
}
const scene=new THREE.Scene(),fx=makeFxUniforms(),env=await loadEnvironment('/test/',config,scene,fx);
console.log('Environment',JSON.stringify(env.stats),'bounds',env.interior.min.toArray(),env.interior.max.toArray());
assert(env.interior.min.x < -5.4 && env.interior.max.x > 11.7 && env.interior.max.z > 10,
  'authored wall primitives must retain their role and full room bounds');
assert(Math.abs(env.interior.max.y - 5.1) < .01, 'the original ceiling height is preserved');
assert(env.roomMeshes.filter(m => m.userData.environmentRole === 'wall').length >= 3,
  'all authored wall surfaces remain actual gaze-triggering walls');
if(config.closeRearWall){
  const rear=env.roomMeshes.filter(m=>m.name.startsWith('Rear '));
  assert.equal(rear.length,2,'Concrete panels and a solid backing close the opening');
  assert(rear.some(m=>m.material.map),'Rear wall reuses the actual textured concrete panels');
  const ray=new THREE.Raycaster();ray.firstHitOnly=true;
  for(const y of [.1,.8,1.7,2.8,3.5])for(const z of [-3,-2,-1,0,1,2,3]){
    ray.set(new THREE.Vector3(10.8,y,z),new THREE.Vector3(1,0,0));
    const hit=ray.intersectObjects(env.roomMeshes,false)[0];
    assert(hit&&rear.includes(hit.object),'Rear opening is a real wall at every sampled height and width');
  }
}
assert(env.raycastMeshes.some(m=>m.userData.sourceObject==='Plane'),'large central table is present in rendering and gaze');
assert(env.objectGroups.some(o=>o.kind==='table'),'large table is present in furniture and collision groups');
const roomMaterials=new Set(env.roomMeshes.flatMap(m=>Array.isArray(m.material)?m.material:[m.material]));
for(const o of env.objectGroups)for(const mesh of o.group.children)for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])assert(!roomMaterials.has(mat),'room/prop material instances must not alias');
const camera=new THREE.PerspectiveCamera();camera.position.set(2,1.6,2.2);scene.add(camera);scene.updateMatrixWorld(true);
const director=new AnxietyDirector(PROFILES.Education_Light),effects=new Effects(scene,director,env,fx,camera);
fx.uCenter.value.set(-1.1,2.1);
const gaze=new HeadGaze(camera);gaze.update();gaze.hitObject=null;
const o=env.objectGroups.find(o=>o.kind==='object');const base=o.group.position.clone();
for(let i=0;i<60;i++)effects.update(1/60,gaze);
assert(o.group.position.distanceTo(base)<1e-6,'calm props must stay exactly in their original position');
director.intensity=.5;director.setState('Peak');director.smoothed.Space=1;director.smoothed.Objects=1;
gaze.hitObject=o;for(let i=0;i<240;i++)effects.update(1/60,gaze);
assert(o.group.scale.x>1.195&&o.group.scale.x<=1.200001,'looked object approaches 20% growth');assert.equal(o.group.scale.x,o.group.scale.y);assert.equal(o.group.scale.y,o.group.scale.z);
for(const other of env.objectGroups.filter(x=>x!==o))assert.equal(other.group.scale.x,1,'unlooked props must not grow');
gaze.hitObject=null;for(let i=0;i<180;i++)effects.update(1/60,gaze);assert(o.group.scale.x<1.001,'look-away returns to neutral size');
// Rendering positions, logical deformation and raycast positions must use one mapping.
for(const motion of env.roomMotion){const i=Math.min(5,motion.mesh.geometry.attributes.position.count-1),arr=motion.basePositions;const expected=deformEnvironmentPoint(new THREE.Vector3(arr[i*3],arr[i*3+1],arr[i*3+2]),fx,motion.mesh.userData.environmentRole);const actual=new THREE.Vector3().fromBufferAttribute(motion.mesh.geometry.attributes.position,i).applyMatrix4(motion.mesh.matrixWorld);assert(expected.distanceTo(actual)<1e-5);}
const cursor=new GazeCursor(scene,env);gaze.direction.copy(o.group.position).add(new THREE.Vector3(0,o.size.y*.5,0)).sub(gaze.origin).normalize();cursor.update(gaze,1);assert(Number.isFinite(cursor.distance));
// Controlled occlusion: front wall blocks a gaze-target box behind it.
const testScene=new THREE.Scene(),wall=new THREE.Mesh(new THREE.BoxGeometry(4,4,.1),new THREE.MeshBasicMaterial()),target=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());wall.position.z=-2;target.position.z=-4;target.userData.gazeObject={name:'target'};testScene.add(wall,target);testScene.updateMatrixWorld(true);const c=new GazeCursor(testScene,{root:testScene,raycastMeshes:[wall,target]});const g={origin:new THREE.Vector3(),direction:new THREE.Vector3(0,0,-1)};c.update(g,1);assert.equal(g.hitObject,null);wall.visible=false;c.update(g,1);assert.equal(g.hitObject,target.userData.gazeObject);
// ArrayCamera rig pose must survive gaze evaluation.
const xr=new THREE.ArrayCamera();xr.matrixWorld.makeTranslation(4,1.6,2);const head=new HeadGaze(xr);head.update();assert.deepEqual(head.origin.toArray(),[4,1.6,2]);
console.log('PASS: large table restored, material isolation, exact room/raycast mapping, gaze-only 20% growth, look-away recovery, occlusion and XR head pose.');
// Closing the room must not rewrite/upload vertex buffers each frame on Quest.
const versions=env.roomMeshes.map(m=>m.geometry.attributes.position.version);
let t=performance.now();for(let i=0;i<30;i++){fx.uLeanK.value=i/30*.15;fx.uDrop.value=i/30*.5;updateEnvironmentGeometry(env,fx);}const deformMs=(performance.now()-t)/30;
assert.deepEqual(env.roomMeshes.map(m=>m.geometry.attributes.position.version),versions);
assert(env.raycastMeshes.every(m=>m.geometry.boundsTree),'all visible room geometry is accelerated');
const ray=new THREE.Raycaster();ray.firstHitOnly=true;
const directions=Array.from({length:12},(_,i)=>new THREE.Vector3(Math.sin(i),.1,-Math.cos(i)).normalize());
const cast=()=>directions.map(dir=>{ray.set(new THREE.Vector3(2,1.6,2.2),dir);const h=ray.intersectObjects(env.raycastMeshes,false)[0];return h?{name:h.object.name,d:h.distance}:null;});
t=performance.now();const fast=cast(),fastMs=(performance.now()-t)/directions.length;
const methods=env.raycastMeshes.map(m=>m.raycast);env.raycastMeshes.forEach(m=>m.raycast=THREE.Mesh.prototype.raycast);
t=performance.now();const slow=cast(),slowMs=(performance.now()-t)/directions.length;
env.raycastMeshes.forEach((m,i)=>m.raycast=methods[i]);
fast.forEach((h,i)=>{assert.equal(h?.name,slow[i]?.name);if(h)assert(Math.abs(h.d-slow[i].d)<1e-5);});
console.log(`Performance: room transform ${deformMs.toFixed(3)} ms/frame; BVH ray ${fastMs.toFixed(3)} ms vs brute force ${slowMs.toFixed(3)} ms. Zero vertex uploads; hit fidelity preserved.`);
