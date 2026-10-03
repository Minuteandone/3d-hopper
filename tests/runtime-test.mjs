import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { liftHopperProgram } from '../js/executable.js';
import { createGameState,activeStageRecords,createFloorRuntime,tickFloorRuntime,noteFall } from '../js/runtime.js';

const path=process.argv[2]; if(!path)throw new Error('usage: node tests/runtime-test.mjs ROM');
const b=fs.readFileSync(path),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);const p=liftHopperProgram(new HopperRom(ab));
const s=createGameState(p);s.stageIndex=2;s.currentFloorIndex=4;
if(activeStageRecords(p,s).length!==5)throw new Error('stage 2 should initially have rescue floor');
noteFall(p,s); if(s.stage2ExtraCounter!==1||activeStageRecords(p,s).length!==5)throw new Error('first rescue decrement mismatch');
noteFall(p,s); if(s.stage2ExtraCounter!==0||activeStageRecords(p,s).length!==4)throw new Error('second rescue decrement should remove floor');
const mover=createFloorRuntime(p.stages[3].records[1]);
if(JSON.stringify(mover.center)!==JSON.stringify([0,0,-8]))throw new Error(`floor-builder initial center mismatch ${mover.center}`);
tickFloorRuntime(mover); if(mover.timer!==1)throw new Error('moving floor timer mismatch');
console.log('Translated stage runtime OK', {rescueCounter:s.stage2ExtraCounter,moverCenter:mover.center,moverVelocity:mover.velocity});
