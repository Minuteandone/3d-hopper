import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { emitterMapFromRom } from '../js/emitters.js';
import {
  HOPPER_EFFECT_SLOTS,stageStarShowerSlot,goalEffectSlots,ENDING_STARSHOWER,
  LANDING_STAMP_SLOT,AIRBORNE_STAR_SLOT,FLOOR_EFFECT_SLOT,bindEffectRegistry,
} from '../js/effects.js';

const path=process.argv[2];
if(!path)throw new Error('usage: node tests/effects-test.mjs /path/to/3D_Hopper.app');
const b=fs.readFileSync(path),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const rom=new HopperRom(ab),emitters=emitterMapFromRom(rom),registry=bindEffectRegistry(emitters);

if(registry.length!==16)throw new Error('effect slot count mismatch');
if(HOPPER_EFFECT_SLOTS[1].instances!==3||HOPPER_EFFECT_SLOTS[4].instances!==3)throw new Error('multi-instance effect allocation mismatch');
for(const i of [0,1,2,3])if(stageStarShowerSlot(i)!==6+i)throw new Error('stage shower slot mismatch');
if(JSON.stringify(goalEffectSlots(0))!=='[10,11]'||JSON.stringify(goalEffectSlots(3))!=='[12,13]')throw new Error('goal slot mapping mismatch');
if(ENDING_STARSHOWER.slot!==5||ENDING_STARSHOWER.startFrame!==240)throw new Error('ending shower trigger mismatch');
if(LANDING_STAMP_SLOT!==1||AIRBORNE_STAR_SLOT!==2||FLOOR_EFFECT_SLOT!==15)throw new Error('activation slot constants mismatch');

console.log(registry.map(e=>({slot:e.slot,name:e.name,instances:e.instances,kind:e.emitter.kind})));
console.log('ARM effect registry mapping OK');
