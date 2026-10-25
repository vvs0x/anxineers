import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { VisitorNavigation } from './visitor-navigation.js';
import { FootSupport, fitSeatedPose } from './grounding.js';

function shadowMaterial(opacity, trail=false){
  const material=new THREE.MeshStandardMaterial({color:0x090b10,roughness:1,metalness:0,
    transparent:true,opacity,depthWrite:!trail});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vVisitorNormal; varying vec3 vVisitorView;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\nvVisitorNormal=normalize(transformedNormal);')
      .replace('#include <project_vertex>','#include <project_vertex>\nvVisitorView=normalize(-mvPosition.xyz);');
    shader.fragmentShader='varying vec3 vVisitorNormal; varying vec3 vVisitorView;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight = diffuseColor.rgb;\ndiffuseColor.a *= smoothstep(0.02, 0.65, abs(dot(normalize(vVisitorNormal), normalize(vVisitorView))));\nif(diffuseColor.a<0.015) discard;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey=()=>`shadow-visitor-${trail}`;
  return material;
}

function contactShadow(){
  const size=32,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.hypot((x+.5)/size*2-1,(y+.5)/size*2-1),i=(y*size+x)*4;
    data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(255*Math.max(0,1-r)**2);
  }
  const map=new THREE.DataTexture(data,size,size);map.needsUpdate=true;
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.3,.35),new THREE.MeshBasicMaterial({color:0x000000,map,transparent:true,opacity:.32,depthWrite:false}));
  mesh.name='Foot contact shadow';mesh.rotation.x=-Math.PI/2;mesh.position.y=.002;return mesh;
}

function makeAvatar(gltf, height, material){
  const model=clone(gltf.scene),root=new THREE.Group();root.add(model);
  const bones=new Map();model.traverse(o=>{if(o.isBone)bones.set(o.name.replace(/^mixamorig\d*[:_]?/,''),o);if(o.isMesh){o.material=material;o.frustumCulled=false;o.castShadow=false;}});
  // Horizontal root translation in the supplied walking clip must never move the navigation body.
  const walk=gltf.animations[0].clone();
  const hips=bones.get('Hips');
  if(!hips)throw new Error('Walking visitor is missing its hip bone.');
  root.updateMatrixWorld(true);
  const parentMatrix=hips.parent.matrixWorld.clone(),inverse=parentMatrix.clone().invert();
  for(const track of walk.tracks)if(track.name===hips.name+'.position'){
    const anchor=new THREE.Vector3().fromArray(track.values).applyMatrix4(parentMatrix);
    for(let i=0;i<track.values.length;i+=3){
      const p=new THREE.Vector3().fromArray(track.values,i).applyMatrix4(parentMatrix);
      p.x=anchor.x;p.z=anchor.z;p.applyMatrix4(inverse).toArray(track.values,i);
    }
  }
  const restStanding=new Map();
  for(const name of ['Hips','Spine','Spine1','Spine2','Neck','Head',...['Left','Right'].flatMap(side=>['UpLeg','Leg','Foot','ToeBase'].map(part=>side+part))]){const b=bones.get(name);if(b)restStanding.set(b,b.quaternion.clone());}
  const mixer=new THREE.AnimationMixer(model),action=mixer.clipAction(walk);action.play();mixer.setTime(0);root.updateMatrixWorld(true);
  // Scale each supplied figure to human height, then center its in-place walk.
  const box=new THREE.Box3().setFromObject(model,true),factor=height/box.getSize(new THREE.Vector3()).y;
  model.scale.multiplyScalar(factor);root.updateMatrixWorld(true);
  const center=hips.getWorldPosition(new THREE.Vector3());model.position.x-=center.x;model.position.z-=center.z;
  // One fixed floor offset over the full cycle, preserving the natural foot lift.
  let minY=Infinity,bestTime=0,bestGap=Infinity;
  for(let i=0;i<24;i++){
    const t=walk.duration*i/24;mixer.setTime(t);root.updateMatrixWorld(true);
    minY=Math.min(minY,new THREE.Box3().setFromObject(model,true).min.y);
    const left=bones.get('LeftFoot')?.getWorldPosition(new THREE.Vector3()),right=bones.get('RightFoot')?.getWorldPosition(new THREE.Vector3());
    if(left&&right&&Math.abs(left.z-right.z)<bestGap){bestGap=Math.abs(left.z-right.z);bestTime=t;}
  }
  model.position.y-=minY;
  // A planted passing pose becomes a quiet idle; crossfade to it at each artwork.
  mixer.setTime(bestTime);root.updateMatrixWorld(true);
  for(const [bone,rotation] of restStanding)bone.quaternion.copy(rotation);
  root.updateMatrixWorld(true);
  const idleFloor=new THREE.Box3().setFromObject(model,true).min.y;
  const hipWorld=hips.getWorldPosition(new THREE.Vector3());hipWorld.y-=idleFloor;
  hips.position.copy(hips.parent.worldToLocal(hipWorld));root.updateMatrixWorld(true);
  const tracks=[];model.traverse(o=>{if(o.isBone){tracks.push(new THREE.QuaternionKeyframeTrack(o.name+'.quaternion',[0,1],[...o.quaternion.toArray(),...o.quaternion.toArray()]));tracks.push(new THREE.VectorKeyframeTrack(o.name+'.position',[0,1],[...o.position.toArray(),...o.position.toArray()]));}});
  const idle=mixer.clipAction(new THREE.AnimationClip('Gallery pause',1,tracks));idle.play();idle.setEffectiveWeight(1);action.setEffectiveWeight(0);
  mixer.update(0);root.updateMatrixWorld(true);
  const support=new FootSupport(root,model,bones),hipRotation=hips.quaternion.clone(),baseModelY=model.position.y;
  const restPose=new Map();model.traverse(b=>{if(b.isBone)restPose.set(b,{position:b.position.clone(),quaternion:b.quaternion.clone()});});
  return {root,model,bones,mixer,action,idle,walk,material,support,hipRotation,baseModelY,restPose};
}

