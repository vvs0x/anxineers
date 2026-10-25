import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../public/js/session.js';
import { AnxietyDirector } from '../public/js/director.js';
import { PROFILES } from '../public/js/profiles.js';

class MockDirector {
  constructor() { this.state = 'Calm'; this.intensity = 0; this.cap = .5; this.profile = PROFILES.Education_Light; this.listeners = []; this.builds = 0; }
  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach(fn => fn(this)); }
  reset() { this.state = 'Calm'; this.intensity = 0; this.override = null; this.emit(); }
  setCap(n) { this.cap = n; this.emit(); }
  setProfile(p) { this.profile = p; this.emit(); }
  startBuild() { this.builds++; this.state = 'Build'; this.emit(); }
  setTargetOverride(n) { this.override = n; }
  calmNow() { this.state = 'Recovery'; this.emit(); }
}
function harness(opts = {}) {
  const director = new MockDirector();
  const panel = { model: null, orbScale: 1, setOrb(mode) { this.orbMode = mode; }, placeInFront() {}, show(model) { this.model = model; this.visible = true; }, hide() { this.model = null; this.visible = false; }, setStatus(text) { this.model.status = text; }, _draw() {} };
  const voice = { available: false, cancelled: 0, init() {}, cancel() { this.cancelled++; } };
  const session = new Session({ observationSeconds:12, director, panel, voice, audio: { chime() {} }, ...opts });
  return { session, director, panel, voice };
}
function startViaPanels(session) {
  session.begin(); assert.equal(session.phase, 'consent'); session.pick('welcome');
  session.update(.35); assert.equal(session.phase, 'intro');
  session.update(5); assert.equal(session.phase, 'ready');
  session.pick('start'); assert.equal(session.phase, 'observing');
}

test('12-second calm observation and 4-second embodiment precede the first anxiety build', () => {
  const { session: s, director: d, panel } = harness();
  startViaPanels(s);
  assert.equal(s.phase, 'observing'); assert.equal(s.phaseDuration, 12); assert(Math.abs(s.phaseTime) < 1e-8);
  assert.equal(d.state, 'Calm'); assert.equal(panel.visible, false);
  s.update(11.9); assert.equal(s.phase, 'observing'); assert.equal(d.builds, 0);
  s.update(.1); assert.equal(s.phase, 'embodying'); assert(Math.abs(s.phaseTime) < 1e-8); assert.equal(s.phaseDuration, 4); assert.equal(d.builds, 0);
  s.update(3.9); assert.equal(d.builds, 0);
  s.update(.1); assert.equal(s.phase, 'running'); assert(Math.abs(s.phaseTime) < 1e-8); assert.equal(d.builds, 1);
  s.update(100); assert.equal(d.builds, 1);
});

test('journey durations are configurable and carry excess frame time across boundaries', () => {
  const { session: s, director: d } = harness({ observationSeconds: 2, embodimentSeconds: 1 });
  s.startRun(); s.update(2.5);
  assert.equal(s.phase, 'embodying'); assert.equal(s.phaseTime, .5); assert.equal(d.builds, 0);
  s.update(1); assert.equal(s.phase, 'running'); assert.equal(s.phaseTime, .5); assert.equal(d.builds, 1);
});

for (const phase of ['observing', 'embodying']) {
  test(`Calm Now during ${phase} cancels the journey with no later anxiety build`, () => {
    const { session: s, director: d } = harness(); s.startRun();
    if (phase === 'embodying') s.update(13);
    assert.equal(s.phase, phase); s.calmNow();
    assert.equal(s.phase, 'breathing'); assert(Math.abs(s.phaseTime) < 1e-8); assert.equal(s.phaseDuration, 15);
    s.update(60); assert.equal(s.phase, 'grounding'); assert.equal(d.builds, 0);
    for (let i = 0; i < 5; i++) s.pick('next'); assert.equal(s.phase, 'end');
    s.update(60); assert.equal(d.builds, 0);
  });
}

