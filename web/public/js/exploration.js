import * as THREE from 'three';

const ACTIVE_PHASES = new Set(['observing', 'exploring', 'embodying', 'running']);
const up = new THREE.Vector3(0, 1, 0);

/** Floor-safe locomotion with a gentle guide and immediate visitor steering. */
export class RoomExploration {
  constructor({ scene, camera, rig, renderer, env, character, visitors, panel, isTracked = () => false, reducedMotion = false }) {
    Object.assign(this, { scene, camera, rig, renderer, env, character, visitors, panel, isTracked, reducedMotion });
    this.navigation = this.createNavigation();
    this.active = true; this.enabled = false; this.guided = !reducedMotion;
    this.position = new THREE.Vector3(); this.path = []; this.stops = [];
    this.time = 0; this.hold = 0; this.rest = 0; this.stopIndex = 0;
    this.height = 1.8; this.speed = 0; this.keys = new Set();
    this.impulse = new THREE.Vector2(); this.stick = new THREE.Vector2();
    this.trackingOffset = new THREE.Vector3(); this.wasTracked = false;
    this.target = new THREE.Vector3(); this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(.19, .25, 40),
      new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide }));
    this.marker.name = 'Teleport landing'; this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false; scene.add(this.marker);
    this.reset();
  }

  createNavigation() {
    const nav = this.visitors.navigation.fork(), floorClear = nav.clear;
    // The pathfinder and manual steering must agree about camera distance.
    // Otherwise a newly opened aisle can produce a route through the body.
    nav.clear = function (p, ...args) {
      const world = this.toWorld(p), center = this.character.root.position;
      return Math.hypot(world.x - center.x, world.z - center.z) >= 1.8 &&
        (this.viewerPeers || []).every(peer => p.distanceToSquared(peer) >= (.72 / this.contraction) ** 2) &&
        floorClear.call(this, p, ...args);
    };
    return nav;
  }

  refresh(dt = .1) {
    this.navigation.refresh(null, dt);
    this.navigation.viewerPeers = this.visitors.visitors.map(visitor => this.navigation.toBase(visitor.root.position));
    this.character.getEyePosition(this.target); this.target.y = this.env.floorY + .85;
  }

  reset() {
    this.refresh();
    const base = this.navigation.toBase(new THREE.Vector3(this.env.spawn.x, 0, this.env.spawn.z));
    const id = this.navigation.nearest(base);
    if (id >= 0) this.position.copy(this.navigation.point(id));
    this.path = []; this.stops = []; this.stopIndex = 0; this.hold = 2; this.rest = 0; this.time = 0;
    this.speed = 0; this.height = 1.8; this.clearInput(); this.captureTracking(); this.planStops();
  }

  clearInput() { this.walkPath=[];this.keys.clear(); this.impulse.set(0, 0); this.stick.set(0, 0); this.marker.visible = false; }

  planStops(reachableOnly = true) {
    const nav = this.navigation, center = nav.toBase(this.character.root.position);
    const reachable = new Set();
    if (reachableOnly) {
      const seed = nav.nearest(this.position);
      if (seed >= 0) {
        const queue = [seed]; reachable.add(seed);
        for (let i = 0; i < queue.length; i++) for (const next of nav.neighbors(queue[i])) {
          if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
        }
      }
    }
    const candidates = [];
    for (let id = 0; id < nav.cells.length; id++) if (nav.cells[id] && (!reachableOnly || reachable.has(id))) {
      const p = nav.point(id), distance = p.distanceTo(center) * nav.contraction;
      if (distance >= 2.1 && distance <= 5.5 && nav.clear(p)) candidates.push(p);
    }
    this.stops = [];
    const startAngle = Math.atan2(this.position.z - center.z, this.position.x - center.x);
    for (let i = 0; i < 6; i++) {
      const angle = startAngle + i * Math.PI / 3;
      const ideal = center.clone().add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(3.3));
      candidates.sort((a, b) => a.distanceToSquared(ideal) - b.distanceToSquared(ideal));
      const stop = candidates.find(p => this.stops.every(s => s.distanceTo(p) > 1));
      if (stop) this.stops.push(stop.clone());
    }
  }

  beginPullback() {
    this.reset();this.guided=false;this.walkPath=[];
    const start=this.position.clone(),center=this.navigation.toBase(this.character.root.position);
    const direction=start.clone().sub(center).normalize();
    const id=this.navigation.nearest(start.clone().addScaledVector(direction,.75));
    const end=id>=0?this.navigation.point(id):start.clone();
    this.pullbackStart=start;
    this.pullbackEnd=this.navigation.segment(start,end)?end:start.clone();
    this.position.copy(this.pullbackStart);this.placeCamera();
    // Establish Signal once; subsequent physical/drag look is never overwritten.
    if(!this.isTracked()){
      const eye=this.camera.getWorldPosition(new THREE.Vector3()),target=this.character.getEyePosition(new THREE.Vector3());
      this.rig.quaternion.identity();this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye,target,up));
    }
  }
  updatePullback(session) {
    const t=THREE.MathUtils.smoothstep(Math.min(1,session.phaseTime/Math.max(.001,session.phaseDuration)),0,1);
    this.position.lerpVectors(this.pullbackStart,this.pullbackEnd,t);this.placeCamera();
  }
  walkTo(world) {
    if(!this.active||!this.enabled||this.panel.mesh.visible)return false;
    this.refresh();const end=this.destination(world);
    if(!end)return false;
    const path=this.navigation.path(this.position,end);
    if(!path?.length)return false;
    this.guided=false;this.walkPath=path;this.walkDestination=end.clone();this.speed=0;this.onChange?.();return true;
  }

  beginShowcase() {
    this.reset();this.enabled=false;this.showcaseLength=0;
    this.height=1.8;this.placeCamera();
    const eye=this.camera.getWorldPosition(new THREE.Vector3());
    const rear=this.env.objectGroups.find(o=>o.group.name==='Rear gallery Nike sculpture');
    const west=this.env.objectGroups.find(o=>o.group.name==='Object6');
    const seated=this.visitors.slots?.filter(s=>s.chair)||[];
    const seatFocus=seated.length?seated.reduce((p,s)=>p.add(s.chair.getWorldPosition(new THREE.Vector3())),new THREE.Vector3()).multiplyScalar(1/seated.length).add(new THREE.Vector3(0,1.1,0)):this.character.getEyePosition(new THREE.Vector3());
    const focus=object=>object?object.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,1.3,0)):this.character.getEyePosition(new THREE.Vector3());
    const targets=[focus(rear),seatFocus,focus(west),this.character.getEyePosition(new THREE.Vector3())];
    this.showcaseRotations=targets.map(target=>new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye,target,up)));
    // Keep the opening sweep, then join a camera-only circle around the large table.
    const table = this.env.objectGroups.find(object => object.kind === 'table');
    const box = table ? new THREE.Box3().setFromObject(table.group) : this.env.interior;
    this.orbitCenter = box.getCenter(new THREE.Vector3());
    this.orbitRadius = table ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + .9 : 3;
    this.orbitAngle = Math.atan2(eye.z - this.orbitCenter.z, eye.x - this.orbitCenter.x) - Math.PI / 2;
    this.overviewPosition = eye.clone();
    this.showcaseTrackedOffset = this.camera.position.clone();
    this.showcaseStartRigRotation = this.rig.quaternion.clone();
    this.orbitHeight = this.env.floorY + 2.6;
    this.showcaseLength = 2 * Math.PI * this.orbitRadius;
    if(!this.isTracked()){this.rig.quaternion.identity();this.camera.quaternion.copy(this.showcaseRotations[0]);this.rig.updateMatrixWorld(true);}
  }

  updateShowcase(dt, session) {
    this.enabled = false; this.clearInput();
    const elapsed = session.phaseTime;
    // The complete opening scales to ten seconds: an establishing look,
    // a floating approach and one full orbit, tracking Signal as he walks and sits.
    const scale = session.observationSeconds / 38;
    const overview = 10 * scale, approach = 4 * scale, orbit = 24 * scale;
    if (elapsed <= overview || this.reducedMotion) {
      this.height = 1.8; this.time = 0; this.placeCamera();
      if (this.isTracked()) return;
      const times = [0, 3.2, 6.2, 8.5].map(t => t * scale);
      let segment = 0;
      while (segment < 2 && elapsed > times[segment + 1]) segment++;
      const t = THREE.MathUtils.clamp((elapsed - times[segment]) / Math.max(.001, times[segment + 1] - times[segment]), 0, 1);
      const ease = t * t * (3 - 2 * t);
      this.rig.quaternion.identity();
      this.camera.quaternion.slerpQuaternions(this.showcaseRotations[segment], this.showcaseRotations[segment + 1], ease);
    } else {
      const joining = elapsed < overview + approach;
      const progress = THREE.MathUtils.clamp((elapsed - overview - approach) / Math.max(.001, orbit), 0, 1);
      // Smooth velocity at both ends; complete exactly one full turn.
      const turn = progress - Math.sin(progress * 2 * Math.PI) / (2 * Math.PI);
      const angle = this.orbitAngle - turn * 2 * Math.PI;
      const position = new THREE.Vector3(this.orbitCenter.x + this.orbitRadius * Math.cos(angle),
        this.orbitHeight, this.orbitCenter.z + this.orbitRadius * Math.sin(angle));
      if (joining) {
        const t = THREE.MathUtils.smoothstep((elapsed - overview) / Math.max(.001, approach), 0, 1);
        position.lerpVectors(this.overviewPosition, position, t);
      }
      this.character.getEyePosition(this.target);
      if (this.isTracked()) {
        // Move the virtual rig, while physical headset/phone look remains live.
        const yaw = Math.atan2(position.x - this.target.x, position.z - this.target.z);
        const rotation = new THREE.Quaternion().setFromAxisAngle(up, yaw);
        const t = joining ? THREE.MathUtils.smoothstep((elapsed - overview) / Math.max(.001, approach), 0, 1) : 1;
        this.rig.quaternion.slerpQuaternions(this.showcaseStartRigRotation, rotation, t);
        this.rig.position.copy(position).sub(this.showcaseTrackedOffset.clone().applyQuaternion(this.rig.quaternion));
      } else {
        this.rig.quaternion.identity();
        this.camera.position.set(0, 1.6, 0);
        this.rig.position.copy(position).sub(this.camera.position);
        this.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(position, this.target, up));
      }
      this.position.copy(this.navigation.toBase(position)); this.position.y = 0;
    }
    this.rig.updateMatrixWorld(true);
  }

  toggleGuided() {
    this.guided = !this.guided; this.hold = 0; this.rest = 0; this.path = [];
    this.onChange?.();
  }

  steer(dx, dy) {
    if (!this.active || !this.enabled) return false;
    const angles = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.rig.rotation.y += angles.y - dx * .003;
    this.camera.rotation.set(THREE.MathUtils.clamp(angles.x - dy * .003, -Math.PI / 2, Math.PI / 2), 0, 0, 'YXZ');
    this.hold = 4; this.path = [];
    return true;
  }

  destination(world) {
    const nav = this.navigation, base = nav.toBase(world), id = nav.nearest(base);
    if (id < 0) return null;
    const p = nav.point(id);
    // Only snap within the clicked patch of clear floor, never across a wall.
    if (p.distanceTo(base) * nav.contraction > .4 || !nav.clear(p)) return null;
    if (nav.toWorld(p).distanceTo(this.character.root.position) < 1.8) return null;
    return p;
  }

  teleport(world) {
    if (!this.active || !this.enabled || this.panel.mesh.visible) return false;
    this.refresh();
    const p = this.destination(world);
    if (!p) return false;
    this.position.copy(p); this.path = []; this.hold = 6; this.rest = 0; this.speed = 0;
    this.impulse.set(0, 0); this.marker.visible = false;
    this.captureTracking(); this.placeCamera(); this.onChange?.(); return true;
  }

  nextStop() {
    if (!this.active || !this.enabled) return false;
    this.refresh(); this.planStops(false);
    for (let i = 0; i < this.stops.length; i++) {
      const p = this.stops[this.stopIndex++ % this.stops.length];
      if (p.distanceTo(this.position) > .8 && this.teleport(this.navigation.toWorld(p))) return true;
    }
    return false;
  }

  pick(ray) {
    if (!this.active || !this.enabled || this.panel.mesh.visible) return null;
    const hit = ray.intersectObjects(this.env.raycastMeshes, false).find(h => h.object.visible);
    if (!hit || hit.object.userData.environmentRole !== 'floor') return null;
    return this.destination(hit.point);
  }

  preview(ray) {
    const p = this.pick(ray); this.marker.visible = Boolean(p);
    if (p) this.marker.position.copy(this.navigation.toWorld(p)).add(new THREE.Vector3(0, .025, 0));
    return p;
  }

  move(delta) {
    const nav = this.navigation, next = this.position.clone().add(delta);
    const center = nav.toBase(this.character.root.position);
    if (next.distanceTo(center) * nav.contraction < 1.8) return false;
    if (!nav.segment(this.position, next)) return false;
    this.position.copy(next); return true;
  }

  captureTracking() { this.trackingOffset.copy(this.camera.position).applyQuaternion(this.rig.quaternion); }

  placeCamera() {
    const world = this.navigation.toWorld(this.position);
    const tracked = this.isTracked();
    // Preserve the headset/phone's physical orientation. Locomotion never writes
    // tracked pose; compensate its local X/Z offset at the virtual landing.
    const local = this.trackingOffset;
    this.rig.position.set(world.x - local.x, world.y + this.height - local.y, world.z - local.z);
    if (!tracked) {
      this.camera.position.set(0, 1.6, 0);
      this.rig.position.set(world.x, world.y + this.height - 1.6 + (this.guided && !this.reducedMotion ? .025 * Math.sin(this.time * .6) : 0), world.z);
      this.rig.updateMatrixWorld(true);
    }
    this.rig.updateMatrixWorld(true);
  }

  update(dt, session) {
    dt = Math.min(.1, Math.max(0, dt));
    this.enabled = ACTIVE_PHASES.has(session.phase) && !this.panel.mesh.visible;
    if (!this.enabled) { this.clearInput(); this.speed = 0; return; }
    this.time += dt; this.hold = Math.max(0, this.hold - dt); this.rest = Math.max(0, this.rest - dt);
    const tracked = this.isTracked();
    if (tracked !== this.wasTracked || this.wasXR !== this.renderer.xr.isPresenting) {
      this.captureTracking(); this.clearInput();
      // Headsets enter with stationary exploration; stick-click opts into drift.
      if (tracked && this.renderer.xr.isPresenting) this.guided = false;
      this.wasTracked = tracked;
      this.wasXR = this.renderer.xr.isPresenting;
    }
    this.refresh(dt);
    const nav = this.navigation;
    // Furniture and contracting walls can invalidate a formerly clear landing.
    if (!nav.clear(this.position)) {
      const id = nav.nearest(this.position);
      if (id >= 0) { this.position.copy(nav.point(id)); this.path = []; }
    }
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const x = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')) + this.stick.x;
    const z = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')) - this.stick.y;
    const height = Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));
    const manual = Math.hypot(x, z, height) > .05 || this.impulse.length() > .01;
    if (manual) {
      this.hold = 4; this.path = []; this.walkPath=[]; this.speed = 0;
      this.height = THREE.MathUtils.clamp(this.height + height * dt * .35, 1.45, Math.min(2.5, this.env.roomHeight - .4));
      const delta = right.multiplyScalar(x * .8 * dt + this.impulse.x * dt * 5)
        .addScaledVector(forward, z * .8 * dt + this.impulse.y * dt * 5).divideScalar(nav.contraction);
      this.move(delta); this.impulse.multiplyScalar(Math.exp(-5 * dt));
    } else if(this.walkPath?.length){
      const destination=this.walkPath[0],delta=destination.clone().sub(this.position),distance=delta.length();
      this.speed=THREE.MathUtils.damp(this.speed,1.05,4,dt);
      const step=Math.min(distance,this.speed*dt/nav.contraction);
      if(this.move(delta.multiplyScalar(step/Math.max(distance,1e-6)))){
        if(distance<=step+.005)this.walkPath.shift();
      }else{
        this.walkPath=nav.path(this.position,this.walkDestination)||[];this.speed=0;
      }
    } else if (this.guided && !this.hold && !this.rest) {
      if (!this.path.length) {
        for (let i = 0; i < this.stops.length; i++) {
          const stop = this.stops[this.stopIndex++ % this.stops.length];
          if (stop.distanceTo(this.position) < .8 || !nav.clear(stop)) continue;
          const path = nav.path(this.position, stop);
          if (path?.length) { this.path = path; break; }
        }
        if (!this.path.length) { this.planStops(); this.rest = 2; }
      }
      const destination = this.path[0];
      if (destination) {
        const delta = destination.clone().sub(this.position), distance = delta.length();
        this.speed = THREE.MathUtils.damp(this.speed, .28, 1.5, dt);
        const step = Math.min(distance, this.speed * dt / nav.contraction);
        if (this.move(delta.multiplyScalar(step / Math.max(1e-6, distance)))) {
          if (distance < step + .01) this.path.shift();
          if (!this.path.length) { this.rest = 3; this.speed = 0; }
        } else { this.path = []; this.rest = 1; this.speed = 0; }
      }
    } else this.speed = 0;
    this.placeCamera();
  }
}

