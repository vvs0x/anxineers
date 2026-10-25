import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { loadAuthoredDaylight } from './daylight.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PROFILES } from './profiles.js';
import { AnxietyDirector, STATES } from './director.js';
import { HeadGaze, GazeCursor } from './gaze.js';
import { GroupView } from './group-view.js';
import { loadSignalCharacter } from './character.js';
import { loadSeating } from './seating.js';
import { loadRearSculpture } from './sculpture.js';
import { loadVisitors } from './visitors.js';
import { EmbodimentJourney } from './experience.js';
import { loadEnvironment, makeFxUniforms } from './environment.js';
import { Effects } from './effects.js';
import { ProceduralAudio } from './audio.js';
import { Panel } from './ui.js';
import { PerspectiveTarget } from './perspective-target.js';
import { Session } from './session.js';
import { Voice } from './voice.js';
import { Guide } from './guide.js';
import { LookControls } from './look-controls.js';
import { RoomExploration } from './exploration.js';
import { createDeveloperPanel } from './developer-panel.js';
import { SpectatorBroadcast } from './spectator-broadcast.js';

const TEXTS_LANG = (l) => (l === 'de' ? 'de' : 'en');
const params = new URLSearchParams(location.search);
document.body.classList.toggle('developer-mode', params.get('dev') === '1' || params.get('debug') === '1');
// Keep headset entry available during setup, without showing desktop VR controls.
if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then(supported => {
  document.body.classList.toggle('vr-available', supported);
}).catch(() => {});
document.addEventListener('click', event => {
  // Opening replaces its button during the click; use the original event path.
  if (!event.composedPath().some(node => node.id === 'session-buttons') || document.body.classList.contains('vr-available') || document.body.classList.contains('developer-mode')) return;
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});
const envId = params.get('env') || 'brutalist';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const touchDevice = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, touchDevice ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.cameraAutoUpdate = false;
renderer.xr.setFramebufferScaleFactor(1.0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const spectator = new SpectatorBroadcast(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8f979e);
const bgBase = scene.background.clone();

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 80);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);

const director = new AnxietyDirector(PROFILES[params.get('profile')] || PROFILES.Education_Light);
if (params.get('cap')) director.setCap(parseFloat(params.get('cap')));
const audio = new ProceduralAudio();
const gaze = new HeadGaze(camera);
const groupView = new GroupView();
const debug = params.get('debug') === '1';

const hud = document.getElementById('hud');
const status = document.getElementById('status');
// Opening screens run independently while the heavy scene assets arrive.
camera.position.set(0,1.6,0);
const panel = new Panel(scene, camera, renderer, rig);
const lang = params.get('lang') || (navigator.language || 'en').slice(0, 2);
const voice = new Voice(TEXTS_LANG(lang));
const guide = new Guide(audio, TEXTS_LANG(lang));
const session = new Session({ director, panel, voice, audio, guide, lang, freeExplore: true, onExitVR: () => renderer.xr.getSession()?.end() });
session.cap = director.cap;
session.assetsReady = false;
window.app = {session,panel,renderer,spectator,ready:false};
const reportLoadError = () => {
  session.loadFailed = true;
  panel.setStatus(lang==='de' ? 'Der Raum konnte nicht geladen werden. Bitte neu laden.' : 'The room could not load. Please reload.');
};
addEventListener('unhandledrejection', reportLoadError);
addEventListener('error', reportLoadError);
addEventListener('pointerdown', () => audio.start());
Promise.all([400,500,600,700].map(weight=>document.fonts.load(`${weight} 16px "Roboto Mono"`)))
  .then(()=>{if(panel.model)panel._draw();}).catch(()=>{});
session.begin();
const openingClock = new THREE.Clock();
renderer.setAnimationLoop((time)=>{
  const dt=Math.min(openingClock.getDelta(),.1);
  session.update(dt);panel.update(dt);
  // Desktop opening text is DOM-rendered; avoid drawing a half-loaded gallery.
  if(renderer.xr.isPresenting) renderer.render(scene,camera);
  spectator.frame(time, session.phase);
});

