const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome'});try{for(const mobile of [false,true]){
const p=await b.newPage({viewport:mobile?{width:390,height:844}:{width:1200,height:800},isMobile:mobile,hasTouch:mobile}),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto((process.argv[2]||'http://127.0.0.1:8080')+'/?lang=en');await p.waitForFunction(()=>window.app?.ready,null,{timeout:120000});await p.evaluate(()=>app.session.startRun());
await p.waitForFunction(()=>app.session.phase==='exploring'&&app.perspectiveTarget.enabled,null,{timeout:15000});
assert(await p.evaluate(()=>{app.session.update(600);return app.session.phase==='exploring'&&app.director.level===0;}));
const findDestination=()=>p.evaluate(()=>{
 const e=app.exploration,T=app.THREE;e.refresh();app.scene.updateMatrixWorld(true);
 for(let id=0;id<e.navigation.cells.length;id++){
  const point=e.navigation.point(id),d=point.distanceTo(e.position);if(d<.8||d>4.5||!e.navigation.clear(point))continue;
  const world=e.navigation.toWorld(point),screen=world.clone().project(app.camera);
  if(Math.abs(screen.x)>.9||screen.y<-.92||screen.y>.3||screen.z>1)continue;
  const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(screen.x,screen.y),app.camera);if(!e.pick(ray)||!e.navigation.path(e.position,point)?.length)continue;
  window.walkBefore=e.position.clone();window.lookBefore=app.camera.getWorldQuaternion(new T.Quaternion());
  return {x:(screen.x+1)*innerWidth/2,y:(1-screen.y)*innerHeight/2};
 }return null;
});
let dest=await findDestination();
for(let attempt=0;!dest&&attempt<6;attempt++){const size=p.viewportSize();await p.mouse.move(size.width*.6,size.height*.4);await p.mouse.down();await p.mouse.move(size.width*.15,size.height*.55,{steps:12});await p.mouse.up();dest=await findDestination();}
assert(dest,'Visible reachable floor after looking around');await p.mouse.click(dest.x,dest.y);
await p.waitForFunction(()=>app.exploration.position.distanceTo(walkBefore)>.7,null,{timeout:15000});
assert(await p.evaluate(()=>app.camera.getWorldQuaternion(new app.THREE.Quaternion()).angleTo(lookBefore)<1e-5),'Walking never turns the view');
const label=await p.evaluate(()=>{
 app.exploration.walkPath=[];app.rig.quaternion.identity();const target=app.perspectiveTarget.label.position;app.camera.lookAt(target);app.scene.updateMatrixWorld(true);
 const s=target.clone().project(app.camera);return{x:(s.x+1)*innerWidth/2,y:(1-s.y)*innerHeight/2};
});await p.mouse.move(label.x,label.y);await p.waitForFunction(()=>app.perspectiveTarget.preview>.2,null,{timeout:5000});
await p.screenshot({path:`/tmp/free-explore-${mobile?'phone':'desktop'}.png`});
await p.mouse.click(label.x,label.y);await p.waitForFunction(()=>app.session.phase==='running'&&app.journey.embodied,null,{timeout:10000});
assert(await p.evaluate(()=>app.director.level>0&&!app.exploration.active&&!app.perspectiveTarget.label.visible));assert.deepEqual(errors,[]);
console.log('PASS',mobile?'phone':'desktop','untimed exploration, floor click walking, free look, hover preview, label selection and anxiety handoff');await p.close();
}}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
