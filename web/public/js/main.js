import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PROFILES } from './profiles.js';
import { AnxietyDirector, STATES } from './director.js';
import { HeadGaze } from './gaze.js';
import { loadEnvironment, makeFxUniforms } from './environment.js';
import { Effects } from './effects.js';
import { ProceduralAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const envId = params.get('env') || 'brutalist';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFramebufferScaleFactor(1.0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8f979e);
const bgBase = scene.background.clone();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
scene.add(new THREE.HemisphereLight(0xdfe7f0, 0x4a4a4a, 0.35));

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 80);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);

const director = new AnxietyDirector(PROFILES[params.get('profile')] || PROFILES.Education_Light);
if (params.get('cap')) director.setCap(parseFloat(params.get('cap')));
const audio = new ProceduralAudio();
const gaze = new HeadGaze(camera);

const hud = document.getElementById('hud');
const status = document.getElementById('status');

// ---------- environment ----------
const base = `/environments/${envId}/`;
const config = await (await fetch(base + 'env.json')).json();
status.textContent = 'Loading ' + config.name + ' ...';
const fx = makeFxUniforms();
const env = await loadEnvironment(base, config, scene, fx);
const effects = new Effects(scene, director, env, fx, camera, config.strength);
status.textContent = '';
console.log('[env]', JSON.stringify(env.stats), 'interior', env.interior.min.toArray().map((v) => +v.toFixed(2)), env.interior.max.toArray().map((v) => +v.toFixed(2)));

// ---------- placement and desktop look ----------
let yaw = THREE.MathUtils.degToRad(env.spawn.yawDeg), pitch = 0;
rig.position.set(env.spawn.x, env.floorY, env.spawn.z);
camera.position.set(0, 1.6, 0);
function applyLook() { camera.rotation.set(pitch, 0, 0, 'YXZ'); rig.rotation.set(0, yaw, 0); }
applyLook();
let dragging = false;
addEventListener('pointerdown', (e) => { if (e.target === renderer.domElement) dragging = true; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => {
  if (!dragging || renderer.xr.isPresenting) return;
  yaw -= e.movementX * 0.003; pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.003, -1.4, 1.4); applyLook();
});

// ---------- debug keys ----------
addEventListener('keydown', (e) => {
  audio.start();
  if (e.key === '1') director.reset();
  else if (e.key === '2') director.startBuild();
  else if (e.key === '3') director.setState('Peak');
  else if (e.key === '4') director.setState('Recovery');
  else if (e.code === 'Space') { e.preventDefault(); director.calmNow(); }
  else if (e.key === 'ArrowUp') director.setCap(director.cap + 0.1);
  else if (e.key === 'ArrowDown') director.setCap(director.cap - 0.1);
  else if (e.key.toLowerCase() === 'p') { const ids = Object.keys(PROFILES); const i = ids.indexOf(director.profile.id); director.setProfile(PROFILES[ids[(i + 1) % ids.length]]); }
  else if (e.key.toLowerCase() === 'h') hud.hidden = !hud.hidden;
});

// ---------- WebXR ----------
const vrButton = VRButton.createButton(renderer);
document.getElementById('xr').appendChild(vrButton);
renderer.xr.addEventListener('sessionstart', () => { audio.start(); hud.hidden = true; rig.rotation.set(0, yaw, 0); camera.rotation.set(0, 0, 0); camera.position.set(0, 0, 0); });
renderer.xr.addEventListener('sessionend', () => { hud.hidden = false; camera.position.set(0, 1.6, 0); applyLook(); });
const pressed = new Map();
function pollControllers() {
  const session = renderer.xr.getSession(); if (!session) return;
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp) continue;
    gp.buttons.forEach((b, i) => {
      const key = src.handedness + i, was = pressed.get(key) || false;
      if (b.pressed && !was) {
        if (i === 4) director.calmNow();                      // A / X: calm now
        if (i === 5) (director.state === 'Calm' ? director.startBuild() : director.reset()); // B / Y: start / reset
      }
      pressed.set(key, b.pressed);
    });
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); effects.setAspect(camera.aspect);
});
effects.setAspect(camera.aspect);

// ---------- loop ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (renderer.xr.isPresenting) pollControllers();
  gaze.update();
  director.update(dt);
  effects.update(dt, gaze);
  { const l = bgBase.r * 0.3 + bgBase.g * 0.59 + bgBase.b * 0.11; scene.background.copy(bgBase).lerp(new THREE.Color(l * 0.7, l * 0.7, l * 0.72), fx.uDesat.value / Math.max(0.01, effects.s.desaturateMax)).multiplyScalar(1 - 0.35 * effects.values.Light); }
  audio.gain = effects.s.audioGain;
  audio.update(effects.values.Audio, dt);
  if (!hud.hidden) {
    const v = effects.values;
    hud.textContent = `${director.profile.id}  state ${director.state}  intensity ${director.intensity.toFixed(2)}  cap ${director.cap.toFixed(1)}\n` +
      `space ${v.Space.toFixed(2)} vision ${v.Vision.toFixed(2)} audio ${v.Audio.toFixed(2)} light ${v.Light.toFixed(2)} objects ${v.Objects.toFixed(2)}\n` +
      `keys: 1 calm  2 build  3 peak  4 recovery  space CALM NOW  up/down cap  P profile  H hide`;
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

if (params.get('autostart')) director.startBuild();
window.app = { THREE, scene, camera, rig, renderer, director, env, effects, fx, audio, STATES, setLook(y, p) { yaw = y; pitch = p; applyLook(); }, ready: true };
