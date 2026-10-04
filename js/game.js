import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import { createModelInstance, disposeModelInstance } from './model-renderer.js';
import { gridCoordinate, transformControlVector, computeCenterCameraPose } from './executable.js';
import {
  createGameState,activeStageRecords,createFloorRuntime,tickFloorRuntime,noteFall,findStartRecord,updateHorizontalVelocity,intersectFloorTop,intersectFloorBottom,createEndingRuntime,tickEndingRuntime,applyLowerSideCollision,updateUpperCollisionPoint,updateViewTarget,
} from './runtime.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class HopperGame {
  constructor(host,assets,models,program,callbacks={}) {
    this.host=host;this.assets=assets;this.models=models;this.program=program;this.callbacks=callbacks;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.host.appendChild(this.renderer.domElement);

    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x9bdcf3);this.scene.fog=new THREE.Fog(0xb4e6f4,35,95);
    this.camera=new THREE.PerspectiveCamera(47,5/3,.1,160);
    this.clock=new THREE.Clock();this.accumulator=0;
    // Browser host cadence only. The original executable has per-update constants,
    // but this port has not yet proven the game's scheduler frequency.
    this.fixedStep=1/60;
    this.input={left:false,right:false,up:false,down:false,confirm:false};this.gamepad={x:0,y:0,confirm:false};
    this.playing=false;this.elapsedFrames=0;this.phase=0;this.endingRuntime=null;
    this.viewTarget=new THREE.Vector3();
    this.state=createGameState(program);
    this.player={pos:new THREE.Vector3(),upper:new THREE.Vector3(),vel:new THREE.Vector3(),grounded:false};
    this.platforms=[];this.stageGroup=new THREE.Group();this.scene.add(this.stageGroup);

    this.#lights();this.#makeSky();this.#makePlayer();this.#events();
    this.resize();new ResizeObserver(()=>this.resize()).observe(host);
    this.openingPrepared=false;this.openingFloor=null;
    this.#buildOpeningStage();this.renderer.setAnimationLoop(()=>this.#tick());
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

  #makePlayer(){
    const model=this.models.get('neko_hopping_model');
    if(!model)throw new Error('The ROM did not provide neko_hopping_model.');
    const group=createModelInstance(model,this.assets,{shadows:true});
    group.name='ROM neko_hopping_model';
    this.scene.add(group);this.playerMesh=group;
  }

  #events(){
    const map={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down'};
    const confirmCodes=new Set(['Enter','Space','KeyZ']);
    addEventListener('keydown',e=>{
      if(map[e.code]){this.input[map[e.code]]=true;e.preventDefault();}
      if(confirmCodes.has(e.code)){this.input.confirm=true;e.preventDefault();}
    });
    addEventListener('keyup',e=>{
      if(map[e.code]){this.input[map[e.code]]=false;e.preventDefault();}
      if(confirmCodes.has(e.code)){this.input.confirm=false;e.preventDefault();}
    });
  }

  bindTouch(root){
    root.querySelectorAll('button[data-key]').forEach(btn=>{
      const key=btn.dataset.key;
      const on=e=>{e.preventDefault();this.input[key]=true;btn.classList.add('active');};
      const off=e=>{e.preventDefault();this.input[key]=false;btn.classList.remove('active');};
      btn.addEventListener('pointerdown',on);btn.addEventListener('pointerup',off);btn.addEventListener('pointercancel',off);btn.addEventListener('pointerleave',off);
    });
  }

  resize(){const w=Math.max(1,this.host.clientWidth),h=Math.max(1,this.host.clientHeight);this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}

  #clearStage(){
    for(const o of [...this.stageGroup.children]){
      this.stageGroup.remove(o);
      disposeModelInstance(o);
    }
    this.platforms=[];
  }

  #makeFloor(record){
    const runtime=createFloorRuntime(record,this.program.floorBuilder);const group=new THREE.Group();
    const modelName=record.type===3?'hopper_floor02_model':'hopper_floor01_model';
    const model=this.models.get(modelName);
    if(!model)throw new Error(`The ROM did not provide ${modelName}.`);
    const scaleXZ=record.spacing*this.program.floorBuilder.tileModelScale;
    const scaleY=this.program.floorBuilder.verticalModelScale;
    for(let row=0;row<record.rows;row++)for(let col=0;col<record.columns;col++){
      const x=gridCoordinate(record.columns,record.spacing,col),z=gridCoordinate(record.rows,record.spacing,row);
      const tile=createModelInstance(model,this.assets,{shadows:true});
      // Translation of 0x13C1F0..0x13C21C: the 10-unit floor mesh is
      // scaled by spacing*0.1 on X/Z and 0.4 on Y.
      tile.scale.set(scaleXZ,scaleY,scaleXZ);
      tile.position.set(x,0,z);group.add(tile);
    }
    group.position.set(...runtime.center);this.stageGroup.add(group);
    runtime.group=group;
    return runtime;
  }

  #placePlayerOnFloor(floor){
    const center=floor.center;
    this.player.pos.set(center[0],center[1]+this.program.physics.spawnClearance,center[2]);
    this.player.upper.set(
      this.player.pos.x,
      this.player.pos.y+this.program.physics.upperCollisionLength,
      this.player.pos.z
    );
    this.player.vel.set(0,0,0);this.player.grounded=false;this.state.currentFloorIndex=floor.index;
    this.playerMesh.position.copy(this.player.pos);
  }

  #resetViewTarget(stageIndex){
    const target=this.program.viewController.stageSetup[stageIndex]?.target??[0,0,0];
    this.viewTarget.set(target[0],target[1],target[2]);
  }

  #buildOpeningStage(){
    this.state=createGameState(this.program);this.state.stageIndex=0;this.#clearStage();this.#resetViewTarget(0);
    const records=activeStageRecords(this.program,this.state,0);
    this.platforms=records.map(r=>this.#makeFloor(r));
    const openingRecord={...this.program.startupFloor,index:records.length};
    const opening=this.#makeFloor(openingRecord);
    this.platforms.push(opening);this.openingFloor=opening;this.openingPrepared=true;
    this.#placePlayerOnFloor(opening);this.elapsedFrames=0;
    this.callbacks.onStage?.(1,{recordCount:records.length,startupFloor:true,rescueCounter:this.state.stage2ExtraCounter});
    this.#camera();
  }

  #releaseOpeningFloor(){
    if(!this.openingPrepared||!this.openingFloor)return;
    const floor=this.openingFloor;
    this.stageGroup.remove(floor.group);disposeModelInstance(floor.group);
    this.platforms=this.platforms.filter(p=>p!==floor);
    this.openingFloor=null;this.openingPrepared=false;this.phase=1;
    // The executable leaves the current-floor index pointing at the removed
    // startup slot until the next collision updates it.
  }

  #buildStage(index,newCampaign=false,preserveElapsed=false){
    const previousElapsed=this.elapsedFrames;
    if(newCampaign)this.state=createGameState(this.program);
    this.openingPrepared=false;this.openingFloor=null;this.phase=1;
    this.state.stageIndex=index;this.#clearStage();this.#resetViewTarget(index);
    const records=activeStageRecords(this.program,this.state,index);
    this.platforms=records.map(r=>this.#makeFloor(r));
    const start=findStartRecord(records);
    const floor=this.platforms.find(p=>p.index===start.index);
    this.#placePlayerOnFloor(floor);
    this.elapsedFrames=preserveElapsed?previousElapsed:0;
    this.callbacks.onStage?.(index+1,{recordCount:records.length,rescueCounter:this.state.stage2ExtraCounter});
    this.#camera();
  }

  #resetPlayer(startRecord=null){
    const records=activeStageRecords(this.program,this.state,this.state.stageIndex);
    const start=startRecord??findStartRecord(records);
    const floor=this.platforms.find(p=>p.index===start.index);
    if(!floor)throw new Error('Stage restart floor is missing.');
    this.#placePlayerOnFloor(floor);
  }

  start(stage=0){
    if(stage===0){
      if(!this.openingPrepared)this.#buildOpeningStage();
      this.#releaseOpeningFloor();
    }else this.#buildStage(stage,false);
    this.playing=true;this.accumulator=0;this.clock.getDelta();
  }
  pause(){this.playing=false;}

  #readGamepad(){
    const gp=navigator.getGamepads?.()?.find(Boolean);if(!gp){this.gamepad.x=this.gamepad.y=0;this.gamepad.confirm=false;return;}
    this.gamepad.x=Math.abs(gp.axes[0]||0)>.18?(gp.axes[0]||0):0;this.gamepad.y=Math.abs(gp.axes[1]||0)>.18?(gp.axes[1]||0):0;
    this.gamepad.confirm=!!gp.buttons?.[0]?.pressed;
  }

  #inputVector(){
    let x=(this.input.right?1:0)-(this.input.left?1:0)+this.gamepad.x;
    let z=(this.input.down?1:0)-(this.input.up?1:0)+this.gamepad.y;
    const n=Math.hypot(x,z);if(n>1){x/=n;z/=n;}
    return transformControlVector(this.program.controls,this.state.stageIndex,x,z);
  }

  #updateFloors(){
    for(const floor of this.platforms){
      tickFloorRuntime(floor);
      floor.group.position.set(...floor.center);
    }
  }

  #landingFloor(previous,current){
    if(this.player.vel.y>0)return null;
    const size=this.program.physics.horizontalCollisionSize;
    // 0x13CECC..0x13D404 scans runtime floors in array order and accepts
    // the first downward plane/bounds intersection.
    for(const floor of this.platforms){
      const hit=intersectFloorTop(floor,previous,current,size);
      if(hit)return {floor,hit};
    }
    return null;
  }

  #land(collision){
    const {floor}=collision;
    const p=this.program.physics;
    this.player.vel.y=floor.velocity[1]+p.landingBouncePerUpdate;
    this.player.grounded=true;this.state.currentFloorIndex=floor.index;
    if(floor.record.type===3){
      if(this.state.stageIndex===this.program.stages.length-1){
        // Final-stage goal path enters dedicated state 3. 0x13B74C resets
        // its two counters before 0x13E630 takes over on following updates.
        this.phase=3;this.endingRuntime=createEndingRuntime();
        this.callbacks.onEndingStart?.({stage:4});
      }else{
        // Goal collision path 0x13D144..0x13D19C: ordinary stages enter
        // state 2 and continue the bounce instead of stopping immediately.
        this.phase=2;
      }
    }
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
    this.#readGamepad();

    if(this.phase===3){
      const tick=tickEndingRuntime(this.endingRuntime,this.program.ending,{confirm:this.input.confirm||this.gamepad.confirm});
      this.player.pos.y+=tick.riseY;
      this.player.upper.y+=tick.riseY;
      this.playerMesh.position.copy(this.player.pos);
      for(const event of tick.events)this.callbacks.onEndingEvent?.(event);
      if(tick.state===5){
        this.phase=5;this.playing=false;
        // The native outer update asks the global fade controller for a
        // 30-step transition before switching to the literal Thanks scene.
        // That global fade controller is not translated yet, so expose the
        // scene transition now rather than inventing a local timer.
        this.callbacks.onThanks?.({scene:this.program.ending.thanksSceneName,fadeArgument:this.program.ending.state5FadeArgument});
      }
      return;
    }

    this.#updateFloors();

    // 0x13CAD4..0x13CB40: state 2 advances to the next descriptor stage as
    // the upward velocity reaches its apex window.
    if(this.phase===2&&this.player.vel.y>=0&&this.player.vel.y-this.program.physics.gravityPerUpdate<0){
      const next=this.state.stageIndex+1;
      this.#buildStage(next,false);
      this.callbacks.onAdvance?.(next+1);
      return;
    }

    const input=this.#inputVector();
    this.player.grounded=false;
    const state2=this.phase===2;
    const physics=this.program.physics;
    this.player.vel.y-=state2?physics.state2GravityPerUpdate:physics.gravityPerUpdate;

    const previousLower=this.player.pos.clone();
    const previousUpper=this.player.upper.clone();
    const movement=this.player.vel.clone().multiplyScalar(
      state2?physics.state2DisplacementScale:1
    );
    let collision=null;

    if(this.player.vel.y>physics.verticalCollisionEpsilon){
      // 0x13CC04..0x13CE9C sweeps the separately stored upper point with
      // the full velocity, not the state-2-scaled ordinary displacement.
      const upperSweepEnd=previousUpper.clone().add(this.player.vel);
      for(const floor of this.platforms){
        const hit=intersectFloorBottom(
          floor,previousUpper,upperSweepEnd,physics.upperHorizontalCollisionSize
        );
        if(!hit)continue;
        movement.set(
          hit.x-previousUpper.x,
          hit.y-previousUpper.y,
          hit.z-previousUpper.z
        );
        this.player.vel.y=0;
        break;
      }
    }else if(this.player.vel.y< -physics.verticalCollisionEpsilon){
      // 0x13CECC..0x13D404 does the same with the lower pogo point.
      const lowerSweepEnd=previousLower.clone().add(this.player.vel);
      collision=this.#landingFloor(previousLower,lowerSweepEnd);
      if(collision){
        movement.set(
          collision.hit.x-previousLower.x,
          collision.hit.y-previousLower.y,
          collision.hit.z-previousLower.z
        );
        this.#land(collision);
      }
    }else{
      this.player.vel.y=0;
      movement.y=0;
    }

    // 0x13D414 calls 0x13B8AC after the vertical sweep. That helper owns
    // the actual lower-point position write and X/Z slab-side clamping.
    const lower=applyLowerSideCollision(
      {x:previousLower.x,y:previousLower.y,z:previousLower.z},
      {x:previousUpper.x,y:previousUpper.y,z:previousUpper.z},
      {x:movement.x,y:movement.y,z:movement.z},
      this.platforms,
      physics.horizontalCollisionSize
    );
    this.player.pos.set(lower.x,lower.y,lower.z);

    if(this.player.pos.y<physics.failY){this.#fall();return;}
    if(!this.playing)return;

    const horizontal=updateHorizontalVelocity(this.player.vel,input,!!collision,physics);
    this.player.vel.x=horizontal.x;this.player.vel.z=horizontal.z;

    // 0x13D5E0..0x13D7E4 rebuilds the upper collision point from the
    // transformed control vector and clamps it against platform undersides.
    const upper=updateUpperCollisionPoint(
      lower,
      {x:previousUpper.x,y:previousUpper.y,z:previousUpper.z},
      input,
      this.platforms,
      physics
    );
    this.player.upper.set(upper.x,upper.y,upper.z);

    const currentFloor=this.platforms.find(p=>p.index===this.state.currentFloorIndex)??null;
    const view=updateViewTarget(
      this.viewTarget.y,
      {x:this.player.pos.x,y:this.player.pos.y,z:this.player.pos.z},
      this.player.vel.y,
      currentFloor,
      this.program.viewController.followYLerp
    );
    this.viewTarget.set(view.x,view.y,view.z);

    this.callbacks.onTime?.(this.elapsedFrames/60);
    // The original CMDL root is authored at the pogo contact point.
    this.playerMesh.position.copy(this.player.pos);
  }

  #camera(){
    const pose=computeCenterCameraPose(
      this.program.controls,
      this.program.viewController,
      this.state.stageIndex,
      {x:this.viewTarget.x,y:this.viewTarget.y,z:this.viewTarget.z}
    );
    this.camera.position.set(pose.eye.x,pose.eye.y,pose.eye.z);
    this.camera.up.set(0,1,0);
    this.camera.lookAt(pose.target.x,pose.target.y,pose.target.z);
    this.camera.fov=pose.projection.fovDegrees;
    this.camera.near=pose.projection.near;
    this.camera.far=pose.projection.far;
    this.camera.updateProjectionMatrix();
  }

  #tick(){
    const dt=Math.min(.1,this.clock.getDelta());
    if(this.playing){
      this.accumulator=Math.min(this.accumulator+dt,.25);
      while(this.accumulator>=this.fixedStep){this.#fixedTick();this.accumulator-=this.fixedStep;}
    }
    this.#camera();this.renderer.render(this.scene,this.camera);
  }
}
