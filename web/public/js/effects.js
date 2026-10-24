import * as THREE from 'three';
import { EFFECT_STRENGTH } from './profiles.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Applies the director's channels to the environment: space, vision, light, objects. Audio is separate. */
export class Effects {
  constructor(scene, director, env, fx, camera, strengthOverrides = {}) {
    this.director = director; this.env = env; this.fx = fx; this.camera = camera;
    this.s = { ...EFFECT_STRENGTH, ...strengthOverrides };
    this.t = 0;
    this.values = { Space: 0, Vision: 0, Audio: 0, Light: 0, Objects: 0 };
    this.gazeByKind = { Space: 0, Vision: 0, Audio: 0, Light: 0, Objects: 0 };
    fx.uCenter.value.set(env.center.x, env.center.z);
    fx.uDropY0.value = env.interior.min.y + env.roomHeight * 0.55;
    fx.uDropY1.value = env.interior.max.y - 0.05;

    // vignette in clip space: identical in both eyes, no parallax, nothing to render when 0
    this.vignetteMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uAmount: { value: 0 }, uInner: { value: this.s.vignetteInner }, uAspect: { value: 1 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vP; uniform float uAmount; uniform float uInner; uniform float uAspect;
        void main(){ float r = length(vP * vec2(max(uAspect,1.0), max(1.0/uAspect,1.0)) ) / 1.2;
          float a = smoothstep(uInner, 1.05, r) * uAmount; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
    });
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.vignetteMat);
    this.vignette.frustumCulled = false; this.vignette.renderOrder = 9999; this.vignette.visible = false;
    scene.add(this.vignette);
    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  setAspect(a) { this.vignetteMat.uniforms.uAspect.value = a; }

  update(dt, gaze) {
    this.t += dt;
    const d = this.director, env = this.env, s = this.s;

    // gaze per channel
    let spaceG = 0, lightG = 0, objG = 0;
    for (const t of env.roomTargets) spaceG = Math.max(spaceG, t.update(gaze, dt));
    for (const t of env.lightTargets) lightG = Math.max(lightG, t.update(gaze, dt));
    for (const o of env.objectGroups) objG = Math.max(objG, o.target.update(gaze, dt));
    this.gazeByKind = { Space: spaceG, Vision: objG, Audio: objG, Light: lightG, Objects: objG };
    d.setGaze(this.gazeByKind);
    for (const k of Object.keys(this.values)) this.values[k] = d.channel(k);
    const v = this.values;

    // SPACE: the room closes in horizontally, the upper part drops
    const leanMeters = Math.min(s.wallLeanMeters + s.wallGazeExtraMeters * spaceG, 1.6);
    const half = Math.max(1, Math.min(env.interior.max.x - env.interior.min.x, env.interior.max.z - env.interior.min.z) / 2);
    const wantK = Math.min(s.wallLeanFraction, leanMeters / half);
    this.fx.uLeanK.value = wantK * v.Space;
    this.fx.uDrop.value = s.ceilingDropMeters * v.Space;

    // VISION: dark edge, colour drains, slight cool shift
    this.fx.uDesat.value = s.desaturateMax * v.Vision;
    this.fx.uCool.value = s.coolShiftMax * v.Vision;
    this.vignette.visible = v.Vision > 0.002;
    this.vignetteMat.uniforms.uAmount.value = s.vignetteMax * v.Vision;

    // LIGHT: slow irregular dip and general dimming, never a strobe
    const n = 0.5 + 0.25 * Math.sin(this.t * Math.PI * 2 * s.flickerHz * 0.37) + 0.25 * Math.sin(this.t * Math.PI * 2 * s.flickerHz * 0.91 + 1.7);
    const dip = s.flickerDepth * v.Light * n;
    const dim = 1 - s.ambientDim * v.Light;
    const mul = clamp01(dim - dip);
    env.lightSources.forEach((l, i) => { l.intensity = env.lightBase[i] * mul; });
    env.lightMats.forEach((m) => { m.emissiveIntensity = (m.userData.baseEmissive ?? 1) * (0.25 + 0.75 * mul); });

    // OBJECTS: drift, pulse, creep towards the viewer, strongest when looked at
    this.camera.getWorldPosition(this._tmp);
    for (const o of env.objectGroups) {
      const target = d.rawChannel('Objects', o.target.value);
      o.smoothed += Math.sign(target - o.smoothed) * Math.min(Math.abs(target - o.smoothed), (target > o.smoothed ? 0.5 : 0.8) * dt);
      const a = o.smoothed;
      const drift = s.objDrift * a;
      const px = Math.sin(this.t * 0.37 + o.phase) * drift, pz = Math.cos(this.t * 0.29 + o.phase * 1.3) * drift;
      const toX = this._tmp.x - o.base.x, toZ = this._tmp.z - o.base.z;
      const dist = Math.hypot(toX, toZ);
      const approach = Math.min(s.objApproach * a, Math.max(0, dist - 1.4));
      const ax = dist > 0.01 ? (toX / dist) * approach : 0, az = dist > 0.01 ? (toZ / dist) * approach : 0;
      o.group.position.set(o.base.x + px + ax, o.base.y, o.base.z + pz + az);
      const pulse = 1 + s.objPulse * a * (0.5 + 0.5 * Math.sin(this.t * 1.1 + o.phase));
      o.group.scale.set(1, pulse, 1);
    }
  }
}
