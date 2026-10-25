import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { MAX_ROOM_DIMMING } from './profiles.js';

const DEFAULT_BASE = '/environments/brutalist/daylight/';
const clamp01 = value => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
const isGlass = material => /glass/i.test(material.name) || material.transmission > .5;

/** Original Blender world-node output and Sun, using a single bounded shadow map.
 * Rendered geometry casts the shadows: windows, mullions, walls, props and benches.
 * Light color/direction/energy are authored values, not a painted light overlay.
 */
export async function loadAuthoredDaylight(scene, renderer, env, { baseUrl = DEFAULT_BASE, shadowMapSize = 1024 } = {}) {
  const response = await fetch(baseUrl + 'lighting.json');
  if (!response.ok) throw new Error(`Could not load authored lighting (${response.status})`);
  const metadata = await response.json();
  const source = metadata.lights.find(light => light.type === 'SUN');
  if (!source) throw new Error('Original gallery has no authored Sun light.');
  const worldTexture = await new RGBELoader().loadAsync(baseUrl + metadata.world.file);
  worldTexture.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(worldTexture);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = metadata.world.bakedStrength ? 1 : metadata.world.strength;
  // The panorama contains the exact authored World mix. Retain its original
  // unblurred source for the world outside the gallery's transparent windows.
  scene.background = worldTexture;
  scene.backgroundIntensity = 1;
  const sun = new THREE.DirectionalLight();
  sun.name = source.name + ' (original Blender lighting)';
  sun.color.setRGB(...source.colorLinear, THREE.LinearSRGBColorSpace);
  sun.intensity = source.energy;
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.bias = -.00015;
  sun.shadow.normalBias = .005;
  sun.shadow.radius = 1.4;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  const center = env.interior.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(...source.direction).normalize();
  const distance = env.interior.getSize(new THREE.Vector3()).length() + 12;
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(direction, -distance);
  sun.userData.authoredPosition = source.position;
  sun.userData.authoredAngularDiameter = source.angleRadians;
  scene.add(sun, sun.target);
  sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true);
  sun.shadow.camera.near = .1;
  sun.shadow.camera.far = distance * 2.5;
  sun.shadow.updateMatrices(sun);
  // Tight room-bounds projection gives thin window frames useful shadow texels.
  const lightBounds = new THREE.Box3();
  for (const x of [env.interior.min.x, env.interior.max.x])
    for (const y of [env.floorY - .5, env.interior.max.y + .5])
      for (const z of [env.interior.min.z, env.interior.max.z])
        lightBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(sun.shadow.camera.matrixWorldInverse));
  Object.assign(sun.shadow.camera, {
    left: lightBounds.min.x - .5, right: lightBounds.max.x + .5,
    bottom: lightBounds.min.y - .5, top: lightBounds.max.y + .5,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.camera.layers.enable(31);
  const shadowProxies = [];
  const configured = new WeakSet();
  function register(root) {
    const meshes = [];
    root.traverse(mesh => { if (mesh.isMesh && !configured.has(mesh)) meshes.push(mesh); });
    for (const mesh of meshes) {
      configured.add(mesh);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.receiveShadow = true;
      if (materials.every(isGlass)) { mesh.castShadow = false; continue; }
      mesh.castShadow = true;
      if (!materials.some(isGlass)) continue;
      // GLTF uses separate primitives, but the original FBX combines panes and
      // frames. An opaque-only shadow proxy lets clear glass transmit sunlight.
      mesh.castShadow = false;
      const geometry = mesh.geometry.clone();
      geometry.clearGroups();
      const indices = [];
      for (const group of mesh.geometry.groups) {
        if (isGlass(materials[group.materialIndex])) continue;
        for (let i = group.start; i < group.start + group.count; i++) indices.push(mesh.geometry.index ? mesh.geometry.index.getX(i) : i);
      }
      if (!indices.length) { geometry.dispose(); continue; }
      geometry.setIndex(indices);
      const proxy = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      proxy.name = mesh.name + ' opaque frame shadow';
      proxy.layers.set(31);
      proxy.castShadow = true; proxy.frustumCulled = false;
      mesh.add(proxy);
      shadowProxies.push(proxy); configured.add(proxy);
    }
    sun.shadow.needsUpdate = true;
  }
  register(env.root);
  let shadowElapsed = 1;
  const baseWorldIntensity = scene.environmentIntensity;
  return {
    sun, metadata, worldTexture, environment, register,
    update(dt, lightAmount = 0, ambientDim = .25) {
      const anxiety = clamp01(lightAmount);
      ambientDim = Math.min(MAX_ROOM_DIMMING, clamp01(ambientDim));
      // The existing effect keeps its authored fixture flicker. Daylight follows
      // its global dimming, without inventing a second independent anxiety ramp.
      sun.intensity = source.energy * (1 - Math.min(1, ambientDim * 1.2) * anxiety);
      scene.environmentIntensity = baseWorldIntensity * (1 - ambientDim * anxiety);
      scene.backgroundIntensity = 1 - ambientDim * anxiety;
      shadowElapsed += Math.max(0, dt);
      if (shadowElapsed >= 1 / 15) {
        sun.shadow.needsUpdate = true;
        shadowElapsed = 0;
      }
    },
    dispose() {
      scene.remove(sun, sun.target);
      for (const proxy of shadowProxies) { proxy.removeFromParent(); proxy.geometry.dispose(); proxy.material.dispose(); }
      if (scene.environment === environment.texture) scene.environment = null;
      if (scene.background === worldTexture) scene.background = null;
      sun.shadow.dispose(); environment.dispose(); worldTexture.dispose();
    },
  };
}
