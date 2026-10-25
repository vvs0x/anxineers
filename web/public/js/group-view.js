import * as THREE from 'three';

/** Whole-view attention, independent of the red cursor's exact mesh hit. */
export class GroupView {
  constructor() {
    this.frusta = []; this.matrix = new THREE.Matrix4();
    this.bounds = new THREE.Box3(); this.position = new THREE.Vector3();
  }
  update(camera) {
    // XR provides separate asymmetric projections for the two eyes. A group
    // visible to either eye counts; do not rebuild tracked camera transforms.
    const cameras = camera.isArrayCamera ? camera.cameras : [camera];
    this.frusta.length = cameras.length;
    cameras.forEach((eye, index) => {
      const frustum = this.frusta[index] ||= new THREE.Frustum();
      this.matrix.multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse);
      frustum.setFromProjectionMatrix(this.matrix, eye.coordinateSystem, eye.reversedDepth);
    });
  }
  includes(members) {
    // Generous body boxes include shoulders and a little surrounding space.
    // Partial visibility at any screen edge is enough for the entire group.
    return members.some(member => {
      member.root.getWorldPosition(this.position);
      this.bounds.min.set(this.position.x - .65, this.position.y, this.position.z - .65);
      this.bounds.max.set(this.position.x + .65, this.position.y + 1.9, this.position.z + .65);
      return this.frusta.some(frustum => frustum.intersectsBox(this.bounds));
    });
  }
}
