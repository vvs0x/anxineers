import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { signalMaterial, Scribble, scribbleSettings } from './signal.js';
import { FootSupport, fitSeatedPose } from './grounding.js';

const STANDING_SAMPLE = 5;
const ASSET_BASE = '/characters/signal/';
const cleanBone = name => name.replace(/^mixamorig\d*[:_]?/, '');
const ease = value => THREE.MathUtils.smoothstep(value, 0, 1);

/** The existing Signal character, independent of the room's lighting and anxiety director. */
export class SignalCharacter {
  constructor(scene, gltf, texture, { position = new THREE.Vector3(), yaw = 0, seatHeight = null, walkClip = null } = {}) {
    this.root = new THREE.Group();
    this.root.name = 'SignalCharacter';
    this.root.position.copy(position);
    this.root.rotation.y = yaw;
    this.model = gltf.scene;
    this.root.add(this.model);
    scene.add(this.root);
    this.bones = new Map();
    this.material = signalMaterial(texture);
    this.texture = texture;
    this.model.traverse(o => {
      if (o.isBone) this.bones.set(o.name.replace(/^mixamorig[:_]?/, ''), o);
      if (o.isMesh) {
        o.material = this.material;
        o.frustumCulled = false;
        // The viewer's own body must not win the room-object gaze raycast.
        o.userData.signalCharacter = true;
      }
    });
    this.hips = this.bones.get('Hips');
    this.head = this.bones.get('Head');
    this.neck = this.bones.get('Neck');
    if (!this.hips || !this.head || !this.neck || !gltf.animations.length) {
      this.root.removeFromParent();
      throw new Error('Signal character requires its skeleton and scared animation.');
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    gltf.animations.forEach(clip => this.mixer.clipAction(clip).play());
    this.seatHeight = seatHeight;
    this.poseMode = 'observe';
    this.embodied = false;
    this.chaosTime = 0;
    this.scribbleTime = 0;
    this._neck = new THREE.Vector3();
    this._head = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._eyeOffset = new THREE.Vector3();
    this.mixer.setTime(STANDING_SAMPLE);
    this.root.updateMatrixWorld(true);
    this.seatedHipRotation = this.hips.quaternion.clone();
    this.openingSeatPosition = position.clone(); this.openingSeatYaw = yaw;
    this.openingModelPosition = this.model.position.clone();
    this.openingStandingPose = [...this.bones.values()].map(bone => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
    this.openingWalk = [];
    if (walkClip) this.setOpeningWalk(walkClip);
    // Tube vertices are world-space, so the scribble group stays at scene origin.
    this.scribble = new Scribble(scene, this.bones);
    this.scribble.group.name = 'SignalScribbles';
    this.applySeatedPose();
    this.support = new FootSupport(this.root, this.model, this.bones);
    this.hipRotation = this.seatedHipRotation;
    this.update(0, 0);
  }

  /** Retarget only Mixamo rotations: Signal keeps its own proportions and root motion. */
  setOpeningWalk(clip) {
    this.openingWalkDuration = clip.duration;
    this.openingWalk = clip.tracks.filter(track => track.name.endsWith('.quaternion')).flatMap(track => {
      const bone = this.bones.get(cleanBone(track.name.slice(0, -'.quaternion'.length)));
      return bone ? [{ bone, sample: track.createInterpolant() }] : [];
    });
    return this;
  }

  restoreOpeningStanding() {
    this.model.position.copy(this.openingModelPosition);
    for (const saved of this.openingStandingPose) {
      saved.bone.position.copy(saved.position); saved.bone.quaternion.copy(saved.quaternion);
    }
  }

  /** A calm left-to-right walk across the seat's foreground, followed by sitting. */
  updateOpening(elapsed, duration = 10) {
    const p = THREE.MathUtils.clamp(elapsed / Math.max(.001, duration), 0, 1);
    if (this.seatHeight === null) return;
    this.openingActive = true;
    this.restoreOpeningStanding();
    const forward = new THREE.Vector3(Math.sin(this.openingSeatYaw), 0, Math.cos(this.openingSeatYaw));
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const seat = this.openingSeatPosition;
    const left = seat.clone().addScaledVector(forward, .85).addScaledVector(right, -.7);
    const across = seat.clone().addScaledVector(forward, .85).addScaledVector(right, .7);
    const front = seat.clone().addScaledVector(forward, .68);
    let heading = right.clone(), travel = 0;
    if (p < .5) {
      const t = ease((p - .05) / .45);
      this.root.position.lerpVectors(left, across, t); travel = left.distanceTo(across) * t;
    } else if (p < .68) {
      const t = ease((p - .5) / .18);
      this.root.position.lerpVectors(across, front, t); heading.subVectors(front, across).normalize();
      travel = left.distanceTo(across) + across.distanceTo(front) * t;
    } else {
      this.root.position.copy(front); heading.copy(forward);
      travel = left.distanceTo(across) + across.distanceTo(front);
    }
    let yaw = Math.atan2(heading.x, heading.z);
    if (p >= .45 && p < .68) {
      const from = Math.atan2(right.x, right.z), toward = front.clone().sub(across).normalize();
      const to = Math.atan2(toward.x, toward.z);
      yaw = from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * ease((p - .45) / .1);
    }
    // Turn on planted feet before sitting back onto the supporting cushion.
    if (p >= .68) {
      const approach = front.clone().sub(across).normalize(), from = Math.atan2(approach.x, approach.z);
      yaw = from + Math.atan2(Math.sin(this.openingSeatYaw - from), Math.cos(this.openingSeatYaw - from)) * ease((p - .68) / .07);
    }
    this.root.rotation.y = yaw;
    const walkTime = (travel / .85) % (this.openingWalkDuration || 1);
    for (const entry of this.openingWalk) entry.bone.quaternion.fromArray(entry.sample.evaluate(walkTime));
    if (p >= .65) {
      const settle = ease((p - .65) / .1);
      for (const saved of this.openingStandingPose) saved.bone.quaternion.slerp(saved.quaternion, settle);
    }
    this.root.updateMatrixWorld(true);
    // The source scared clip has authored horizontal hip drift. Keep the walk's
    // root on its path while retaining Signal's own limb lengths.
    const hip = this.hips.getWorldPosition(new THREE.Vector3());
    const modelWorld = this.model.getWorldPosition(new THREE.Vector3());
    modelWorld.x += this.root.position.x - hip.x; modelWorld.z += this.root.position.z - hip.z;
    this.model.position.copy(this.root.worldToLocal(modelWorld));
    this.root.updateMatrixWorld(true); this.support.ground(seat.y);
    if (p >= .75) {
      const sitting = ease((p - .75) / .25);
      this.root.position.lerpVectors(front, seat, sitting); this.root.rotation.y = this.openingSeatYaw;
      // Blend the upper body into Signal's original authored seated attitude.
      for (const saved of this.openingStandingPose) {
        if (!/^(Hips|LeftUpLeg|RightUpLeg|LeftLeg|RightLeg|LeftFoot|RightFoot|LeftToeBase|RightToeBase)$/.test(cleanBone(saved.bone.name)))
          saved.bone.quaternion.slerp(saved.quaternion, sitting);
      }
      this.root.updateMatrixWorld(true);
      fitSeatedPose(this, seat.y + this.seatHeight, seat.y, sitting);
      this.support.ground(seat.y);
    }
    if (p >= 1) this.finishOpening();
    else this.syncVisuals();
    return this;
  }

  finishOpening() {
    if (!this.openingActive) return;
    this.openingActive = false;
    this.root.position.copy(this.openingSeatPosition); this.root.rotation.y = this.openingSeatYaw;
    this.restoreOpeningStanding(); this.applySeatedPose(); this.syncVisuals();
  }

  applySeatedPose() {
    if (this.seatHeight === null) return;
    if (this.support) {
      const floorY = this.root.getWorldPosition(new THREE.Vector3()).y;
      fitSeatedPose(this, floorY + this.seatHeight, floorY);
      return;
    }
    this.hips.quaternion.copy(this.seatedHipRotation);
    this.root.updateMatrixWorld(true);
    const target = this.root.localToWorld(new THREE.Vector3(0, this.seatHeight + .095, 0));
    this.hips.position.copy(this.hips.parent.worldToLocal(target));
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const aim = (bone, child, direction) => {
      const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
      const to = direction.clone().applyQuaternion(rootQ).normalize();
      const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromUnitVectors(from, to));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
      this.root.updateMatrixWorld(true);
    };
    for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
      const upper = this.bones.get(side + 'UpLeg'), lower = this.bones.get(side + 'Leg');
      const foot = this.bones.get(side + 'Foot'), toe = this.bones.get(side + 'ToeBase');
      aim(upper, lower, new THREE.Vector3(sign * .12, -.08, 1));
      aim(lower, foot, new THREE.Vector3(0, -1, .04));
      aim(foot, toe, new THREE.Vector3(0, -.18, 1));
    }
  }

