import * as THREE from 'three';

/** A real scene label: selectable by mouse, touch or a controller ray. */
export class PerspectiveTarget {
  constructor(scene,character,env){
    Object.assign(this,{character,env});
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=160;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#101823ee';ctx.beginPath();ctx.roundRect(4,4,1016,152,44);ctx.fill();
    ctx.strokeStyle='#a9caff';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#ffffff';ctx.font='500 54px "Roboto Mono"';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('See his perspective',512,80);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    this.label=new THREE.Mesh(new THREE.PlaneGeometry(1.4,.219),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false}));
    this.label.name='See his perspective';this.label.visible=false;scene.add(this.label);
    this.bounds=new THREE.Box3();this.point=new THREE.Vector3();this.enabled=false;this.preview=0;
  }
  update(camera,enabled){
    this.enabled=enabled;this.label.visible=enabled;
    if(!enabled)return;
    this.bounds.setFromObject(this.character.model,true);
    this.label.position.copy(this.bounds.getCenter(new THREE.Vector3()));this.label.position.y=this.bounds.max.y+.34;
    this.label.quaternion.setFromRotationMatrix(camera.matrixWorld);this.label.updateMatrixWorld(true);
  }
  hit(ray,near=false){
    if(!this.enabled)return null;
    const box=this.bounds.clone().expandByScalar(near ? .22 : .04);
    const body=ray.ray.intersectBox(box,this.point),label=ray.intersectObject(this.label,false)[0];
    let distance=Math.min(body?ray.ray.origin.distanceTo(body):Infinity,label?.distance??Infinity);
    if(!Number.isFinite(distance)||distance>12)return null;
    const wall=ray.intersectObjects(this.env.raycastMeshes,false)[0];
    if(wall&&wall.distance<distance-.04)return null;
    return distance;
  }
  hover(active,dt){
    this.preview=THREE.MathUtils.damp(this.preview,active && this.enabled ? .3 : 0,active?5:8,dt);
    this.label.material.color.setHex(active?0x9fc4ff:0xffffff);
  }
}