test('short startup uses default profile and cap, with grounding and replay available', () => {
  const { session: s, director: d, panel } = harness();
  startViaPanels(s);
  assert.equal(d.profile, PROFILES.Education_Light); assert.equal(d.cap, s.cap);
  s.update(16); assert.equal(s.phase, 'running');
  d.state = 'Recovery'; d.emit();
  assert.equal(s.phase, 'breathing'); assert.equal(d.override, null); assert.equal(d.state, 'Recovery');
  s.update(15); assert.equal(s.phase, 'grounding'); assert.equal(panel.model.groundOnly, true);assert.equal(panel.model.groundCount,5);
  for (let i = 0; i < 5; i++) s.pick('next');
  assert.equal(s.phase, 'end');
  s.pick('again'); assert.equal(s.phase, 'consent'); assert(Math.abs(s.phaseTime) < 1e-8);
  s.pick('welcome'); s.update(.35); s.update(3); s.pick('start');
  assert.equal(s.phase, 'observing'); assert.equal(d.profile, PROFILES.Education_Light); assert.equal(d.cap, s.cap);
});

test('a zero-duration journey starts once without a loop', () => {
  const { session: s, director: d } = harness({ observationSeconds: 0, embodimentSeconds: 0 });
  s.startRun(); s.update(0); assert.equal(s.phase, 'running'); assert.equal(d.builds, 1);
});

test('director reset clears remaining effect and gaze channels for a calm replay', () => {
  const d = new AnxietyDirector();
  for (const key of Object.keys(d.smoothed)) d.smoothed[key] = .8;
  d.intensity = .6; d.setGaze({ Objects: 1 }); d.setTargetOverride(.5); d.reset();
  assert.equal(d.state, 'Calm'); assert.equal(d.intensity, 0); assert.equal(d.override, null); assert.equal(d._gaze, null);
  assert(Object.values(d.smoothed).every(n => n === 0));
});

test('breathing completes exactly three cycles of two seconds in and three seconds out', () => {
  const { session: s, panel } = harness();
  s.startBreathing();
  assert.equal(s.phaseDuration, 15);
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.equal(panel.model.breathOnly, true); assert.equal(panel.model.body, ''); assert.equal(panel.orbScale, 1);
    s.update(2);
    assert.equal(panel.model.body, ''); assert(panel.orbScale > 1);
    s.update(2.5);
    assert.equal(s.phase, 'breathing');
    assert.equal(panel.model.body, ''); assert(panel.orbScale > 1);
    s.update(.5);
    assert.equal(s.phase, cycle === 2 ? 'end' : 'breathing');
  }
});

test('developer profile, cap and breathing edits survive the normal start flow and replay', () => {
  const { session: s, director: d } = harness();
  d.setProfile({ ...PROFILES.Education_Light, build: 12, hold: 4 }); s.cap = .65;
  s.breathing = { count: 3, inhale: 1.5, exhale: 2.5 };
  startViaPanels(s); assert.equal(d.profile.build, 12); assert.equal(d.cap, .65);
  s.startBreathing(); assert.equal(s.phaseDuration, 12); s.update(12); assert.equal(s.phase, 'end');
  s.pick('again'); s.pick('welcome'); s.update(.35); s.update(3); s.pick('start');
  assert.equal(d.profile.hold, 4); assert.equal(d.cap, .65);
});

test('opening keeps its button visible and waits for Start after the warning', () => {
  const {session:s, panel, director:d} = harness();
  s.begin(); assert.equal(panel.model.title, 'I am still here');
  assert.deepEqual(panel.model.buttons.map(b=>b.id), ['welcome']);
  s.update(600); assert.equal(s.phase, 'consent');
  s.pick('welcome'); assert.equal(panel.model.buttons[0].id, 'start'); assert.ok(!panel.model.buttons[0].disabled);
  s.update(.35); assert.equal(panel.model.title, 'Trigger warning');
  assert.equal(panel.model.buttons[0].id, 'start'); assert.ok(!panel.model.buttons[0].disabled);
  s.update(3); assert.equal(panel.model.body, s.T.headsetReminder);
  assert.ok(!panel.model.buttons[0].disabled);
  s.update(600); assert.equal(s.phase, 'ready'); assert.equal(d.builds, 0);
  s.pick('start'); assert.equal(s.phase, 'observing'); assert.equal(panel.visible, false);
});

