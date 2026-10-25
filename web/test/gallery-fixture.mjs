import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {loadEnvironment,makeFxUniforms} from '../public/js/environment.js';
import {loadSeating} from '../public/js/seating.js';
import {loadRearSculpture} from '../public/js/sculpture.js';
import {SignalCharacter} from '../public/js/character.js';
// Preserve production meshes and skeletons; only replace bitmap decoding.
GLTFLoader.prototype.loadAsync=async function(url){
 const b=fs.readFileSync(new URL('../public'+url,import.meta.url));
 return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(()=>({name:'NO_BITMAP',loadTexture:()=>Promise.resolve(new THREE.Texture())}))
  .parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
};
export async function galleryFixture(){
 const scene=new THREE.Scene(),fx=makeFxUniforms(),config=JSON.parse(fs.readFileSync(new URL('../public/environments/brutalist/env.json',import.meta.url)));
 const env=await loadEnvironment('/environments/brutalist/',config,scene,fx);
 const sculpture=await loadRearSculpture(env,fx),seating=await loadSeating(scene,env);
 const character=new SignalCharacter(scene,await new GLTFLoader().loadAsync('/characters/signal/remy.glb'),new THREE.Texture(),{position:seating.position,yaw:seating.yaw,seatHeight:seating.height});
 fx.uCenter.value.set(seating.position.x,seating.position.z);fx.uFloorY.value=env.floorY;fx.uRoomHeight.value=env.roomHeight;
 return {scene,fx,env,seating,character,sculpture};
}
