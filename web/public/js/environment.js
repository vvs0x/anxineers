import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GazeTarget } from './gaze.js';

const DEFAULT_ROLES = {
  light:   ['light', 'lamp'],
  object:  ['sculpture', 'statue', 'stand', 'pedestal', 'bust', 'figure'],
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
    uDrop: { value: 0 },           // metres the upper part of the room drops
    uDropY0: { value: 2 },
    uDropY1: { value: 3 },
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

function patchMaterial(mat, fx, isRoom) {
  const concrete = /concrete/i.test(mat.name);
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
    if (isRoom) {
      shader.vertexShader = 'uniform vec2 uCenter; uniform float uLeanK; uniform float uDrop; uniform float uDropY0; uniform float uDropY1;\n' +
        shader.vertexShader.replace('#include <begin_vertex>',
          `#include <begin_vertex>
           transformed.xz = uCenter + (transformed.xz - uCenter) * (1.0 - uLeanK);
           transformed.y -= uDrop * smoothstep(uDropY0, uDropY1, transformed.y);`);
    }
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
  const loaded = ext === 'fbx' ? await new FBXLoader().loadAsync(url) : (await new GLTFLoader().loadAsync(url)).scene;

  // 1. scale, then bake every mesh into world space so shaders and effects can work in metres
  loaded.scale.multiplyScalar(config.scale ?? 1);
  loaded.updateMatrixWorld(true);
  const meshes = [];
  loaded.traverse((o) => { if (o.isMesh && !exclude.has(normName(o.name))) meshes.push(o); });

  const world = new THREE.Group(); world.name = 'EnvironmentRoot';
  const entries = [];
  const matCache = new Map();
  const std = (m) => { if (!matCache.has(m)) matCache.set(m, toStandard(m)); return matCache.get(m); };

  for (const mesh of meshes) {
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingBox();
    if (!geo.attributes.position.count) continue;
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    if (size.lengthSq() < 1e-8) continue;
    const mats = Array.isArray(mesh.material) ? mesh.material.map(std) : std(mesh.material);
    const m = new THREE.Mesh(geo, mats);
    m.name = mesh.name;
    entries.push({ mesh: m, role: detectRole(mesh.name, roles, overrides), bbox: geo.boundingBox.clone() });
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
      group: g, base: pivot.clone(), size: bb.getSize(new THREE.Vector3()), smoothed: 0,
      phase: Math.random() * 6.28,
      target: new GazeTarget((out) => out.copy(g.position).add(offset)),
    };
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
        if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissiveIntensity;
      }
    }
    if (e.role === 'light') ceilingLights.push(e);
    if (e.role !== 'object') { e.mesh.frustumCulled = false; world.add(e.mesh); }
  }
  for (const g of objectGroups) world.add(g.group);
  scene.add(world);

  // 5. gaze targets for the room (walls, ceiling, lights)
  const roomTargets = [];
  const mid = (x, y, z) => new THREE.Vector3(x, y, z);
  const wide = { fullAngle: 20, falloffAngle: 50 };
  const cy = interior.min.y + roomHeight * 0.5;
  for (const [x, z] of [[interior.min.x, center.z], [interior.max.x, center.z], [center.x, interior.min.z], [center.x, interior.max.z]]) {
    const p = mid(x, cy, z); roomTargets.push(new GazeTarget((o) => o.copy(p), wide));
  }
  const pc = mid(center.x, interior.max.y, center.z); roomTargets.push(new GazeTarget((o) => o.copy(pc), wide));
  const lightTargets = ceilingLights.filter((e) => e.bbox.getSize(new THREE.Vector3()).y > 0.15).slice(0, 24).map((e) => {
    const c = e.bbox.getCenter(new THREE.Vector3());
    return new GazeTarget((o) => o.copy(c), { fullAngle: 12, falloffAngle: 35 });
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
    scene.add(pl); lightSources.push(pl); lightBase.push(pl.intensity);
  }

  const spawn = config.spawn || {};
  const stats = {
    meshes: entries.length, tris: entries.reduce((a, e) => a + (e.mesh.geometry.index ? e.mesh.geometry.index.count : e.mesh.geometry.attributes.position.count) / 3, 0),
    objects: objectGroups.length, hiddenObjects: objs.filter((o) => o.hidden).length, lightTargets: lightTargets.length,
    roles: entries.reduce((a, e) => (a[e.role] = (a[e.role] || 0) + 1, a), {}),
  };

  return {
    root: world, name: config.name, interior, center, roomHeight, floorY, objectGroups, roomTargets, lightTargets,
    lightSources, lightBase, lightMats: [...lightMats], spawn: {
      x: spawn.x ?? center.x, z: spawn.z ?? center.z, yawDeg: spawn.yawDeg ?? 0,
    }, stats,
  };
}