const flush = () => new Promise(resolve => setImmediate(resolve));

test('opening retains speech timing and waits when Start is not pressed', async () => {
  const spoken=[]; let finish;
  const guide={unlocked:false,cancel(){finish?.();},unlock(){this.unlocked=true;},speak(id){spoken.push(id);return new Promise(resolve=>{finish=resolve;});}};
  const {session:s,panel,director:d}=harness({guide});
  s.begin();s.update(100);assert.equal(spoken.length,0);
  s.pick('welcome');s.pick('welcome');assert.deepEqual(spoken,['welcome']);
  assert.equal(panel.model.buttons.length,1);assert.equal(panel.model.buttons[0].id,'start');assert(!panel.model.buttons[0].disabled);
  s.update(100);assert.equal(s.phase,'consent');
  finish();await flush();s.update(.34);assert.equal(s.phase,'consent');
  s.update(.02);assert.equal(s.phase,'intro');assert.equal(spoken.length,1);
  s.update(.19);assert.equal(spoken.length,1);s.update(.02);assert.deepEqual(spoken,['welcome','warning']);
  s.update(100);assert.equal(s.phase,'intro');
  finish();await flush();s.update(.54);assert.equal(s.phase,'intro');
  s.update(.02);assert.equal(s.phase,'ready');assert(!panel.model.buttons[0].disabled);
  s.update(.21);assert.deepEqual(spoken,['welcome','warning','reminder']);
  s.update(100);assert.equal(s.phase,'ready');assert(!panel.model.buttons[0].disabled);
  finish();await flush();s.update(0);assert(!panel.model.buttons[0].disabled);
  s.update(600);assert.equal(s.phase,'ready');assert.equal(d.builds,0);
  s.pick('start');assert.equal(s.phase,'observing');
  s.begin();assert.equal(panel.model.buttons[0].id,'welcome');assert(!panel.model.buttons[0].disabled);
  s.update(100);assert.equal(s.phase,'consent');
});

for (const stage of ['welcome', 'warningQueued', 'warning', 'reminderQueued', 'reminder']) {
  test(`Start skips ${stage}, cancels narration and cannot resume the intro`, async () => {
    let finish, cancellations = 0;
    const spoken = [];
    const guide = { unlock() {}, cancel() { cancellations++; finish?.(); }, speak(id) { spoken.push(id); return new Promise(resolve => { finish = resolve; }); } };
    const {session:s,panel}=harness({guide});
    s.begin();s.pick('welcome');
    if(stage !== 'welcome') { finish();await flush();s.update(.36); }
    if(['warning','reminderQueued','reminder'].includes(stage))s.update(.21);
    if(['reminderQueued','reminder'].includes(stage)){finish();await flush();s.update(.56);}
    if(stage==='reminder')s.update(.21);
    assert.equal(panel.model.buttons[0].id,'start');assert(!panel.model.buttons[0].disabled);
    const before=cancellations,lines=spoken.length;
    s.pick('start');assert.equal(s.phase,'observing');assert.equal(panel.visible,false);
    assert.ok(cancellations>before);assert.equal(s.openingLine,null);assert.equal(s.narrating,false);
    finish?.();await flush();s.update(1);
    assert.equal(s.phase,'observing');assert.equal(spoken.length,lines);
    s.pick('start');assert.equal(s.phaseTime,1,'repeated clicks cannot restart the journey');
  });
}

test('skipping a spoken intro before assets arrive cancels speech and starts once loading finishes', async () => {
  let finish;
  const guide={unlock(){},cancel(){finish?.();},speak(){return new Promise(resolve=>finish=resolve);}};
  const {session:s}=harness({guide});s.assetsReady=false;s.begin();s.pick('welcome');s.pick('start');
  assert.equal(s.phase,'loading');assert.equal(s.narrating,false);assert.equal(s.openingLine,null);
  await flush();s.setAssetsReady();assert.equal(s.phase,'observing');assert.equal(s.elapsed,0);
});

