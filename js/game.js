import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import { canvasFromTexture } from './cgfx.js';
import { gridCoordinate } from './executable.js';
import {
  createGameState,activeStageRecords,createFloorRuntime,tickFloorRuntime,noteFall,findStartRecord,
} from './runtime.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function makeTexture(asset) {
  const canvas=canvasFromTexture(asset);
  const tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=THREE.ClampToEdgeWrapping;tex.wrapT=THREE.ClampToEdgeWrapping;
  tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;
  return tex;
}

export class HopperGame {
  constructor(host,assets,program,callbacks={}) {
    this.host=host;this.assets=assets;this.program=program;this.callbacks=callbacks;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.host.appendChild(this.renderer.domElement);

    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x9bdcf3);this.scene.fog=new THREE.Fog(0xb4e6f4,35,95);
    this.camera=new THREE.PerspectiveCamera(47,5/3,.1,160);
    this.clock=new THREE.Clock();this.accumulator=0;
    this.fixedStep=1/this.program.physics.fixedHz;
    this.input={left:false,right:false,up:false,down:false};this.gamepad={x:0,y:0};
    this.depth=.55;this.playing=false;this.elapsedFrames=0;
    this.state=createGameState(program);
    this.player={pos:new THREE.Vector3(),vel:new THREE.Vector3(),grounded:false};
    this.platforms=[];this.particles=[];this.stageGroup=new THREE.Group();this.scene.add(this.stageGroup);
    this.materials=new Map();

