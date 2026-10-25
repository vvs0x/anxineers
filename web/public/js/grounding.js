import * as THREE from 'three';

const point = new THREE.Vector3();
const cleanName = name => name.replace(/^mixamorig\d*[:_]?/, '');
const directions = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) directions.push(new THREE.Vector3(x, y, z));
}

/** Cache sole/heel/toe extremities once, then skin only those contact vertices. */
export class FootSupport {
  constructor(root, model, bones) {
    Object.assign(this, { root, model, bones });
    this.samples = { Left: [], Right: [] }; this.ankleHeight = {}; this.footRotation = {};
    root.updateMatrixWorld(true);
    const inverseRoot = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const side of ['Left', 'Right']) {
      const foot = bones.get(side + 'Foot'), inverse = foot.matrixWorld.clone().invert();
      const candidates = [];
      model.traverse(mesh => {
        if (!mesh.isSkinnedMesh) return;
        const { skinIndex, skinWeight, position } = mesh.geometry.attributes;
        const footIndices = new Set(mesh.skeleton.bones.map((bone, i) =>
          [side + 'Foot', side + 'ToeBase'].includes(cleanName(bone.name)) ? i : -1).filter(i => i >= 0));
        for (let i = 0; i < position.count; i++) {
          let influence = 0;
          for (let j = 0; j < 4; j++) if (footIndices.has(skinIndex.array[i * 4 + j])) influence += skinWeight.array[i * 4 + j];
          if (influence < .05) continue;
          mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
          candidates.push({ mesh, index: i, local: point.clone() });
        }
      });
      if (!candidates.length) throw new Error('Missing skinned sole for ' + side);
      // The convex extremities retain the sole through ankle rotation without a
      // full skinned-mesh bounding-box traversal every animation frame.
      const chosen = new Set();
      for (const direction of directions) {
        let best = candidates[0], distance = -Infinity;
        for (const candidate of candidates) {
          const d = candidate.local.dot(direction);
          if (d > distance) { distance = d; best = candidate; }
        }
        chosen.add(best);
      }
      this.samples[side] = [...chosen];
      this.ankleHeight[side] = foot.getWorldPosition(new THREE.Vector3()).y - this.minY(side);
      this.footRotation[side] = inverseRoot.clone().multiply(foot.getWorldQuaternion(new THREE.Quaternion()));
    }
  }
  minY(side) {
    let y = Infinity;
    for (const sample of this.samples[side]) {
      sample.mesh.getVertexPosition(sample.index, point).applyMatrix4(sample.mesh.matrixWorld);
      y = Math.min(y, point.y);
    }
    return y;
  }
  ground(floorY) {
    this.root.updateMatrixWorld(true);
    const bottom = Math.min(this.minY('Left'), this.minY('Right'));
    const world = this.model.getWorldPosition(new THREE.Vector3()); world.y += floorY - bottom;
    this.model.position.copy(this.model.parent.worldToLocal(world));
    this.root.updateMatrixWorld(true);
    return bottom;
  }
}

function aimBone(root, bone, child, target) {
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const from = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const to = target.clone().sub(origin).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(from, to)
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  root.updateMatrixWorld(true);
}

/** Two-bone leg solve: seated hips stay on the cushion and both soles on the floor. */
export function fitSeatedPose({ root, bones, support, hipRotation }, seatTop, floorY, amount = 1) {
  const hips = bones.get('Hips'), rootQ = root.getWorldQuaternion(new THREE.Quaternion());
  hips.quaternion.copy(hipRotation);
  root.updateMatrixWorld(true);
  const standingHip = hips.getWorldPosition(new THREE.Vector3());
  const seatedHip = root.getWorldPosition(new THREE.Vector3()); seatedHip.y = seatTop + .095;
  const hipTarget = standingHip.lerp(seatedHip, amount);
  hips.position.copy(hips.parent.worldToLocal(hipTarget)); root.updateMatrixWorld(true);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const upper = bones.get(side + 'UpLeg'), lower = bones.get(side + 'Leg'), foot = bones.get(side + 'Foot');
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const knee = lower.getWorldPosition(new THREE.Vector3()), ankle = foot.getWorldPosition(new THREE.Vector3());
    const a = hip.distanceTo(knee), b = knee.distanceTo(ankle);
    const target = new THREE.Vector3(sign * .12, 0, .45 * amount).applyQuaternion(rootQ).add(root.getWorldPosition(new THREE.Vector3()));
    target.y = floorY + support.ankleHeight[side];
    for (let iteration = 0; iteration < 3; iteration++) {
      const direction = target.clone().sub(hip), distance = THREE.MathUtils.clamp(direction.length(), Math.abs(a - b) + .001, a + b - .001);
      direction.normalize();
      const along = (a * a - b * b + distance * distance) / (2 * distance);
      const height = Math.sqrt(Math.max(0, a * a - along * along));
      const bend = forward.clone().addScaledVector(direction, -forward.dot(direction)).normalize();
      const kneeTarget = hip.clone().addScaledVector(direction, along).addScaledVector(bend, height);
      aimBone(root, upper, lower, kneeTarget); aimBone(root, lower, foot, target);
      foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(rootQ).multiply(support.footRotation[side]));
      root.updateMatrixWorld(true);
      target.y += floorY - support.minY(side);
    }
  }
}