const TOTAL_VISITORS = 7;
const EXCHANGES = [[2,4],[0,5],[3,1],[6,2],[1,4],[0,3],[5,6]];
const UP = new THREE.Vector3(0,1,0);

/** Seven assigned places. Only the two members of one exchange travel at a time. */
export class GalleryVisitors {
  constructor(scene,env,fx,seating,character,gltfs){
    Object.assign(this,{scene,env,fx,seating,character});
    this.navigation=new VisitorNavigation(env,fx,seating,character);
    this.navigation.refresh(null);
    this.root=new THREE.Group();this.root.name='Seven gallery visitors';scene.add(this.root);
    this.time=0;this.nextExchange=4;this.exchange=null;this.exchangeIndex=0;this.exchanges=0;this.events=[];
    // The compact rear group shares the artwork as its focus.
    this.groupCenter=(env.objectGroups.find(o=>o.group.name==='Rear gallery Nike sculpture')?.base||new THREE.Vector3(9.6,0,0)).clone();
    // Anchor this conversation to the left corner sculpture, independently of
    // Signal's seated orientation. Leave room for the plinth and the wall.
    const cornerSculpture=env.objectGroups.find(o=>o.group.name==='Object6');
    const sculpturePosition=cornerSculpture?.base||new THREE.Vector3(-4.47,0,1.4);
    const forward=new THREE.Vector3(-1,0,0);
    const right=new THREE.Vector3().crossVectors(forward,UP).normalize();
    const front=sculpturePosition.clone().add(new THREE.Vector3(1.45,0,0));front.y=0;
    this.frontYaw=Math.atan2(forward.x,forward.z);
    this.slots=[
      {role:'seated',chair:seating.chairs[1],yaw:.30},
      {role:'seated',chair:seating.chairs[2],yaw:-.30},
      {role:'front',position:front.clone().addScaledVector(right,.58),yaw:this.frontYaw+.22},
      {role:'front',position:front.clone().addScaledVector(right,-.58),yaw:this.frontYaw-.22},
      {role:'rear',position:new THREE.Vector3(8.1,0,-.60)},
      {role:'rear',position:new THREE.Vector3(8.1,0,.60)},
      {role:'rear',position:new THREE.Vector3(7.15,0,0)},
    ];
    const chosen=[];
    for(const slot of this.slots){
      if(slot.chair){
        slot.position=this.navigation.toBase(slot.chair.getWorldPosition(new THREE.Vector3()));
        slot.chair.userData.occupied=true;
        env.seatGazeObjects.find(o=>o.group===slot.chair).occupied=true;
        env.collisionSeats.find(o=>o.chair===slot.chair).occupied=true;
      }else{
        const id=this.navigation.nearest(slot.position,true,chosen);
        if(id<0)throw new Error('No supported floor for the gallery arrangement.');
        slot.position.copy(this.navigation.point(id));
      }
      chosen.push(slot.position);
    }
    this.visitors=[];
    for(let i=0;i<TOTAL_VISITORS;i++){
      const avatar=makeAvatar(gltfs[i%gltfs.length],1.69+(i%4)*.035,shadowMaterial(.94));
      avatar.root.name=`Gallery visitor ${i+1}`;this.root.add(avatar.root);
      const shadows=['Left','Right'].map(side=>{const mesh=contactShadow();avatar.root.add(mesh);return {side,mesh};});
      const slot=this.slots[i];
      const v={...avatar,shadows,index:i,slot:i,role:slot.role,state:slot.role==='seated'?'seated':'talking',
        position:slot.position.clone(),path:[],speed:.52+(i%3)*.025,blend:0,distance:0,blocked:0,visits:0};
      slot.occupant=v;this.visitors.push(v);
      this.navigation.toWorld(v.position,v.root.position);this.faceSlot(v,slot,1);
      this.animate(v,0,false);
      v.model.traverse(o=>{if(o.isMesh){o.castShadow=true;env.raycastMeshes.push(o);}});
    }
  }
  get group(){return this.visitors.filter(v=>v.state==='talking');}
  get roamers(){return this.visitors.filter(v=>['walking','rising','sitting','waiting'].includes(v.state));}
  peers(v,omit=null){return this.visitors.filter(other=>other!==v&&other!==omit).map(other=>other.position);}
  record(type){this.events.push({type,time:this.time,people:this.exchange?.moves.map(m=>m.v.index)});if(this.events.length>40)this.events.shift();}
  entry(slot){
    if(!slot.chair)return slot.position.clone();
    const world=slot.chair.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(Math.sin(slot.yaw),0,Math.cos(slot.yaw)).multiplyScalar(1.05));
    const id=this.navigation.nearest(this.navigation.toBase(world));
    return id<0?null:this.navigation.point(id);
  }
  route(start,end,peers){
    const path=this.navigation.path(start,end,peers);
    if(!path)return null;
    if(!path.length||path[path.length-1].distanceTo(end)>.005)path.push(end.clone());
    return path;
  }
  planExchange(a,b,start,end){
    const nav=this.navigation,stationary=this.peers(a,b),candidates=[];
    for(let id=0;id<nav.cells.length;id++)if(nav.cells[id]){
      const point=nav.point(id),distance=point.distanceTo(start);
      if(distance>.95&&distance<2.8&&nav.clear(point,[...stationary,end]))candidates.push({point,distance});
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    for(const {point} of candidates){
      const first=this.route(start,point,[...stationary,end]);if(!first)continue;
      const second=this.route(end,start,[...stationary,point]);if(!second)continue;
      const last=this.route(point,end,[...stationary,start]);if(!last)continue;
      return {first,second,last};
    }
    return null;
  }
  beginExchange(){
    for(let attempt=0;attempt<EXCHANGES.length;attempt++){
      const pair=EXCHANGES[this.exchangeIndex++%EXCHANGES.length];
      const a=this.slots[pair[0]].occupant,b=this.slots[pair[1]].occupant;
      if(!a||!b)continue;
      const fromA=this.entry(this.slots[a.slot]),fromB=this.entry(this.slots[b.slot]);
      if(!fromA||!fromB)continue;
      const plan=this.planExchange(a,b,fromA,fromB);if(!plan)continue;
      // A steps into a clear waiting place, B takes A's place, then A continues.
      // Planning all three legs prevents head-on deadlocks in the narrow aisles.
      this.exchange={started:this.time,moves:[
        {v:a,from:a.slot,to:b.slot,start:fromA,end:fromB,path:plan.first,staging:true,stage:plan.first.at(-1).clone(),last:plan.last},
        {v:b,from:b.slot,to:a.slot,start:fromB,end:fromA,path:plan.second,pending:true},
      ]};
      for(const move of this.exchange.moves){
        const v=move.v;v.move=move;v.blocked=0;move.transition=0;
        this.slots[move.from].occupant=null;
      }
      this.startMove(this.exchange.moves[0]);this.record('start');return true;
    }
    this.nextExchange=this.time+4;return false;
  }
  startMove(move){
    const v=move.v;v.path=move.path;move.pending=false;
    v.state=this.slots[move.from].chair?'rising':'walking';
  }
  finish(v){
    const move=v.move,slot=this.slots[move.to];
    v.slot=move.to;v.role=slot.role;v.state=slot.chair?'seated':'talking';v.position.copy(slot.position);
    slot.occupant=v;move.done=true;v.move=null;v.path=[];v.visits++;this.faceSlot(v,slot,1);
  }
  faceSlot(v,slot,blend){
    let yaw=slot.yaw;
    if(yaw===undefined){const center=this.navigation.toWorld(this.groupCenter),here=this.navigation.toWorld(v.position);yaw=Math.atan2(center.x-here.x,center.z-here.z);}
    v.root.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(UP,yaw),blend);
  }
  animate(v,dt,moving){
    for(const [bone,pose] of v.restPose){bone.position.copy(pose.position);bone.quaternion.copy(pose.quaternion);}
    v.model.position.y=v.baseModelY;
    v.blend=THREE.MathUtils.damp(v.blend,moving?1:0,8,dt);
    const seated=['seated','rising','sitting'].includes(v.state);
    v.action.setEffectiveWeight(seated?0:v.blend);v.idle.setEffectiveWeight(seated?1:1-v.blend);
    v.action.timeScale=v.speed/.85;v.mixer.update(dt);
    if(seated){
      const slot=this.slots[v.state==='rising'?v.move.from:v.state==='sitting'?v.move.to:v.slot];
      const top=new THREE.Box3().setFromObject(slot.chair).max.y;
      const amount=v.state==='seated'?1:v.state==='rising'?1-v.move.transition:v.move.transition;
      fitSeatedPose(v,top,this.env.floorY,amount);
    }else v.support.ground(this.env.floorY);
    // Conversation stays subtle, with no hip/leg bobbing or accumulated rotations.
    if(v.state==='talking'||v.state==='seated'){
      const phase=this.time*1.3+v.index*1.7,gesture=.5+.5*Math.sin(this.time*2.8+v.index);
      const speaker=v.speaking ?? (Math.floor(this.time/2.5)%TOTAL_VISITORS===v.index);
      v.bones.get('Head').rotation.y+=.10*Math.sin(phase*.6)+(v.role==='front'?(v.slot===2?.32:-.32):0);
      v.bones.get('Head').rotation.x+=(speaker?.045:.018)*Math.sin(phase*1.5);
      v.bones.get('RightForeArm').rotation.y-=(speaker?.3:.07)*gesture;
      v.bones.get('LeftForeArm').rotation.y+=.05*gesture;
    }
    v.root.updateMatrixWorld(true);
    for(const {side,mesh} of v.shadows){
      const foot=v.bones.get(side+'Foot').getWorldPosition(new THREE.Vector3());
      foot.y=this.env.floorY+.002;mesh.position.copy(v.root.worldToLocal(foot));
      const gap=v.support.minY(side)-this.env.floorY;
      mesh.material.opacity=.32*Math.max(0,1-gap/.18);
    }
  }
  keepClear(v){
    const nav=this.navigation;
    if(['seated','rising','sitting'].includes(v.state))return;
    const peers=this.peers(v);
    if(nav.clear(v.position)&&peers.every(peer=>v.position.distanceTo(peer)*nav.contraction>.76))return;
    const candidates=[];
    // Resolve contact at the outer personal-space margin, before a moving prop
    // reaches the body. Tiny horizontal corrections never alter foot height.
    for(const b of nav.obstacles){
      if(v.position.x<=b.minX||v.position.x>=b.maxX||v.position.z<=b.minZ||v.position.z>=b.maxZ)continue;
      for(const [axis,value] of [['x',b.minX-.005],['x',b.maxX+.005],['z',b.minZ-.005],['z',b.maxZ+.005]]){
        const p=v.position.clone();p[axis]=value;if(nav.clear(p,this.peers(v)))candidates.push(p);
      }
    }
    // Current footprints provide a small supported escape when forecast margins
    // temporarily fill an aisle. Preserve actual body clearance while sidestepping.
    for(const obstacle of nav.obstacles){
      const b=obstacle.actual||obstacle;
      if(v.position.x<=b.minX||v.position.x>=b.maxX||v.position.z<=b.minZ||v.position.z>=b.maxZ)continue;
      for(const [axis,value] of [['x',b.minX-.005],['x',b.maxX+.005],['z',b.minZ-.005],['z',b.maxZ+.005]]){
        for(const offset of [0,-.1,.1,-.2,.2,-.3,.3,-.4,.4,-.5,.5]){
          const p=v.position.clone();p[axis]=value;p[axis==='x'?'z':'x']+=offset;
          if(nav.clear(p,null,.12)&&this.peers(v).every(peer=>p.distanceTo(peer)*nav.contraction>.70))candidates.push(p);
        }
      }
    }
    // A contracting room also closes personal space between rigid people.
    for(const peer of peers){
      if(v.position.distanceTo(peer)*nav.contraction>=.76)continue;
      const angle=Math.atan2(v.position.z-peer.z,v.position.x-peer.x);
      for(const offset of [0,-.2,.2,-.4,.4,-.7,.7]){
        const p=peer.clone().add(new THREE.Vector3(Math.cos(angle+offset),0,Math.sin(angle+offset)).multiplyScalar(.80/nav.contraction));
        if(nav.clear(p,null,.12)&&peers.every(other=>p.distanceTo(other)*nav.contraction>.70))candidates.push(p);
      }
    }
    candidates.sort((a,b)=>a.distanceToSquared(v.position)-b.distanceToSquared(v.position));
    if(!candidates.length)return;
    const clear=candidates[0];if(clear.distanceTo(v.position)>.5)return;
    v.position.copy(clear);
    if(v.state==='talking')this.slots[v.slot].position.copy(clear);
    if(v.state==='walking'){
      const destination=v.move.staging?v.move.stage:v.move.end,path=this.route(v.position,destination,this.peers(v));
      if(path)v.path=path;
    }
  }
  update(dt,viewer){
    dt=Math.min(.05,Math.max(0,dt));this.time+=dt;
    const nav=this.navigation;nav.refresh(viewer,dt);
    // Seat contact follows the physical support even during sit/stand blends.
    for(const slot of this.slots)if(slot.chair)slot.position.copy(nav.toBase(slot.chair.getWorldPosition(new THREE.Vector3())));
    if(!this.exchange&&this.time>=this.nextExchange)this.beginExchange();
    for(const v of this.visitors){
      this.keepClear(v);
      let moving=false;
      if(v.state==='rising'||v.state==='sitting'){
        const move=v.move,slot=this.slots[v.state==='rising'?move.from:move.to];
        move.transition=Math.min(1,move.transition+dt/1.6);
        const t=THREE.MathUtils.smoothstep(move.transition,0,1);
        v.position.lerpVectors(v.state==='rising'?slot.position:move.end,v.state==='rising'?move.start:slot.position,t);
        this.faceSlot(v,slot,1-Math.exp(-6*dt));
        if(move.transition===1){if(v.state==='rising')v.state='walking';else this.finish(v);}
      }else if(v.state==='walking'){
        const destination=v.path[0],peers=this.peers(v);
        if(destination){
          const delta=destination.clone().sub(v.position),distance=delta.length();
          const step=Math.min(distance,v.speed*dt/nav.contraction);
          const next=v.position.clone().addScaledVector(delta,step/Math.max(distance,1e-6));
          if(nav.segment(v.position,next,peers)){
            v.position.copy(next);v.distance+=step*nav.contraction;moving=step>1e-5;v.blocked=0;
            if(moving)v.root.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(UP,Math.atan2(delta.x,delta.z)),1-Math.exp(-6*dt));
            if(distance<=step+.005)v.path.shift();
          }else{
            v.blocked+=dt;
            if(v.blocked>1+(v.index%2)*.5){
              const path=this.route(v.position,v.move.staging?v.move.stage:v.move.end,peers);
              if(path?.length)v.path=path;
              v.blocked=0;
            }
          }
        }else{
          if(v.move.staging){
            v.move.staging=false;v.state='waiting';this.startMove(this.exchange.moves[1]);
            continue;
          }
          const slot=this.slots[v.move.to];
          if(slot.chair){v.state='sitting';v.move.transition=0;}else this.finish(v);
        }
      }else if(v.state==='waiting'){
        if(this.exchange.moves[1].done){v.path=v.move.last;v.state='walking';}
      }else{
        const slot=this.slots[v.slot];
        if(slot.chair)slot.position.copy(nav.toBase(slot.chair.getWorldPosition(new THREE.Vector3())));
        v.position.copy(slot.position);this.faceSlot(v,slot,1-Math.exp(-3*dt));
      }
      nav.toWorld(v.position,v.root.position);this.animate(v,dt,moving);
    }
    if(this.exchange&&this.exchange.moves.every(move=>move.done)){
      this.record('complete');this.exchanges++;this.exchange=null;
      this.nextExchange=this.time+4+(this.exchanges%3);
    }
    this.root.updateMatrixWorld(true);
  }
}

export async function loadVisitors(scene,env,fx,seating,character){
  const loader=new GLTFLoader();
  const gltfs=await Promise.all(['visitor-a','visitor-b'].map(name=>loader.loadAsync(`/characters/visitors/${name}.glb`)));
  return new GalleryVisitors(scene,env,fx,seating,character,gltfs);
}
