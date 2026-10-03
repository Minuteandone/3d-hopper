import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import { canvasFromTexture } from './cgfx.js';
import { createModelInstance, disposeModelInstance } from './model-renderer.js';
import { PROTOTYPE_DT, HopperState, stepPrototypeVelocity, integratePrototypePosition, prototypeBounce } from './prototype-code.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// Level placement is still being recovered from the executable. These positions
// remain a temporary scene layout, but every rendered player/floor mesh and the
// movement constants now come from the prototype ROM/code.
const STAGES=[
  [[0,0,0,7,5],[0,0,-6,5,5],[2,0,-11,5,4],[-1,1,-16,4,4],[3,1.7,-21,4,5],[-2,2.4,-27,5,4],[1,3,-33,4,5],[-3,3.7,-39,4,4],[0,4.5,-45,7,5]],
  [[0,0,0,6,5],[4,.7,-6,4,4],[0,1.5,-11,4,4],[-4,2.2,-16,4,4],[0,3,-21,4,4],[4,3.8,-27,4,4],[0,4.7,-33,4,4],[-4,5.5,-39,4,4],[0,6.3,-45,4,4],[0,7,-51,8,5]]
];

function makeTexture(asset){
  const canvas=canvasFromTexture(asset),tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;return tex;
}

export class HopperGame{
  constructor(host,assets,models,callbacks={}){
    this.host=host;this.assets=assets;this.models=models;this.callbacks=callbacks;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;host.appendChild(this.renderer.domElement);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x98d7f0);this.scene.fog=new THREE.Fog(0xa8deef,22,85);
    this.camera=new THREE.PerspectiveCamera(48,5/3,.1,140);this.clock=new THREE.Clock();this.accumulator=0;
    this.input={left:false,right:false,up:false,down:false};this.gamepad={x:0,y:0};this.depth=.55;this.playing=false;this.stageIndex=0;this.elapsed=0;this.falls=0;
    this.prototypeState=HopperState.S1;this.player={x:0,y:0,z:0,vx:0,vy:0,vz:0};this.platforms=[];this.particles=[];
    this.#lights();this.#makeSky();this.#makePlayer();this.#events();this.resize();new ResizeObserver(()=>this.resize()).observe(host);this.reset(0);this.renderer.setAnimationLoop(()=>this.#tick());
  }
  #lights(){const hemi=new THREE.HemisphereLight(0xe8fbff,0x355b73,2.4);this.scene.add(hemi);const sun=new THREE.DirectionalLight(0xfff4df,3.1);sun.position.set(10,18,9);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=30;sun.shadow.camera.bottom=-60;this.scene.add(sun);}
  #makeSky(){const sea=new THREE.Mesh(new THREE.PlaneGeometry(180,180),new THREE.MeshBasicMaterial({color:0xbfeafa,side:THREE.DoubleSide}));sea.rotation.x=-Math.PI/2;sea.position.y=-8;this.scene.add(sea);}
  #makePlayer(){
    const model=this.models.get('neko_hopping_model');
    if(!model)throw new Error('The ROM model neko_hopping_model was not decoded.');
    this.playerMesh=createModelInstance(model,this.assets);this.playerMesh.name='ROM neko_hopping_model';this.scene.add(this.playerMesh);
  }
  #events(){const map={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down'};addEventListener('keydown',e=>{if(map[e.code]){this.input[map[e.code]]=true;e.preventDefault();}});addEventListener('keyup',e=>{if(map[e.code]){this.input[map[e.code]]=false;e.preventDefault();}});}
  bindTouch(root){root.querySelectorAll('button[data-key]').forEach(btn=>{const key=btn.dataset.key;const on=e=>{e.preventDefault();this.input[key]=true;btn.classList.add('active');};const off=e=>{e.preventDefault();this.input[key]=false;btn.classList.remove('active');};btn.addEventListener('pointerdown',on);btn.addEventListener('pointerup',off);btn.addEventListener('pointercancel',off);btn.addEventListener('pointerleave',off);});}
  setDepth(v){this.depth=clamp(v,0,1);}
  resize(){const w=Math.max(1,this.host.clientWidth),h=Math.max(1,this.host.clientHeight);this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  #clearStage(){for(const p of this.platforms){this.scene.remove(p.object);disposeModelInstance(p.object);}this.platforms=[];if(this.goal){this.scene.remove(this.goal);this.goal.material?.map?.dispose?.();this.goal.material?.dispose?.();this.goal=null;}}
  #platform(x,y,z,w,d,i){
    const name=i%2?'hopper_floor02_model':'hopper_floor01_model',model=this.models.get(name)||this.models.get('hopper_floor01_model');
    if(!model)throw new Error('Original Hopper floor model is missing.');
    const object=createModelInstance(model,this.assets);object.scale.set(w/10,1,d/10);object.position.set(x,y-.525,z);this.scene.add(object);
    this.platforms.push({x,y,z,w,d,object,modelName:name,bounce:0});
  }
  #makeGoal(last){const asset=this.assets.get('hopper_goal01')||this.assets.get('hopper_star01');const mat=new THREE.SpriteMaterial({map:asset?makeTexture(asset):null,color:0xffffff,transparent:true,depthWrite:false});const sprite=new THREE.Sprite(mat);sprite.scale.set(2.2,2.2,1);sprite.position.set(last[0],last[1]+1.5,last[2]);this.scene.add(sprite);this.goal=sprite;}
  reset(stage=this.stageIndex){
    this.#clearStage();this.stageIndex=stage%STAGES.length;const layout=STAGES[this.stageIndex];layout.forEach((p,i)=>this.#platform(...p,i));this.#makeGoal(layout.at(-1));
    const s=layout[0];Object.assign(this.player,{x:s[0],y:s[1]+.04,z:s[2]+1,vx:0,vy:.42,vz:0});this.spawn={x:this.player.x,y:this.player.y,z:this.player.z};this.elapsed=0;this.falls=0;this.accumulator=0;this.prototypeState=HopperState.S1;
    this.#syncPlayer();this.#camera(true);this.callbacks.onStage?.(this.stageIndex+1);
  }
  start(stage=0){this.reset(stage);this.playing=true;this.clock.getDelta();}
  pause(){this.playing=false;}
  #readInput(){const gp=navigator.getGamepads?.()?.find(Boolean);this.gamepad.x=gp&&Math.abs(gp.axes[0]||0)>.18?(gp.axes[0]||0):0;this.gamepad.y=gp&&Math.abs(gp.axes[1]||0)>.18?(gp.axes[1]||0):0;let x=(this.input.right?1:0)-(this.input.left?1:0)+this.gamepad.x,z=(this.input.down?1:0)-(this.input.up?1:0)+this.gamepad.y;const len=Math.hypot(x,z);if(len>1){x/=len;z/=len;}return{x,z};}
  #land(previousY){
    if(this.player.vy>0)return false;
    for(const p of this.platforms){if(Math.abs(this.player.x-p.x)<=p.w/2+.12&&Math.abs(this.player.z-p.z)<=p.d/2+.12&&previousY>=p.y&&this.player.y<=p.y+.02){this.player.y=p.y;prototypeBounce(this.player,p.bounce);return true;}}
    return false;
  }
  #stepFixed(){
    const input=this.#readInput(),previousY=this.player.y;
    stepPrototypeVelocity(this.player,input,this.prototypeState);integratePrototypePosition(this.player);this.#land(previousY);
    if(this.player.y<-8){this.falls++;Object.assign(this.player,{...this.spawn,vx:0,vy:.42,vz:0});this.callbacks.onFalls?.(this.falls);}
    if(this.goal){const dx=this.player.x-this.goal.position.x,dy=(this.player.y+1)-this.goal.position.y,dz=this.player.z-this.goal.position.z;if(Math.hypot(dx,dy,dz)<1.4)this.#win();}
    this.elapsed+=PROTOTYPE_DT;this.callbacks.onTime?.(this.elapsed);this.#syncPlayer();
  }
  #syncPlayer(){this.playerMesh.position.set(this.player.x,this.player.y,this.player.z);}
  #win(){if(!this.playing)return;this.playing=false;this.#burst();this.callbacks.onWin?.({stage:this.stageIndex+1,time:this.elapsed,falls:this.falls});}
  #burst(){const asset=this.assets.get('hopper_star01')||this.assets.get('hopper_spark01'),map=asset?makeTexture(asset):null;for(let i=0;i<22;i++){const s=new THREE.Sprite(new THREE.SpriteMaterial({map,color:0xffe86c,transparent:true,depthWrite:false}));s.scale.setScalar(.45+Math.random()*.65);s.position.set(this.player.x,this.player.y+1,this.player.z);this.scene.add(s);this.particles.push({mesh:s,life:1.2,vel:new THREE.Vector3((Math.random()-.5)*6,Math.random()*6+2,(Math.random()-.5)*6)});}}
  #particles(dt){for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;p.vel.y-=8*dt;p.mesh.position.addScaledVector(p.vel,dt);p.mesh.material.opacity=Math.max(0,p.life);if(p.life<=0){this.scene.remove(p.mesh);p.mesh.material.dispose();this.particles.splice(i,1);}}}
  #camera(snap=false){const distance=8+this.depth*7,height=6+this.depth*2,target=new THREE.Vector3(this.player.x,this.player.y+2,this.player.z),wanted=new THREE.Vector3(this.player.x,this.player.y+height,this.player.z+distance),a=snap?1:.07;this.camera.position.lerp(wanted,a);this.camera.lookAt(target);this.camera.fov=52-this.depth*10;this.camera.updateProjectionMatrix();}
  #tick(){const dt=Math.min(.05,this.clock.getDelta());if(this.playing){this.accumulator=Math.min(.2,this.accumulator+dt);while(this.accumulator>=PROTOTYPE_DT){this.#stepFixed();this.accumulator-=PROTOTYPE_DT;}}this.#particles(dt);this.#camera(false);this.renderer.render(this.scene,this.camera);}
}
