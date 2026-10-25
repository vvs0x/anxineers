import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GroupView} from '../public/js/group-view.js';
import {groupAttention,imaginedConversationMix} from '../public/js/voice-atmosphere.js';
const member=(x,z,y=0)=>{const root=new THREE.Object3D();root.position.set(x,y,z);root.updateMatrixWorld();return {root};};
function camera(aspect=16/9) {const c=new THREE.PerspectiveCamera(70,aspect,.05,50);c.position.y=1.6;c.updateMatrixWorld();return c;}

test('whole-view detection includes a peripheral group with no centre-ray hit',()=>{
 const c=camera(),view=new GroupView();view.update(c);
 assert.equal(view.includes([member(5,-5)]),true);
 assert.equal(view.includes([member(7,-5)]),true,'partial body at the right edge is sufficient');
 assert.equal(view.includes([member(-7,-5)]),true);
 assert.equal(view.includes([member(9,-5)]),false);
 assert.equal(view.includes([member(0,5)]),false,'groups behind the camera are outside the view');
 assert.equal(view.includes([member(0,-5,8)]),false,'groups entirely above the view do not count');
 assert.equal(view.includes([]),false);
});
test('visibility follows portrait/landscape changes and camera turns',()=>{
 const c=camera(),view=new GroupView(),group=[member(5,-5)];view.update(c);assert.equal(view.includes(group),true);
 c.aspect=390/844;c.updateProjectionMatrix();view.update(c);assert.equal(view.includes(group),false);
 c.lookAt(5,1.6,-5);c.updateMatrixWorld();view.update(c);assert.equal(view.includes(group),true);
 c.lookAt(0,1.6,5);c.updateMatrixWorld();view.update(c);assert.equal(view.includes(group),false);
});
test('a group visible in either XR eye counts without modifying tracked transforms',()=>{
 const left=camera(.8),right=camera(.8);left.position.x=-.032;right.position.x=.032;
 left.lookAt(-2,1.6,-5);right.lookAt(2,1.6,-5);left.updateMatrixWorld();right.updateMatrixWorld();
 const xr=new THREE.ArrayCamera([left,right]),view=new GroupView(),before=right.matrixWorld.clone();
 view.update(xr);assert.equal(view.includes([member(4,-5)]),true);assert.equal(view.includes([member(-4,-5)]),true);
 assert.ok(right.matrixWorld.equals(before));
 assert.equal(view.includes([member(0,5)]),false);
});
test('one visible member emphasizes its whole group; moving the group updates visibility',()=>{
 const c=camera(),view=new GroupView(),group=[member(9,-5),member(5,-5)];view.update(c);
 assert.equal(view.includes(group),true);group[1].root.position.x=10;assert.equal(view.includes(group),false);
});
test('on-screen groups receive full emphasis even far from the head-direction centre',()=>{
 const listener={position:{x:0,y:1.6,z:0},forward:{x:0,y:0,z:-1}};
 const group={position:{x:3,z:-1},radius:.65,inView:true};
 assert.equal(groupAttention(group,listener).focus,1);
 const visible=imaginedConversationMix(group,listener,1),hidden=imaginedConversationMix({...group,inView:false},listener,1);
 assert.ok(Math.abs(visible.gain/hidden.gain-10)<1e-6);
 assert.equal(groupAttention({...group,inView:false},listener).focus,0);
});
