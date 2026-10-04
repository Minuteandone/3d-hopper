import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { liftHopperProgram } from '../js/executable.js';
import { createGameState,activeStageRecords,createFloorRuntime,tickFloorRuntime,noteFall,updateHorizontalVelocity,intersectFloorTop,intersectFloorBottom,floorContainsHorizontalPoint } from '../js/runtime.js';

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

console.log('Translated stage runtime OK', {rescueCounter:s.stage2ExtraCounter,moverCenter:mover.center,moverVelocity:mover.velocity});
