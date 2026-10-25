// Requires Playwright and a running gallery. Usage: node test/fear-audio-browser.cjs [baseURL]
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome'});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2] || 'http://localhost:8080');await page.waitForFunction(()=>window.app?.ready,null,{timeout:120000});
 await page.mouse.click(700,500);
 await page.evaluate(()=>{app.renderer.setAnimationLoop(null);app.audio.start();app.audio.master.gain.value=.5;app.audio.fear.update(1,.016,{active:true,hostile:true,firstPerson:true});});
 await page.waitForFunction(()=>app.audio.fear.engine?.playing,null,{timeout:30000});
 await page.evaluate(()=>{const a=app.audio;window.fearMeter=a.ctx.createAnalyser();window.windMeter=a.ctx.createAnalyser();a.fear.synthBus.connect(fearMeter);a.fear.wind.connect(windMeter);});
 await page.waitForTimeout(3000);
 const first=await page.evaluate(()=>{const rms=m=>{const b=new Float32Array(m.fftSize);m.getFloatTimeDomainData(b);return Math.sqrt(b.reduce((a,v)=>a+v*v,0)/b.length);};return{fear:rms(fearMeter),wind:rms(windMeter),state:app.audio.ctx.state,level:app.audio.fear.level,playing:app.audio.fear.engine.playing};});
 assert(first.fear>.00001,JSON.stringify(first));assert(first.wind>.00001);assert.equal(first.state,'running');
 await page.evaluate(()=>app.audio.fear.update(1,.016,{active:true,hostile:false,firstPerson:false}));
 await page.waitForTimeout(1800);
 const stopped=await page.evaluate(()=>({playing:app.audio.fear.engine.playing,level:app.audio.fear.level,gain:app.audio.fear.synthBus.gain.value,wind:app.audio.fear.wind.gain.value,context:app.audio.ctx.state}));
 assert(!stopped.playing);assert.equal(stopped.level,0);assert(stopped.gain<.002);assert(stopped.wind<.002);assert.equal(stopped.context,'running');
 await page.evaluate(()=>app.audio.fear.update(1,.016,{active:true,hostile:true,firstPerson:true}));await page.waitForFunction(()=>app.audio.fear.engine?.playing);
 assert.deepEqual(errors,[]);console.log('PASS real Tone.js + wind audible, independent overlap, fade/stop and replay:',{first,stopped});
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
