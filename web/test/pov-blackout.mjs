import test from 'node:test';
import assert from 'node:assert/strict';
import { PovBlackout } from '../public/js/pov-blackout.js';
const active = { active: true, runId: 1 };
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
test('two continuous four-second fades down and up, after the 20-second peak hold', () => {
  const cue = new PovBlackout();
  close(cue.update(30, active), 0);
  for (let wave = 0; wave < 2; wave++) {
    close(cue.update(2, active), .5); close(cue.update(2, active), 1);
    close(cue.update(2, active), .5); close(cue.update(2, active), 0);
  }
  assert(cue.finished); close(cue.update(100, active), 0);
});
test('wave opacity has no frame-sized jumps or sharp reversal at its endpoints', () => {
  const cue = new PovBlackout(); let previous = 0;
  for (let i = 0; i < 50 * 120; i++) {
    const amount = cue.update(1 / 120, active);
    assert(Math.abs(amount - previous) < .004); assert(amount >= 0 && amount <= 1); previous = amount;
  }
});
test('floating pauses the POV clock; leaving during a wave consumes the sequence', () => {
  const cue = new PovBlackout(); cue.update(20, active);
  close(cue.update(100, { active: false, runId: 1 }), 0); close(cue.elapsed, 20);
  close(cue.update(12, active), .5);
  close(cue.update(0, { active: false, runId: 1 }), 0);
  close(cue.update(2, active), 0); assert(cue.finished);
});
test('replay resets, and a large elapsed step never leaves darkness stuck on', () => {
  const cue = new PovBlackout(); cue.update(100, active);
  close(cue.update(0, { active: true, runId: 2 }), 0); close(cue.elapsed, 0);
  close(cue.update(34, { active: true, runId: 2 }), 1);
  close(cue.update(100, { active: true, runId: 2 }), 0);
});
test('custom timing, duration and wave count, including disabling the sequence', () => {
  const cue = new PovBlackout(); cue.afterSeconds = 12; cue.durationSeconds = 4; cue.count = 1;
  close(cue.update(14, active), 1); close(cue.update(2, active), 0);
  cue.durationSeconds = 0; close(cue.update(14, { active: true, runId: 2 }), 0);
  cue.durationSeconds = 4; cue.count = 0; close(cue.update(14, { active: true, runId: 3 }), 0);
});

test('calming eases an active darkness wave out even when cancellation changes the run ID',()=>{
 const cue=new PovBlackout();cue.update(34,active);close(cue.amount,1);
 close(cue.update(.016,{active:false,settling:true,runId:2}),1);
 close(cue.update(3,{active:false,settling:true,runId:2}),.5);
 close(cue.update(3,{active:false,settling:true,runId:2}),0);
 close(cue.update(1,{active:true,runId:2}),0);assert(cue.finished);
});
