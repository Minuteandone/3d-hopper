import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { parseEmitters } from '../js/emitters.js';

const path=process.argv[2];
if(!path)throw new Error('usage: node tests/emitters-test.mjs /path/to/3D_Hopper.app');
const b=fs.readFileSync(path),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const rom=new HopperRom(ab);
const emitters=parseEmitters(rom.get('gfx/hopper_effect.bcmdl'));

if(emitters.length!==16)throw new Error(`expected 16 PEMT emitters, got ${emitters.length}`);
const counts=new Map();
for(const e of emitters)counts.set(e.kind,(counts.get(e.kind)||0)+1);
if(counts.get(1)!==7||counts.get(4)!==1||counts.get(8)!==8)throw new Error(`unexpected kind counts: ${JSON.stringify(Object.fromEntries(counts))}`);
for(const e of emitters){
  const expected=e.kind===1?0xF0:e.kind===4?0xF8:0xDC;
  if(e.binarySize!==expected)throw new Error(`${e.name}: wrong PEMT size 0x${e.binarySize.toString(16)}`);
}
const byName=new Map(emitters.map(e=>[e.name,e]));
for(const name of [
  'hopper_opening01Emitter','hopper_e_stamp01Emitter','hopper_e_star01Emitter','hopper_e_star02Emitter',
  'hopper_e_headpat01Emitter','hopper_e_starshower00Emitter','hopper_e_starshower01Emitter',
  'hopper_e_starshower02Emitter','hopper_e_starshower03Emitter','hopper_e_starshower04Emitter',
  'hopper_e_goal01Emitter','hopper_e_goal02Emitter','hopper_e_goal03Emitter','hopper_e_goal04Emitter',
  'hopper_e_goal05Emitter','hopper_flooreffect01Emitter'
])if(!byName.has(name))throw new Error(`missing emitter ${name}`);

if(byName.get('hopper_e_goal05Emitter').offset>0x10000)throw new Error('goal05 should verify the non-sequential PEMT layout in this prototype');
if(byName.get('hopper_e_headpat01Emitter').kind!==4)throw new Error('headpat kind mismatch');
if(byName.get('hopper_e_starshower00Emitter').common.valueD4!==1000)throw new Error('starshower00 common field mismatch');

console.log(emitters.map(e=>({name:e.name,offset:'0x'+e.offset.toString(16),kind:e.kind,size:'0x'+e.binarySize.toString(16),d4:e.common.valueD4})));
console.log('prototype PEMT parser OK');
