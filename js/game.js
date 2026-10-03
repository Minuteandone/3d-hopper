import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import { canvasFromTexture } from './cgfx.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const STAGES = [
  [
    [0,0,0,7,5],[0,0,-6,5,5],[2,0,-11,5,4],[-1,1.0,-16,4,4],[3,1.7,-21,4,5],[-2,2.4,-27,5,4],
    [1,3.0,-33,4,5],[-3,3.7,-39,4,4],[0,4.5,-45,7,5]
  ],
  [
    [0,0,0,6,5],[4,.7,-6,4,4],[0,1.5,-11,4,4],[-4,2.2,-16,4,4],[0,3,-21,4,4],[4,3.8,-27,4,4],
    [0,4.7,-33,4,4],[-4,5.5,-39,4,4],[0,6.3,-45,4,4],[0,7,-51,8,5]
  ]
];

function makeTexture(asset, opts={}) {
  const canvas=canvasFromTexture(asset);
  const tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=opts.repeat?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
  tex.wrapT=opts.repeat?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
  if(opts.repeat)tex.repeat.set(opts.repeat[0],opts.repeat[1]);
  tex.magFilter=THREE.NearestFilter;
  tex.minFilter=THREE.LinearMipmapLinearFilter;
  return tex;
}

function softMaterial(map, color=0xffffff) {
  return new THREE.MeshStandardMaterial({map,color,roughness:.82,metalness:.02,transparent:true,alphaTest:.02});
}

export class HopperGame {
  constructor(host, assets, callbacks={}) {
    this.host=host; this.assets=assets; this.callbacks=callbacks;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.host.appendChild(this.renderer.domElement);

    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x98d7f0);
    this.scene.fog=new THREE.Fog(0xa8deef,22,75);
    this.camera=new THREE.PerspectiveCamera(48,5/3,.1,120);
    this.clock=new THREE.Clock();
    this.input={left:false,right:false,up:false,down:false};
    this.gamepad={x:0,y:0};
    this.depth=.55; this.playing=false; this.stageIndex=0; this.elapsed=0; this.falls=0;
    this.player={pos:new THREE.Vector3(0,2.5,0),vel:new THREE.Vector3(),radius:.52};
    this.platforms=[]; this.particles=[];

    this.#lights(); this.#makeSky(); this.#makePlayer(); this.#events();
    this.resize();
    new ResizeObserver(()=>this.resize()).observe(host);
    this.reset(0);
    this.renderer.setAnimationLoop(()=>this.#tick());
  }