    this.#lights();this.#makeSky();this.#makePlayer();this.#events();
    this.resize();new ResizeObserver(()=>this.resize()).observe(host);
    this.#buildStage(0,true);this.renderer.setAnimationLoop(()=>this.#tick());
  }

  #lights(){
    const hemi=new THREE.HemisphereLight(0xf2fcff,0x39596e,2.7);this.scene.add(hemi);
    const sun=new THREE.DirectionalLight(0xfff5dd,3.4);sun.position.set(14,25,14);sun.castShadow=true;
    sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-45;sun.shadow.camera.right=45;sun.shadow.camera.top=45;sun.shadow.camera.bottom=-45;
    this.scene.add(sun);this.sun=sun;
  }

  #makeSky(){
    const sea=new THREE.Mesh(new THREE.PlaneGeometry(220,220),new THREE.MeshBasicMaterial({color:0xbce9f6,side:THREE.DoubleSide}));
    sea.rotation.x=-Math.PI/2;sea.position.y=-26;this.scene.add(sea);
    const grid=new THREE.GridHelper(180,36,0x7bb8ca,0x9fd3df);grid.position.y=-25.96;this.scene.add(grid);
  }

  #materialFor(type){
    const key=type===3?'goal':'normal';if(this.materials.has(key))return this.materials.get(key);
    const asset=this.assets.get(type===3?'hopper_floor02':'hopper_floor01')||this.assets.get('hopper_floor01');
    const mat=asset?new THREE.MeshStandardMaterial({map:makeTexture(asset),roughness:.9,metalness:0,color:0xffffff}):new THREE.MeshStandardMaterial({color:type===3?0xf3d45b:0xb8d7a6,roughness:.9});
    this.materials.set(key,mat);return mat;
  }

  #makePlayer(){
    const catTex=this.assets.get('nekopper')||this.assets.get('flockycmp')||this.assets.get('hopping');
    const fur=catTex?new THREE.MeshStandardMaterial({map:makeTexture(catTex),roughness:.85}):new THREE.MeshStandardMaterial({color:0xd98746,roughness:.9});
    const dark=new THREE.MeshStandardMaterial({color:0x37291f,roughness:.9});
    const metal=new THREE.MeshStandardMaterial({color:0xcbd3d5,metalness:.72,roughness:.22});
    const group=new THREE.Group();
    const body=new THREE.Mesh(new THREE.SphereGeometry(.8,18,12),fur);body.scale.set(.82,1.05,.72);body.position.y=1.25;group.add(body);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.62,18,12),fur);head.position.set(0,2.12,-.05);group.add(head);
    for(const x of [-.33,.33]){const ear=new THREE.Mesh(new THREE.ConeGeometry(.26,.52,3),fur);ear.position.set(x,2.62,-.04);ear.rotation.z=x<0?.12:-.12;group.add(ear);}
    for(const x of [-.22,.22]){const eye=new THREE.Mesh(new THREE.SphereGeometry(.055,9,7),dark);eye.position.set(x,2.23,-.58);group.add(eye);}
    const nose=new THREE.Mesh(new THREE.SphereGeometry(.07,8,6),dark);nose.position.set(0,2.05,-.64);group.add(nose);
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,2.0,10),metal);pole.position.y=.15;group.add(pole);
    const spring=new THREE.Mesh(new THREE.TorusGeometry(.22,.045,7,20),metal);spring.rotation.x=Math.PI/2;spring.scale.y=2.2;spring.position.y=-.78;group.add(spring);
    const foot=new THREE.Mesh(new THREE.CylinderGeometry(.38,.3,.11,18),dark);foot.position.y=-1.05;foot.scale.z=.55;group.add(foot);
    group.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    this.scene.add(group);this.playerMesh=group;
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
  resize(){const w=Math.max(1,this.host.clientWidth),h=Math.max(1,this.host.clientHeight);this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}

  #clearStage(){
    while(this.stageGroup.children.length){
      const o=this.stageGroup.children[0];this.stageGroup.remove(o);
      o.traverse?.(x=>{if(x.geometry)x.geometry.dispose();});
    }
    this.platforms=[];
  }

  #makeFloor(record){
    const runtime=createFloorRuntime(record);const group=new THREE.Group();
    const material=this.#materialFor(record.type);
    const h=this.program.floorBuilder.collisionHalfHeight*2;
    for(let row=0;row<record.rows;row++)for(let col=0;col<record.columns;col++){
      const x=gridCoordinate(record.columns,record.spacing,col),z=gridCoordinate(record.rows,record.spacing,row);
      const tile=new THREE.Mesh(new THREE.BoxGeometry(record.spacing,h,record.spacing),material);
      tile.position.set(x,-h/2,z);tile.castShadow=true;tile.receiveShadow=true;group.add(tile);
    }
    group.position.set(...runtime.center);this.stageGroup.add(group);
    runtime.group=group;
    if(record.type===3){
      const starAsset=this.assets.get('hopper_goal01')||this.assets.get('hopper_star01');
      const sprite=new THREE.Sprite(starAsset?new THREE.SpriteMaterial({map:makeTexture(starAsset),transparent:true,depthWrite:false}):new THREE.SpriteMaterial({color:0xffe35e}));
      sprite.scale.set(3.2,3.2,1);sprite.position.set(0,3.1,0);group.add(sprite);runtime.goalSprite=sprite;
    }
    return runtime;
  }

  #buildStage(index,newCampaign=false,preserveElapsed=false){
    const previousElapsed=this.elapsedFrames;
    if(newCampaign)this.state=createGameState(this.program);
    this.state.stageIndex=index;this.#clearStage();
    const records=activeStageRecords(this.program,this.state,index);
    this.platforms=records.map(r=>this.#makeFloor(r));
    const start=findStartRecord(records);this.state.currentFloorIndex=start.index;
    this.#resetPlayer(start);
    this.elapsedFrames=preserveElapsed?previousElapsed:0;
    this.callbacks.onStage?.(index+1,{recordCount:records.length,rescueCounter:this.state.stage2ExtraCounter});
    this.#camera(true);
  }

  #resetPlayer(startRecord=null){
    const records=activeStageRecords(this.program,this.state,this.state.stageIndex);
    const start=startRecord??findStartRecord(records);
    const floor=this.platforms.find(p=>p.index===start.index);
    const center=floor?.center??start.position;
    this.player.pos.set(center[0],center[1]+this.program.physics.spawnClearance,center[2]);
    this.player.vel.set(0,0,0);this.player.grounded=false;this.state.currentFloorIndex=start.index;
    this.playerMesh.position.copy(this.player.pos);
  }

  start(stage=0){this.#buildStage(stage,stage===0);this.playing=true;this.accumulator=0;this.clock.getDelta();}
  pause(){this.playing=false;}

  #readGamepad(){
    const gp=navigator.getGamepads?.()?.find(Boolean);if(!gp){this.gamepad.x=this.gamepad.y=0;return;}
    this.gamepad.x=Math.abs(gp.axes[0]||0)>.18?(gp.axes[0]||0):0;this.gamepad.y=Math.abs(gp.axes[1]||0)>.18?(gp.axes[1]||0):0;
  }

  #inputVector(){
    let x=(this.input.right?1:0)-(this.input.left?1:0)+this.gamepad.x;
    let z=(this.input.down?1:0)-(this.input.up?1:0)+this.gamepad.y;
    const n=Math.hypot(x,z);if(n>1){x/=n;z/=n;}return {x,z};
  }

  #updateFloors(){
    for(const floor of this.platforms){
      tickFloorRuntime(floor);
      floor.group.position.set(...floor.center);
      if(floor.goalSprite)floor.goalSprite.material.rotation=(floor.goalSprite.material.rotation||0)+.025;
    }
  }

  #steer(input){
    const p=this.program.physics;
    if(this.player.grounded){
      const tx=input.x*p.groundedInputScale,tz=input.z*p.groundedInputScale;
      if(Math.abs(this.player.vel.x)<Math.abs(tx))this.player.vel.x=tx;
      if(Math.abs(this.player.vel.z)<Math.abs(tz))this.player.vel.z=tz;
    }else{
      const tx=input.x*p.inputScale,tz=input.z*p.inputScale;
      this.player.vel.x+=(tx-this.player.vel.x)*p.airVelocityLerp;
      this.player.vel.z+=(tz-this.player.vel.z)*p.airVelocityLerp;
    }
  }

  #landingFloor(previous,current){
    if(this.player.vel.y>0)return null;
    let best=null;const skin=this.program.physics.collisionSkin;
    for(const f of this.platforms){
      const surface=f.center[1];
      if(previous.y<surface||current.y>surface)continue;
      const dx=Math.abs(current.x-f.center[0]),dz=Math.abs(current.z-f.center[2]);
      if(dx<=f.width/2+skin&&dz<=f.depth/2+skin){if(!best||surface>best.center[1])best=f;}
    }
    return best;
  }

  #land(floor){
    const p=this.program.physics;this.player.pos.y=floor.center[1];
    this.player.vel.y=floor.velocity[1]+p.landingBouncePerFrame;
    this.player.pos.x+=floor.velocity[0];this.player.pos.z+=floor.velocity[2];
    this.player.grounded=true;this.state.currentFloorIndex=floor.index;
    if(floor.record.type===3)this.#win();
  }

  #fall(){
    const before=this.state.stage2ExtraCounter;noteFall(this.program,this.state);
    const rebuild=before!==this.state.stage2ExtraCounter;
    this.callbacks.onFalls?.(this.state.falls,{rescueCounter:this.state.stage2ExtraCounter,rebuild});
    if(rebuild)this.#buildStage(this.state.stageIndex,false,true);else this.#resetPlayer();
  }

  #fixedTick(){
    if(!this.playing)return;
    this.elapsedFrames++;
    this.#readGamepad();this.#updateFloors();
    const input=this.#inputVector();this.#steer(input);
    this.player.grounded=false;
    this.player.vel.y-=this.program.physics.gravityPerFrame;
    const previous=this.player.pos.clone(),current=this.player.pos.clone().add(this.player.vel);
    this.player.pos.copy(current);
    const floor=this.#landingFloor(previous,current);if(floor)this.#land(floor);
    if(this.player.pos.y<this.program.physics.failY)this.#fall();
    this.callbacks.onTime?.(this.elapsedFrames/this.program.physics.fixedHz);
    this.playerMesh.position.copy(this.player.pos);this.playerMesh.position.y+=1.05;
    this.playerMesh.rotation.z=THREE.MathUtils.lerp(this.playerMesh.rotation.z,-input.x*.15,.18);
    this.playerMesh.rotation.x=THREE.MathUtils.lerp(this.playerMesh.rotation.x,input.z*.1,.18);
  }

  #win(){
    if(!this.playing)return;this.playing=false;this.#burst();
    const final=this.state.stageIndex===this.program.stages.length-1;
    this.callbacks.onWin?.({stage:this.state.stageIndex+1,stageIndex:this.state.stageIndex,time:this.elapsedFrames/this.program.physics.fixedHz,falls:this.state.falls,final,rescueCounter:this.state.stage2ExtraCounter});
  }

  #burst(){
    const asset=this.assets.get('hopper_star01')||this.assets.get('hopper_spark01');const map=asset?makeTexture(asset):null;
    for(let i=0;i<26;i++){
      const s=new THREE.Sprite(new THREE.SpriteMaterial({map,color:0xffe86c,transparent:true,depthWrite:false}));s.scale.setScalar(.6+Math.random()*.8);s.position.copy(this.player.pos).add(new THREE.Vector3(0,1.4,0));this.scene.add(s);
      this.particles.push({mesh:s,life:1.2,vel:new THREE.Vector3((Math.random()-.5)*.28,Math.random()*.25+.08,(Math.random()-.5)*.28)});
    }
  }

  #updateParticles(dt){
    const frames=dt*this.program.physics.fixedHz;
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;p.vel.y-=.012*frames;p.mesh.position.addScaledVector(p.vel,frames);p.mesh.material.opacity=Math.max(0,p.life);if(p.life<=0){this.scene.remove(p.mesh);p.mesh.material.dispose();this.particles.splice(i,1);}}
  }

  #camera(snap=false){
    const d=15+this.depth*12,h=8+this.depth*4;
    const target=new THREE.Vector3(this.player.pos.x,this.player.pos.y+1.5,this.player.pos.z-4);
    const wanted=new THREE.Vector3(this.player.pos.x*.88,this.player.pos.y+h,this.player.pos.z+d);
    this.camera.position.lerp(wanted,snap?1:.09);this.camera.lookAt(target);this.camera.fov=52-this.depth*11;this.camera.updateProjectionMatrix();
  }

  #tick(){
    const dt=Math.min(.1,this.clock.getDelta());
    if(this.playing){
      this.accumulator=Math.min(this.accumulator+dt,.25);
      while(this.accumulator>=this.fixedStep){this.#fixedTick();this.accumulator-=this.fixedStep;}
    }
    this.#updateParticles(dt);this.#camera(false);this.renderer.render(this.scene,this.camera);
  }
}
