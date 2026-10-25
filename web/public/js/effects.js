import * as THREE from 'three';
import { EFFECT_STRENGTH, MAX_ROOM_DIMMING, MAX_WALL_CONTRACTION } from './profiles.js';
import { updateEnvironmentGeometry } from './environment.js';
import { WallCollisionSystem } from './wall-collisions.js';
import { updateGazeScale } from './furniture-gaze.js';
import { PovBlackout } from './pov-blackout.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Repeating horizontal in/out cycle, with a short dwell before motion begins. */
export class WallGazeContraction {
  constructor() {
    this.dwell = 0; this.latched = false; this.amount = 0;
    this.amplitude = MAX_WALL_CONTRACTION; this.halfCycleSeconds = 3;
    this.dwellSeconds = 1; this.releaseSeconds = 2;
    this.holdAfterBlackoutSeconds = 10; this.introPulseCycles = 2;
    this.cycleTime = 0; this.firstCycle = true; this.cycleStartAmount = 0;
    this.releasing = false; this.releaseFrom = 0; this.releaseTime = 0;
  }
  _release(dt, seconds = this.releaseSeconds) {
    if (!this.releasing) {
      this.releasing = true; this.releaseFrom = this.amount; this.releaseTime = 0; this.releaseDuration = seconds;
    } else this.releaseTime += dt;
    const t = THREE.MathUtils.smoothstep(Math.min(this.releaseTime / this.releaseDuration, 1), 0, 1);
    this.amount = THREE.MathUtils.lerp(this.releaseFrom, 0, t);
    return this.amount;
  }
  /** Build with anxiety, hold through both darkness waves, then pulse from inward. */
  updateChoreography(dt, { active, intensity, elapsed, blackoutEndSeconds, buildSeconds = 10, blackoutStartSeconds = 30, recoverySeconds = this.releaseSeconds }) {
    dt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    if (!active) return this.update(dt, null, false, 1, recoverySeconds);
    const amplitude = this.amplitude * clamp01(intensity);
    const pulseStart = blackoutEndSeconds + this.holdAfterBlackoutSeconds;
    const period = 2 * this.halfCycleSeconds;
    const initialCycles = Math.min(this.introPulseCycles, Math.max(0, Math.floor((blackoutStartSeconds - buildSeconds - 4) / period)));
    const initialEnd = buildSeconds + initialCycles * period;
    const earlyPulse = elapsed > buildSeconds && elapsed < initialEnd;
    this.cycleTime = earlyPulse ? elapsed - buildSeconds : Math.max(0, elapsed - pulseStart);
    const target = earlyPulse || elapsed > pulseStart
      ? amplitude * (.5 + .5 * Math.cos(Math.PI * this.cycleTime / this.halfCycleSeconds)) : amplitude;
    // A cosine starts at maximum inward with zero velocity: no jump at handoff.
    // Limit re-entry from floating/recovery without slowing the authored ramp.
    const step = this.amplitude * Math.PI / (2 * this.halfCycleSeconds) * dt;
    this.amount += Math.sign(target - this.amount) * Math.min(Math.abs(target - this.amount), step);
    this.latched = true; this.releasing = false;
    return this.amount;
  }
  update(dt, hitRole, active, intensity = 1, recoverySeconds = this.releaseSeconds) {
    dt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    if (!active) {
      this.dwell = 0; this.latched = false; this.cycleTime = 0; this.firstCycle = true;
      return this._release(dt, recoverySeconds);
    }
    const amplitude = this.amplitude * clamp01(intensity);
    let cycleDt = dt;
    if (!this.latched) {
      // Any non-wall hit interrupts the required continuous one-second look.
      const before = this.dwell;
      this.dwell = hitRole === 'wall' ? Math.min(this.dwellSeconds, this.dwell + dt) : 0;
      if (this.dwell < this.dwellSeconds - 1e-9) return this._release(dt);
      this.latched = true; this.releasing = false;
      this.cycleTime = 0; this.firstCycle = true; this.cycleStartAmount = this.amount;
      cycleDt = Math.max(0, dt - (this.dwellSeconds - before));
    }
    const half = this.halfCycleSeconds, period = half * 2;
    this.cycleTime += cycleDt;
    if (this.cycleTime >= period) { this.firstCycle = false; this.cycleTime %= period; }
    if (this.cycleTime <= half) {
      const t = .5 - .5 * Math.cos(Math.PI * this.cycleTime / half);
      // Restarting anxiety during a release also starts without a position jump.
      this.amount = THREE.MathUtils.lerp(this.firstCycle ? this.cycleStartAmount : 0, amplitude, t);
    } else {
      const t = .5 + .5 * Math.cos(Math.PI * (this.cycleTime - half) / half);
      this.amount = amplitude * t;
    }
    return this.amount;
  }
}


