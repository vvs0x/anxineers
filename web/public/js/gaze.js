import * as THREE from 'three';

/** Head gaze provider. Swap for an eye tracking provider later: same interface (origin, direction). */
export class HeadGaze {
  constructor(camera) { this.camera = camera; this.origin = new THREE.Vector3(); this.direction = new THREE.Vector3(); }
  update() {
    this.camera.getWorldPosition(this.origin);
    this.camera.getWorldDirection(this.direction);
  }
}

/** Looked-at-ness 0..1 for a point in the world: angle proximity times dwell time. */
export class GazeTarget {
  constructor(getCenter, { fullAngle = 8, falloffAngle = 25, dwellIn = 1.5, dwellOut = 2.5 } = {}) {
    this.getCenter = getCenter;
    Object.assign(this, { fullAngle, falloffAngle, dwellIn, dwellOut });
    this.dwell = 0; this.proximity = 0; this.value = 0;
    this._v = new THREE.Vector3();
  }
  update(gaze, dt) {
    const c = this.getCenter(this._v).sub(gaze.origin);
    const dist = c.length();
    if (dist < 1e-3) { this.proximity = 1; }
    else {
      const ang = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(c.divideScalar(dist).dot(gaze.direction), -1, 1)));
      this.proximity = ang <= this.fullAngle ? 1 : ang >= this.falloffAngle ? 0 : 1 - (ang - this.fullAngle) / (this.falloffAngle - this.fullAngle);
    }
    const looking = this.proximity > 0;
    this.dwell = THREE.MathUtils.clamp(this.dwell + (looking ? dt / this.dwellIn : -dt / this.dwellOut), 0, 1);
    this.value = this.dwell * this.proximity;
    return this.value;
  }
}
