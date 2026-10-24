// Headless flow test: consent -> mode -> cap -> run -> grounding (mocked ElevenLabs) -> breathing -> end. Screenshots per screen.
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const fs = require('fs'); const out = process.argv[2] || '/tmp/flow'; fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 640, height: 360 }, permissions: ['microphone'] });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  p.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
  let sttCalls = 0;
  await p.route('**/api/status', (r) => r.fulfill({ json: { ok: true, stt: true } }));
  await p.route('**/api/stt*', (r) => { sttCalls++; r.fulfill({ json: { text: 'a lamp, a chair and a door' } }); });
  await p.goto('http://localhost:8080/?lang=en&debug=1');
  await p.waitForFunction('window.app && window.app.ready', null, { timeout: 180000 });
  const shot = async (n) => { await p.waitForTimeout(500); await p.screenshot({ path: `${out}/${n}.png`, timeout: 120000 }); };
  const ph = () => p.evaluate('app.session.phase');
  const pick = (id) => p.evaluate((i) => app.session.pick(i), id);
  const log = async (l) => console.log(l, await ph());
  await shot('1_consent'); await log('consent');
  await pick('agree'); await shot('2_intro'); await log('intro');
  await pick('continue'); await shot('3_mode'); await log('mode');
  await pick('edu'); await pick('capup'); await shot('4_cap'); await log('cap');
  await pick('start'); await log('running');
  await p.evaluate('app.director.setProfile({...app.director.profile, build: 2, hold: 1, recovery: 3, peak: 0.5}); app.director.startBuild()');
  await p.waitForFunction('app.session.phase === "grounding"', null, { timeout: 60000 }); await shot('5_grounding'); await log('grounding');
  // voice answers: expect auto advance through the 5 steps via mocked STT
  await p.waitForFunction('app.session.groundIdx >= 1', null, { timeout: 60000 }); console.log('voice advanced, stt calls', sttCalls);
  await pick('next'); await pick('next'); await pick('next'); await pick('next');
  await p.waitForFunction('app.session.phase === "breathing"', null, { timeout: 30000 }); await shot('6_breathing'); await log('breathing');
  await p.evaluate('app.session.breathT = 29.9'); await p.waitForFunction('app.session.phase === "end"', null, { timeout: 30000 });
  await shot('7_end'); await log('end');
  // calm now during a run
  await pick('again'); await pick('agree'); await pick('continue'); await pick('reg'); await pick('start'); await p.waitForTimeout(300);
  await p.evaluate('app.session.calmNow()'); await log('after calmNow'); 
  console.log('errors', errors.length, 'stt calls', sttCalls);
  await b.close();
})();
