// Headless smoke test: loads the app in Chromium (software GL), takes screenshots calm and at peak.
// Usage: node test/headless.cjs [outDir]    (server must run on :8080)
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const fs = require('fs'); const out = process.argv[2] || '/tmp/shots'; fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('console', (m) => console.log('console:', m.text())); p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto('http://localhost:8080/?profile=Debug_Fast&cap=0.9');
  await p.waitForFunction('window.app && window.app.ready', null, { timeout: 180000 });
  const looks = [[1.57, 0], [0, 0], [3.14, 0], [-1.57, 0.2]];
  for (const phase of ['calm', 'peak']) {
    if (phase === 'peak') { await p.evaluate('app.director.startBuild()'); await p.waitForTimeout(500); await p.evaluate('app.director.intensity=0.9; app.director.setState("Peak"); for(const k in app.director.smoothed) app.director.smoothed[k]=1;'); await p.waitForTimeout(800); }
    for (let i = 0; i < looks.length; i++) {
      await p.evaluate(([y, pi]) => app.setLook(y, pi), looks[i]); await p.waitForTimeout(700);
      await p.screenshot({ path: `${out}/${phase}_${i}.png`, timeout: 120000 });
    }
  }
  console.log(await p.evaluate('JSON.stringify(app.effects.values)'));
  await b.close();
})();
