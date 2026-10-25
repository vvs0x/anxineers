import * as THREE from 'three';
export function signalMaterial(texture) {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  return new THREE.ShaderMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
    uniforms: { atlas: {value:texture}, chaos: {value:.25}, time: {value:0}, anchor: {value:new THREE.Vector3(0,.9,0)}, embodied: {value:0}, clipY: {value:1e6}, bodyRight: {value:new THREE.Vector3(1,0,0)} },
    vertexShader: `
      #include <common>
      #include <skinning_pars_vertex>
      varying vec3 signalView;
      varying vec3 originView;
      varying vec3 signalWorld;
      uniform vec3 anchor;
      void main(){
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        signalView = mv.xyz;
        signalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        originView = (viewMatrix * vec4(anchor,1.0)).xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D atlas;
      uniform float chaos;
      uniform float time;
      uniform float embodied;
      uniform float clipY;
      uniform vec3 anchor;
      uniform vec3 bodyRight;
      varying vec3 signalView;
      varying vec3 originView;
      varying vec3 signalWorld;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float layer(vec2 uv,float clock,float index){
        // A nonzero baseline keeps thoughts restless even in a quiet room.
        float energy=mix(.55,1.0,chaos);
        float band=floor((1.0-uv.y)*36.0);
        uv.x+=energy*(.035*sin(clock*3.1+band*1.73+index)
          +.018*sin(clock*7.7-band*.83));
        uv.y+=energy*.006*sin(clock*4.3+band*2.17);
        float rowPosition=(1.0-uv.y)*36.0;
        float row=floor(rowPosition);
        float phase=clock+hash(vec2(row,index))*.8;
        float cycle=floor(phase);
        float progress=clamp(fract(phase)/.62,0.0,1.0);
        float seed=hash(vec2(row+index*71.0,cycle));
        float tick=floor(clock*24.0);
        float shift=hash(vec2(row+index*59.0,tick))-.5;
        uv.x+=shift*energy*energy*.16*step(.45,seed);
        float column=floor(uv.x*48.0);
        vec2 cell=vec2(fract(uv.x*48.0),fract(rowPosition));
        float sourceRow=mod(row+cycle*36.0+11500.0,115.0);
        if(index>.5) sourceRow=115.0+floor(seed*22.0);
        vec2 text=texture2D(atlas,vec2(uv.x,1.0-(sourceRow+cell.y)/138.0)).rg;
        float mode=floor(hash(vec2(row+17.0,cycle+index))*3.0);
        float revealed=step((column+1.0)/48.0,progress);
        if(mode>.5 && mode<1.5) revealed=step(text.g,progress);
        float mask=text.r*revealed;
        if(mode>1.5){
          float glyph=floor(hash(vec2(column+row*48.0,tick+index*113.0))*48.0);
          float scrambled=texture2D(atlas,vec2((glyph+cell.x)/48.0,1.0-(137.0+cell.y)/138.0)).r*step(.001,text.g);
          mask=mix(scrambled,text.r,revealed);
        }
        mask=mix(text.r,mask,smoothstep(0.0,.18,energy));
        return mask*step(0.0,uv.x)*step(uv.x,1.0);
      }
      void main(){
        // Remove the head in first person; the tracked viewer still sees their body below.
        if (embodied > .5 && signalWorld.y > clipY) discard;
        // Per-eye projection follows the animated hips, including in stereo VR.
        vec2 uv=(signalView.xy*(originView.z/min(signalView.z,-.001))-originView.xy)/vec2(1.25,2.0)+.5;
        if (embodied > .5) {
          vec3 relative = signalWorld - anchor;
          uv = vec2(dot(relative, bodyRight), relative.y) / vec2(1.25, 2.0) + .5;
        }
        float energy=mix(.55,1.0,chaos);
        uv.y+=time*.035*energy;
        float mask=layer(uv,time,0.0);
        vec2 drift=vec2(sin(time*3.7)*.055,cos(time*2.1)*.025)*energy;
        mask=max(mask,layer(uv+vec2(.035,.018)+drift,time*1.31,1.0)*smoothstep(.12,.85,energy)*.85);
        mask=max(mask,layer(uv*vec2(1.1,1.05)-drift+vec2(-.04,.035),time*1.73,2.0)*smoothstep(.55,1.0,energy));
        gl_FragColor=vec4(mix(vec3(.035,.008,1.0),vec3(1.0),clamp(mask,0.0,1.0)),1.0);
      }`
  });
}
const route=['LeftFoot','LeftLeg','LeftUpLeg','Hips','Spine','Neck','Head','Neck','LeftArm','LeftForeArm','LeftHand','LeftForeArm','LeftArm','Spine2','RightArm','RightForeArm','RightHand','RightForeArm','RightArm','Spine','Hips','RightUpLeg','RightLeg','RightFoot'];
// The line is always restless; room intensity increases its energy.
export function scribbleSettings(chaos) {
  const intensity=THREE.MathUtils.clamp((chaos-.2)/.8,0,1);
  return {
    visible:true,
    opacity:THREE.MathUtils.lerp(.6,1,THREE.MathUtils.smoothstep(intensity,0,1)),
    radius:.12*(1+intensity),
    speed:THREE.MathUtils.lerp(5,24,intensity**1.5)
  };
}
export class Scribble {
  constructor(scene,bones){
    this.bones=route.map(name=>bones.get(name));
    if(this.bones.some(b=>!b)) throw new Error('Character is missing a scribble anchor bone.');
    this.anchors=route.map(()=>new THREE.Vector3());
    this.group=new THREE.Group(); scene.add(this.group);
    this.samples=768; this.sides=6; this.points=Array.from({length:this.samples},()=>new THREE.Vector3());
    this.curve=new THREE.CatmullRomCurve3(this.anchors,false,'catmullrom',.5);
    this.material=new THREE.MeshBasicMaterial({color:0x1402ff,transparent:true,opacity:0,depthWrite:false,toneMapped:false});
    this.clipUniforms = {
      uSignalEmbodied: {value:0}, uSignalClipY: {value:1e6},
      uSignalViewer: {value:new THREE.Vector3(0,-1000,0)}
    };
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.clipUniforms);
      shader.vertexShader = 'varying vec3 vSignalWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vSignalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = 'varying vec3 vSignalWorld; uniform float uSignalEmbodied; uniform float uSignalClipY; uniform vec3 uSignalViewer;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uSignalEmbodied > .5 && (vSignalWorld.y > uSignalClipY || distance(vSignalWorld, uSignalViewer) < .22)) discard;`);
    };
    this.material.customProgramCacheKey = () => 'signal-scribble-embodied-v1';
    this.strands=Array.from({length:2},()=>{
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(this.samples*this.sides*3),3).setUsage(THREE.DynamicDrawUsage));
      const indices=[];
      for(let i=0;i<this.samples-1;i++)for(let k=0;k<this.sides;k++){const a=i*this.sides+k,b=i*this.sides+(k+1)%this.sides,c=a+this.sides,d=b+this.sides;indices.push(a,b,c,b,d,c);}
      geometry.setIndex(indices);const mesh=new THREE.Mesh(geometry,this.material);mesh.frustumCulled=false;this.group.add(mesh);return geometry;
    });
    this.tangent=new THREE.Vector3();this.normal=new THREE.Vector3();this.binormal=new THREE.Vector3();this.up=new THREE.Vector3(0,1,0);
  }
  setView(embodied, clipY, viewerPosition) {
    this.clipUniforms.uSignalEmbodied.value = embodied ? 1 : 0;
    this.clipUniforms.uSignalClipY.value = clipY;
    if (viewerPosition) this.clipUniforms.uSignalViewer.value.copy(viewerPosition);
  }
  dispose() {
    this.group.removeFromParent();
    this.strands.forEach(g => g.dispose());
    this.material.dispose();
  }
  update(chaos,time){
    const settings=scribbleSettings(chaos);
    this.group.visible=settings.visible;this.material.opacity=settings.opacity;
    if(!this.group.visible)return;
    this.bones.forEach((b,i)=>b.getWorldPosition(this.anchors[i]));this.anchors[6].y+=.12;
    const radius=settings.radius;
    this.strands.forEach((geometry,strand)=>{
      // Fewer broad loops, with enough samples for genuinely rounded curves.
      const seed=strand*13.71,turns=8+strand*2;
      for(let i=0;i<this.samples;i++){
        const t=i/(this.samples-1),p=this.curve.getPoint(strand%2?1-t:t,this.points[i]);
        let phase=t*turns*Math.PI*2+seed;phase+=.65*Math.sin(t*12+seed+time*.25)+.24*Math.sin(t*31-time*1.37+seed);
        const x=Math.sin(phase+time*(1+strand*.13))+.22*Math.sin(phase*1.7-time*.8+seed)+.08*Math.cos(phase*2.2+time*.5);
        const y=Math.cos(phase-time*.87)+.2*Math.sin(phase*1.6+time*.7+seed);
        const envelope=THREE.MathUtils.smoothstep(Math.min(t,1-t)*35,0,1),r=radius*(.85+.16*Math.sin(t*15+seed+time*.71)+.09*Math.sin(t*37-time*1.13))*envelope;
        // World-space coils stay stable when the viewer walks around the body.
        p.x+=r*x;p.y+=r*y*.8;p.z+=r*Math.sin(phase*.73+time*.6)*.4;
      }
      const attr=geometry.attributes.position,width=.006*(1+strand*.08);
      this.normal.set(1,0,0);
      for(let i=0;i<this.samples;i++){
        this.tangent.subVectors(this.points[Math.min(i+1,this.samples-1)],this.points[Math.max(i-1,0)]).normalize();
        // Transport the previous frame along the curve to avoid tube twists/spikes.
        this.normal.addScaledVector(this.tangent,-this.normal.dot(this.tangent));
        if(this.normal.lengthSq()<.001){this.normal.crossVectors(this.tangent,this.up);if(this.normal.lengthSq()<.001)this.normal.set(1,0,0);}
        this.normal.normalize();
        this.binormal.crossVectors(this.tangent,this.normal).normalize();const p=this.points[i];
        for(let k=0;k<this.sides;k++){const a=k*Math.PI*2/this.sides,c=Math.cos(a)*width,s=Math.sin(a)*width;attr.setXYZ(i*this.sides+k,p.x+this.normal.x*c+this.binormal.x*s,p.y+this.normal.y*c+this.binormal.y*s,p.z+this.normal.z*c+this.binormal.z*s);}
      }
      attr.needsUpdate=true;
    });
  }
}
