// Two browser clients and real WebGL2 framebuffers; no physical headset required.
const { chromium } = require('playwright');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const { createSpectatorRelay } = await import('../spectator-relay.mjs');
  const root = path.resolve(__dirname, '..'), app = express(), relay = createSpectatorRelay();
  app.get('/api/status', (_req,res)=>res.json({headsetUrls:['https://192.168.1.10:8443']}));
  app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
  app.use(express.static(path.join(root, 'public')));
  app.get('/capture-test', (_req, res) => res.type('html').send(`<!doctype html><html><head><style>body{margin:0} [hidden]{display:none!important}</style></head><body><div id="session-overlay" hidden></div>
    <script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js"}}</script>
    <script type="module">
      import * as THREE from 'three';
      import { SpectatorCapture } from '/js/spectator-capture.js';
      import { SpectatorBroadcast } from '/js/spectator-broadcast.js';
      const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(innerWidth,innerHeight); document.body.append(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.Camera();
      const material = new THREE.ShaderMaterial({uniforms:{turn:{value:0}},vertexShader:'void main(){gl_Position=vec4(position,1.);}',fragmentShader:'uniform float turn; void main(){ if(gl_FragCoord.x>128.) gl_FragColor=vec4(0.,1.,0.,1.); else if(gl_FragCoord.y>64.) gl_FragColor=vec4(1.-turn,turn,0.,1.); else gl_FragColor=vec4(0.,0.,1.,1.); }'});
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
      let rt; const eye = {viewport:new THREE.Vector4(0,0,128,128)};
      renderer.xr.getCamera=()=>({cameras:[eye]});
      function draw(samples=4){if(rt?.samples!==samples){rt?.dispose();rt=new THREE.WebGLRenderTarget(256,128,{samples});} renderer.setRenderTarget(rt);renderer.setScissorTest(false);renderer.render(scene,camera);}
      const broadcast = new SpectatorBroadcast(renderer);
      function drawBrowser(){renderer.setRenderTarget(null);renderer.setScissorTest(false);renderer.render(scene,camera);}
      const tick=()=>{if(renderer.xr.isPresenting)draw();else drawBrowser();broadcast.frame(performance.now(),'breathing');};
      window.fixture={renderer,draw,drawBrowser,tick,broadcast,material,eye,SpectatorCapture}; material.uniforms.turn.value=Number(new URLSearchParams(location.search).get('green')||0); drawBrowser(); window.ready=true;
    </script></body></html>`));
  const server = http.createServer(app); relay.attach(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const out = process.argv[2] || '/tmp/still-here-spectator'; await fs.mkdir(out, { recursive: true });
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const viewer = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const source = await browser.newPage({ viewport: { width: 640, height: 480 } });
    const errors = []; for (const page of [viewer, source]) page.on('pageerror', e => errors.push(e.message));
    await viewer.goto(base+'/spectator.html');
    await viewer.waitForFunction(()=>document.getElementById('connection').textContent==='Waiting for visitors');
    await viewer.screenshot({path:path.join(out,'waiting.png')});
    await source.goto(base + '/capture-test'); await source.waitForFunction(() => window.ready);
    for (const samples of [0, 4]) {
      const result = await source.evaluate(async samples => {
        const {renderer,draw,SpectatorCapture}=fixture; renderer.xr.isPresenting=true; draw(samples);
        const gl=renderer.getContext(), target=renderer.getRenderTarget();
        renderer.setScissor(3,4,20,25);renderer.setScissorTest(true);
        const before=[gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)];
        const capture=new SpectatorCapture(renderer,{maxEdge:64,quality:.9});
        const blob=await capture.capture(), image=await createImageBitmap(blob), canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();
        const top=Array.from(ctx.getImageData(32,10,1,1).data),bottom=Array.from(ctx.getImageData(32,54,1,1).data);
        const restored=before.every((value,i)=>value===gl.getParameter([gl.READ_FRAMEBUFFER_BINDING,gl.DRAW_FRAMEBUFFER_BINDING,gl.PIXEL_PACK_BUFFER_BINDING][i]))&&gl.isEnabled(gl.SCISSOR_TEST)&&renderer.getRenderTarget()===target;
        const error=gl.getError();capture.dispose();renderer.setScissorTest(false);
        return {top,bottom,width:canvas.width,height:canvas.height,restored,error};
      }, samples);
      assert.equal(result.error, 0, `WebGL error with ${samples} samples`);
      assert(result.restored, 'Frame capture must restore renderer and WebGL state');
      assert.equal(result.width,64); assert.equal(result.height,64);
      assert(result.top[0]>220&&result.top[1]<25&&result.top[2]<25, 'Top of the left eye must be red, not flipped or the right eye');
      assert(result.bottom[2]>220&&result.bottom[0]<25, 'Bottom of the left eye must be blue');
    }
    await source.evaluate(()=>{fixture.renderer.xr.isPresenting=false;fixture.timer=setInterval(fixture.tick,70);});
    await viewer.waitForFunction(()=>document.querySelectorAll('.tile.live').length===1);
    const firstId=await viewer.locator('.tile').getAttribute('data-source');
    const first=viewer.locator(`[data-source="${firstId}"]`);
    assert(await first.locator('.caption').evaluate(e=>e.getBoundingClientRect().bottom<=document.getElementById('view').getBoundingClientRect().bottom),'A single tile must keep its Enter view control on screen');
    assert.equal(await first.locator('canvas').evaluate(c=>c.width),640,'Browser view keeps its full viewport');
    assert.equal(await first.locator('canvas').evaluate(c=>c.height),480);
    assert.match(await first.locator('.details').textContent(),/Browser/);
    assert.equal(await first.locator('canvas').evaluate(c=>c.getContext('2d').getImageData(50,15,1,1).data[0]>200),true);
    // Browser DOM is composited too, including opening copy and the breathing cue.
    await source.evaluate(()=>{const overlay=document.getElementById('session-overlay');overlay.hidden=false;overlay.style.cssText='position:fixed;inset:0;background:#08090b;color:white;display:grid;place-items:center;font:32px monospace';overlay.innerHTML='<span>I am still here</span>';});
    await viewer.waitForFunction(id=>{const c=document.querySelector(`[data-source="${id}"] canvas`);return c.getContext('2d').getImageData(50,15,1,1).data[0]<20;},firstId);
    assert(await first.locator('canvas').evaluate(c=>{const a=c.getContext('2d').getImageData(100,200,440,80).data;let bright=0;for(let i=0;i<a.length;i+=4)if(a[i]>150)bright++;return bright>200;}),'Opening text must be visible in the stream');
    await viewer.screenshot({path:path.join(out,'browser-opening.png')});
    await source.evaluate(()=>{const overlay=document.getElementById('session-overlay');overlay.style.background='transparent';overlay.innerHTML='<span style="display:block;width:64px;height:64px;border-radius:50%;background:rgb(191,217,255);transform:scale(1.4)"></span>';});
    await viewer.waitForFunction(id=>{const c=document.querySelector(`[data-source="${id}"] canvas`),p=c.getContext('2d').getImageData(320,240,1,1).data;return p[2]>230&&p[0]>160;},firstId);
    await source.evaluate(()=>document.getElementById('session-overlay').hidden=true);
    const other=await browser.newPage({viewport:{width:640,height:480}});other.on('pageerror',e=>errors.push(e.message));
    await other.goto(base+'/capture-test?green=1');await other.waitForFunction(()=>window.ready);
    await other.evaluate(()=>fixture.timer=setInterval(fixture.tick,70));
    await viewer.waitForFunction(()=>document.querySelectorAll('.tile.live').length===2);
    const secondId=await viewer.locator(`.tile:not([data-source="${firstId}"])`).getAttribute('data-source');
    const second=viewer.locator(`[data-source="${secondId}"]`);
    assert(await second.locator('canvas').evaluate(c=>c.getContext('2d').getImageData(50,15,1,1).data[1]>200),'Second browser retains its own image');
    await viewer.screenshot({path:path.join(out,'grid.png')});
    await second.click();await viewer.waitForFunction(()=>document.getElementById('grid').classList.contains('focused'));
    assert(await first.isHidden());
    for (const selector of ['header','footer']) assert(await viewer.locator(selector).isHidden(), `${selector} must be hidden in a selected view`);
    for (const selector of ['.caption','.tile-status']) assert(await second.locator(selector).isHidden(), `${selector} must be hidden in a selected view`);
    await source.waitForFunction(()=>!fixture.broadcast.watching&&!fixture.broadcast.busy&&!fixture.broadcast.capture);
    assert.deepEqual(await second.locator('.preview').boundingBox(),{x:0,y:0,width:1366,height:900},'Selected view must fill the viewport');
    await viewer.screenshot({path:path.join(out,'focused.png')});
    await viewer.keyboard.press('f');await viewer.waitForFunction(()=>Boolean(document.fullscreenElement));
    await viewer.keyboard.press('f');await viewer.waitForFunction(()=>!document.fullscreenElement);
    await viewer.keyboard.press('Escape');assert(await first.isVisible());
    assert(await viewer.locator('header').isVisible());
    await source.waitForFunction(()=>fixture.broadcast.watching);
    await first.click();await viewer.keyboard.press('Escape');assert(await second.isVisible());
    // VR uses the same participant tile, then returns to the full browser view.
    await source.evaluate(()=>{fixture.renderer.xr.isPresenting=true;fixture.renderer.xr.dispatchEvent({type:'sessionstart'});});
    await viewer.waitForFunction(id=>{const e=document.querySelector(`[data-source="${id}"]`);return e.classList.contains('live')&&e.querySelector('canvas').width===128&&e.querySelector('.details').textContent.includes('VR headset');},firstId);
    await source.evaluate(()=>{fixture.renderer.xr.isPresenting=false;fixture.renderer.xr.dispatchEvent({type:'sessionend'});});
    await viewer.waitForFunction(id=>{const e=document.querySelector(`[data-source="${id}"]`);return e.classList.contains('live')&&e.querySelector('canvas').width===640&&e.querySelector('.details').textContent.includes('Browser');},firstId);
    // Backgrounding a browser pauses just that participant.
    await source.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await viewer.waitForFunction(id=>document.querySelector(`[data-source="${id}"] .tile-status`).textContent==='Their page is paused',firstId);
    assert(await second.evaluate(e=>e.classList.contains('live')));
    await source.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await viewer.waitForFunction(()=>document.querySelectorAll('.tile.live').length===2);
    await viewer.reload();await viewer.waitForFunction(()=>document.querySelectorAll('.tile.live').length===2);
    const additional=await browser.newPage({viewport:{width:900,height:700}});additional.on('pageerror',e=>errors.push(e.message));
    await additional.goto(base+'/spectator.html');await additional.waitForFunction(()=>document.querySelectorAll('.tile.live').length===2);
    await source.evaluate(()=>fixture.broadcast.connection.socket.close());
    await source.waitForFunction(()=>fixture.broadcast.state==='reconnecting');
    await viewer.waitForFunction(()=>document.querySelectorAll('.tile.live').length===2);
    await source.close();await other.close();
    await viewer.waitForFunction(()=>document.getElementById('connection').textContent==='Waiting for visitors');
    await additional.close();
    await viewer.setViewportSize({width:390,height:844});await viewer.screenshot({path:path.join(out,'waiting-mobile.png')});
    // A browser opened first streams as soon as a spectator returns.
    const late=await browser.newPage({viewport:{width:640,height:480}});late.on('pageerror',e=>errors.push(e.message));
    await viewer.close();await late.goto(base+'/capture-test');await late.waitForFunction(()=>window.ready);
    await late.evaluate(()=>fixture.timer=setInterval(fixture.tick,70));
    assert(await late.evaluate(()=>!fixture.broadcast.capture),'No image capture without spectators');
    const reopened=await browser.newPage({viewport:{width:390,height:844}});
    await reopened.goto(base+'/spectator.html');await reopened.waitForFunction(()=>document.querySelector('.tile.live'));
    await reopened.screenshot({path:path.join(out,'grid-mobile.png')});
    await reopened.locator('.tile').click();await reopened.screenshot({path:path.join(out,'focused-mobile.png')});
    assert.deepEqual(await reopened.locator('.preview').boundingBox(),{x:0,y:0,width:390,height:844});
    await reopened.close();await late.waitForFunction(()=>!fixture.broadcast.watching&&!fixture.broadcast.busy&&!fixture.broadcast.capture);
    await late.close();
    assert.deepEqual(errors,[]);
    console.log('PASS: browser opening/circle capture, independent simultaneous streams, clickable grid, focus/back/Escape/full screen, browser-to-VR-to-browser transitions, pause/resume, reconnect, multiple spectators, mobile layout, no capture without viewers, and XR crop/MSAA/GL state.');
  } finally { await browser?.close(); relay.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
