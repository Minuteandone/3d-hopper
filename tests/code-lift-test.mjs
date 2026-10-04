import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { liftHopperProgram, gridCoordinate, movingFloorAt, transformControlVector, computeCenterCameraPose } from '../js/executable.js';

const path=process.argv[2];
if(!path)throw new Error('usage: node tests/code-lift-test.mjs /path/to/3D_Hopper.app');
const b=fs.readFileSync(path);const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const rom=new HopperRom(ab);const p=liftHopperProgram(rom);
const close=(a,b,e=1e-5)=>Math.abs(a-b)<e;
const eq=(a,b,msg)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);};
if(p.build.sceneName!=='Game'||p.build.factoryAddress!==0x13ebd4)throw new Error('Game descriptor mismatch');
eq(p.stages.map(s=>s.count),[10,4,5,3],'stage counts');
eq(p.startupFloor.position,[0,80,0],'startup floor constructor');
if(p.startupFloor.columns!==1||p.startupFloor.rows!==1||!close(p.startupFloor.spacing,6)||p.startupFloor.type!==1)throw new Error('startup floor static fields mismatch');
eq(p.stages.map(s=>s.records.map(r=>r.type)),[[2,0,1,0,1,0,1,0,1,3],[2,0,1,3],[2,0,1,3,1],[2,4,3]],'stage types');
eq(p.stages[0].records.map(r=>r.position),[[0,4.5,0],[-8,6,-8],[0,3,-8],[8,0,-8],[-8,3,-16],[0,3,-16],[8,0,-16],[-8,9,-16],[0,12,-16],[8,15,-16]],'stage 0 constructor');
eq(p.stages[1].records.map(r=>r.position),[[0,0,0],[18,4,0],[22,8,-4],[10,12,0]],'stage 1 constructor');
eq(p.stages[2].records.map(r=>r.position),[[0,2,0],[0,0,-10],[6,4.75,-20],[0,9.5,-32],[-9,-3,-27.5]],'stage 2 constructor');
eq(p.stages[3].records.map(r=>r.position),[[0,0,0],[8,0,-16],[16,0,-32]],'stage 3 constructor');
eq(p.stages[3].records[1].offset,[-8,0,8],'moving floor vector');
if(p.stages[3].records[1].parameter!==720||p.stages[3].records[1].flag!==1)throw new Error('moving floor metadata mismatch');
if(!close(p.physics.gravityPerUpdate,.012)||!close(p.physics.state2GravityPerUpdate,.006)||!close(p.physics.state2DisplacementScale,.5)||!close(p.physics.landingBouncePerUpdate,.42)||!close(p.physics.airVelocityLerp,.03))throw new Error('motion constants mismatch');
if(!close(p.physics.horizontalCollisionSize,.8)||!close(p.physics.upperHorizontalCollisionSize,1)||!close(p.physics.upperCollisionLength,4.25)||!close(p.physics.upperLeanInputScale,.2)||!close(p.physics.spawnClearance,7.35)||!close(p.physics.failY,-25)||!close(p.physics.verticalCollisionEpsilon,.0001,1e-7))throw new Error('runtime constants mismatch');
if(!close(p.floorBuilder.collisionHeight,.4)||!close(p.floorBuilder.verticalModelScale,.4)||!close(p.floorBuilder.tileModelScale,.1))throw new Error('floor-builder scale/collision constants mismatch');
if(gridCoordinate(3,8,0)!==-8||gridCoordinate(3,8,1)!==0||gridCoordinate(3,8,2)!==8)throw new Error('translated grid math mismatch');
const mover=p.stages[3].records[1];
const quarter=movingFloorAt(mover,179);
if(!close(quarter.position[0],0)||!close(quarter.position[2],-8))throw new Error(`moving-floor sine mismatch: ${quarter.position}`);
if(p.initialState.stage2ExtraCounter!==2)throw new Error('game constructor state mismatch');
eq([
  p.catAnimation.stageSetup.current,p.catAnimation.stageSetup.start,p.catAnimation.stageSetup.end,p.catAnimation.stageSetup.step
],[24,24,47,1],'stage/retry cat animation range');
eq([
  p.catAnimation.landing.current,p.catAnimation.landing.start,p.catAnimation.landing.end,p.catAnimation.landing.step
],[0,0,23,1],'landing cat animation range');
eq([
  p.catAnimation.falling.current,p.catAnimation.falling.start,p.catAnimation.falling.end,p.catAnimation.falling.step
],[24,24,47,1],'falling cat animation range');
eq([
  p.catAnimation.endingFrame60.current,p.catAnimation.endingFrame60.start,p.catAnimation.endingFrame60.end,p.catAnimation.endingFrame60.step
],[24,24,47,.5],'ending cat animation range');
if(p.catAnimation.binderAddress!==0x101a20||p.catAnimation.clockAddress!==0x101870)throw new Error('cat animation controller routine mapping mismatch');

