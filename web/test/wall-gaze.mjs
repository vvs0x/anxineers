import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Effects, WallGazeContraction } from '../public/js/effects.js';
import { GazeCursor } from '../public/js/gaze.js';
import { makeFxUniforms } from '../public/js/environment.js';

const close = (a, b, label) => assert(Math.abs(a-b) < 1e-8, `${label}: ${a} != ${b}`);

test('one continuous wall second starts a repeating three-second inward / three-second outward cycle', () => {
  const response = new WallGazeContraction();
  response.update(.6, 'wall', true); assert.equal(response.latched, false); close(response.amount,0,'No early motion');
  response.update(.1, 'object', true); assert.equal(response.dwell,0);
  response.update(.6, 'wall', true); assert.equal(response.latched,false);
  response.update(.4, 'wall', true); assert.equal(response.latched,true);close(response.amount,0,'Cycle begins at original footprint');
  response.update(1.5, 'wall', true); close(response.amount,.15,'Halfway inward');
  response.update(1.5, 'wall', true); close(response.amount,.3,'Full inward at three seconds');
  response.update(1.5, 'floor', true); close(response.amount,.15,'Moving outward after looking away');
  response.update(1.5, 'floor', true); close(response.amount,0,'Fully outward at six seconds');
  response.update(3, 'floor', true); close(response.amount,.3,'Next inward cycle continues');
  response.update(3, 'wall', true); close(response.amount,0,'Next outward cycle returns completely');
  for(let i=0;i<200;i++){response.update(.17,'wall',true);assert(response.amount>=0&&response.amount<=.3000001,'Cycles must never accumulate collapse');}
});

test('calm never moves; ending anxiety releases smoothly and a new episode requires new dwell', () => {
  const response = new WallGazeContraction(); response.update(30,'wall',false);
  assert.equal(response.dwell,0);assert.equal(response.latched,false);close(response.amount,0,'Calm');
  response.update(1,'wall',true);response.update(3,'wall',true);close(response.amount,.3,'Inward');
  response.update(.1,'wall',false);assert.equal(response.latched,false);close(response.amount,.3,'No stop jump');
  response.update(1,'wall',false);close(response.amount,.15,'Half release');
  response.update(1,'wall',false);close(response.amount,0,'Released');
  response.update(.9,'wall',true);assert.equal(response.latched,false);close(response.amount,0,'New dwell required');
});

test('cursor exposes only the nearest visible hit role, respecting occluders and hidden parents', () => {
  const scene = new THREE.Scene();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 4, .1), new THREE.MeshBasicMaterial());
  wall.position.z = -4; wall.userData.environmentRole = 'wall';
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  object.position.z = -2; object.userData.environmentRole = 'object'; object.userData.gazeObject = { name: 'prop' };
  const parent = new THREE.Group(); parent.add(object); scene.add(wall, parent); scene.updateMatrixWorld(true);
  const cursor = new GazeCursor(scene, { root: scene, raycastMeshes: [wall, object] });
  const gaze = { origin: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, -1) };
  cursor.update(gaze, 1);
  assert.equal(gaze.hitRole, 'object'); assert.equal(gaze.hitMesh, object); assert.equal(gaze.hitObject, object.userData.gazeObject);
  parent.visible = false; cursor.update(gaze, 1);
  assert.equal(gaze.hitRole, 'wall'); assert.equal(gaze.hitMesh, wall); assert.equal(gaze.hitObject, null);
  wall.visible = false; cursor.update(gaze, 1);
  assert.equal(gaze.hitRole, null); assert.equal(gaze.hitMesh, null);
  cursor.dispose();
});

function roomHarness() {
  const scene=new THREE.Scene(),root=new THREE.Group();scene.add(root);
  const walls=[[-10,0],[10,0],[0,-10],[0,10]].map(([x,z])=>{
    const geometry=new THREE.BoxGeometry(x ? .1 : 20,3,x ? 20 : .1).translate(x,1.5,z);
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());mesh.userData.environmentRole='wall';root.add(mesh);return mesh;
  });
  const ceiling=new THREE.Mesh(new THREE.BoxGeometry(20,.1,20).translate(0,3,0),new THREE.MeshBasicMaterial());ceiling.userData.environmentRole='ceiling';root.add(ceiling);
  const env={root,center:new THREE.Vector3(1,1.5,-2),floorY:0,roomHeight:3,
    interior:new THREE.Box3(new THREE.Vector3(-10,0,-10),new THREE.Vector3(10,3,10)),
    roomTargets:[{update(){throw Error('Approximate wall cone should not drive motion');}}],
    lightTargets:[],objectGroups:[],lightSources:[],lightBase:[],lightMats:[],roomMotion:[...walls,ceiling].map(mesh=>({mesh}))};
  // Maxed slow Space channel must not mask the outward phase or move the ceiling.
  const director={settings:{Objects:{maxValue:1}},state:'Build',level:1,setGaze(){},channel:()=>1,rawChannel:()=>0};
  const fx=makeFxUniforms(),effects=new Effects(scene,director,env,fx,new THREE.PerspectiveCamera());
  const gaze={origin:new THREE.Vector3(1,1.6,-2),direction:new THREE.Vector3(0,0,-1),hitRole:'wall',hitMesh:walls[0],hitObject:null};
  return {scene,env,director,fx,effects,gaze,walls,ceiling};
}

