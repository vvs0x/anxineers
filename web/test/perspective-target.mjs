import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PerspectiveTarget} from '../public/js/perspective-target.js';
function target(){
 const p=Object.create(PerspectiveTarget.prototype);p.enabled=true;p.point=new THREE.Vector3();
 p.bounds=new THREE.Box3(new THREE.Vector3(-.3,0,-3.3),new THREE.Vector3(.3,1.7,-2.7));
 p.label=new THREE.Mesh(new THREE.PlaneGeometry(1.4,.219),new THREE.MeshBasicMaterial());p.label.position.set(0,2,-3);p.label.updateMatrixWorld();
 p.env={raycastMeshes:[]};return p;
}
test('controller world rays can select the body or the label',()=>{
 const p=target(),origin=new THREE.Vector3(0,1.6,0);
 for(const destination of [p.bounds.getCenter(new THREE.Vector3()),p.label.position]){
  const controller=new THREE.Object3D();controller.position.copy(origin);controller.lookAt(origin.clone().sub(destination.clone().sub(origin)));controller.updateMatrixWorld();
  const ray=new THREE.Raycaster(new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld),new THREE.Vector3(0,0,-1).transformDirection(controller.matrixWorld));
  assert(p.hit(ray)!==null);
 }
});
test('walls block selection and the broader hover area does not activate selection',()=>{
 const p=target(),ray=new THREE.Raycaster(new THREE.Vector3(.5,1,0),new THREE.Vector3(0,0,-1));
 assert.equal(p.hit(ray),null);assert(p.hit(ray,true)!==null);
 const wall=new THREE.Mesh(new THREE.BoxGeometry(3,3,.1),new THREE.MeshBasicMaterial());wall.position.set(0,1,-1);wall.updateMatrixWorld();p.env.raycastMeshes=[wall];
 assert.equal(p.hit(ray,true),null);
 p.enabled=false;p.env.raycastMeshes=[];assert.equal(p.hit(ray,true),null);
});