test('breathing waits for narration and cancels any queued opening line', async () => {
  let finish;
  const guide = { unlocked: true, cancel() { finish?.(); }, speak() { return new Promise(resolve => { finish = resolve; }); } };
  const { session: s, panel } = harness({ guide });
  s.showIntro();assert.equal(s.openingLine,'warning');
  s.startBreathing(true);assert.equal(s.openingLine,null);
  s.update(10); assert.equal(s.breathT, 0); assert.equal(panel.orbScale, 1);
  finish(); await flush(); s.update(2); assert.equal(s.breathT, 2); assert.equal(panel.orbScale, 2.8);
  s.update(13); assert.equal(s.phase, 'grounding');
  s.cancelMedia();
});

test('spoken partial lists accumulate, repeated items do not count twice, and the target count advances automatically', async () => {
  const { session: s, voice } = harness();
  let answer;
  voice.available = true;
  voice.listen = () => new Promise(resolve => { answer = resolve; });
  s.startGrounding();
  answer('a chair, a sculpture'); await flush();
  assert.equal(s.groundIdx, 0); assert.equal(s.groundItems.size, 2);
  answer('a chair and a lamp'); await flush();
  assert.equal(s.groundItems.size, 3); assert.equal(s.groundIdx, 0);
  answer('a person and a wall'); await flush();
  assert.equal(s.groundIdx, 1, 'Five distinct items advance immediately'); assert.equal(s.groundItems.size, 0);
  answer("I'm ready"); await flush();assert.equal(s.groundIdx,1,'Readiness alone does not skip the four-item target');
  s.cancelMedia(); answer('a delayed answer'); await flush(); assert.equal(s.groundIdx, 1);
});

test('silence keeps the dice visible and listening open; stop cancels listening', async () => {
  const { session: s, voice, panel } = harness(); let answer;
  voice.available = true; voice.listen = () => new Promise(resolve => { answer = resolve; });
  s.startGrounding(); answer(''); await flush();
  assert.equal(s.groundIdx, 0); assert.equal(panel.model.body, '');assert.equal(panel.model.groundCount,5);
  answer('stop'); await flush(); assert.equal(s.phase, 'breathing'); assert.equal(s.afterBreathing, false);
  s.update(15); assert.equal(s.phase, 'end');
});

test('manual next during transcription ignores the late response', async () => {
  const { session: s, voice } = harness(); const answers = [];
  voice.available = true; voice.listen = () => new Promise(resolve => answers.push(resolve));
  s.startGrounding(); s.pick('next'); answers[0]('ready'); await flush();
  assert.equal(s.groundIdx, 1); assert.equal(s.phase, 'grounding');
  s.cancelMedia(); answers[1]('ready'); await flush(); assert.equal(s.groundIdx, 1);
});

test('the timed experience reaches breathing, then every grounding step, then finishes', () => {
  const { session: s } = harness({ observationSeconds: 0, embodimentSeconds: 0, anxietySeconds: 1 });
  s.startRun(); s.update(0); s.update(1); assert.equal(s.phase, 'breathing');
  s.update(15); assert.equal(s.phase, 'grounding');
  for (let i = 0; i < 5; i++) { assert.equal(s.groundIdx, i); s.pick('next'); }
  assert.equal(s.phase, 'end');
});

test('opening proceeds during asset loading and Start waits without starting the experience timer',()=>{
 const {session:s,director:d,panel}=harness();s.assetsReady=false;s.begin();
 s.pick('welcome');s.update(.35);assert.equal(s.phase,'intro');s.update(3);assert.equal(s.phase,'ready');
 s.pick('start');assert.equal(s.phase,'loading');assert.match(panel.model.status,/Loading/);
 s.update(60);assert.equal(s.phase,'loading');assert.equal(d.builds,0);assert.equal(s.elapsed,0);
 s.setAssetsReady();assert.equal(s.phase,'observing');assert.equal(s.phaseTime,0);assert.equal(panel.visible,false);
 s.setAssetsReady();assert.equal(s.phase,'observing');
});
test('assets becoming ready preserve the warning and still require Start',()=>{
 const {session:s}=harness();s.assetsReady=false;s.begin();s.pick('welcome');s.update(.35);
 s.setAssetsReady();assert.equal(s.phase,'intro');s.update(5);assert.equal(s.phase,'ready');
 s.pick('start');assert.equal(s.phase,'observing');
});

