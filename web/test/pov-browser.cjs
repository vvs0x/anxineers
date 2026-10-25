// Rendered regression: real frame loop, saved dimming settings, and timed blackout.
// Requires Playwright and a running server. Usage: node test/pov-browser.cjs [baseURL] [output]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.argv[2] || 'http://localhost:8080';
const output = process.argv[3] || '/tmp/still-here-pov';
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/.test(m.text())) errors.push(m.text()); });
    // This used to extinguish both the sun and ambient lighting at peak.
    await page.addInitScript(() => localStorage.setItem('signal.developer-settings.v1',
      JSON.stringify({ journeyVersion: 2, 'effects.s.ambientDim': 1, 'director.cap': .5, 'director.profile.peak': .5, 'effects.wallGaze.amplitude': .12 })));
    await page.goto(base + '/?lang=en');
    await page.waitForFunction(() => window.app?.ready, null, { timeout: 120000 });
    const settings = await page.evaluate(() => {
      app.session.observationSeconds = .1; app.session.embodimentSeconds = .1;
      app.session.startRun();
      return { dim: app.effects.s.ambientDim, after: app.effects.blackout.afterSeconds, duration: app.effects.blackout.durationSeconds, cap: app.director.cap, peak: app.director.profile.peak, walls: app.effects.wallGaze.amplitude };
    });
    assert.deepEqual(settings, { dim: .6, after: 30, duration: 8, cap: 1, peak: 1, walls: .3 });
    async function sample(label, at) {
      await page.waitForFunction(t => app.effects.blackout.elapsed >= t, at, { timeout: 60000, polling: 50 });
      const result = await page.evaluate(() => {
        const a = app; a.renderer.render(a.scene, a.camera);
        const gl = a.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let sum = 0, lit = 0, count = 0;
        for (let y = Math.floor(h * .2); y < h * .8; y += 8) for (let x = Math.floor(w * .2); x < w * .8; x += 8) {
          const i = (y * w + x) * 4, value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          sum += value; lit += value > 15; count++;
        }
        return { time: a.effects.blackout.elapsed, mean: sum / count, lit: lit / count,
          wall: a.fx.uLeanK.value, blackout: a.effects.blackout.amount, fade: a.journey.fade.visible,
          environment: a.scene.environmentIntensity, sun: a.daylight.sun.intensity };
      });
      await page.screenshot({ path: `${output}/${label}.png` });
      console.log(label, result);
      return result;
    }
    const entry = await sample('entry', .25);
    const peak = await sample('peak', 11);
    const earlyOut = await sample('early-outward', 13);
    assert(earlyOut.wall < .005, 'Early pulses precede the close hold');
    const before = await sample('before-blackout', 29.5);
    const dimming = await sample('fading-down', 32);
    const dark = await sample('blackout', 34);
    const between = await sample('between-waves', 38);
    const darkAgain = await sample('blackout-again', 42);
    const restored = await sample('restored', 46.2);
    const later = await sample('later', 48);
    const held = await sample('held-after-blackouts', 55.5);
    const outward = await sample('walls-outward', 59);
    const inward = await sample('walls-inward', 62);
    for(const result of [before,dimming,dark,between,darkAgain,restored,later,held])
      assert(Math.abs(result.wall-.3)<.0001, 'Walls stay at maximum throughout both waves and the extra hold');
    assert(outward.wall<.005, 'Pulsing begins outward after the hold');
    assert(inward.wall>.295, 'Walls return inward in the first full cycle');
    for (const result of [entry, peak, before, restored, later]) {
      assert.equal(result.blackout, 0); assert.equal(result.fade, false);
      assert(result.mean > 12 && result.lit > .3, 'The rendered room must remain visible outside the timed cue');
      assert(result.environment >= .4 && result.sun > 0, 'Anxiety never extinguishes room lighting');
    }
    assert(dimming.blackout > .45 && dimming.blackout < .65, 'Darkness fades gradually');
    assert(between.blackout < .02, 'First wave returns to light');
    for (const result of [dark, darkAgain]) { assert(result.blackout > .98); assert(result.mean < 3, 'Both waves reach darkness'); }
    assert.deepEqual(errors, []);
    // Stop/cancel must reveal the room on the next real animation frame.
    await page.evaluate(() => {
      app.effects.blackout.elapsed = 34; app.effects.blackout.finished = false;
      app.effects.blackout.amount = 1; app.session.calmNow();
    });
    await page.waitForFunction(() => app.effects.blackout.amount === 0);
    assert.equal(await page.evaluate(() => app.session.phase), 'breathing');
    console.log('PASS rendered POV: visible at entry/peak, two smooth 30–46s darkness waves, restored room, legacy dimming clamped, Calm Now clears darkness.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