test('all walls cycle horizontally to thirty percent and fully back; ceiling and wall heights stay fixed',()=>{
  const h=roomHarness();h.director.level=.5;h.effects.update(1,h.gaze);close(h.fx.uLeanK.value,.15,'Half anxiety contracts halfway');h.director.level=1;
  h.gaze.hitMesh=h.walls[1];h.effects.update(.1,h.gaze);assert.equal(h.effects.wallGaze.latched,true);
  h.effects.update(3,h.gaze);close(h.fx.uLeanK.value,.3,'Inward peak');close(h.fx.uDrop.value,0,'No ceiling drop');
  for(const wall of h.walls){close(wall.scale.x,.7,'Wall x');close(wall.scale.z,.7,'Wall z');close(wall.scale.y,1,'Wall height');close(wall.position.y,0,'Wall y position');}
  close(new THREE.Box3().setFromObject(h.ceiling).getCenter(new THREE.Vector3()).y,3,'Ceiling world height');
  assert.deepEqual(h.ceiling.scale.toArray(),[1,1,1]);
  assert.deepEqual(h.ceiling.position.toArray(),[0,0,0]);
  h.effects.blackout.elapsed=59;h.effects.blackout.runId=0;
  h.effects.update(3,h.gaze);close(h.fx.uLeanK.value,0,'Full outward after the blackout hold');
  for(const wall of h.walls){close(wall.scale.x,1,'Original width');close(wall.scale.z,1,'Original depth');}
  h.effects.blackout.elapsed=62;h.effects.update(3,h.gaze);close(h.fx.uLeanK.value,.3,'Cycle repeats');close(h.fx.uDrop.value,0,'Ceiling remains fixed');
});

for(const stop of ['Recovery','Calm','cap0'])test(`${stop} releases the wall cycle instead of continuing it`,()=>{
  const h=roomHarness();h.effects.update(1,h.gaze);h.effects.update(3,h.gaze);close(h.fx.uLeanK.value,.3,'Initial inward peak');
  if(stop==='cap0')h.director.level=0;else h.director.state=stop;
  h.effects.update(.1,h.gaze);assert.equal(h.effects.wallGaze.latched,false);close(h.effects.wallGaze.cycleTime,0,'Cycle reset');close(h.fx.uLeanK.value,.3,'No stop jump');
  h.effects.update(1,h.gaze);close(h.fx.uLeanK.value,.15,'Smooth release');
  h.effects.update(1,h.gaze);close(h.fx.uLeanK.value,0,'Released');close(h.fx.uDrop.value,0,'No vertical movement');
  h.effects.update(30,h.gaze);close(h.fx.uLeanK.value,0,'Stays calm after release');
});

// A fast stop/restart must not create an instantaneous room-position change.
test('retriggering during release blends from the existing footprint into the next cycle',()=>{
  const r=new WallGazeContraction();r.update(1,'wall',true);r.update(3,'wall',true);
  r.update(.1,'wall',false);r.update(.5,'wall',true);const before=r.amount;
  r.update(.5,'wall',true);assert.equal(r.latched,true);close(r.amount,before,'Retrigger continuity');
  r.update(3,'wall',true);close(r.amount,.3,'New inward apex');r.update(3,'wall',true);close(r.amount,0,'New full outward endpoint');
});

test('guided calming releases the rendered room over fourteen seconds with no first-frame jump',()=>{
 const h=roomHarness();h.effects.update(3,h.gaze);close(h.fx.uLeanK.value,.3,'peak');
 h.director.state='Recovery';
 h.effects.update(1/60,h.gaze,{settling:true,settlingSeconds:14});close(h.fx.uLeanK.value,.3,'first recovery frame');
 h.effects.update(2,h.gaze,{settling:true,settlingSeconds:14});assert(h.fx.uLeanK.value>.28);
 h.effects.update(5,h.gaze,{settling:true,settlingSeconds:14});close(h.fx.uLeanK.value,.15,'halfway');
 h.effects.update(7,h.gaze,{settling:true,settlingSeconds:14});close(h.fx.uLeanK.value,0,'settled');
 for(const wall of h.walls){close(wall.position.y,0,'floor contact');close(wall.scale.y,1,'wall height');}
});
