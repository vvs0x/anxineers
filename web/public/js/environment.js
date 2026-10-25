import * as THREE from 'three';
import { furnitureKind } from './furniture-gaze.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GazeTarget } from './gaze.js';
import { closeRearGalleryWall } from './rear-wall.js';

const DEFAULT_ROLES = {
  light:   ['light', 'lamp'],
  object:  ['sculpture', 'statue', 'stand', 'pedestal', 'bust', 'figure', 'table', 'block', 'bench', 'chair', 'stool', 'furniture', 'cabinet'],
  ceiling: ['ceiling'],
  floor:   ['floor', 'ground'],
  window:  ['window', 'glass'],
  wall:    ['wall'],
};
const ROLE_ORDER = ['light', 'object', 'ceiling', 'floor', 'window', 'wall'];

/** Shared uniforms: every environment material reads these, the effects write them. */
export function makeFxUniforms() {
  return {
    uCenter: { value: new THREE.Vector2() },
    uLeanK: { value: 0 },          // fraction of horizontal distance the room moves inward
    uDrop: { value: 0 },           // retained for saved settings; the ceiling stays fixed
    uDropY0: { value: 2 },
    uDropY1: { value: 3 },
    uFloorY: { value: 0 },
    uRoomHeight: { value: 3 },
    uDesat: { value: 0 },
    uCool: { value: 0 },
  };
}

const NOISE_GLSL = `
  float fxHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float fxNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(fxHash(i+vec3(0,0,0)), fxHash(i+vec3(1,0,0)), f.x), mix(fxHash(i+vec3(0,1,0)), fxHash(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(fxHash(i+vec3(0,0,1)), fxHash(i+vec3(1,0,1)), f.x), mix(fxHash(i+vec3(0,1,1)), fxHash(i+vec3(1,1,1)), f.x), f.y), f.z); }
`;