/** Applies the director's channels to the environment: space, vision, light, objects. Audio is separate. */
export class Effects {
  constructor(scene, director, env, fx, camera, strengthOverrides = {}) {
    this.director = director; this.env = env; this.fx = fx; this.camera = camera;
    this.s = { ...EFFECT_STRENGTH, ...strengthOverrides };
    this.t = 0;
    this.wallGaze = new WallGazeContraction();
    this.blackout = new PovBlackout();
    this.values = { Space: 0, Vision: 0, Audio: 0, Light: 0, Objects: 0 };
    this.gazeByKind = { Space: 0, Vision: 0, Audio: 0, Light: 0, Objects: 0 };
    fx.uCenter.value.set(env.center.x, env.center.z);
    fx.uFloorY.value=env.floorY;fx.uRoomHeight.value=env.roomHeight;
    fx.uDropY0.value = env.interior.min.y + env.roomHeight * 0.55;
    fx.uDropY1.value = env.interior.max.y - 0.05;

    // vignette in clip space: identical in both eyes, no parallax, nothing to render when 0
    this.vignetteMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uAmount: { value: 0 }, uInner: { value: this.s.vignetteInner }, uAspect: { value: 1 }, uBlackout: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vP; uniform float uAmount; uniform float uInner; uniform float uAspect; uniform float uBlackout;
        void main(){ float r = length(vP * vec2(max(uAspect,1.0), max(1.0/uAspect,1.0)) ) / 1.2;
          float a = smoothstep(uInner, 1.05, r) * uAmount; gl_FragColor = vec4(0.0, 0.0, 0.0, max(a, uBlackout)); }`,
    });
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.vignetteMat);
    this.vignette.frustumCulled = false; this.vignette.renderOrder = 9999; this.vignette.visible = false;
    scene.add(this.vignette);
    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  setAspect(a) { this.vignetteMat.uniforms.uAspect.value = a; }

  update(dt, gaze, { firstPerson = true, blackoutActive = false, runId = 0, povDelta = dt, settling = false, settlingSeconds = 14 } = {}) {
    this.t += dt;
    const d = this.director, env = this.env, s = this.s;
    // The first frame comes after the character, furniture and contraction
    // centre are placed. Register late additions without rebuilding the room.
    env.wallCollisions ||= new WallCollisionSystem(env, this.fx);
    for (const object of env.objectGroups) {
      if (!env.wallCollisions.get(object.group)) env.wallCollisions.add(object.group, { base: object.base });
    }
    for (const seat of env.collisionSeats || []) {
      if (!env.wallCollisions.get(seat.chair)) env.wallCollisions.add(seat.chair, { base: seat.base, occupant: seat.occupied });
    }

    // One POV clock keeps the wall hold synchronized with both darkness waves.
    const anxietyActive = firstPerson && (d.state === 'Build' || d.state === 'Peak') && d.level > 0;
    const blackout = this.blackout.update(povDelta, { active: firstPerson && blackoutActive, runId, settling: firstPerson && settling });
    const blackoutEnd = this.blackout.count > 0 && this.blackout.durationSeconds > 0
      ? this.blackout.afterSeconds + this.blackout.durationSeconds * this.blackout.count : 0;
    const holdEnd = Math.max(d.profile?.build ?? 0, blackoutEnd);
    const wallContraction = this.wallGaze.updateChoreography(dt, {
      active: anxietyActive, intensity: d.level, elapsed: this.blackout.elapsed, blackoutEndSeconds: holdEnd,
      buildSeconds: d.profile?.build ?? 10, blackoutStartSeconds: this.blackout.afterSeconds, recoverySeconds: settling ? settlingSeconds : this.wallGaze.releaseSeconds,
    });
    const spaceG = anxietyActive && gaze.hitRole === 'wall' ? 1 : 0;
    let lightG = 0, objG = 0;
    for (const t of env.lightTargets) {
      t.fullAngle = s.lightFullAngle; t.falloffAngle = s.lightFalloffAngle; t.dwellIn = s.lightDwellIn; t.dwellOut = s.lightDwellOut;
      lightG = Math.max(lightG, t.update(gaze, dt));
    }
    for (const o of [...env.objectGroups, ...(env.seatGazeObjects || [])]) {
      o.target.dwellIn = s.gazeDwellIn; o.target.dwellOut = s.gazeDwellOut;
      objG = Math.max(objG, o.target.updateHit(gaze.hitObject === o, dt));
    }
    this.gazeByKind = { Space: spaceG, Vision: objG, Audio: objG, Light: lightG, Objects: objG };
    d.setGaze(this.gazeByKind);
    for (const k of Object.keys(this.values)) this.values[k] = firstPerson ? d.channel(k) : 0;
    const v = this.values;

    // SPACE: build inward, hold, then cycle. Ceiling and wall heights stay fixed.
    this.fx.uLeanK.value = wallContraction;
    this.fx.uDrop.value = 0;
    updateEnvironmentGeometry(env,this.fx);

    // VISION: dark edge, colour drains, slight cool shift
    this.fx.uDesat.value = s.desaturateMax * v.Vision;
    this.fx.uCool.value = s.coolShiftMax * v.Vision;
    this.vignetteMat.uniforms.uBlackout.value = blackout;
    this.vignette.visible = v.Vision > 0.002 || blackout > 0;
    this.vignetteMat.uniforms.uAmount.value = s.vignetteMax * v.Vision;
    this.vignetteMat.uniforms.uInner.value = s.vignetteInner;

    // LIGHT: slow irregular dip and general dimming, never a strobe
    const n = 0.5 + 0.25 * Math.sin(this.t * Math.PI * 2 * s.flickerHz * 0.37) + 0.25 * Math.sin(this.t * Math.PI * 2 * s.flickerHz * 0.91 + 1.7);
    const dip = s.flickerDepth * v.Light * n;
    const dim = 1 - Math.min(MAX_ROOM_DIMMING, clamp01(s.ambientDim)) * v.Light;
    const mul = clamp01(dim - dip);
    env.lightSources.forEach((l, i) => { l.intensity = env.lightBase[i] * mul; });
    env.lightMats.forEach((m) => { m.emissiveIntensity = (m.userData.baseEmissive ?? 1) * (0.25 + 0.75 * mul); });

    // Props keep their own drift and gaze growth. Solid walls push their rigid
    // footprints on contact; the furniture is not scaled along with the room.
    this._tmp.copy(gaze.origin);
    const active = d.settings.Objects.maxValue; // Gaze enlargement also works in calm and floating views.
    for (const o of env.objectGroups) {
      const target = firstPerson ? d.rawChannel('Objects', o.target.value) : 0;
      if (!firstPerson) o.smoothed = 0;
      o.smoothed += Math.sign(target - o.smoothed) * Math.min(Math.abs(target - o.smoothed), (target > o.smoothed ? d.settings.Objects.riseSpeed : d.settings.Objects.fallSpeed) * dt);
      const a = o.smoothed;
      updateGazeScale(o, gaze, active, s, dt);
      const drift = s.objDrift * a;
      const px = Math.sin(this.t * 0.55 + o.phase) * drift, pz = Math.cos(this.t * 0.41 + o.phase * 1.3) * drift;
      const bx=o.base.x,bz=o.base.z;
      const toX = this._tmp.x - bx, toZ = this._tmp.z - bz;
      const dist = Math.hypot(toX, toZ);
      const approach = Math.min(s.objApproach * a, Math.max(0, dist - 1.4));
      const ax = dist > 0.01 ? (toX / dist) * approach : 0, az = dist > 0.01 ? (toZ / dist) * approach : 0;
      env.wallCollisions.setDesired(o.group,bx+px+ax,bz+pz+az);
    }
    for (const seat of env.seatGazeObjects || []) {
      updateGazeScale(seat, gaze, active, s, dt);
    }
    env.wallCollisions.update(dt);
    env.root.updateMatrixWorld(true);
  }
}