if(!close(p.ending.risePerUpdate,.42)||p.ending.introUpdates!==60||p.ending.starShowerUpdate!==240||p.ending.postShowerTimeoutUpdates!==600)throw new Error('ending timeline constants mismatch');
if(p.ending.starShowerEffectSlot!==5||p.ending.starShowerY!==65||p.ending.thanksSceneName!=='Thanks'||p.ending.state5FadeArgument!==30)throw new Error('ending resource/scene mapping mismatch');
eq(p.ending.frame60Controller,[24,24,47,.5],'ending frame-60 controller values');
if(p.ending.followYLimit!==61||!close(p.ending.followYLerp,.15))throw new Error('ending follow-camera constants mismatch');
if(!close(p.viewController.followYLerp,.15))throw new Error('normal view follow lerp mismatch');
eq(p.viewController.stageSetup.map(v=>[
  v.projection.fovDegrees,v.projection.near,v.projection.far,
  v.projection.frustumParameter0,v.projection.frustumParameter1,
  v.distance,v.pitchDegrees,v.headingDegrees,v.secondaryAngleDegrees,...v.auxiliaryPair
]),[
  [15,10,300,.5,.75,65,-40,0,0,62.5,2.5],
  [20,10,300,.5,.75,60,-20,0,0,50,2],
  [20,10,300,.5,.7,60,-50,25,0,60,2],
  [15,10,300,.5,.75,65,-40,0,0,65,2],
],'stage view-controller setup');
eq(p.viewController.selectors,[1024,1040,0x401],'view selectors');
eq(p.viewController.projectionOffsets,[136,200,264],'projection matrix offsets');
eq(p.viewController.viewOffsets,[328,376,424],'view matrix offsets');
eq(p.viewController.inverseViewOffsets,[472,520,568],'inverse-view matrix offsets');

if(!close(p.controls.degreesToTrigUnits,.7111111283))throw new Error('control degree conversion mismatch');
eq(p.controls.stageSetup.map(s=>s.controlHeadingDegrees),[0,0,25,0],'stage control headings');
const cameraOffsets=[
  [0,41.778077678,49.789148085],
  [0,20.520134522,56.378626274],
  [37.748447813,41.65110381,20.958021185],
  [0,41.778077678,49.789148085],
];
for(let i=0;i<4;i++){
  const pose=computeCenterCameraPose(p.controls,p.viewController,i,{x:0,y:0,z:0});
  if(!close(pose.eye.x,cameraOffsets[i][0],1e-5)||
     !close(pose.eye.y,cameraOffsets[i][1],1e-5)||
     !close(pose.eye.z,cameraOffsets[i][2],1e-5)){
    throw new Error(`stage ${i+1} center camera eye mismatch: ${JSON.stringify(pose.eye)}`);
  }
}

const right3=transformControlVector(p.controls,2,1,0);
if(!close(right3.x,.9062611285,1e-6)||!close(right3.z,-.4225963562,1e-6))throw new Error(`stage 3 control rotation mismatch: ${JSON.stringify(right3)}`);
const forward3=transformControlVector(p.controls,2,0,1);
if(!close(forward3.x,.4225963562,1e-6)||!close(forward3.z,.9062611285,1e-6))throw new Error(`stage 3 forward rotation mismatch: ${JSON.stringify(forward3)}`);

console.log(JSON.stringify({scene:p.build.sceneName,startupFloor:p.startupFloor,stageCounts:p.stages.map(s=>s.count),stage3:p.stages[3],physics:p.physics},null,2));
console.log('ARM data/code lift OK');
