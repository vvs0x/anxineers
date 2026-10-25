import assert from 'node:assert/strict';
import * as THREE from 'three';
import {galleryFixture} from './gallery-fixture.mjs';
import {loadVisitors} from '../public/js/visitors.js';
import {RoomExploration} from '../public/js/exploration.js';
import {EmbodimentJourney} from '../public/js/experience.js';
import {Session} from '../public/js/session.js';
import {AnxietyDirector} from '../public/js/director.js';
const f=await galleryFixture(),{scene,env,character}=f;
const visitors=await loadVisitors(scene,env,f.fx,f.seating,character);
const rig=new THREE.Group(),camera=new THREE.PerspectiveCamera(70,16/9,.05,80);rig.add(camera);scene.add(rig);
const renderer={xr:{isPresenting:false}},panel={mesh:{visible:false},setOrb(){},hide(){this.mesh.visible=false;},show(m){this.model=m;this.mesh.visible=true;},placeInFront(){},_draw(){}};
const director=new AnxietyDirector(),session=new Session({director,panel});
const exploration=new RoomExploration({scene,camera,rig,renderer,env,character,visitors,panel});
const journey=new EmbodimentJourney({scene,camera,rig,renderer,env,character,panel,exploration});
session.startRun();journey.update(0,session);
const seen=new Set(),walls=env.roomMeshes.filter(m=>['wall','window','room'].includes(m.userData.environmentRole));
let previous=camera.getWorldPosition(new THREE.Vector3()),distance=0;
for(let i=0;i<200;i++){
 session.update(.05);journey.update(.05,session);director.update(.05);scene.updateMatrixWorld(true);
 const position=camera.getWorldPosition(new THREE.Vector3()),delta=position.clone().sub(previous),length=delta.length();
 if(length>1e-6){const ray=new THREE.Raycaster(previous,delta.normalize(),0,length);assert(!ray.intersectObjects(walls,false).length, `Showcase at ${session.phaseTime}: ${ray.intersectObjects(walls,false).map(h=>h.object.name)} ${position.toArray()}`);}
 distance+=length;previous.copy(position);
 assert.equal(director.intensity,0,'Overview and orbit are calm');
 if(session.phase==='observing' && session.phaseTime>10*10/38){
  const target=character.getEyePosition(new THREE.Vector3()).project(camera);
  assert(Math.abs(target.x)<1e-6 && Math.abs(target.y)<1e-6,'Signal stays centered throughout the floating approach and orbit');
  const toSignal=character.getEyePosition(new THREE.Vector3()).sub(position), ray=new THREE.Raycaster(position,toSignal.clone().normalize(),0,toSignal.length());
  assert(!ray.intersectObjects(walls,false).length,'Signal is never hidden behind a solid wall');
 }
 if(session.phase==='observing' && session.phaseTime<10*10/38)assert(distance<.01,'Preserve the original stationary overview');
 const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 for(const v of visitors.visitors)if(frustum.containsPoint(v.root.position.clone().add(new THREE.Vector3(0,1,0))))seen.add(v.index);
}
assert.equal(session.phase,'embodying');assert.equal(exploration.active,false);
assert(distance > 18, 'The complete floating orbit travels around the table');

assert.equal(seen.size,7,'Every visitor is framed in the overview');
for(let i=0;i<80;i++){
 const old=camera.getWorldPosition(new THREE.Vector3());
 session.update(.05);journey.update(.05,session);director.update(.05);scene.updateMatrixWorld(true);
 const now=camera.getWorldPosition(new THREE.Vector3()),delta=now.clone().sub(old),length=delta.length();
 if(length>1e-6)assert(!new THREE.Raycaster(old,delta.normalize(),0,length).intersectObjects(walls,false).length,'Handoff stays clear of walls');
}
assert.equal(session.phase,'running');assert(journey.embodied);assert(!exploration.active);
assert(camera.getWorldPosition(new THREE.Vector3()).distanceTo(character.getEyePosition(new THREE.Vector3()))<1e-5);
assert(character.openingActive,'POV and anxiety start before sitting finishes');
assert(director.intensity>0,'Anxiety is building during the descent');
const handoffEye=character.getEyePosition(new THREE.Vector3());
for(let i=0;i<41;i++){
 session.update(.05);journey.update(.05,session);director.update(.05);character.update(.05,director.level);scene.updateMatrixWorld(true);
 assert(camera.getWorldPosition(new THREE.Vector3()).distanceTo(character.getEyePosition(new THREE.Vector3()))<1e-5,'POV follows the animated descent');
 assert(Math.abs(Math.min(character.support.minY('Left'),character.support.minY('Right'))-env.floorY)<.008,'Sitting feet stay grounded after handoff');
}
assert(!character.openingActive,'Sitting finishes naturally after POV and anxiety begin');
assert(character.getEyePosition(new THREE.Vector3()).y<handoffEye.y-.03,'The seated head continues down inside POV');
for(let i=0;i<199;i++){session.update(.05);director.update(.05);}
assert.equal(director.state,'Peak');assert(Math.abs(director.level-1)<1e-5);
while(session.povElapsed<59.949){session.update(.05);director.update(.05);}
assert.equal(session.phase,'running');
session.update(.1);assert.equal(session.phase,'breathing','Breathing starts after 60 seconds in POV');
session.startRun();session.update(22);session.update(2);session.calmNow();assert.equal(session.phase,'breathing');
// Breathing and subsequent grounding belong to their own workflow.

console.log('PASS overview and complete table orbit, all visitors framed, wall clearance, POV handoff, 100% ramp, 60s POV cutoff and early calm',{distance,route:exploration.showcaseLength});

// Physical look stays live while the tracked rig follows the same camera-only orbit.
exploration.isTracked=()=>true; journey.isMotionActive=()=>true;
camera.rotation.set(.1,.2,.03); const trackedLook=camera.quaternion.clone();
session.startRun(); journey.update(0,session);
let trackedDistance=0, trackedPrevious=camera.getWorldPosition(new THREE.Vector3());
for(let frame=0;frame<198;frame++){
 session.update(.05); journey.update(.05,session); scene.updateMatrixWorld(true);
 const position=camera.getWorldPosition(new THREE.Vector3());
 trackedDistance+=position.distanceTo(trackedPrevious); trackedPrevious.copy(position);
 assert(camera.quaternion.angleTo(trackedLook)<1e-7,'Orbit never overwrites physical look');
}
assert(trackedDistance>18,'Tracked rig completes the floating orbit');
console.log('PASS tracked camera orbit preserves physical look');
