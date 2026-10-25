import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../web/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';

const base = new URL('../web/public/environments/brutalist/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('materials/manifest.json', base)));
async function load(path) {
  const bytes = fs.readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binStart = 20 + jsonLength + 8;
  // Image decoding is a browser/GPU responsibility. Preserve every glTF image
  // reference and decode all actual geometry/material data for this test.
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(() => ({
    name: 'NODE_TEXTURE_DECODER', loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  const { scene } = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  scene.updateMatrixWorld(true);
  const objects = new Map();
  let triangles = 0, primitives = 0;
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    let source = mesh;
    while (source && !source.userData.sourceObject) source = source.parent;
    const key = mesh.name.startsWith('windows_') ? mesh.name : source?.userData.sourceObject || mesh.name;
    const item = objects.get(key) || { bounds: new THREE.Box3(), triangles: 0 };
    item.bounds.union(new THREE.Box3().setFromObject(mesh));
    const count = (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3;
    item.triangles += count;
    triangles += count;
    primitives++;
    objects.set(key, item);
  });
  const textures = json.images.map(image => {
    const view = json.bufferViews[image.bufferView];
    const start = binStart + (view.byteOffset || 0);
    assert.equal(image.mimeType, 'image/png');
    return { name: image.name, width: bytes.readUInt32BE(start + 16), height: bytes.readUInt32BE(start + 20) };
  });
  return { bytes: bytes.length, json, objects, triangles, primitives, textures };
}

const asset = await load(new URL('room-textured.glb', base));
assert(asset.bytes < 25_000_000, 'Quest download budget');
assert.equal(asset.objects.size, manifest.meshes.length, 'authored object count');
assert.equal(asset.triangles, manifest.meshes.reduce((sum, mesh) => sum + mesh.triangles, 0), 'authored triangle topology');
assert.equal(asset.textures.length, 9, 'shared atlas texture count');
for (const mesh of manifest.meshes) {
  const object = asset.objects.get(mesh.name);
  assert(object, `retained ${mesh.name}`);
  assert.equal(object.triangles, mesh.triangles, `${mesh.name} triangle topology`);
}
assert(asset.objects.has('windows_frame') && asset.objects.has('windows_glass'), 'separate window shadow surfaces');
const glass = asset.json.materials.find(m => m.name === 'glass.external.web');
assert.equal(glass.extensions.KHR_materials_transmission.transmissionFactor, 1);
assert(Math.abs(glass.extensions.KHR_materials_ior.ior - 1.05) < 1e-6);
for (const material of asset.json.materials.filter(m => m.name.includes('.atlas.'))) {
  assert(material.pbrMetallicRoughness.baseColorTexture, `${material.name} base color`);
  assert(material.pbrMetallicRoughness.metallicRoughnessTexture, `${material.name} roughness/metalness`);
  assert(material.normalTexture, `${material.name} authored normal`);
}
const textureMiB = asset.textures.reduce((sum, t) => sum + t.width * t.height * 4 * 4 / 3, 0) / 1024 / 1024;
assert(textureMiB < 100, 'Quest uncompressed texture memory budget including mipmaps');
let sourceUnchanged = manifest.sourceUnchanged;
if (fs.existsSync(manifest.source)) {
  sourceUnchanged = createHash('sha256').update(fs.readFileSync(manifest.source)).digest('hex') === manifest.sourceSha256;
  assert(sourceUnchanged, 'original Blender file must remain unchanged');
}
let maxBoundsErrorMetres = null;
if (process.argv[2]) {
  const original = await load(process.argv[2]);
  assert.equal(asset.triangles, original.triangles);
  maxBoundsErrorMetres = 0;
  for (const [name, item] of original.objects) {
    const final = asset.objects.get(name);
    assert(final, name);
    maxBoundsErrorMetres = Math.max(maxBoundsErrorMetres,
      item.bounds.min.distanceTo(final.bounds.min), item.bounds.max.distanceTo(final.bounds.max));
  }
  assert(maxBoundsErrorMetres < 1e-4, 'compression must preserve room dimensions');
}
console.log(JSON.stringify({ pass: true, bytes: asset.bytes, objects: asset.objects.size,
  primitives: asset.primitives, triangles: asset.triangles, textureMiB, textures: asset.textures,
  sourceUnchanged, maxBoundsErrorMetres, extensions: asset.json.extensionsUsed }, null, 2));
