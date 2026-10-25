import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GazeTarget } from './gaze.js';

export async function loadSeating(scene, env) {
  const { scene: source } = await new GLTFLoader().loadAsync('/furniture/black-pouf.glb');
  const root = new THREE.Group(); root.name = 'Gallery seating';
  // Seating occupies the open east wing, looking back into the sculpture gallery.
  // Keep a clear aisle between the groups; walls can push unoccupied seats.
  const layout = [
    [4.0, 1.9, 0], [4.25, -2.15, .30], [5.5, -2.15, -.30],
    // Clear the statue's foreground for the conversation circle.
    [10.35, 2.2, .15], [10.35, -2.2, -.12],
    // Leave room for the walls' inward movement and keep the central aisle clear.
    [9.15, 2.55, .12], [8.0, -2.15, .05],
    [-3.0, 8.2, -.04], [-4.15, 6.9, .06], [8.0, 2.55, -.05],
  ];
  const chairs = layout.map(([x,z,yaw], i) => {
    const chair = source.clone(true); chair.name = `Black pouf ${i + 1}`;
    chair.position.set(x, env.floorY, z); chair.rotation.y = yaw;
    chair.userData.seatingGroup = i < 3 ? 'central-three' : i < 5 ? 'gallery-two' : 'wall-seating';
    root.add(chair); return chair;
  });
  env.wallSeats = chairs.slice(5).map(chair => ({ chair, base: chair.position.clone() }));
  env.collisionSeats = chairs.map((chair, i) => ({ chair, base: chair.position.clone(), occupied: i === 0 }));
  scene.add(root); root.updateMatrixWorld(true);
  env.seatGazeObjects = chairs.map((chair, i) => {
    const center = chair.worldToLocal(new THREE.Box3().setFromObject(chair).getCenter(new THREE.Vector3()));
    const object = { group: chair, base: chair.position.clone(), baseScale: chair.scale.clone(),
      kind: 'chair', occupied: i === 0, gazeScale: 1,
      target: new GazeTarget(out => chair.localToWorld(out.copy(center))) };
    chair.userData.gazeObject = object;
    chair.traverse(mesh => { if (mesh.isMesh) { mesh.userData.gazeObject = object; mesh.userData.environmentRole = 'chair'; } });
    return object;
  });
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; env.raycastMeshes.push(o); } });
  const box = new THREE.Box3().setFromObject(chairs[0]);
  return { root, chairs, position: chairs[0].position.clone(), height: box.max.y - env.floorY, yaw: -Math.PI / 2 - THREE.MathUtils.degToRad(12) };
}