  setPoseMode(mode) {
    if (mode !== 'observe' && mode !== 'embodied') throw new Error('Unknown Signal pose mode: ' + mode);
    if (this.poseMode !== mode) {
      this.poseMode = mode;
      if (!this.openingActive) { this.mixer.setTime(STANDING_SAMPLE); this.applySeatedPose(); }
      this.root.updateMatrixWorld(true);
    }
    return this;
  }

  setEmbodied(value) {
    this.embodied = Boolean(value);
    this.setPoseMode(this.embodied ? 'embodied' : 'observe');
    this.material.uniforms.embodied.value = this.embodied ? 1 : 0;
    return this;
  }

  /** World position for a camera handoff. The rig, not the animation, owns head tracking. */
  getEyePosition(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    this.head.getWorldPosition(out);
    this.root.getWorldQuaternion(this._quaternion);
    // Character faces local +Z. Use the body's orientation, not the scared head roll.
    this._eyeOffset.set(0, .045, .08).applyQuaternion(this._quaternion);
    return out.add(this._eyeOffset);
  }

  getForward(out = new THREE.Vector3()) {
    this.root.getWorldQuaternion(this._quaternion);
    return out.set(0, 0, 1).applyQuaternion(this._quaternion).normalize();
  }

  update(dt, chaos, { embodied = this.embodied, viewerPosition = null } = {}) {
    dt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    chaos = THREE.MathUtils.clamp(Number.isFinite(chaos) ? chaos : 0, 0, 1);
    this.currentChaos = chaos;
    if (Boolean(embodied) !== this.embodied) this.setEmbodied(embodied);
    // Calm observation is still. During embodiment freeze the posture: tracked head
    // motion stays independent of the character's prerecorded frightened movements.
    if (!this.openingActive && this.poseMode === 'observe' && chaos > 0) this.mixer.update(dt);
    else if (!this.openingActive && this.poseMode === 'observe') this.mixer.setTime(STANDING_SAMPLE);
    this.chaosTime += dt * THREE.MathUtils.lerp(1.0, 2.4, chaos);
    this.scribbleTime += dt * scribbleSettings(chaos).speed;
    this.root.updateMatrixWorld(true);
    if (!this.openingActive) this.applySeatedPose();
    this.syncVisuals(viewerPosition);
  }