// ---------- environment ----------
const base = `/environments/${envId}/`;
const config = await (await fetch(base + 'env.json')).json();
const fx = makeFxUniforms();
const env = await loadEnvironment(base, config, scene, fx);
const rearSculpture = await loadRearSculpture(env, fx);
const effects = new Effects(scene, director, env, fx, camera, config.strength);
const seating = await loadSeating(scene, env);
const character = await loadSignalCharacter(scene, { position: seating.position, yaw: seating.yaw, seatHeight: seating.height });
let daylight = null;
if (config.authoredLighting) {
  daylight = await loadAuthoredDaylight(scene, renderer, env, { baseUrl: base + config.authoredLighting });
  daylight.register(seating.root);
  daylight.register(character.root);
} else {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  pmrem.dispose();
  scene.environmentIntensity = .3;
  scene.add(new THREE.HemisphereLight(0xdfe7f0, 0x4a4a4a, .35));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .85;
}
fx.uCenter.value.set(seating.position.x, seating.position.z);
const visitors = await loadVisitors(scene, env, fx, seating, character);
for (const visitor of visitors.visitors) daylight?.register(visitor.model);
const cursor = new GazeCursor(scene, env);
status.textContent = '';
console.log('[env]', JSON.stringify(env.stats), 'interior', env.interior.min.toArray().map((v) => +v.toFixed(2)), env.interior.max.toArray().map((v) => +v.toFixed(2)));

// ---------- placement and device look ----------
let yaw = THREE.MathUtils.degToRad(env.spawn.yawDeg), pitch = 0;
rig.position.set(env.spawn.x, env.floorY, env.spawn.z);
camera.position.set(0, 1.6, 0);
function applyLook() { camera.rotation.set(pitch, 0, 0, 'YXZ'); rig.rotation.set(0, yaw, 0); }
applyLook();
const motionButton = document.getElementById('motion');
const recenterButton = document.getElementById('recenter');
const lookHint = document.getElementById('look-hint');
new ResizeObserver(() => {
  const bottom = document.getElementById('look-controls').getBoundingClientRect().bottom;
  document.documentElement.style.setProperty('--look-bottom', `${Math.ceil(bottom) + 16}px`);
}).observe(document.getElementById('look-controls'));
motionButton.hidden = !touchDevice;
let exploration;
const look = new LookControls({ camera, rig, element: renderer.domElement,
  canDrag: () => !journey.viewTransition && (exploration?.active || session.phase !== 'embodying'),
  onDrag: (dx, dy) => exploration?.steer(dx, dy),
  onChange(mode, message) {
    lookHint.textContent = message;
    motionButton.textContent = ['motion', 'waiting'].includes(mode) ? 'Use drag instead' : 'Enable phone motion';
    motionButton.disabled = mode === 'pending';
    motionButton.setAttribute('aria-pressed', String(['motion', 'waiting'].includes(mode)));
    recenterButton.hidden = mode !== 'motion';
  }
});
motionButton.onclick = () => look.mode === 'motion' ? look.useDrag() : look.enableMotion();
recenterButton.onclick = () => { look.recenter(); if (panel.mesh.visible) panel.placeInFront(); };
lookHint.textContent = touchDevice ? 'Enable phone motion to look around, or drag the view.' : 'Drag to look around.';
exploration = new RoomExploration({ scene, camera, rig, renderer, env, character, visitors, panel,
  isTracked: () => renderer.xr.isPresenting || look.motionActive,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
const journey = new EmbodimentJourney({ scene, camera, rig, renderer, character, env, panel, exploration, isMotionActive: () => look.motionActive });
const perspectiveTarget = new PerspectiveTarget(scene,character,env);
const exploreActions = document.getElementById('explore-actions');
const exploreHint = document.getElementById('explore-hint');
const floatButton = document.getElementById('float');
const teleportButton = document.getElementById('teleport');
const perspectiveButton = document.getElementById('perspective');
let exploreUISignature = '';
function updateExploreUI() {
  const T = session.T;
  const signature = [session.phase, session.lang, exploration.active, exploration.guided, Boolean(journey.viewTransition), touchDevice].join(':');
  if (signature === exploreUISignature) return;
  exploreUISignature = signature;
  perspectiveButton.disabled = floatButton.disabled = teleportButton.disabled = Boolean(journey.viewTransition);
  const active = ['exploring','running'].includes(session.phase);
  exploreActions.hidden = !active; exploreHint.hidden = !active;
  lookHint.hidden = ['observing','embodying'].includes(session.phase) || (active && exploration.active && !touchDevice);
  floatButton.hidden = teleportButton.hidden = true;
  floatButton.textContent = exploration.guided ? T.pauseFloat : T.resumeFloat;
  floatButton.setAttribute('aria-pressed', String(exploration.guided));
  teleportButton.textContent = T.teleport;
  perspectiveButton.textContent = exploration.active ? T.hisView : T.floatView;
  perspectiveButton.setAttribute('aria-pressed', String(!exploration.active));
  exploreHint.textContent = exploration.active ? 'Point and click the floor to walk · Select Signal to see his perspective' : T.returnFloat;
}
exploration.onChange = updateExploreUI;
floatButton.onclick = () => exploration.toggleGuided();
teleportButton.onclick = () => exploration.nextStop();
perspectiveButton.onclick = () => {
  journey.switchView(session);
  updateExploreUI();
};
const travelRay = new THREE.Raycaster(), travelPointer = new THREE.Vector2();
travelRay.firstHitOnly = true;
function pointerRay(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  travelPointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
  travelRay.far = Infinity; travelRay.setFromCamera(travelPointer, camera); return travelRay;
}
let travelDown = null, pointerActive=false;
function selectScene(ray){
  if(journey.viewTransition||panel.mesh.visible)return;
  if(perspectiveTarget.hit(ray)!==null){journey.switchView(session);updateExploreUI();return;}
  exploration.refresh();const p=exploration.pick(ray);
  if(p)exploration.walkTo(exploration.navigation.toWorld(p));
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.isPrimary !== false && e.button === 0) travelDown = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
});
renderer.domElement.addEventListener('pointerleave',()=>{pointerActive=false;});
renderer.domElement.addEventListener('pointermove', e => {
  pointerActive=true;
  if (travelDown && Math.hypot(e.clientX - travelDown.x, e.clientY - travelDown.y) > 6) travelDown.moved = true;
  if (exploration.active) exploration.preview(pointerRay(e));
});
renderer.domElement.addEventListener('pointerup', e => {
  if (travelDown?.id === e.pointerId && !travelDown.moved) {
    selectScene(pointerRay(e));
  }
  travelDown = null;
});
for (const name of ['pointercancel', 'lostpointercapture']) renderer.domElement.addEventListener(name, () => { travelDown = null; exploration.marker.visible = false; });
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('button, input, select, textarea') || !exploration.active || !exploration.enabled) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) { e.preventDefault(); exploration.keys.add(e.code); }

  if (!session.freeExplore && !e.repeat && e.code === 'KeyT') exploration.nextStop();
});
addEventListener('keyup', e => exploration.keys.delete(e.code));
addEventListener('blur', () => { travelDown = null; exploration.clearInput(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    session.cancelMedia(true);
    exploration.clearInput();
    audio.update(0, 0, { active: false, hostile: false, firstPerson: false });
    if (session.phase === 'grounding') { panel.setStatus(session.micNotice()); panel.setOrb('off'); }
  } else if (session.phase === 'grounding') session.enableGroundListening();
});
for (const { c } of panel.controllers) c.addEventListener('selectstart', event => {
  if (!renderer.xr.isPresenting || event.uiConsumed || panel.mesh.visible) return;
  exploration.refresh();
  travelRay.set(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld));
  selectScene(travelRay);
});
const stage = document.getElementById('stage');
const calmButton = document.getElementById('calm');
calmButton.onclick = () => session.calmNow();
if (touchDevice) calmButton.textContent = 'Calm now';