test('all five spoken targets advance 5-4-3-2-1 with no ready confirmation or panels', async () => {
  const {session:s,voice,panel}=harness();let answer;
  voice.available=true;voice.listen=()=>new Promise(resolve=>{answer=resolve;});
  s.startGrounding();
  const lists=['chair, table, wall, person, lamp','shirt, seat, controller, floor','voices, wind, music','coffee, soap','water'];
  for(let i=0;i<5;i++){
    assert.equal(panel.model.groundOnly,true);assert.equal(panel.model.groundCount,5-i);
    assert.deepEqual(panel.model.buttons,[{id:'next',label:'Continue'}]);assert.equal(panel.model.body,'');
    answer(lists[i]);await flush();
    assert.equal(s.phase,i===4?'end':'grounding');
    if(i<4)assert.equal(s.groundIdx,i+1);
  }
  assert.deepEqual(s.groundProgress.map(step=>step.items.size),[5,4,3,2,1]);
  s.begin();assert(s.groundProgress.every(step=>step.items.size===0),'Only a new exercise clears the saved category lists');
});

test('two more means two additional items, retaining separate category lists through redraws and microphone retries', async()=>{
  const spoken=[],guide={cancel(){},speak:async id=>spoken.push(id)};
  const {session:s,voice,panel}=harness({guide});let answer;
  voice.available=true;voice.listen=()=>new Promise(resolve=>{answer=resolve;});
  voice.init=async()=>{voice.available=true;};
  s.startGrounding();await flush();answer('chair, lamp, sculpture');await flush();
  assert.equal(spoken.at(-1),'more2');assert.equal(s.groundRemaining(),2);
  const saved=s.groundItems;s.groundShow();s.startGrounding();
  assert.equal(s.groundItems,saved);assert.equal(s.groundItems.size,3);
  s.cancelMedia();voice.available=false;await s.enableGroundListening();
  answer('person and wall');await flush();
  assert.equal(s.groundIdx,1);assert.equal(panel.model.groundLabel,'4 things you can feel');
  assert.equal(s.groundProgress[0].items.size,5);assert.equal(s.groundRemaining(),4);
  answer('chair and shirt');await flush();assert.equal(spoken.at(-1),'more2');
  await s.groundHint();assert.equal(s.groundRemaining(),2);
  answer('floor and controller');await flush();
  assert.equal(s.groundIdx,2);assert.equal(panel.model.groundLabel,'3 things you can hear');
  assert.deepEqual(s.groundProgress.slice(0,2).map(step=>step.items.size),[5,4]);
  s.cancelMedia();
});

test('Continue moves on with a partial list and a late transcript cannot enter the next category',async()=>{
  const {session:s,voice,panel}=harness();const answers=[];
  voice.available=true;voice.listen=()=>new Promise(resolve=>answers.push(resolve));
  s.startGrounding();answers.shift()('a chair');await flush();
  const late=answers.shift();panel.onPick('next');late('lamp, wall, person, sculpture');await flush();
  assert.equal(s.groundIdx,1);assert.deepEqual([...s.groundProgress[0].items],['chair']);
  assert.equal(s.groundItems.size,0);assert.equal(panel.model.groundCount,4);
  assert.equal(panel.model.groundLabel,'4 things you can feel');s.cancelMedia();
});
test('grounding requests microphone access automatically and retries from the dice after denial', async()=>{
  const {session:s,voice,panel}=harness();let attempts=0,answers=0;
  voice.init=async()=>{attempts++;voice.available=attempts>1;return voice.available;};
  voice.listen=()=>{answers++;return new Promise(()=>{});};
  s.startGrounding();await flush();assert.equal(attempts,1);assert.equal(answers,0);
  assert.equal(panel.model.groundOnly,true);assert.equal(s.groundIdx,0);
  s.pick('mic');await flush();assert.equal(attempts,2);assert.equal(answers,1);
  s.pick('mic');await flush();assert.equal(answers,1,'Dice cannot start duplicate listeners');s.cancelMedia();
});