  syncVisuals(viewerPosition = null) {
    this.root.updateMatrixWorld(true);
    this.hips.getWorldPosition(this.material.uniforms.anchor.value);
    this.neck.getWorldPosition(this._neck);
    this.head.getWorldPosition(this._head);
    // Keep the shoulders, arms, and torso, but remove the head in the user's view.
    const clipY = this._neck.y + .015;
    this.material.uniforms.clipY.value = clipY;
    this.material.uniforms.chaos.value = this.currentChaos;
    this.material.uniforms.time.value = this.chaosTime;
    this.root.getWorldQuaternion(this._quaternion);
    this.material.uniforms.bodyRight.value.set(1, 0, 0).applyQuaternion(this._quaternion);
    this.scribble.setView(this.embodied, clipY, viewerPosition || this.getEyePosition(this._head));
    this.scribble.update(this.currentChaos, this.scribbleTime);
    this.scribble.group.visible = this.root.visible && scribbleSettings(this.currentChaos).visible;
  }

  reset() {
    this.finishOpening();
    this.chaosTime = this.scribbleTime = 0;
    this.setEmbodied(false);
    this.mixer.setTime(STANDING_SAMPLE);
    this.update(0, 0);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
    this.scribble.dispose();
    this.model.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    this.material.dispose();
    this.texture.dispose();
  }
}

export async function loadSignalCharacter(scene, options = {}) {
  const [gltf, texture, walking] = await Promise.all([
    new GLTFLoader().loadAsync(ASSET_BASE + 'remy.glb'),
    new THREE.TextureLoader().loadAsync(ASSET_BASE + 'SignalText.png'),
    new GLTFLoader().loadAsync('/characters/visitors/visitor-a.glb'),
  ]);
  return new SignalCharacter(scene, gltf, texture, { ...options, walkClip: walking.animations[0] });
}
