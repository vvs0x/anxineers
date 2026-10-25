import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { GazeTarget } from './gaze.js';
import { patchMaterial } from './environment.js';

/** Rear-wing focal point, opposite the seated character's sculpture-facing view. */
export async function loadRearSculpture(env, fx) {
  const { scene: statue } = await new GLTFLoader().loadAsync('/sculptures/nike.glb');
  const group = new THREE.Group(); group.name = 'Rear gallery Nike sculpture';
  group.position.set(9.6, env.floorY, 0);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.25, .4, 1.25),
    new THREE.MeshStandardMaterial({ color: 0xb4afa4, roughness: .8 }));
  plinth.name = 'Nike plinth'; plinth.position.y = .2;
  statue.position.y = .4; statue.rotation.y = -Math.PI / 2;
  group.add(plinth, statue); env.root.add(group); env.root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const base = group.position.clone(), offset = bounds.getCenter(new THREE.Vector3()).sub(base);
  const object = { group, base, size: bounds.getSize(new THREE.Vector3()), smoothed: 0, gazeGrowth: false,
    phase: 0, gazeScale: 1, gazeOffset: offset,
    target: new GazeTarget(out => group.localToWorld(out.copy(offset))),
    clearance: { minX: env.interior.min.x, maxX: env.interior.max.x, minZ: env.interior.min.z, maxZ: env.interior.max.z },
  };
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  const origin = base.clone().add(offset);
  const walls = env.roomMeshes.filter(m => ['wall', 'room'].includes(m.userData.environmentRole));
  for (const [axis, sign, key] of [['x',-1,'minX'],['x',1,'maxX'],['z',-1,'minZ'],['z',1,'maxZ']]) {
    const direction = new THREE.Vector3(); direction[axis] = sign; ray.set(origin, direction);
    const hit = ray.intersectObjects(walls, false)[0];
    if (hit) object.clearance[key] = sign < 0 ? Math.max(object.clearance[key], hit.point[axis]) : Math.min(object.clearance[key], hit.point[axis]);
  }
  const materials = new Set();
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.userData.environmentRole = 'object'; mesh.userData.gazeObject = object;
    mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { indirect: true }); mesh.raycast = acceleratedRaycast;
    env.raycastMeshes.push(mesh);
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      if (!materials.has(material)) { patchMaterial(material, fx, false); materials.add(material); }
    }
  });
  group.userData.gazeObject = object; env.objectGroups.push(object); env.stats.objects++;
  return object;
}
