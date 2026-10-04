import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { liftHopperProgram } from '../js/executable.js';
import { createGameState,activeStageRecords,createFloorRuntime,tickFloorRuntime,noteFall,updateHorizontalVelocity,intersectFloorTop,intersectFloorBottom,floorContainsHorizontalPoint,createEndingRuntime,tickEndingRuntime,applyLowerSideCollision,updateUpperCollisionPoint } from '../js/runtime.js';

const path=process.argv[2]; if(!path)throw new Error('usage: node tests/runtime-test.mjs ROM');
const b=fs.readFileSync(path),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);const p=liftHopperProgram(new HopperRom(ab));
const s=createGameState(p);s.stageIndex=2;s.currentFloorIndex=4;
if(activeStageRecords(p,s).length!==5)throw new Error('stage 2 should initially have rescue floor');
noteFall(p,s); if(s.stage2ExtraCounter!==1||activeStageRecords(p,s).length!==5)throw new Error('first rescue decrement mismatch');
noteFall(p,s); if(s.stage2ExtraCounter!==0||activeStageRecords(p,s).length!==4)throw new Error('second rescue decrement should remove floor');
const mover=createFloorRuntime(p.stages[3].records[1],p.floorBuilder);
if(JSON.stringify(mover.center)!==JSON.stringify([0,0,-8]))throw new Error(`floor-builder initial center mismatch ${mover.center}`);
tickFloorRuntime(mover); if(mover.timer!==1)throw new Error('moving floor timer mismatch');

const floorHit=updateHorizontalVelocity({x:.1,z:-.3},{x:1,z:.5},true,p.physics);
if(Math.abs(floorHit.x-.25)>1e-6||Math.abs(floorHit.z-(-.3))>1e-6)throw new Error(`floor-hit steering mismatch ${JSON.stringify(floorHit)}`);
const airborne=updateHorizontalVelocity({x:.1,z:-.3},{x:1,z:.5},false,p.physics);
if(Math.abs(airborne.x-.1015)>1e-6||Math.abs(airborne.z-(-.28875))>1e-6)throw new Error(`air steering mismatch ${JSON.stringify(airborne)}`);

const testFloor={center:[0,10,0],width:6,height:.4,depth:6};
const top=intersectFloorTop(testFloor,{x:3.39,y:11,z:0},{x:3.39,y:9,z:0},.8);
if(!top||Math.abs(top.y-10.2)>1e-6||Math.abs(top.x-3.39)>1e-6)throw new Error(`native top-plane collision mismatch ${JSON.stringify(top)}`);
if(intersectFloorTop(testFloor,{x:3.41,y:11,z:0},{x:3.41,y:9,z:0},.8)!==null)throw new Error('horizontal collision margin should be 0.4 per side');
if(!floorContainsHorizontalPoint(testFloor,-3.4,3.4,.8)||floorContainsHorizontalPoint(testFloor,-3.401,0,.8))throw new Error('native expanded floor bounds mismatch');
const bottom=intersectFloorBottom(testFloor,{x:0,y:9,z:0},{x:0,y:11,z:0},.8);
if(!bottom||Math.abs(bottom.y-9.8)>1e-6)throw new Error(`native bottom-plane collision mismatch ${JSON.stringify(bottom)}`);

