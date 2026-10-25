import * as THREE from 'three';

/** Head gaze provider. Swap for an eye tracking provider later: same interface (origin, direction). */
export class HeadGaze {
  constructor(camera) { this.camera = camera; this.origin = new THREE.Vector3(); this.direction = new THREE.Vector3(); this.hitObject=null; this.hitRole=null; this.hitMesh=null; }
  update() {
    if(this.camera.isArrayCamera){
      // WebXR owns this world matrix; updateWorldMatrix would discard the rig pose.
      this.origin.setFromMatrixPosition(this.camera.matrixWorld);
      this.direction.set(0,0,-1).transformDirection(this.camera.matrixWorld);
    }else{
      this.camera.getWorldPosition(this.origin);
      this.camera.getWorldDirection(this.direction);
    }
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
  updateHit(looking, dt) {
    this.proximity=looking?1:0;
    this.dwell=THREE.MathUtils.clamp(this.dwell+(looking?dt/this.dwellIn:-dt/this.dwellOut),0,1);
    // Smooth the departure too, so a prop shrinks gently when attention moves away.
    this.value=this.dwell;
    return this.value;
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

/** A visible head-direction cursor, with exact occlusion against rendered meshes.
 * Quest 3 supplies head orientation, not eye tracking. No gaze history is stored.
 */
export class GazeCursor {
  constructor(scene,env){
    this.env=env;this.raycaster=new THREE.Raycaster();this.raycaster.far=50;this.raycaster.firstHitOnly=true;
    this.dot=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshBasicMaterial({color:0xff2525,depthTest:false,depthWrite:false,toneMapped:false}));
    this.dot.name='Head gaze indicator';this.dot.renderOrder=10001;scene.add(this.dot);
    this.hitPoint=new THREE.Vector3();this.hitObject=null;this.hitRole=null;this.hitMesh=null;this.distance=3;this.sinceCast=Infinity;
    this.hitNormal=new THREE.Vector3();this.normalMatrix=new THREE.Matrix3();
  }
  update(gaze,dt=1/60){
    this.sinceCast+=dt;
    if(this.sinceCast>=1/30){
      this.sinceCast=0;this.env.root.updateMatrixWorld(true);
      this.raycaster.set(gaze.origin,gaze.direction);
      const hits=this.raycaster.intersectObjects(this.env.raycastMeshes,false);
      const hit=hits.find(h=>{
        const mats=Array.isArray(h.object.material)?h.object.material:[h.object.material];
        const mat=mats[h.face?.materialIndex||0];
        let visible=true;for(let o=h.object;o;o=o.parent)if(!o.visible){visible=false;break;}
        return visible&&mat?.visible!==false&&!(mat?.transparent&&mat.opacity<.15);
      });
      this.hitMesh=hit?.object||null;
      this.hitRole=this.hitMesh?.userData.environmentRole||null;
      // Some authored wall objects also contain ceiling faces. Only upright
      // surfaces count toward the wall dwell, regardless of their parent name.
      if(this.hitRole==='wall'&&hit?.face){
        this.hitNormal.copy(hit.face.normal).applyNormalMatrix(this.normalMatrix.getNormalMatrix(this.hitMesh.matrixWorld));
        if(Math.abs(this.hitNormal.y)>.7)this.hitRole=this.hitNormal.y<0?'ceiling':'floor';
      }
      this.hitObject=this.hitMesh?.userData.gazeObject||null;
      this.distance=hit?hit.distance:3;
      if(hit)this.hitPoint.copy(hit.point);else this.hitPoint.copy(gaze.origin).addScaledVector(gaze.direction,3);
    }
    gaze.hitObject=this.hitObject;gaze.hitRole=this.hitRole;gaze.hitMesh=this.hitMesh;
    // Head-locked aiming stays responsive between the lower-frequency scene tests.
    this.dot.position.copy(gaze.origin).addScaledVector(gaze.direction,Math.max(.1,this.distance-.012));
    this.dot.scale.setScalar(THREE.MathUtils.clamp(this.distance*.004,.002,.04));
  }
  dispose(){this.dot.removeFromParent();this.dot.geometry.dispose();this.dot.material.dispose();}
}
