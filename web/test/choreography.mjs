import test from 'node:test';
import assert from 'node:assert/strict';
import { AnxietyDirector } from '../public/js/director.js';
import { Session } from '../public/js/session.js';
import { WallGazeContraction } from '../public/js/effects.js';
import { tuningControls } from '../public/js/developer-panel.js';
const panel = () => ({ hide(){}, show(){}, setOrb(){}, placeInFront(){} });
test('default ramp reaches 100% anxiety and every effect channel in ten seconds', () => {
  const d = new AnxietyDirector(), wall = new WallGazeContraction();
  d.sustain = true; d.startBuild();
  for (let frame = 1; frame <= 600; frame++) {
    d.update(1 / 60); wall.updateChoreography(1 / 60, {active:true, intensity:d.level, elapsed:frame/60, blackoutEndSeconds:46});
    assert(Math.abs(wall.amount - .3 * d.level) < 1e-7, 'Walls move only inward during the ramp');
    assert(Math.abs(d.level - frame / 600) < 1e-7);
    assert(wall.amount <= .3 * d.level + 1e-7);
  }
  assert(Math.abs(d.level - 1) < 1e-7);
  for (const kind of Object.keys(d.settings)) assert(Math.abs(d.channel(kind) - 1) < 1e-7, kind);
  assert(Math.abs(wall.amount - .3) < 1e-7, 'Wall apex matches 100% at POV ten seconds');
  const controls = tuningControls({});
  assert.equal(wall.amplitude, controls.find(c => c.path === 'effects.wallGaze.amplitude').max);
});
test('breathing begins after 60 seconds in POV regardless of overview length', () => {
  for (const observationSeconds of [38, 18, 50]) {
    const session = new Session({ director: new AnxietyDirector(), panel: panel(), observationSeconds });
    session.startRun(); session.update(observationSeconds + session.embodimentSeconds, { inPerspective: false });
    assert.equal(session.povElapsed, 0);
    session.update(59.99, { inPerspective: true });
    assert.equal(session.phase, 'running');
    session.update(.01, { inPerspective: true }); assert.equal(session.phase, 'breathing');
    assert.equal(session.povElapsed, 60);
    assert.equal(session.breathT, 0, 'The cutoff frame must not consume a breathing cycle');
  }
});

test('walls stay fully inward through both blackouts plus ten seconds, then pulse outward smoothly', () => {
  const wall = new WallGazeContraction(); let previous = 0;
  for (let frame = 1; frame <= 62 * 60; frame++) {
    const elapsed = frame / 60, intensity = Math.min(1, elapsed / 10);
    const amount = wall.updateChoreography(1/60, {active:true,intensity,elapsed,blackoutEndSeconds:46});
    if (elapsed >= 22 && elapsed <= 56) assert(Math.abs(amount-.3)<1e-7, `Held at POV ${elapsed}`);
    assert(Math.abs(amount-previous)<.003, 'No discontinuity'); previous=amount;
    if (elapsed === 13 || elapsed === 19) assert(amount < 1e-7, 'Two early outward pulses');
    if (elapsed === 16 || elapsed === 22) assert(Math.abs(amount-.3)<1e-7, 'Early inward peaks');
    if (elapsed === 59) assert(amount < 1e-7, 'First outward endpoint');
    if (elapsed === 62) assert(Math.abs(amount-.3)<1e-7, 'First return inward');
  }
  wall.updateChoreography(.1,{active:false});
  wall.updateChoreography(2,{active:false}); assert.equal(wall.amount,0);
});
test('moving blackout timings also moves the wall hold, and hold length is tunable', () => {
  const wall = new WallGazeContraction(); wall.holdAfterBlackoutSeconds=15;
  const step=(elapsed)=>wall.updateChoreography(3,{active:true,intensity:1,elapsed,blackoutEndSeconds:60});
  assert.equal(step(56),.3); assert.equal(step(75),.3); assert.equal(step(78),0);
});

test('calming starts from the existing intensity and settles monotonically over fourteen seconds', () => {
 const director=new AnxietyDirector();director.intensity=1;director.state='Peak';director.sustain=true;
 for(const key of Object.keys(director.smoothed))director.smoothed[key]=1;
 const session=new Session({director,panel:panel()});session.phase='running';session.calmNow();
 assert.equal(session.phase,'breathing');assert.equal(director.level,1);assert.equal(director.override,null);
 let previous=1;
 for(let frame=1;frame<=840;frame++){
   director.setGaze({Vision:1,Audio:1,Objects:1,Light:1,Space:1});director.update(1/60);
   assert(director.level<=previous+1e-8);assert(previous-director.level<.003);
   if(frame===120)assert(director.level>.9,'room still carries most of its state after two seconds');
   if(frame===420)assert(Math.abs(director.level-.5)<1e-7);
   previous=director.level;
 }
 assert(director.level<1e-8);
});
