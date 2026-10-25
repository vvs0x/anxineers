import * as THREE from 'three';

const STEP = .28;
export const VISITOR_RADIUS = .34;
const directions = Array.from({length: 8}, (_, i) => new THREE.Vector3(Math.cos(i*Math.PI/4),0,Math.sin(i*Math.PI/4)));

/** Navigation lives in the original floor coordinates, then follows room contraction. */
export class VisitorNavigation {
  constructor(env, fx, seating, character) {
    Object.assign(this, {env,fx,seating,character});
    this.step=STEP; this.minX=env.interior.min.x+.45; this.minZ=env.interior.min.z+.45;
    this.width=Math.floor((env.interior.max.x-.45-this.minX)/STEP)+1;
    this.height=Math.floor((env.interior.max.z-.45-this.minZ)/STEP)+1;
    this.cells=new Uint8Array(this.width*this.height); this.obstacles=[]; this.previousBounds=new Map(); this.restBounds=new Map();
    const walls=env.roomMeshes.filter(m=>['wall','room','window'].includes(m.userData.environmentRole));
    const floors=env.roomMeshes.filter(m=>m.userData.environmentRole==='floor');
    const ray=new THREE.Raycaster();ray.firstHitOnly=true;
    env.root.updateMatrixWorld(true);
    for(let id=0;id<this.cells.length;id++){
      const p=this.point(id); ray.set(new THREE.Vector3(p.x,env.floorY+.15,p.z),new THREE.Vector3(0,-1,0));ray.far=.3;
      if(!ray.intersectObjects(floors,false).length)continue;
      // Conservative body clearance survives the room's maximum horizontal compression.
      let blocked=false;ray.far=.60;
      for(const y of [.45,1.35]){
        for(const d of directions){ray.set(new THREE.Vector3(p.x,env.floorY+y,p.z),d);if(ray.intersectObjects(walls,false).length){blocked=true;break;}}
        if(blocked)break;
      }
      if(!blocked)this.cells[id]=1;
    }
    // Discard disconnected floor islands, including exterior floor fragments.
    const seed=this.nearest(new THREE.Vector3(env.spawn.x,0,env.spawn.z),false);
    if(seed<0)throw new Error('No clear gallery floor for visitors.');
    const reachable=new Uint8Array(this.cells.length),queue=[seed];reachable[seed]=1;
    for(let i=0;i<queue.length;i++)for(const next of this.neighbors(queue[i],false))if(!reachable[next]){reachable[next]=1;queue.push(next);}
    this.cells=reachable;
  }
  get contraction(){return Math.max(.65,1-this.fx.uLeanK.value);}
  // Share the immutable floor grid, but keep viewer/visitor obstacle caches separate.
  fork(){return Object.assign(Object.create(VisitorNavigation.prototype),this,{obstacles:[],previousBounds:new Map()});}
  toWorld(p,out=new THREE.Vector3()){
    const c=this.fx.uCenter.value,k=this.contraction;
    return out.set(c.x+(p.x-c.x)*k,this.env.floorY,c.y+(p.z-c.y)*k);
  }
  toBase(p,out=new THREE.Vector3()){
    const c=this.fx.uCenter.value,k=this.contraction;
    return out.set(c.x+(p.x-c.x)/k,0,c.y+(p.z-c.y)/k);
  }
  point(id){return new THREE.Vector3(this.minX+(id%this.width)*STEP,0,this.minZ+Math.floor(id/this.width)*STEP);}
  id(p){const x=Math.round((p.x-this.minX)/STEP),z=Math.round((p.z-this.minZ)/STEP);return x<0||z<0||x>=this.width||z>=this.height?-1:z*this.width+x;}
  refresh(viewer,dt=.05){
    this.obstacles=[];
    const padding=(VISITOR_RADIUS+.12)/this.contraction;
    for(const obj of [...this.env.objectGroups.map(o=>o.group),...this.seating.chairs]){
      obj.updateWorldMatrix(true,true);
      const b=new THREE.Box3().setFromObject(obj),a=this.toBase(b.min),z=this.toBase(b.max);
      const current={minX:a.x,maxX:z.x,minZ:a.z,maxZ:z.z},previous=this.previousBounds.get(obj);
      // Reserve the prop's return lane as walls expand, not just its current position.
      if(!this.restBounds.has(obj))this.restBounds.set(obj,{...current});
      const rest=this.restBounds.get(obj);
      const future={...current};
      if(previous)for(const key of Object.keys(current))future[key]+=THREE.MathUtils.clamp((current[key]-previous[key])/Math.max(.01,dt),-.4,.4)*.8;
      this.previousBounds.set(obj,current);
      this.obstacles.push({minX:Math.min(a.x,future.minX,rest.minX)-padding,maxX:Math.max(z.x,future.maxX,rest.maxX)+padding,minZ:Math.min(a.z,future.minZ,rest.minZ)-padding,maxZ:Math.max(z.z,future.maxZ,rest.maxZ)+padding,
        actual:{minX:a.x-padding,maxX:z.x+padding,minZ:a.z-padding,maxZ:z.z+padding}});
    }
    // Include the seated figure's knees and the spectator/headset personal space.
    this.addCircle(this.character.root.position,.8);
    if(viewer)this.addCircle(viewer,.7);
  }
  addCircle(world,radius){const p=this.toBase(world),r=radius/this.contraction;this.obstacles.push({minX:p.x-r,maxX:p.x+r,minZ:p.z-r,maxZ:p.z+r});}
  clear(p,peer=null,margin=0){
    const id=this.id(p);if(id<0||!this.cells[id])return false;
    const shrink=Math.min(margin,.12)/this.contraction;
    if(this.obstacles.some(obstacle=>{const b=margin>0?(obstacle.actual||obstacle):obstacle;return p.x>b.minX+shrink&&p.x<b.maxX-shrink&&p.z>b.minZ+shrink&&p.z<b.maxZ-shrink;}))return false;
    const peers = peer ? (Array.isArray(peer) ? peer : [peer]) : [];
    return peers.every(other => p.distanceToSquared(other) > (.82/this.contraction)**2);
  }
  segment(a,b,peer=null,margin=0){
    const length=a.distanceTo(b),steps=Math.max(1,Math.ceil(length/.10));
    for(let i=1;i<=steps;i++)if(!this.clear(new THREE.Vector3().lerpVectors(a,b,i/steps),peer,margin))return false;
    return true;
  }
  neighbors(id,dynamic=true,peer=null){
    const x=id%this.width,z=Math.floor(id/this.width),out=[];
    const valid=(a,b)=>a>=0&&b>=0&&a<this.width&&b<this.height&&this.cells[b*this.width+a]&&(!dynamic||this.clear(this.point(b*this.width+a),peer));
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
      if(!dx&&!dz)continue;if(!valid(x+dx,z+dz))continue;
      if(dx&&dz&&(!valid(x+dx,z)||!valid(x,z+dz)))continue;
      const next=(z+dz)*this.width+x+dx;
      if(dynamic&&!this.segment(this.point(id),this.point(next),peer))continue;
      out.push(next);
    }
    return out;
  }
  nearest(p,dynamic=true,peer=null){
    let best=-1,dist=Infinity;
    for(let i=0;i<this.cells.length;i++)if(this.cells[i]){const v=this.point(i),d=v.distanceToSquared(p);if(d<dist&&(!dynamic||this.clear(v,peer))){best=i;dist=d;}}
    return best;
  }
  path(start,end,peer=null){
    let a=this.id(start),b=this.id(end);if(a<0||b<0||!this.clear(end,peer))return null;
    // A person between cells may be clear while the rounded cell is occupied.
    // Connect to a nearby reachable cell instead of stranding them at that edge.
    const connect=p=>{
      const candidates=[];
      for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
        const id=this.id(p.clone().add(new THREE.Vector3(dx*STEP,0,dz*STEP)));if(id<0)continue;
        const q=this.point(id);if(this.clear(q,peer)&&this.segment(p,q,peer))candidates.push({id,d:p.distanceToSquared(q)});
      }
      candidates.sort((a,b)=>a.d-b.d);return candidates[0]?.id??-1;
    };
    if(!this.segment(start,this.point(a),peer))a=connect(start);
    if(!this.clear(this.point(b),peer)||!this.segment(this.point(b),end,peer))b=connect(end);
    if(a<0||b<0)return null;
    const costs=new Float32Array(this.cells.length).fill(Infinity),parent=new Int32Array(this.cells.length).fill(-1),closed=new Uint8Array(this.cells.length),open=[a];costs[a]=0;
    while(open.length){
      let at=0,best=Infinity;for(let i=0;i<open.length;i++){const f=costs[open[i]]+this.point(open[i]).distanceTo(end);if(f<best){best=f;at=i;}}
      const id=open.splice(at,1)[0];if(closed[id])continue;
      if(id===b){const result=[];for(let n=b;n!==a;n=parent[n])result.push(this.point(n));result.push(this.point(a));return result.reverse();}
      closed[id]=1;
      for(const n of this.neighbors(id,true,peer)){
        if(closed[n])continue;const g=costs[id]+this.point(n).distanceTo(this.point(id));
        if(g<costs[n]){costs[n]=g;parent[n]=id;open.push(n);}
      }
    }
    return null;
  }
}