const slab={center:[0,0,0],width:6,height:.4,depth:6};
let side=applyLowerSideCollision({x:-5,y:0,z:0},{x:-5,y:4.25,z:0},{x:3,y:0,z:0},[slab],.8);
if(Math.abs(side.x-(-3.4))>1e-6||side.y!==0||side.z!==0)throw new Error(`positive-X slab clamp mismatch ${JSON.stringify(side)}`);
side=applyLowerSideCollision({x:5,y:0,z:0},{x:5,y:4.25,z:0},{x:-3,y:0,z:0},[slab],.8);
if(Math.abs(side.x-3.4)>1e-6)throw new Error(`negative-X slab clamp mismatch ${JSON.stringify(side)}`);
side=applyLowerSideCollision({x:0,y:0,z:-5},{x:0,y:4.25,z:-5},{x:0,y:0,z:3},[slab],.8);
if(Math.abs(side.z-(-3.4))>1e-6)throw new Error(`positive-Z slab clamp mismatch ${JSON.stringify(side)}`);
side=applyLowerSideCollision({x:-5,y:1,z:0},{x:-5,y:5.25,z:0},{x:3,y:0,z:0},[slab],.8);
if(Math.abs(side.x-(-2))>1e-6)throw new Error('side clamp should ignore slabs outside vertical overlap');
side=applyLowerSideCollision({x:-5,y:0,z:-5},{x:-5,y:4.25,z:-5},{x:3,y:0,z:3},[slab],.8);
if(Math.abs(side.x-(-2))>1e-6||Math.abs(side.z-(-3.4))>1e-6)throw new Error(`X-then-Z corner ordering mismatch ${JSON.stringify(side)}`);

const upperPhysics={upperLeanInputScale:.2,upperCollisionLength:4.25,upperHorizontalCollisionSize:1};
let upper=updateUpperCollisionPoint({x:0,y:0,z:0},{x:0,y:4.25,z:0},{x:1,z:0},[],upperPhysics);
if(Math.abs(upper.x-.85)>1e-6||Math.abs(upper.y-3.80131556)>1e-6||Math.abs(upper.z)>1e-6)throw new Error(`upper collision posture mismatch ${JSON.stringify(upper)}`);
const roof={center:[0,3.5,0],width:6,height:.4,depth:6};
upper=updateUpperCollisionPoint({x:0,y:0,z:0},{x:0,y:3,z:0},{x:0,z:0},[roof],upperPhysics);
if(Math.abs(upper.y-3.3)>1e-6)throw new Error(`upper underside clamp mismatch ${JSON.stringify(upper)}`);

const ending=createEndingRuntime();
for(let i=0;i<60;i++){
  const tick=tickEndingRuntime(ending,p.ending);
  if(Math.abs(tick.riseY-.42)>1e-6)throw new Error('ending rise mismatch');
  if(tick.events.length)throw new Error(`unexpected ending event before 60: ${JSON.stringify(tick.events)}`);
}
let tick=tickEndingRuntime(ending,p.ending);
if(ending.mainCounter!==61||tick.events[0]?.type!=='frame60-controller')throw new Error('ending frame-60 event mismatch');
while(ending.mainCounter<240)tickEndingRuntime(ending,p.ending);
tick=tickEndingRuntime(ending,p.ending);
if(tick.events[0]?.type!=='starshower'||tick.events[0].slot!==5||tick.events[0].y!==65)throw new Error('ending frame-240 starshower mismatch');
if(ending.state!==3||ending.mainCounter!==241)throw new Error('ending should remain state 3 through frame 240');
tick=tickEndingRuntime(ending,p.ending,{confirm:true});
if(ending.state!==5||tick.events[0]?.type!=='enter-state5'||tick.events[0].reason!=='confirm')throw new Error('ending confirm transition mismatch');

const timeoutEnding=createEndingRuntime();
while(timeoutEnding.mainCounter<=240)tickEndingRuntime(timeoutEnding,p.ending);
for(let i=0;i<599;i++)tickEndingRuntime(timeoutEnding,p.ending);
if(timeoutEnding.state!==3||timeoutEnding.postShowerCounter!==599)throw new Error('ending timeout fired early');
tick=tickEndingRuntime(timeoutEnding,p.ending);
if(timeoutEnding.state!==5||tick.events[0]?.reason!=='timeout')throw new Error('ending 600-update timeout mismatch');

console.log('Translated stage runtime OK', {rescueCounter:s.stage2ExtraCounter,moverCenter:mover.center,moverVelocity:mover.velocity});