test('returning during a pending microphone request resumes the current grounding step only', async()=>{
  const {session:s,voice}=harness();let permit,reads=0,attempts=0;
  voice.init=()=>{attempts++;return new Promise(resolve=>{permit=()=>{voice.available=true;resolve(true);};});};
  voice.listen=()=>{reads++;return new Promise(()=>{});};
  s.startGrounding();await flush();
  s.cancelMedia();s.enableGroundListening();permit();await flush();
  assert.equal(attempts,1);assert.equal(reads,1);assert.equal(s.listeningGen,s.gen);
  s.cancelMedia();
});


test('free exploration never starts anxiety or its timer without a perspective selection',()=>{
 const {session:s,director:d}=harness({freeExplore:true});s.startRun();s.update(3);
 assert.equal(s.phase,'exploring');s.update(600);assert.equal(s.phase,'exploring');assert.equal(d.builds,0);
 s._setPhase('embodying',2.8);s.update(2.8);assert.equal(s.phase,'running');assert.equal(d.builds,1);
});

test('calming waits for one minute inside POV, excluding exploration and the camera transition',()=>{
 const {session:s,director:d}=harness({freeExplore:true});s.startRun();s.update(3);
 s.update(1800,{inPerspective:false});assert.equal(s.phase,'exploring');assert.equal(s.povElapsed,0);
 s._setPhase('embodying',2.8);s.update(2.8,{inPerspective:false});
 s.update(2,{inPerspective:false});assert.equal(s.phase,'running');assert.equal(s.povElapsed,0);
 s.update(59.99,{inPerspective:true});assert.equal(s.phase,'running');
 s.update(.01,{inPerspective:true});assert.equal(s.phase,'breathing');assert.equal(d.state,'Recovery');
 assert.equal(s.afterBreathing,true);assert.equal(s.breathT,0);assert.equal(s.povElapsed,60);
});

test('floating and hidden tabs pause the POV minute; a new run resets it',()=>{
 const {session:s}=harness();s.startRun();s.update(16,{inPerspective:false});s.update(20,{inPerspective:true});
 s.update(600,{inPerspective:false});assert.equal(s.povElapsed,20);assert.equal(s.phase,'running');
 const oldDocument=globalThis.document;
 try {globalThis.document={hidden:true};s.update(600,{inPerspective:true});}
 finally {if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
 assert.equal(s.povElapsed,20);s.update(39.99,{inPerspective:true});assert.equal(s.phase,'running');
 s.update(.01,{inPerspective:true});assert.equal(s.phase,'breathing');
 s.startRun();assert.equal(s.povElapsed,0);assert.equal(s.calmRequested,false);
});


test('each accepted Start resets all room conversations, but POV switches do not',()=>{
 let resets=0;const {session:s}=harness({audio:{resetSession(){resets++;}}});
 s.assetsReady=false;s.startRun();assert.equal(resets,0,'loading does not consume a new audio session');
 s.setAssetsReady();assert.equal(resets,1);
 s.update(16);s._setPhase('exploring');s._setPhase('embodying',1);s.update(1);
 assert.equal(resets,1,'changing perspective preserves current sentence history');
 s.startRun();assert.equal(resets,2,'replay restores every voice without reloading the page');
});

test('audio session reset works before the sound context is unlocked',async()=>{
 const {ProceduralAudio}=await import('../public/js/audio.js');const audio=new ProceduralAudio();
 audio.resetSession();let resets=0;audio.voices={resetSession(){resets++;}};audio.resetSession();assert.equal(resets,1);
});
