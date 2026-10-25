// Requires Playwright and a running server. Optional first argument: production URL.
const { chromium }=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.argv[2]||'http://localhost:8080';
const output=process.argv[3]||'/tmp/still-here-crowd';fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{});
  try{
    for(const mobile of [false,true]){
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile});
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error'&&/shader|WebGLProgram/.test(message.text()))errors.push(message.text());});
      await page.goto(base+'/?lang=en');await page.waitForFunction(()=>window.app?.ready,null,{timeout:120000});
      const result=await page.evaluate(()=>{
        app.renderer.setAnimationLoop(null);app.panel.hide();
        if(app.exploration)app.exploration.active=false;
        const crowd=app.visitors,initial={count:crowd.visitors.length,group:crowd.group.length,roamers:crowd.roamers.length};
        const viewer=new app.THREE.Vector3(app.env.spawn.x,1.7,app.env.spawn.z);
        for(let i=0;i<2400&&crowd.exchanges<1;i++)crowd.update(.05,viewer);
        const ray=new app.THREE.Raycaster(new app.THREE.Vector3(10.8,1.7,1.5),new app.THREE.Vector3(1,0,0));
        const wall=ray.intersectObjects(app.env.roomMeshes,false)[0];
        app.rig.position.set(3.3,app.env.floorY,.3);app.rig.rotation.set(0,-Math.PI/2,0);
        app.camera.position.set(0,1.7,0);app.camera.rotation.set(0,0,0);
        app.scene.updateMatrixWorld(true);app.renderer.render(app.scene,app.camera);
        return {initial,group:crowd.group.length,roamers:crowd.roamers.length,exchanges:crowd.exchanges,seated:crowd.visitors.filter(v=>v.role==='seated').length,front:crowd.visitors.filter(v=>v.role==='front').length,rear:crowd.visitors.filter(v=>v.role==='rear').length,wall:wall?.object.name};
      });
      assert.equal(result.initial.count,7);assert.equal(result.initial.group,5);assert.equal(result.initial.roamers,0);
      assert(result.exchanges>=1);assert.equal(result.group,5);assert.equal(result.roamers,0);
      assert.equal(result.seated,2);assert.equal(result.front,2);assert.equal(result.rear,3);
      assert(result.wall.startsWith('Rear '));assert.deepEqual(errors,[]);
      await page.screenshot({path:`${output}/${mobile?'phone':'laptop'}-crowd.png`});
      console.log('PASS',mobile?'phone':'laptop',JSON.stringify(result));await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
