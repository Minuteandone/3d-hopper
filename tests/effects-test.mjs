import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { emitterMapFromRom } from '../js/emitters.js';
import {
  HOPPER_EFFECT_SLOTS,goalEffectSlots,ENDING_STARSHOWER,bindEffectRegistry,
} from '../js/effects.js';

const path=process.argv[2];
if(!path)throw new Error('usage: node tests/effects-test.mjs /path/to/3D_Hopper.app');
const b=fs.readFileSync(path),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const rom=new HopperRom(ab),emitters=emitterMapFromRom(rom),registry=bindEffectRegistry(emitters);

if(registry.length!==16)throw new Error('effect slot count mismatch');
if(HOPPER_EFFECT_SLOTS[1].instances!==3||HOPPER_EFFECT_SLOTS[4].instances!==3)throw new Error('multi-instance effect allocation mismatch');
if(JSON.stringify(goalEffectSlots(0))!=='[10,11]'||JSON.stringify(goalEffectSlots(3))!=='[12,13]')throw new Error('goal slot mapping mismatch');
if(ENDING_STARSHOWER.slot!==5||ENDING_STARSHOWER.startFrame!==240)throw new Error('ending shower trigger mismatch');

console.log(registry.map(e=>({slot:e.slot,name:e.name,instances:e.instances,kind:e.emitter.kind})));
console.log('ARM effect registry mapping OK');