export function patchMaterial(mat, fx, isRoom) {
  // Authored Blender concrete is baked into the GLB. Only use the old noise
  // fallback for textureless legacy FBX materials.
  const concrete = /concrete/i.test(mat.name) && !mat.map;
  mat.onBeforeCompile = (shader) => {
    if (concrete) {
      shader.vertexShader = 'varying vec3 vFxP;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vFxP = position;');
      shader.fragmentShader = 'varying vec3 vFxP;\n' + NOISE_GLSL + shader.fragmentShader.replace('#include <color_fragment>',
        `#include <color_fragment>
         float cn = fxNoise(vFxP * 3.0) * 0.5 + fxNoise(vFxP * 11.0) * 0.3 + fxNoise(vFxP * 47.0) * 0.2;
         diffuseColor.rgb *= 0.78 + 0.34 * cn;`);
    }
    Object.assign(shader.uniforms, fx);
    shader.fragmentShader = 'uniform float uDesat; uniform float uCool;\n' + shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float fxL = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
       gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(fxL), uDesat);
       gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.88, 0.97, 1.10), uCool);`);

  };
  mat.customProgramCacheKey = () => (isRoom ? 'room' : 'prop') + (concrete ? 'C' : '');
  mat.needsUpdate = true;
}

function toStandard(m) {
  if (m.isMeshStandardMaterial) return m;
  const s = new THREE.MeshStandardMaterial({
    name: m.name, color: m.color ? m.color.clone() : new THREE.Color(0x888888),
    map: m.map || null, side: m.side, transparent: m.transparent, opacity: m.opacity,
    roughness: 0.9, metalness: 0.0,
  });
  if (m.emissive) { s.emissive = m.emissive.clone(); s.emissiveIntensity = m.emissiveIntensity ?? 1; }
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  if (/concrete/i.test(m.name)) { s.color.multiplyScalar(0.62); s.roughness = 0.95; }
  if (/marble/i.test(m.name)) { s.roughness = 0.35; }
  if (/metal|chrome/i.test(m.name)) { s.metalness = 0.8; s.roughness = 0.3; }
  return s;
}

function normName(n) { return n.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function authoredName(mesh, root) {
  // glTF splits a multi-material Blender object into child primitives whose
  // names are geometry datablocks (Plane010, Cube016...). Keep the authored
  // object's role, otherwise walls and pedestal feet become generic scenery.
  for (let node = mesh; node && node !== root; node = node.parent) {
    if (node.userData.sourceObject) return node.userData.sourceObject;
  }
  return mesh.name;
}

function detectRole(name, roles, overrides) {
  if (overrides[name]) return overrides[name];
  const n = normName(name);
  if (/(outside|exterior)/.test(n)) return 'exterior';
  for (const r of ROLE_ORDER) for (const hint of roles[r] || []) if (n.includes(hint)) {
    if (r === 'wall' && /(plug|switch|socket)/.test(n)) return 'prop';
    return r;
  }
  return 'room';
}

export async function loadEnvironment(baseUrl, config, scene, fxUniforms) {
  const roles = { ...DEFAULT_ROLES, ...(config.roles || {}) };
  const overrides = config.overrides || {};
  const exclude = new Set((config.exclude || []).map(normName));
  const url = baseUrl + config.file;
  const ext = url.split('.').pop().toLowerCase();
  const loaded = ext === 'fbx' ? await new FBXLoader().loadAsync(url) : (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url)).scene;

  // 1. scale, then bake every mesh into world space so shaders and effects can work in metres
  loaded.scale.multiplyScalar(config.scale ?? 1);
  loaded.updateMatrixWorld(true);
  const meshes = [];
  loaded.traverse((o) => { if (o.isMesh && !exclude.has(normName(authoredName(o, loaded)))) meshes.push(o); });

  const world = new THREE.Group(); world.name = 'EnvironmentRoot';
  const entries = [];
  const matCache = new Map();
  const std = (m, isRoom) => {
    const key=m.uuid+(isRoom ? ':room' : ':prop');
    if (!matCache.has(key)) matCache.set(key, toStandard(m.clone()));
    return matCache.get(key);
  };

  for (const mesh of meshes) {
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingBox();
    if (!geo.attributes.position.count) continue;
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    if (size.lengthSq() < 1e-8) continue;
    const sourceName = authoredName(mesh, loaded);
    const role=detectRole(sourceName, roles, overrides);
    const mats = Array.isArray(mesh.material) ? mesh.material.map(m=>std(m,role!=='object')) : std(mesh.material,role!=='object');
    const m = new THREE.Mesh(geo, mats);
    m.name = mesh.name;
    m.userData.sourceObject = sourceName;
    m.userData.environmentRole = role;
    const surfaces = Array.isArray(mats) ? mats : [mats];
    const glassOnly = surfaces.every(mat => /glass/i.test(mat.name));
    m.castShadow = !glassOnly && role !== 'light';
    m.receiveShadow = !glassOnly;
    entries.push({ mesh: m, sourceName, role, bbox: geo.boundingBox.clone() });
  }

  // 2. room bounds from floors (fallback: everything that is not an object)
  const floors = entries.filter((e) => e.role === 'floor');
  const boundsSource = floors.length ? floors : entries.filter((e) => e.role !== 'object');
  const bounds = new THREE.Box3();
  boundsSource.forEach((e) => bounds.union(e.bbox));
  const floorY = floors.length ? Math.max(...floors.map((e) => e.bbox.max.y)) : bounds.min.y;
  const wallsLike = entries.filter((e) => e.role === 'wall' || e.role === 'ceiling');
  const roomBox = new THREE.Box3();
  (wallsLike.length ? wallsLike : boundsSource).forEach((e) => roomBox.union(e.bbox));
  // the interior box = intersection of the floor footprint and the wall/ceiling extent, whichever is smaller
  const interior = bounds.clone();
  if (wallsLike.length) {
    interior.min.x = Math.max(bounds.min.x, roomBox.min.x); interior.max.x = Math.min(bounds.max.x, roomBox.max.x);
    interior.min.z = Math.max(bounds.min.z, roomBox.min.z); interior.max.z = Math.min(bounds.max.z, roomBox.max.z);
  }
  interior.min.y = floorY; interior.max.y = Math.max(roomBox.max.y, floorY + 2.5);
  if (config.closeRearWall) entries.push(...closeRearGalleryWall(entries, interior, floorY));
  // Keep complete ceiling slabs (including their bevels and panel edges)
  // together. Splitting by individual triangle width tears small triangles
  // away from their coplanar neighbours when the walls contract.
  const ceilingSlabs = entries.filter(e => ['wall', 'room', 'ceiling'].includes(e.role)
    && e.bbox.min.y > floorY + 2 && e.bbox.max.y - e.bbox.min.y < .25
    && e.bbox.max.x - e.bbox.min.x > .4 && e.bbox.max.z - e.bbox.min.z > .4);
  const ceilingY = ceilingSlabs.length ? Math.min(...ceilingSlabs.map(e => e.bbox.min.y)) : floorY + 2;
  for (const entry of ceilingSlabs) {
    entry.role = entry.mesh.userData.environmentRole = 'ceiling';
  }
  // Mixed structural meshes still contain roof faces. Separate only the
  // actual roof level, irrespective of triangle size. Lower lintels and wall
  // caps belong to their walls, so their adjoining planes move together.
  for (const entry of [...entries]) {
    if (entry.role === 'room' && entry.bbox.max.y <= floorY + .01) {
      entry.role = entry.mesh.userData.environmentRole = 'floor';
    }
    if (!['wall', 'room'].includes(entry.role)) continue;
    // A thin upright panel's top bevel is still part of that wall, not roof.
    if (Math.min(entry.bbox.max.x-entry.bbox.min.x, entry.bbox.max.z-entry.bbox.min.z) < .25) continue;
    const source=entry.mesh.geometry, pos=source.attributes.position, idx=source.index;
    const buckets={wall:[],ceiling:[]}, groups={wall:[],ceiling:[]};
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),n=new THREE.Vector3();
    for (const group of source.groups.length ? source.groups : [{start:0,count:idx?idx.count:pos.count,materialIndex:0}]) {
      const starts={wall:buckets.wall.length,ceiling:buckets.ceiling.length};
      for(let i=group.start;i<group.start+group.count;i+=3){
        const ids=[0,1,2].map(j=>idx?idx.getX(i+j):i+j);
        a.fromBufferAttribute(pos,ids[0]);b.fromBufferAttribute(pos,ids[1]);c.fromBufferAttribute(pos,ids[2]);
        n.crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
        const role=Math.abs(n.y)>.9&&Math.min(a.y,b.y,c.y)>=ceilingY-.025?'ceiling':'wall';
        buckets[role].push(...ids);
      }
      for(const role of ['wall','ceiling'])if(buckets[role].length>starts[role])groups[role].push({start:starts[role],count:buckets[role].length-starts[role],materialIndex:group.materialIndex});
    }
    if(!buckets.ceiling.length)continue;
    for(const role of ['wall','ceiling']){
      if(!buckets[role].length)continue;
      const geo=source.clone();geo.setIndex(buckets[role]);geo.clearGroups();
      for(const g of groups[role])geo.addGroup(g.start,g.count,g.materialIndex);
      // Compact unused vertices so bounding boxes describe this surface only.
      const compact=geo.toNonIndexed();geo.dispose();compact.computeBoundingBox();
      const mesh=entry.mesh.clone();mesh.geometry=compact;mesh.userData={...entry.mesh.userData,environmentRole:role};
      mesh.name=entry.mesh.name+(role==='ceiling'?' ceiling':'');
      entries.push({...entry,mesh,role,bbox:compact.boundingBox.clone()});
    }
    entries.splice(entries.indexOf(entry),1);source.dispose();
  }
  const center = interior.getCenter(new THREE.Vector3());
  const roomHeight = interior.max.y - interior.min.y;

  // 3. cluster the objects (statue + its stand) by proximity, hide the ones outside the room
  const objs = entries.filter((e) => e.role === 'object');
  const clusters = [];
  const margin = new THREE.Box3().copy(interior).expandByScalar(0.5);
  for (const o of objs) {
    const c = o.bbox.getCenter(new THREE.Vector3());
    if (!margin.containsPoint(new THREE.Vector3(c.x, interior.min.y + 0.1, c.z))) { o.hidden = true; continue; }
    let target = clusters.find((cl) => Math.hypot(cl.center.x - c.x, cl.center.z - c.z) < 0.8);
    if (!target) { target = { entries: [], center: c.clone(), box: new THREE.Box3() }; clusters.push(target); }
    target.entries.push(o); target.box.union(o.bbox);
  }
  const objectGroups = clusters.map((cl, i) => {
    const bb = cl.box;
    const pivot = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2);
    const g = new THREE.Group(); g.name = 'Object' + i; g.position.copy(pivot);
    for (const e of cl.entries) { e.mesh.geometry.translate(-pivot.x, -pivot.y, -pivot.z); e.mesh.frustumCulled = false; g.add(e.mesh); }
    const gazeCenter = bb.getCenter(new THREE.Vector3());
    const offset = gazeCenter.clone().sub(pivot);
    const grp = {
      kind: furnitureKind(cl.entries.map(e => e.sourceName || e.mesh.name), config.objectKinds),
      group: g, base: pivot.clone(), size: bb.getSize(new THREE.Vector3()), smoothed: 0,
      phase: Math.random() * 6.28, gazeScale: 1, gazeOffset: offset.clone(),
      target: new GazeTarget((out) => g.localToWorld(out.copy(offset))),
    };
    g.userData.gazeObject=grp;
    g.traverse(o=>{if(o.isMesh)o.userData.gazeObject=grp;});
    return grp;
  });

  // 4. add everything to the world, patch materials
  const patched = new Set();
  const lightMats = new Set();
  const ceilingLights = [];
  for (const e of entries) {
    if (e.hidden) continue;
    const isRoom = e.role !== 'object';
    const ms = Array.isArray(e.mesh.material) ? e.mesh.material : [e.mesh.material];
    for (const m of ms) {
      const key = m.uuid + (isRoom ? 'r' : 'p');
      if (!patched.has(key)) {
        // a material shared between room and object would need two programs; clone if both
        patchMaterial(m, fxUniforms, isRoom); patched.add(key);
      }
      if (/emission|emissive/i.test(m.name) || (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0)) {
        lightMats.add(m);
        if (m.userData.baseEmissive == null) m.userData.baseEmissive = m.emissiveIntensity;
      }
    }
    if (e.role === 'light') {
      const fixture = ceilingLights.find(light => light.sourceName === e.sourceName);
      if (fixture) fixture.bbox.union(e.bbox);
      else ceilingLights.push({ ...e, bbox: e.bbox.clone() });
    }
    if (e.role !== 'object') { e.mesh.frustumCulled = false; world.add(e.mesh); }
  }
  for (const g of objectGroups) world.add(g.group);
  scene.add(world);
  world.updateMatrixWorld(true);

  // 5. gaze targets for the room (walls, ceiling, lights)
  const roomTargets = [];
  const mid = (x, y, z) => new THREE.Vector3(x, y, z);
  const wide = { fullAngle: 20, falloffAngle: 50 };
  const cy = interior.min.y + roomHeight * 0.5;
  for (const [x, z] of [[interior.min.x, center.z], [interior.max.x, center.z], [center.x, interior.min.z], [center.x, interior.max.z]]) {
    const p = mid(x, cy, z); roomTargets.push(new GazeTarget((o) => deformEnvironmentPoint(o.copy(p), fxUniforms), wide));
  }
  const pc = mid(center.x, interior.max.y, center.z); roomTargets.push(new GazeTarget((o) => deformEnvironmentPoint(o.copy(pc), fxUniforms, 'ceiling'), wide));
  const lightTargets = ceilingLights.filter((e) => e.bbox.getSize(new THREE.Vector3()).y > 0.15).slice(0, 24).map((e) => {
    const c = e.bbox.getCenter(new THREE.Vector3());
    return new GazeTarget((o) => deformEnvironmentPoint(o.copy(c), fxUniforms, 'light'), { fullAngle: 12, falloffAngle: 35 });
  });

  // 6. scene lighting: own lights, the FBX has none
  const bigLights = ceilingLights.filter((e) => /big/i.test(e.mesh.name)).sort((a, b) => a.mesh.name.localeCompare(b.mesh.name));
  const lightSources = [];
  const lightBase = [];
  const pointLights = (bigLights.length ? bigLights : ceilingLights).slice(0, config.maxPointLights ?? 6);
  for (const e of pointLights) {
    const c = e.bbox.getCenter(new THREE.Vector3());
    const pl = new THREE.PointLight(0xfff0dd, 3.2, 9, 1.6);
    pl.position.set(c.x, e.bbox.min.y - 0.15, c.z);
    pl.userData.basePosition=pl.position.clone();
    scene.add(pl); lightSources.push(pl); lightBase.push(pl.intensity);
  }

  const spawn = config.spawn || {};
  const stats = {
    meshes: entries.length, tris: entries.reduce((a, e) => a + (e.mesh.geometry.index ? e.mesh.geometry.index.count : e.mesh.geometry.attributes.position.count) / 3, 0),
    objects: objectGroups.length, hiddenObjects: objs.filter((o) => o.hidden).length, lightTargets: lightTargets.length,
    roles: entries.reduce((a, e) => (a[e.role] = (a[e.role] || 0) + 1, a), {}),
  };

  // Real mesh transforms keep rendering, lighting and gaze collision identical.
  // Independent surface transforms avoid vertex uploads each XR frame:
  // fixed floor/ceiling/fixtures, with horizontal wall motion only.
  const roomMeshes=entries.filter(e=>!e.hidden&&e.role!=='object').map(e=>e.mesh);
  const roomMotion=roomMeshes.map(mesh=>({mesh,basePositions:mesh.geometry.attributes.position.array}));
  const raycastMeshes=entries.filter(e=>!e.hidden).map(e=>e.mesh);
  for(const mesh of raycastMeshes){
    // Build once after world-space baking and prop-pivot translation. Transforms
    // do not invalidate this tree, and indirect mode preserves material groups.
    mesh.geometry.boundsTree=new MeshBVH(mesh.geometry,{indirect:true,targetLeafSize:12});
    mesh.raycast=acceleratedRaycast;
  }
  const wallMeshes=entries.filter(e=>!e.hidden&&['wall','room'].includes(e.role)).map(e=>e.mesh);
  // Per-object clearance to actual walls, not just the outer footprint. This keeps
  // benches/pedestals from growing through an internal wall in an L-shaped room.
  const clearanceRay=new THREE.Raycaster();clearanceRay.firstHitOnly=true;
  for(const o of objectGroups){
    const c=o.base.clone().add(o.gazeOffset),limits={minX:interior.min.x,maxX:interior.max.x,minZ:interior.min.z,maxZ:interior.max.z};
    for(const [axis,sign,key] of [['x',-1,'minX'],['x',1,'maxX'],['z',-1,'minZ'],['z',1,'maxZ']]){
      const direction=new THREE.Vector3();direction[axis]=sign;clearanceRay.set(c,direction);
      const h=clearanceRay.intersectObjects(wallMeshes,false)[0];
      if(h)limits[key]=sign<0?Math.max(limits[key],h.point[axis]):Math.min(limits[key],h.point[axis]);
    }
    o.clearance=limits;
  }
  return {
    root: world, name: config.name, interior, center, roomHeight, floorY, objectGroups, roomTargets, lightTargets,
    roomMotion,roomMeshes,raycastMeshes,
    lightSources, lightBase, lightMats: [...lightMats], spawn: {
      x: spawn.x ?? center.x, z: spawn.z ?? center.z, yawDeg: spawn.yawDeg ?? 0,
    }, stats,
  };
}

/** Match each room surface transform for its gaze targets and light sources. */
export function deformEnvironmentPoint(point, fx, role = 'wall') {
  const c=fx.uCenter.value,k=fx.uLeanK.value;
  if(!['wall','room','window','prop'].includes(role))return point;
  point.x=c.x+(point.x-c.x)*(1-k);point.z=c.y+(point.z-c.y)*(1-k);
  return point;
}

export function updateEnvironmentGeometry(env,fx){
  const k=fx.uLeanK.value,c=fx.uCenter.value;
  for(const {mesh} of env.roomMotion){
    const role=mesh.userData.environmentRole;
    if(!['wall','room','window','prop'].includes(role)){mesh.scale.set(1,1,1);mesh.position.set(0,0,0);continue;}
    mesh.scale.set(1-k,1,1-k);
    mesh.position.set(c.x*k,0,c.y*k);
  }
  // Furniture is handled by the rigid contact solver after wall transforms.
  for(const light of env.lightSources)deformEnvironmentPoint(light.position.copy(light.userData.basePosition),fx,'light');
  env.root.updateMatrixWorld(true);
}
