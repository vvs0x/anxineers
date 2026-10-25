const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome'});try{for(const mobile of [false,true]){
const p=await b.newPage({viewport:mobile?{width:390,height:844}:{width:1200,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));let release;const gate=new Promise(r=>release=r);
await p.route('**/*.glb',async route=>{await gate;await route.continue();});
await p.goto((process.argv[2]||'http://127.0.0.1:8080')+'/?lang=en',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.app?.session,null,{timeout:30000});
assert.equal(await p.evaluate(()=>app.ready),false);await p.evaluate(()=>app.session.guide.enabled=false);
await p.getByRole('button',{name:'Begin with sound'}).click();await p.evaluate(()=>app.session.update(3));
await p.waitForFunction(()=>app.session.phase==='intro');assert(await p.getByText('Trigger warning',{exact:true}).isVisible());
await p.screenshot({path:`/tmp/loading-warning-${mobile?'phone':'desktop'}.png`});
await p.evaluate(()=>{app.session.narrating=false;app.session.update(5);});await p.locator('#session-buttons button').click();assert.equal(await p.evaluate(()=>app.session.phase),'loading');
assert(await p.getByText('Loading the room…',{exact:true}).isVisible());assert.equal(await p.locator('#status').textContent(),'');
release();await p.waitForFunction(()=>window.app?.ready,null,{timeout:120000});assert.equal(await p.evaluate(()=>app.session.phase),'observing');assert.deepEqual(errors,[]);console.log('PASS',mobile?'phone':'desktop','intro and warning before scene, Start waits, automatic handoff on readiness');await p.close();
}}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
