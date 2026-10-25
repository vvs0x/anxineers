const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.argv[2]||'http://localhost:8080';
(async()=>{const b=await chromium.launch({channel:'chrome'});try{for(const mobile of [false,true]){
 const p=await b.newPage({viewport:mobile?{width:390,height:844}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/?lang=en');await p.waitForFunction(()=>window.app?.ready,null,{timeout:120000});
 await p.evaluate(()=>{app.renderer.setAnimationLoop(null);app.session.startRun();app.journey.update(0,app.session);});
 for(const time of [1,2.5,4,6,8,9.9]){
  const state=await p.evaluate(time=>{while(app.session.phaseTime<time){app.session.update(.05);app.journey.update(.05,app.session);app.director.update(.05);}app.scene.updateMatrixWorld(true);app.renderer.render(app.scene,app.camera);return {phase:app.session.phase,intensity:app.director.level};},time);
  assert.equal(state.phase,'observing');assert.equal(state.intensity,0);await p.screenshot({path:`/tmp/showcase-${mobile?'phone':'desktop'}-${time}.png`});
 }
 const result=await p.evaluate(()=>{
  while(app.session.phase!=='running'){app.session.update(.05);app.journey.update(.05,app.session);app.director.update(.05);}
  const handoff={phase:app.session.phase,embodied:app.journey.embodied,floating:app.exploration.active};
  while(app.session.phaseTime<5){app.session.update(.05);app.director.update(.05);}const half=app.director.level;
  while(app.session.phaseTime<10){app.session.update(.05);app.director.update(.05);}const peak=app.director.level;
  while(app.session.phase==='running'){app.session.update(.05);app.director.update(.05);}const end=app.session.phase;
  app.session.startRun();app.session.update(14);app.journey.update(.05,app.session);document.getElementById('calm').click();
  return {handoff,half,peak,end,early:app.session.phase,route:app.exploration.showcaseLength};
 });
 assert.deepEqual(result.handoff,{phase:'running',embodied:true,floating:false});assert(result.half>.49&&result.half<.52);assert.equal(result.peak,1);assert.equal(result.end,'breathing');assert.equal(result.early,'breathing');assert.deepEqual(errors,[]);console.log('PASS',mobile?'phone':'desktop',result);await p.close();
}}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
