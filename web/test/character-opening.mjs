import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {galleryFixture} from './gallery-fixture.mjs';
const {scene,env,character,seating}=await galleryFixture();
const walking=await new GLTFLoader().loadAsync('/characters/visitors/visitor-a.glb');
character.setOpeningWalk(walking.animations[0]);
const positions=[],eyes=[];let maximumGap=0,largestStep=0,largestEyeStep=0;
const walls=env.roomMeshes.filter(m=>['wall','room','window'].includes(m.userData.environmentRole));
for(let frame=0;frame<=600;frame++){
 const time=frame/60;
 character.update(1/60,0);character.updateOpening(time,10);scene.updateMatrixWorld(true);
 const position=character.root.position.clone(),eye=character.getEyePosition();
 if(positions.length){largestStep=Math.max(largestStep,position.distanceTo(positions.at(-1)));largestEyeStep=Math.max(largestEyeStep,eye.distanceTo(eyes.at(-1)));}
 positions.push(position);eyes.push(eye);
 const support=Math.min(character.support.minY('Left'),character.support.minY('Right'));
 maximumGap=Math.max(maximumGap,Math.abs(support-env.floorY));
 assert(Math.abs(support-env.floorY)<.008,`Supporting foot at ${time}s: ${support-env.floorY}`);
 if(frame%15===0){
  const bounds=new THREE.Box3().setFromObject(character.model,true);
  for(const wall of walls)assert(!wall.geometry.boundsTree.intersectsBox(bounds,new THREE.Matrix4().copy(wall.matrixWorld).invert()),`Signal crosses ${wall.name} at ${time}s`);
  if(time<7.5){const box=new THREE.Box3().setFromObject(seating.chairs[0]);box.expandByScalar(-.02);assert(!bounds.intersectsBox(box),`Walking body crosses supporting chair at ${time}s`);}
 }
}
assert(positions[0].distanceTo(positions[300])>1.3,'Visible left-to-right traverse');
assert(character.root.position.distanceTo(seating.position)<1e-8,'Ends at seat');
const hip=character.hips.getWorldPosition(new THREE.Vector3());assert(Math.abs(hip.y-(env.floorY+seating.height+.095))<1e-6,'Ends seated on cushion');
assert(largestStep<.02,`No root jumps: ${largestStep}`);assert(largestEyeStep<.04,`No head jumps: ${largestEyeStep}`);
character.updateOpening(8,10);const midSitEye=character.getEyePosition(),midSitPosition=character.root.position.clone();
character.setEmbodied(true);character.update(1/60,.4);
assert(character.openingActive,'Handoff keeps the sitting animation active');
assert(character.root.position.distanceTo(midSitPosition)<1e-8,'Handoff does not snap to the seat');
assert(character.getEyePosition().distanceTo(midSitEye)<1e-8,'Handoff preserves the current head height');
character.updateOpening(10,10);assert(!character.openingActive,'Sitting completes naturally');
character.reset();character.updateOpening(0,10);assert(character.root.position.distanceTo(positions[0])<1e-8,'Replay restarts route');
console.log('PASS Signal left-to-right opening walk and sit:',{maximumGap,largestStep,largestEyeStep});