  #lights(){
    const hemi=new THREE.HemisphereLight(0xe8fbff,0x355b73,2.4);this.scene.add(hemi);
    const sun=new THREE.DirectionalLight(0xfff4df,3.1);sun.position.set(10,18,9);sun.castShadow=true;
    sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-20;sun.shadow.camera.right=20;sun.shadow.camera.top=25;sun.shadow.camera.bottom=-35;
    this.scene.add(sun);this.sun=sun;
  }

  #makeSky(){
    const g=new THREE.PlaneGeometry(160,160,1,1); const m=new THREE.MeshBasicMaterial({color:0xbfeafa,side:THREE.DoubleSide});
    const sea=new THREE.Mesh(g,m); sea.rotation.x=-Math.PI/2;sea.position.y=-5;this.scene.add(sea);
  }

  #makePlayer(){
    const catTex=this.assets.get('nekopper')||this.assets.get('flockycmp')||this.assets.get('hopping');
    const mat=catTex?softMaterial(makeTexture(catTex)):new THREE.MeshStandardMaterial({color:0xe48b42,roughness:.9});
    const dark=new THREE.MeshStandardMaterial({color:0x49311f,roughness:.9});
    const metal=new THREE.MeshStandardMaterial({color:0xc7d1d5,metalness:.65,roughness:.25});
    const group=new THREE.Group();
    const body=new THREE.Mesh(new THREE.SphereGeometry(.54,16,12),mat);body.scale.set(.88,1.05,.78);body.position.y=.95;body.castShadow=true;group.add(body);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.46,16,12),mat);head.position.set(0,1.65,-.02);head.castShadow=true;group.add(head);
    for(const x of [-.25,.25]){const ear=new THREE.Mesh(new THREE.ConeGeometry(.2,.38,3),mat);ear.position.set(x,2.02,-.03);ear.rotation.z=x<0?.15:-.15;ear.castShadow=true;group.add(ear);}
    for(const x of [-.16,.16]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),dark);eye.position.set(x,1.72,-.43);group.add(eye);}
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,1.45,10),metal);pole.position.y=.05;pole.castShadow=true;group.add(pole);
    const foot=new THREE.Mesh(new THREE.CylinderGeometry(.28,.2,.08,16),dark);foot.position.y=-.68;foot.scale.z=.55;foot.castShadow=true;group.add(foot);
    group.scale.setScalar(.78); this.scene.add(group); this.playerMesh=group;
  }

  #events(){
    const map={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down'};
    addEventListener('keydown',e=>{if(map[e.code]){this.input[map[e.code]]=true;e.preventDefault();}});
    addEventListener('keyup',e=>{if(map[e.code]){this.input[map[e.code]]=false;e.preventDefault();}});
  }

  bindTouch(root){
    root.querySelectorAll('button[data-key]').forEach(btn=>{
      const key=btn.dataset.key;
      const on=e=>{e.preventDefault();this.input[key]=true;btn.classList.add('active');};
      const off=e=>{e.preventDefault();this.input[key]=false;btn.classList.remove('active');};
      btn.addEventListener('pointerdown',on);btn.addEventListener('pointerup',off);btn.addEventListener('pointercancel',off);btn.addEventListener('pointerleave',off);
    });
  }

  setDepth(v){this.depth=clamp(v,0,1);}

  resize(){
    const w=Math.max(1,this.host.clientWidth),h=Math.max(1,this.host.clientHeight);
    this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
  }

  #clearStage(){
    for(const p of this.platforms){this.scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();}
    this.platforms=[];
    if(this.goal){this.scene.remove(this.goal);this.goal=null;}
  }

  #platform(x,y,z,w,d,i){
    const asset=this.assets.get(i%2?'hopper_floor02':'hopper_floor01')||this.assets.get('hopper_floor01');
    let mat;
    if(asset){const t=makeTexture(asset,{repeat:[Math.max(1,w/2),Math.max(1,d/2)]});mat=new THREE.MeshStandardMaterial({map:t,color:i%2?0xc8f2d5:0xf4ead3,roughness:.88});}
    else mat=new THREE.MeshStandardMaterial({color:i%2?0x91c9a4:0xc8b78d,roughness:.9});
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,.55,d),mat);mesh.position.set(x,y-.275,z);mesh.receiveShadow=true;mesh.castShadow=true;this.scene.add(mesh);
    this.platforms.push({x,y,z,w,d,mesh});
  }

  #makeGoal(last){
    const group=new THREE.Group(); group.position.set(last[0],last[1]+1.5,last[2]);
    const goalAsset=this.assets.get('hopper_goal01')||this.assets.get('hopper_star01');
    const mat=goalAsset?new THREE.SpriteMaterial({map:makeTexture(goalAsset),transparent:true,depthWrite:false}):new THREE.SpriteMaterial({color:0xffeb48});
    const sprite=new THREE.Sprite(mat);sprite.scale.set(2.2,2.2,1);group.add(sprite);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.78,.08,10,32),new THREE.MeshStandardMaterial({color:0xfff075,emissive:0xd98b00,emissiveIntensity:1.2,metalness:.25}));ring.rotation.x=Math.PI/2;group.add(ring);
    this.scene.add(group);this.goal=group;
  }

  reset(stage=this.stageIndex){
    this.#clearStage();this.stageIndex=stage%STAGES.length;const layout=STAGES[this.stageIndex];
    layout.forEach((p,i)=>this.#platform(...p,i));this.#makeGoal(layout.at(-1));
    const s=layout[0];this.spawn=new THREE.Vector3(s[0],s[1]+2.2,s[2]+1);
    this.player.pos.copy(this.spawn);this.player.vel.set(0,0,0);this.elapsed=0;this.falls=0;
    this.playerMesh.position.copy(this.player.pos);this.#camera(true);
    this.callbacks.onStage?.(this.stageIndex+1);
  }

  start(stage=0){this.reset(stage);this.playing=true;this.clock.getDelta();}
  pause(){this.playing=false;}

  #readGamepad(){
    const gp=navigator.getGamepads?.()?.find(Boolean);if(!gp){this.gamepad.x=this.gamepad.y=0;return;}
    this.gamepad.x=Math.abs(gp.axes[0]||0)>.18?(gp.axes[0]||0):0;
    this.gamepad.y=Math.abs(gp.axes[1]||0)>.18?(gp.axes[1]||0):0;
  }

  #land(prevY){
    if(this.player.vel.y>0)return false;
    for(const p of this.platforms){
      const top=p.y;
      const inX=Math.abs(this.player.pos.x-p.x)<=p.w/2+.38;
      const inZ=Math.abs(this.player.pos.z-p.z)<=p.d/2+.38;
      if(inX&&inZ&&prevY>=top&&this.player.pos.y<=top+.05){
        this.player.pos.y=top;this.player.vel.y=8.15;return true;
      }
    }
    return false;
  }

  #step(dt){
    this.#readGamepad();
    let ix=(this.input.right?1:0)-(this.input.left?1:0)+this.gamepad.x;
    let iz=(this.input.down?1:0)-(this.input.up?1:0)+this.gamepad.y;
    const len=Math.hypot(ix,iz);if(len>1){ix/=len;iz/=len;}
    const accel=23,drag=Math.pow(.0025,dt);
    this.player.vel.x=(this.player.vel.x+ix*accel*dt)*drag;
    this.player.vel.z=(this.player.vel.z+iz*accel*dt)*drag;
    this.player.vel.x=clamp(this.player.vel.x,-5.8,5.8);this.player.vel.z=clamp(this.player.vel.z,-5.8,5.8);
    this.player.vel.y-=20.5*dt;
    const prevY=this.player.pos.y;this.player.pos.addScaledVector(this.player.vel,dt);this.#land(prevY);
    if(this.player.pos.y<-7){this.falls++;this.player.pos.copy(this.spawn);this.player.vel.set(0,3,0);this.callbacks.onFalls?.(this.falls);}
    if(this.goal){
      const d=this.player.pos.distanceTo(this.goal.position);this.goal.rotation.y+=dt*1.8;this.goal.children[1].rotation.z+=dt*1.1;
      if(d<1.25)this.#win();
    }
    this.elapsed+=dt;this.callbacks.onTime?.(this.elapsed);
    this.playerMesh.position.copy(this.player.pos);this.playerMesh.position.y+=.68;
    this.playerMesh.rotation.z=THREE.MathUtils.lerp(this.playerMesh.rotation.z,-ix*.16,.12);
    this.playerMesh.rotation.x=THREE.MathUtils.lerp(this.playerMesh.rotation.x,iz*.12,.12);
  }

  #win(){
    if(!this.playing)return;this.playing=false;this.#burst();this.callbacks.onWin?.({stage:this.stageIndex+1,time:this.elapsed,falls:this.falls});
  }

  #burst(){
    const asset=this.assets.get('hopper_star01')||this.assets.get('hopper_spark01');
    const map=asset?makeTexture(asset):null;
    for(let i=0;i<22;i++){
      const s=new THREE.Sprite(new THREE.SpriteMaterial({map,color:0xffe86c,transparent:true,depthWrite:false}));
      s.scale.setScalar(.45+Math.random()*.65);s.position.copy(this.player.pos).add(new THREE.Vector3(0,1,0));this.scene.add(s);
      this.particles.push({mesh:s,life:1.2,vel:new THREE.Vector3((Math.random()-.5)*6,Math.random()*6+2,(Math.random()-.5)*6)});
    }
  }

  #particles(dt){
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;p.vel.y-=8*dt;p.mesh.position.addScaledVector(p.vel,dt);p.mesh.material.opacity=Math.max(0,p.life);if(p.life<=0){this.scene.remove(p.mesh);p.mesh.material.dispose();this.particles.splice(i,1);}}
  }

  #camera(snap=false){
    const depthDistance=6.2+this.depth*6.4, height=4.7+this.depth*1.3;
    const target=new THREE.Vector3(this.player.pos.x,this.player.pos.y+1.2,this.player.pos.z);
    const wanted=new THREE.Vector3(this.player.pos.x*0.82,this.player.pos.y+height,this.player.pos.z+depthDistance);
    const a=snap?1:.07;this.camera.position.lerp(wanted,a);this.camera.lookAt(target);
    this.camera.fov=52-this.depth*10;this.camera.updateProjectionMatrix();
  }

  #tick(){
    const dt=Math.min(.035,this.clock.getDelta());
    if(this.playing)this.#step(dt);this.#particles(dt);this.#camera(false);
    this.renderer.render(this.scene,this.camera);
  }
}
