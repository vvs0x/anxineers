// Run against npm start with Playwright available (or supplied through NODE_PATH).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = process.env.ART_HACK_SHOTS || '/tmp/art-hack-developer-check'; fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/status', route => route.fulfill({ json: { ok: true, stt: false } }));
    await page.goto('http://localhost:8080/?dev=1');
    await page.waitForFunction(() => window.app?.developer, null, { timeout: 180000 });
    // Exercise DOM controls without repeatedly software-rendering the animated crowd.
    await page.waitForFunction(() => app.effects.t > 0);
    await page.evaluate(() => app.renderer.setAnimationLoop(null));
    assert.equal(await page.locator('input[data-setting^="visitors.visitors."]').count(), await page.evaluate(() => app.visitors.visitors.length));
    assert(await page.locator('#developer-panel').isVisible());
    await page.screenshot({ path: `${out}/desktop.png`, timeout: 120000 });
    const table = page.getByRole('slider', { name: 'Furniture & gaze: Table growth', exact: true });
    await table.focus(); await table.press('ArrowRight');
    assert.equal(await page.evaluate(() => app.effects.s.tableGrowth), .09);
    const cap = page.getByRole('slider', { name: 'Session: Intensity cap', exact: true });
    await cap.evaluate(input => { input.value = '.65'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.evaluate(() => app.session.cap), .65);
    await page.getByRole('button', { name: 'Close developer settings' }).click();
    await page.getByRole('button', { name: 'I understand, continue', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    assert.equal(await page.evaluate(() => app.session.phase), 'observing');
    assert.equal(await page.evaluate(() => app.director.cap), .65);
    await page.reload(); await page.waitForFunction(() => window.app?.developer, null, { timeout: 180000 });
    await page.waitForFunction(() => app.effects.t > 0);
    await page.evaluate(() => app.renderer.setAnimationLoop(null));
    assert.equal(await page.evaluate(() => app.effects.s.tableGrowth), .09);
    assert.equal(await page.evaluate(() => app.director.cap), .65);
    await page.getByRole('button', { name: 'Reset defaults' }).click();
    assert.deepEqual(await page.evaluate(() => [app.effects.s.chairGrowth, app.effects.s.tableGrowth, app.director.cap, app.session.breathing]), [.3, .08, .5, { count: 3, inhale: 2, exhale: 3 }]);
    // Every slider has a finite runtime target. None points to an obsolete knob.
    assert(await page.evaluate(() => Object.values(app.developer.values()).every(value => typeof value === 'boolean' || Number.isFinite(value))));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#developer-panel').evaluate(panel => { panel.scrollTop = 0; });
    await page.screenshot({ path: `${out}/mobile.png`, timeout: 120000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('PASS browser: developer sliders, keyboard adjustment, local persistence, reset, shortened start flow, desktop/mobile layout and no runtime errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
