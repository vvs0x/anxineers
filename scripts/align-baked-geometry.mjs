// Preserve the existing room's compressed positions while retaining baked UV seams.
import fs from 'node:fs';
import {GLTFLoader} from '../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../web/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
import {Texture} from '../web/node_modules/three/build/three.module.js';
const dir=new URL('../web/public/environments/brutalist/',import.meta.url);
const original=fs.readFileSync(new URL('room-textured.glb',dir));
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(()=>({name:'NO_BITMAPS',loadTexture:()=>Promise.resolve(new Texture())}));
const gltf=await loader.parseAsync(original.buffer.slice(original.byteOffset,original.byteOffset+original.byteLength),'');
const target=new URL('room-baked.glb',dir), bytes=fs.readFileSync(target), length=bytes.readUInt32LE(12);
const doc=JSON.parse(bytes.subarray(20,20+length)), bin=28+length;
let count=0,maxDelta=0;
for(const node of doc.nodes){
 if(node.mesh===undefined)continue;
 const mesh=doc.meshes[node.mesh];
 if(!mesh.primitives.some(p=>doc.materials[p.material]?.name.startsWith('baked_')))continue;
 const originalNode=gltf.scene.getObjectByName(node.name.replaceAll('.',''));
 if(!originalNode)throw new Error('Missing original '+node.name);
 const positions=[];originalNode.traverse(o=>{if(o.isMesh)positions.push(o.geometry.attributes.position)});
 const grid=new Map(),cell=.01,key=(x,y,z)=>`${x},${y},${z}`;
 for(const pos of positions)for(let i=0;i<pos.count;i++){
  const v=[pos.getX(i),pos.getY(i),pos.getZ(i)],k=key(...v.map(x=>Math.floor(x/cell)));
  if(!grid.has(k))grid.set(k,[]);grid.get(k).push(v);
 }
 for(const p of mesh.primitives){
  const a=doc.accessors[p.attributes.POSITION],view=doc.bufferViews[a.bufferView];
  a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<a.count;i++){
   const offset=bin+(view.byteOffset||0)+(a.byteOffset||0)+i*(view.byteStride||12);
   const v=[0,4,8].map(j=>bytes.readFloatLE(offset+j)),c=v.map(x=>Math.floor(x/cell));
   let best=null,distance=Infinity;
   for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const q of grid.get(key(c[0]+x,c[1]+y,c[2]+z))||[]){
    const d=q.reduce((sum,n,k)=>sum+(n-v[k])**2,0);if(d<distance){best=q;distance=d;}
   }
   if(!best||distance>.0001)throw new Error('Geometry mismatch '+node.name);
   best.forEach((n,j)=>{bytes.writeFloatLE(n,offset+j*4);a.min[j]=Math.min(a.min[j],n);a.max[j]=Math.max(a.max[j],n);});count++;maxDelta=Math.max(maxDelta,Math.sqrt(distance));
  }
 }
}
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const header=Buffer.alloc(20);bytes.copy(header,0,0,20);header.writeUInt32LE(28+json.length+bytes.length-bin,8);header.writeUInt32LE(json.length,12);
fs.writeFileSync(target,Buffer.concat([header,json,bytes.subarray(bin-8)]));console.log(`Aligned ${count} baked vertices to existing positions; max correction ${maxDelta.toFixed(5)}m`);
