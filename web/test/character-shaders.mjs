import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SignalCharacter } from '../public/js/character.js';

function expandIncludes(source, stack = []) {
  return source.replace(/#include\s+<([\w\d_]+)>/g, (_, name) => {
    assert(name in THREE.ShaderChunk, `Missing Three.js shader chunk: ${name}`);
    assert(!stack.includes(name), `Recursive shader chunk: ${name}`);
    return expandIncludes(THREE.ShaderChunk[name], [...stack, name]);
  });
}
const data = fs.readFileSync(new URL('../public/characters/signal/remy.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
const c = new SignalCharacter(new THREE.Scene(), gltf, new THREE.Texture());
const bodyVertex = expandIncludes(c.material.vertexShader);
const bodyFragment = expandIncludes(c.material.fragmentShader);
assert(bodyVertex.includes('bindMatrixInverse * skinned'), 'Body vertex shader includes bone skinning');
assert(bodyVertex.includes('signalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz'), 'Head clipping uses skinned world coordinates');
assert(bodyFragment.includes('signalWorld.y > clipY'), 'First-person head clipping survived shader construction');
assert(bodyFragment.includes('dot(relative, bodyRight)'), 'First-person body text projection is independent of near-camera depth');
const tube = {
  uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms),
  vertexShader: THREE.ShaderLib.basic.vertexShader,
  fragmentShader: THREE.ShaderLib.basic.fragmentShader,
};
c.scribble.material.onBeforeCompile(tube);
const tubeVertex = expandIncludes(tube.vertexShader), tubeFragment = expandIncludes(tube.fragmentShader);
assert(tubeVertex.includes('vSignalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz'), 'Tube world-coordinate insertion was applied');
assert(tubeFragment.includes('distance(vSignalWorld, uSignalViewer) < .22'), 'Tube near-eye exclusion was applied');
assert.equal((tubeVertex.match(/varying vec3 vSignalWorld;/g) || []).length, 1);
assert.equal((tubeFragment.match(/varying vec3 vSignalWorld;/g) || []).length, 1);
c.setEmbodied(true);c.update(.01, .5, {viewerPosition: new THREE.Vector3(1, 2, 3)});
assert.equal(tube.uniforms.uSignalEmbodied.value, 1, 'Shared uniforms update after compilation');
assert.deepEqual(tube.uniforms.uSignalViewer.value.toArray(), [1, 2, 3]);
for (const shader of [bodyVertex,bodyFragment,tubeVertex,tubeFragment]) assert(!shader.includes('#include'), 'All includes resolved');
console.log(`PASS shader assembly on Three r${THREE.REVISION}: skinning, body clipping/projection, tube clip insertion, include expansion, shared uniforms. GPU compilation remains a browser check.`);
c.dispose();
