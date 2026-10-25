import * as THREE from 'three';

// Close the east opening with a copied section of the room's real concrete
// panels. Keep each original triangle's UVs, including seams and bolt details.
export function closeRearGalleryWall(entries, interior, floorY) {
  const source = entries.find(e => e.role === 'wall' && e.sourceName === 'walls.panels.001' && e.mesh.material.map)
    || entries.find(e => e.role === 'wall' && [e.mesh.material].flat().some(m => /concrete_procedural\.walls/.test(m.name)));
  if (!source) throw new Error('Rear closure needs the gallery concrete wall.');
  const zMin = -3.1484375, zMax = 3.1484375, yTop = 3.6015625;
  const rearX = interior.max.x - .04, sourceMinX = interior.max.x - (zMax - zMin), sourceZ = -3.1328125;
  const geometry = source.mesh.geometry, pos = geometry.attributes.position, uv = geometry.attributes.uv;
  const vertices = [], coords = [];
  function clip(polygon, axis, bound, sign) {
    const out = [];
    for (let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=(a.p[axis]-bound)*sign,db=(b.p[axis]-bound)*sign;
      if (da>=0) out.push(a);
      if ((da>=0)!==(db>=0)) {const t=da/(da-db);out.push({p:a.p.clone().lerp(b.p,t),uv:a.uv.clone().lerp(b.uv,t)});}
    }
    return out;
  }
  for (let i=0;i<(geometry.index?.count??pos.count);i+=3) {
    let polygon=[0,1,2].map(j=>{const id=geometry.index?geometry.index.getX(i+j):i+j;return {p:new THREE.Vector3().fromBufferAttribute(pos,id),uv:new THREE.Vector2().fromBufferAttribute(uv,id)};});
    if (polygon.some(v=>v.p.z<sourceZ-.035||v.p.z>sourceZ+.025)) continue;
    for (const [axis,bound,sign] of [['x',sourceMinX,1],['x',interior.max.x,-1],['y',floorY,1],['y',yTop,-1]]) polygon=clip(polygon,axis,bound,sign);
    for (let j=1;j<polygon.length-1;j++) for (const v of [polygon[0],polygon[j],polygon[j+1]]) {
      vertices.push(rearX-(v.p.z-sourceZ),v.p.y,zMin+v.p.x-sourceMinX);coords.push(v.uv.x,v.uv.y);
    }
  }
  if (!vertices.length) throw new Error('No concrete panels available for rear closure.');
  const panels = new THREE.BufferGeometry();
  panels.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));panels.setAttribute('uv',new THREE.Float32BufferAttribute(coords,2));panels.computeVertexNormals();
  const material = [source.mesh.material].flat()[0].clone();material.side=THREE.DoubleSide;
  const backing = new THREE.PlaneGeometry(zMax-zMin,yTop-floorY+.06);
  backing.rotateY(-Math.PI/2);backing.translate(rearX+.04,(floorY+yTop)/2,(zMin+zMax)/2);
  return [[panels,material,'Rear concrete gallery wall'],[backing,new THREE.MeshStandardMaterial({name:'concrete rear backing',color:0xabb3b5,roughness:.95,side:THREE.DoubleSide}),'Rear wall backing']].map(([geometry,material,name])=>{
    geometry.computeBoundingBox();const mesh=new THREE.Mesh(geometry,material);mesh.name=name;
    mesh.userData.sourceObject=name;mesh.userData.environmentRole='wall';mesh.castShadow=true;mesh.receiveShadow=true;
    return {mesh,sourceName:name,role:'wall',bbox:geometry.boundingBox.clone()};
  });
}