// ---------- debug keys ----------

addEventListener('keydown', (e) => {
  audio.start();
  if (e.code === 'Space' && !e.target.closest?.('button, input, select, textarea')) { e.preventDefault(); session.calmNow(); return; }
  if (e.key.toLowerCase() === 'h') { hud.hidden = !hud.hidden; return; }
  if (e.target.closest?.('input, select, textarea, button')) return;
  if (!debug) return;
  if (e.key === '1') director.reset();
  else if (e.key === '2') director.startBuild();
  else if (e.key === '3') director.setState('Peak');
  else if (e.key === '4') director.setState('Recovery');
  else if (e.key === 'ArrowUp') director.setCap(director.cap + 0.1);
  else if (e.key === 'ArrowDown') director.setCap(director.cap - 0.1);
  else if (e.key.toLowerCase() === 'p') { const ids = Object.keys(PROFILES); const i = ids.indexOf(director.profile.id); director.setProfile(PROFILES[ids[(i + 1) % ids.length]]); }
  else if (e.key.toLowerCase() === 'h') hud.hidden = !hud.hidden;
});

// ---------- WebXR ----------
const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['hand-tracking'] });
document.getElementById('xr').appendChild(vrButton);
renderer.xr.addEventListener('sessionstart', () => { look.setXR(true); audio.start(); hud.hidden = true; document.body.classList.add('in-vr'); journey.onXRChange(); if (['consent', 'intro', 'ready'].includes(session.phase)) session.begin(); });
renderer.xr.addEventListener('sessionend', () => { hud.hidden = !debug; document.body.classList.remove('in-vr'); camera.position.set(0, 1.6, 0); look.setXR(false); pressed.clear(); journey.onXRChange(); });
const pressed = new Map();
function pollControllers() {
  const xrSession = renderer.xr.getSession(); if (!xrSession) return;
  exploration.stick.set(0, 0);
  for (const src of xrSession.inputSources) {
    const gp = src.gamepad; if (!gp) continue;
    if (src.handedness === 'left' && exploration.active && exploration.enabled) {
      const axes = gp.axes.length >= 4 ? gp.axes.slice(2, 4) : gp.axes.slice(0, 2);
      exploration.stick.set(Math.abs(axes[0] || 0) > .18 ? axes[0] : 0, Math.abs(axes[1] || 0) > .18 ? axes[1] : 0);
    }
    gp.buttons.forEach((b, i) => {
      const key = src.handedness + i, was = pressed.get(key) || false;
      if (b.pressed && !was) {
        if (i === 4) session.calmNow();                       // A / X: calm now
        if (i === 5 && debug) (director.state === 'Calm' ? director.startBuild() : director.reset());
        if (!session.freeExplore && i === 3 && exploration.active && exploration.enabled) {
          if (src.handedness === 'left') exploration.toggleGuided();
          else exploration.nextStop();
        }
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
let developer;
function frame(time) {
  const dt = Math.min(clock.getDelta(), 0.1);
  look.update();
  scene.updateMatrixWorld(true);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
  if (renderer.xr.isPresenting) pollControllers();
  session.update(dt, { inPerspective: journey.embodied && !exploration.active && !journey.viewTransition });
  if (session.phase === 'consent' && journey.phase !== 'consent') exploration.active = true;
  journey.update(dt, session);
  scene.updateMatrixWorld(true);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
  gaze.camera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  gaze.update();
  cursor.update(gaze, dt);
  cursor.dot.material.visible = session.phase !== 'grounding';
  director.sustain = session.phase === 'running' && !session.calmRequested;
  director.update(dt);
  const firstPerson = journey.embodied && !exploration.active;
  const settling = firstPerson && session.phase === 'breathing' && director.state === 'Recovery';
  effects.update(dt, gaze, {
    firstPerson, settling, settlingSeconds: session.settlingSeconds,
    blackoutActive: session.phase === 'running' && !session.calmRequested && !journey.viewTransition && !document.hidden,
    runId: session.gen,
    povDelta: Math.min(dt, session.phaseTime),
  });
  if (session.phase !== 'observing') {
  // Carry Signal with his supporting cushion when a wall pushes the seat.
  const seatPosition=seating.chairs[0].getWorldPosition(new THREE.Vector3());
  const seatDelta=seatPosition.clone().sub(character.openingActive ? character.openingSeatPosition : character.root.position);
  if (character.openingActive) {
    character.openingSeatPosition.copy(seatPosition);
    character.root.position.add(seatDelta);
  } else character.root.position.copy(seatPosition);
  if(journey.embodied)rig.position.add(seatDelta);
  }
  character.update(dt, director.level, { embodied: journey.embodied, viewerPosition: gaze.origin });
  for(const v of visitors.visitors)v.speaking=false;
  for(const entry of audio.voices?.playing||[])if(entry.kind==='calm'&&entry.group){
    const members=visitors.visitors.filter(v=>v.role===entry.group&&['talking','seated'].includes(v.state));
    if(members.length)members[(entry.turn??(Number(entry.speaker)||0))%members.length].speaking=true;
  }
  visitors.update(dt, gaze.origin);
  daylight?.update(dt, effects.values.Light, effects.s.ambientDim);
  // Text is especially sensitive to peripheral resolution loss from foveation.
  if (renderer.xr.isPresenting) renderer.xr.setFoveation(panel.mesh.visible ? 0 : 1);
  panel.update(dt);
  perspectiveTarget.update(gaze.camera,session.phase==='exploring'&&exploration.active&&!journey.viewTransition&&!panel.mesh.visible);
  let hoveringSignal=false;
  if(!renderer.xr.isPresenting&&pointerActive){
    travelRay.setFromCamera(travelPointer,camera);travelRay.far=12;
    hoveringSignal=perspectiveTarget.hit(travelRay,true)!==null;
    renderer.domElement.style.cursor=hoveringSignal?'pointer':'';
  }
  if (renderer.xr.isPresenting && exploration.active && exploration.enabled) {
    exploration.marker.visible = false;
    for (const { c, source, line, dot } of panel.controllers) {
      if (!source || !c.visible) continue;
      travelRay.set(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld));
      travelRay.far = 8;
      const targetDistance=perspectiveTarget.hit(travelRay,true);
      hoveringSignal ||= targetDistance!==null;
      const p = exploration.pick(travelRay);
      line.visible = true; line.scale.z = targetDistance??(p ? travelRay.ray.origin.distanceTo(exploration.navigation.toWorld(p)) : 5);
      line.material.color.setHex(p ? 0x66ffb3 : 0x9fc4ff);
      dot.visible = Boolean(p)||targetDistance!==null; dot.position.z = -line.scale.z;
    }
  }
  perspectiveTarget.hover(hoveringSignal,dt);
  developer?.update(dt);
  const journeyPhase = ['observing', 'exploring', 'embodying', 'running'].includes(session.phase);
  stage.textContent = session.phase==='observing' ? session.T.observing : session.phase==='embodying' ? session.T.embodying : journeyPhase ? (exploration.active ? (exploration.guided ? session.T.floating : session.T.exploring) : session.T[session.phase]) : '';
  updateExploreUI();
  calmButton.hidden = !['embodying', 'running', 'grounding', 'breathing'].includes(session.phase);
  if (!daylight) {
    const l = bgBase.r * .3 + bgBase.g * .59 + bgBase.b * .11;
    scene.background.copy(bgBase).lerp(new THREE.Color(l * .7, l * .7, l * .72), fx.uDesat.value / Math.max(.01, effects.s.desaturateMax)).multiplyScalar(1 - .35 * effects.values.Light);
  }
  groupView.update(gaze.camera);
  const conversationGroups = ['front','rear','seated'].map(role=>{
      const members=visitors.visitors.filter(v=>v.role===role);
      const position=members.reduce((p,v)=>p.add(v.root.position),new THREE.Vector3()).multiplyScalar(1/Math.max(1,members.length));
      const radius=Math.max(.65,...members.map(v=>Math.hypot(v.root.position.x-position.x,v.root.position.z-position.z)+.65));
      return {id:role,position,radius,inView:groupView.includes(members)};
    });
  audio.gain = effects.s.audioGain;
  audio.update(effects.values.Audio, dt, {
    active: !document.hidden && ['observing', 'exploring', 'embodying', 'running', 'grounding', 'breathing'].includes(session.phase),
    firstPerson, preview:perspectiveTarget.preview, settling, settlingSeconds: session.settlingSeconds,
    listener: {position:gaze.origin,forward:gaze.direction},
    conversationGroups,
    hostile: journey.embodied && !exploration.active && session.phase === 'running' && ['Build', 'Peak'].includes(director.state) && director.level > 0 && !session.calmRequested,
  });
  if (!hud.hidden) {
    const v = effects.values;
    hud.textContent = `${director.profile.id}  state ${director.state}  intensity ${director.intensity.toFixed(2)}  cap ${director.cap.toFixed(1)}\n` +
      `space ${v.Space.toFixed(2)} vision ${v.Vision.toFixed(2)} audio ${v.Audio.toFixed(2)} light ${v.Light.toFixed(2)} objects ${v.Objects.toFixed(2)}\n` +
      `cursor ${gaze.hitRole || 'none'} groups in view ${conversationGroups.filter(group=>group.inView).map(group=>group.id).join(', ') || 'none'} wall dwell ${effects.wallGaze.dwell.toFixed(1)}s contraction ${(fx.uLeanK.value * 100).toFixed(1)}%\n` +
      `keys: 1 calm  2 build  3 peak  4 recovery  space CALM NOW  up/down cap  P profile  H hide`;
  }
  renderer.render(scene, camera);
  spectator.frame(time, session.phase);
}
renderer.setAnimationLoop(frame);

hud.hidden = !debug;
if (params.get('skip')) { session.mode = params.get('mode') || 'edu'; session.cap = parseFloat(params.get('cap') || '1'); director.setProfile(PROFILES[params.get('profile')] || (session.mode === 'reg' ? PROFILES.Regulation_Gentle : PROFILES.Education_Light)); session.startRun(); }
session.setAssetsReady();
panel.placeInFront();
if (params.get('autostart') && !params.get('skip')) session.startRun();
window.app = { session, panel, voice, THREE, scene, camera, rig, renderer, director, env, effects, fx, audio, character, seating, rearSculpture, visitors, journey, exploration, perspectiveTarget, gaze, cursor, daylight, look, STATES, setLook(y, p) { yaw = y; pitch = p; applyLook(); }, ready: true };
panel.xrInput.settings.debug = debug;
developer = createDeveloperPanel(window.app, { open: params.get('dev') === '1' });
window.app.developer = developer;
window.app.spectator = spectator;
