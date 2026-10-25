// Run with a local server and Playwright installed: node test/devices.cjs [baseURL] [screenshots]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.argv[2] || 'http://localhost:8080';
const out = process.argv[3] || '/tmp/still-here-devices'; fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {});
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/i.test(m.text())) errors.push(m.text()); });
      await page.addInitScript(() => {
        window.motionAllowed = false;
        Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { configurable: true, value: async () => window.motionAllowed ? 'granted' : 'denied' });
      });
      await page.goto(`${base}/?lang=en`);
      await page.waitForFunction(() => window.app?.ready, null, { timeout: 180000 });
      await page.screenshot({ path: `${out}/${mobile ? 'phone' : 'laptop'}-consent.png` });
      assert(await page.locator('[data-pick="agree"]').isVisible());
      assert.equal(await page.locator('#motion').isVisible(), mobile);
      if (mobile) {
        await page.locator('#motion').tap();
        await page.waitForFunction(() => document.getElementById('look-hint').textContent.includes('not allowed'));
        await page.evaluate(() => { window.motionAllowed = true; });
        await page.locator('#motion').tap();
        await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 90, gamma: 0 })));
        await page.waitForFunction(() => app.look.motionActive);
        const before = await page.evaluate(() => app.camera.quaternion.toArray());
        await page.evaluate(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 60, beta: 90, gamma: 0 })));
        await page.waitForFunction(q => app.camera.quaternion.angleTo(new app.THREE.Quaternion().fromArray(q)) > .9, before);
        await page.locator('#recenter').tap();
        assert(await page.evaluate(() => app.camera.quaternion.angleTo(new app.THREE.Quaternion()) < 1e-6));
      }
      await page.locator('[data-pick="agree"]').click();
      assert.equal(await page.evaluate(() => app.session.phase), 'intro');
      if (mobile) {
        for (const size of [{ width: 844, height: 390 }, { width: 320, height: 568 }]) {
          await page.setViewportSize(size);
          await page.locator('[data-pick="continue"]').scrollIntoViewIfNeeded();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          assert(await page.evaluate(() => document.getElementById('session-card').getBoundingClientRect().top >= document.getElementById('look-controls').getBoundingClientRect().bottom));
          await page.screenshot({ path: `${out}/phone-${size.width}x${size.height}.png` });
        }
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await page.locator('[data-pick="continue"]').click();
      await page.waitForFunction(() => app.session.phase === 'observing');
      if (!mobile) {
        await page.locator('#float').click();
        const position = await page.evaluate(() => app.exploration.position.toArray());
        await page.mouse.move(500, 380); await page.mouse.down(); await page.mouse.move(700, 420, { steps: 10 }); await page.mouse.up();
        await page.waitForFunction(p => app.exploration.position.distanceTo(new app.THREE.Vector3().fromArray(p)) > .05, position);
        assert.equal(await page.evaluate(() => app.journey.embodied), false);
        assert.equal(await page.evaluate(() => app.character.scribble.group.visible), true);
      }
      await page.screenshot({ path: `${out}/${mobile ? 'phone' : 'laptop'}-room.png` });
      await page.locator('#calm').click();
      await page.waitForFunction(() => app.session.phase === 'breathing');
      assert(await page.locator('#session-orb').isVisible());
      await page.evaluate(() => { app.session.breathT = 14.99; });
      await page.waitForFunction(() => app.session.phase === 'end');
      await page.locator('[data-pick="again"]').click();
      assert.equal(await page.evaluate(() => app.session.phase), 'consent');
      assert.deepEqual(errors, []);
      console.log(`PASS ${mobile ? 'phone' : 'laptop'}: load/render, readable panels, input, calm, breathing, replay; no page/shader errors`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
