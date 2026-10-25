import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { XRPanelInput } from '../public/js/xr-input.js';
import { Panel } from '../public/js/ui.js';

globalThis.document = { createElement: () => ({ getContext: () => ({ clearRect() {}, fillRect() {}, fillText() {} }) }) };

function harness() {
  const scene = new THREE.Scene(), rig = new THREE.Group(); scene.add(rig);
  rig.position.set(4, .2, -3); rig.rotation.y = .7;
  const controllers = [new THREE.Group(), new THREE.Group()], hands = [new THREE.Group(), new THREE.Group()];
  hands.forEach(hand => { hand.joints = {}; });
  const xr = new THREE.EventDispatcher(); Object.assign(xr, { isPresenting: true,
    getController: i => controllers[i], getHand: i => hands[i], getSession: () => ({ inputSources: [] }) });
  const root = new THREE.Group(); scene.add(root);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .75), new THREE.MeshBasicMaterial()); root.add(mesh);
  // Same UV button layout as the real canvas menu. Transform both rig and menu.
  root.position.copy(rig.localToWorld(new THREE.Vector3(0, 1.5, -1.25))); root.rotation.y = rig.rotation.y;
  const picks = [], panel = { root, mesh, model: {}, buttons: [{ id: 'start', x: 342, y: 470, w: 340, h: 92 }], hits: new Map(), hover: -1,
    hitTest: Panel.prototype.hitTest, _pick: index => picks.push(panel.buttons[index].id), _draw() {}, placeInFront() {} };
  const input = new XRPanelInput(panel, { xr }, rig, scene);
  function connect(i = 0, hand = false) {
    const entry = input.controllers[i];
    const source = { handedness: i ? 'right' : 'left', hand: hand ? {} : null, gamepad: hand ? null : { buttons: [{ pressed: false }] } };
    entry.c.position.set(0, 1.5 + (.5 - 516 / 640) * .75, 0); entry.c.visible = true;
    entry.c.dispatchEvent({ type: 'connected', data: source });
    return entry;
  }
  return { scene, rig, panel, input, picks, connect, xr };
}

test('controller ray hits the actual button UV after rig translation and rotation, with a full-length visual', () => {
  const h = harness(), entry = h.connect(); h.input.update(.5);
  assert.equal(entry.hit, 0); assert(Math.abs(entry.line.scale.z - 1.25) < 1e-6); assert(entry.dot.visible);
  entry.c.dispatchEvent({ type: 'selectstart' }); assert.deepEqual(h.picks, ['start']);
});

test('a visible disabled Start cannot be selected by an XR ray or direct panel pick', () => {
  const h = harness(), entry = h.connect();
  h.panel.buttons[0].disabled = true;
  h.panel.onPick = id => h.picks.push(id);
  h.panel._pick = Panel.prototype._pick;
  h.input.update(.5); assert.equal(entry.hit, -1);
  entry.c.dispatchEvent({ type: 'selectstart' }); h.panel._pick(0);
  assert.deepEqual(h.picks, []);
  entry.c.dispatchEvent({ type: 'selectend' });
  h.panel.buttons[0].disabled = false; h.input.update(.5);
  entry.c.dispatchEvent({ type: 'selectstart' }); assert.deepEqual(h.picks, ['start']);
});

test('selection uses the pressed hand, never another hand hover; tracking loss and hidden menus cannot activate', () => {
  const h = harness(), left = h.connect(), right = h.connect(1);
  right.c.position.x = 2; h.input.update(.5);
  assert.equal(left.hit, 0); assert.equal(right.hit, -1);
  right.c.dispatchEvent({ type: 'selectstart' }); assert.equal(h.picks.length, 0);
  left.c.visible = false; left.c.dispatchEvent({ type: 'selectstart' }); assert.equal(h.picks.length, 0);
  left.c.dispatchEvent({ type: 'selectend' }); h.input.update(.5); left.c.visible = true;
  h.panel.mesh.visible = false; left.c.dispatchEvent({ type: 'selectstart' }); assert.equal(h.picks.length, 0);
});

test('native select plus held gamepad fallback activates once, and release permits the next menu', () => {
  const h = harness(), entry = h.connect(); h.input.update(.5);
  entry.source.gamepad.buttons[0].pressed = true; entry.c.dispatchEvent({ type: 'selectstart' });
  h.panel.buttons[0].id = 'continue'; h.input.update(1); assert.deepEqual(h.picks, ['start']);
  entry.c.dispatchEvent({ type: 'selectend' }); entry.source.gamepad.buttons[0].pressed = false; h.input.update(.1);
  entry.source.gamepad.buttons[0].pressed = true; h.input.update(.5); assert.deepEqual(h.picks, ['start', 'continue']);
});

