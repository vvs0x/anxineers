import assert from 'node:assert/strict';
import * as THREE from 'three';
import {galleryFixture} from './gallery-fixture.mjs';
import {loadVisitors} from '../public/js/visitors.js';
import {updateEnvironmentGeometry} from '../public/js/environment.js';
import {WallCollisionSystem} from '../public/js/wall-collisions.js';
const {scene,fx,env,seating,character,sculpture}=await galleryFixture();
const crowd=await loadVisitors(scene,env,fx,seating,character),nav=crowd.navigation;
const viewer=new THREE.Vector3(env.spawn.x,1.7,env.spawn.z);
const roleCounts=()=>Object.fromEntries(['seated','front','rear'].map(role=>[role,crowd.visitors.filter(v=>v.role===role).length]));
character.update(0,0);
assert(Math.abs(new THREE.Box3().setFromObject(character.model,true).min.y-env.floorY)<.008,'Signal also keeps actual soles on the floor');
assert.equal(crowd.visitors.length,7);assert.deepEqual(roleCounts(),{seated:2,front:2,rear:3});
assert.equal(crowd.root.children.length,7,'No detached duplicate bodies or motion trails');
assert.equal(env.collisionSeats.filter(s=>s.occupied).length,3,'Signal and both visitor seats have fixed supports');

let walkingFrames=0,stillFrames=0,maxWalkers=0,maxSoleGap=0,minSeparation=Infinity,contacts=0;
function check(frame){
 const moving=crowd.roamers.length;maxWalkers=Math.max(maxWalkers,moving);
 assert(moving<=2,'Only two people may be in transit');if(moving)walkingFrames++;else stillFrames++;
 if(!crowd.exchange)assert.deepEqual(roleCounts(),{seated:2,front:2,rear:3});
 for(const v of crowd.visitors){
  const bottom=Math.min(v.support.minY('Left'),v.support.minY('Right'));
  maxSoleGap=Math.max(maxSoleGap,bottom-env.floorY);
  assert(bottom-env.floorY<.008,`Visitor ${v.index} levitates in ${v.state}: ${bottom-env.floorY}`);
  if(v.state==='seated'){
   const chair=crowd.slots[v.slot].chair,top=new THREE.Box3().setFromObject(chair).max.y;
   assert(Math.abs(v.bones.get('Hips').getWorldPosition(new THREE.Vector3()).y-top-.095)<1e-5,'Seated hips stay on the cushion');
   for(const side of ['Left','Right'])assert(Math.abs(v.support.minY(side)-env.floorY)<.008,'Both seated feet reach the floor');
  }else if(v.state==='talking'){
   if(v.role==='front'){
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(v.root.quaternion),toSignal=character.root.position.clone().sub(v.root.position).normalize();
    assert(forward.dot(toSignal)<-.55,`Front visitor ${v.index} faces Signal at ${crowd.time}: ${forward.dot(toSignal)}`);
   }else assert(v.root.position.distanceTo(sculpture.group.position)<3.5,'The rear conversation stays by the sculpture');
  }
  if(['walking','talking'].includes(v.state)&&!nav.clear(v.position,null,.12)){contacts++;}
  if(frame%60===0){
   const bounds=new THREE.Box3().setFromObject(v.model,true);
   assert(bounds.min.y<env.floorY+.008&&bounds.min.y>env.floorY-.012,'Actual skinned shoes touch the floor');
   for(const wall of env.roomMeshes.filter(m=>['wall','room','window'].includes(m.userData.environmentRole)))
    assert(!wall.geometry.boundsTree.intersectsBox(bounds,new THREE.Matrix4().copy(wall.matrixWorld).invert()),`Visitor ${v.index} intersects ${wall.name} in ${v.state}`);
  }
 }
 for(let i=0;i<7;i++)for(let j=i+1;j<7;j++)minSeparation=Math.min(minSeparation,crowd.visitors[i].root.position.distanceTo(crowd.visitors[j].root.position));
}
for(let f=0;f<4800;f++){crowd.update(.05,viewer);check(f);}
assert(crowd.exchanges>=5,'Short pauses keep people exchanging places throughout the experience');
assert(crowd.events.find(event=>event.type==='start').time<4.1,'The first exchange begins during the ten-second overview');
assert(crowd.visitors.filter(v=>v.distance>1).length>=4,'Walking duties rotate between people');
assert(stillFrames>400&&walkingFrames>400,'Long stationary pauses separate the exchanges');
assert(minSeparation>.66,'Visitors never overlap');
assert.equal(contacts,0,'Standing and walking visitors stay clear of furniture');
const contactsSystem=new WallCollisionSystem(env,fx);
for(const o of env.objectGroups)contactsSystem.add(o.group,{base:o.base});
for(const seat of env.collisionSeats)contactsSystem.add(seat.chair,{base:seat.base,occupant:seat.occupied});
const seatRest=seating.chairs.slice(1,3).map(c=>c.position.clone());
let maxSeatSlide=0;
for(let f=0;f<1200;f++){
 fx.uLeanK.value=.3*(.5-.5*Math.cos(2*Math.PI*f*.05/6));updateEnvironmentGeometry(env,fx);contactsSystem.update(.05);
 crowd.update(.05,viewer);check(f);
 for(let i=0;i<2;i++)maxSeatSlide=Math.max(maxSeatSlide,seating.chairs[i+1].position.distanceTo(seatRest[i]));
}
assert(maxSeatSlide>.05,'Wall contact slides the occupied seats');
assert.equal(contacts,0,'Moving furniture stays clear of the formations');
assert(minSeparation>.66,'Contraction keeps physical body clearance');
const beforeHold=crowd.visitors.map(v=>v.distance);
for(let f=0;f<600;f++){
 fx.uLeanK.value=.3*(f<60?.5-.5*Math.cos(Math.PI*f/60):1);updateEnvironmentGeometry(env,fx);contactsSystem.update(.05);
 crowd.update(.05,viewer);check(f);
}
assert(crowd.visitors.some((v,i)=>v.distance>beforeHold[i]+.1),'People continue moving during the maximum inward hold');
assert.equal(contacts,0,'A sustained thirty-percent hold preserves furniture clearance');
assert(minSeparation>.66,'A sustained hold preserves personal space');
console.log('PASS seven visitors: 2 seated / 2 back-facing front / 3 rear, rotating exchanges, max two travellers, grounded skins and seat transitions, pauses, contraction.',{exchanges:crowd.exchanges,maxWalkers,maxSoleGap,minSeparation});