test('tracked pinch has hysteresis, deduplicates native selection, and ignores lost joint poses', () => {
  const h = harness(), entry = h.connect(0, true);
  for (const name of ['index-finger-tip', 'thumb-tip']) { const joint = new THREE.Group(); entry.hand.add(joint); entry.hand.joints[name] = joint; }
  const thumb = entry.hand.joints['thumb-tip']; thumb.position.x = .06;
  h.input.update(.5); thumb.position.x = .015; h.input.update(.1);
  assert.deepEqual(h.picks, ['start']);
  entry.c.dispatchEvent({ type: 'selectstart' }); h.input.update(.5); assert.equal(h.picks.length, 1);
  entry.c.dispatchEvent({ type: 'selectend' }); thumb.position.x = .028; h.input.update(.5); assert(entry.pinching); assert.equal(h.picks.length, 1);
  thumb.position.x = .06; h.input.update(.1); assert(!entry.pinching);
  thumb.visible = false; thumb.position.x = .01; h.input.update(.5); assert.equal(h.picks.length, 1);
  thumb.visible = true; h.input.update(.5); assert.equal(h.picks.length, 2);
  entry.c.dispatchEvent({ type: 'disconnected' }); h.input.update(.5);
  assert.equal(entry.source, null); assert(!entry.line.visible); assert(!entry.dot.visible);
  assert([...entry.joints.values()].every(mesh => !mesh.visible));
});

test('session end clears the input latch and reconnect restores the ray', () => {
  const h = harness(), entry = h.connect(); h.input.update(.5); entry.c.dispatchEvent({ type: 'selectstart' });
  h.xr.dispatchEvent({ type: 'sessionend' }); assert(!entry.fired); assert.equal(entry.source, null);
  h.connect(); h.input.update(.5); assert(entry.line.visible); entry.c.dispatchEvent({ type: 'selectstart' });
  assert.equal(h.picks.length, 2);
});

test('menu placement uses the prepared XR world pose, including the locomotion rig', () => {
  const h = harness(), head = new THREE.ArrayCamera();
  h.rig.updateMatrixWorld(true);
  head.matrixWorld.copy(h.rig.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(.2, 1.6, .1));
  const camera = new THREE.PerspectiveCamera();
  Object.assign(h.panel, { camera, rig: h.rig, distance: 1.25, renderer: { xr: { isPresenting: true, updateCamera() {}, getCamera: () => head } } });
  Panel.prototype.placeInFront.call(h.panel);
  const expected = new THREE.Vector3(.2, 1.48, -1.15).applyMatrix4(h.rig.matrixWorld);
  assert(h.panel.root.position.distanceTo(expected) < 1e-6);
  const entry = h.connect(); entry.c.position.set(.2, 1.48 + (.5 - 516/640)*.75, .1);
  h.input.update(.5); assert.equal(entry.hit, 0);
});

test('a menu selection cannot also trigger a scene interaction after hiding the menu', () => {
  const h = harness(), entry = h.connect(); let sceneSelections = 0;
  h.panel._pick = () => { h.panel.mesh.visible = false; };
  entry.c.addEventListener('selectstart', event => { if (!event.uiConsumed && !h.panel.mesh.visible) sceneSelections++; });
  h.input.update(.5); entry.c.dispatchEvent({ type: 'selectstart' });
  assert.equal(h.panel.mesh.visible, false); assert.equal(sceneSelections, 0);
});

test('the grounding Continue button is selectable below the dice and text in XR',()=>{
  const h=harness();
  Object.assign(h.panel,{ctx:{strokeText(){},fillText(){},beginPath(){},moveTo(){},arcTo(){},closePath(){},fill(){}},
    tex:{},groundTextures:{},backdrop:{},_rr:Panel.prototype._rr,
    _draw(){Panel.prototype._drawGrounding.call(this);}});
  Panel.prototype.show.call(h.panel,{groundOnly:true,groundCount:5,groundLabel:'5 things you can see',buttons:[{id:'next',label:'Continue'}]});
  const entry=h.connect(),button=h.panel.buttons.find(b=>b.id==='next');
  h.scene.updateMatrixWorld(true);
  const target=h.panel.mesh.localToWorld(new THREE.Vector3(((button.x+button.w/2)/1024-.5)*1.2,(.5-(button.y+button.h/2)/640)*.75,0));
  const origin=target.add(new THREE.Vector3(0,0,1.25).applyQuaternion(h.rig.quaternion));
  entry.c.position.copy(h.rig.worldToLocal(origin));h.input.update(.5);
  assert.equal(h.panel.buttons[entry.hit].id,'next');
  entry.c.dispatchEvent({type:'selectstart'});assert.deepEqual(h.picks,['next']);
});
