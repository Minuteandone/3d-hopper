import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { bcsarFromRom } from '../js/bcsar.js';

const path=process.argv[2];
if(!path)throw new Error('usage: node tests/bcsar-test.mjs /path/to/3D_Hopper.app');
const b=fs.readFileSync(path),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const rom=new HopperRom(ab),cat=bcsarFromRom(rom);

if(cat.strings.length!==408)throw new Error(`expected 408 BCSAR strings, got ${cat.strings.length}`);
if(cat.files.length!==23)throw new Error(`expected 23 BCSAR files, got ${cat.files.length}`);
if(cat.sounds.length!==386)throw new Error(`expected 386 BCSAR sounds, got ${cat.sounds.length}`);

const expect=(name,index,fileId,type)=>{
  const s=cat.byName.get(name);
  if(!s)throw new Error(`missing sound ${name}`);
  if(s.index!==index||s.fileId!==fileId||s.type!==type)throw new Error(`${name} catalog mismatch`);
  return s;
};
expect('DUMMY_LOOPED',0,0,0x2201);
expect('HOPPER_BGM_CONGRATS',1,1,0x2201);
expect('HOPPER_BGM_STAGE_CLEAR_RISE',2,2,0x2201);
const stage=expect('BGM_STAGE',20,5,0x2203);
if(stage.sequenceOffset!==3||stage.bankReferences.length!==1||stage.bankReferences[0]!==0x03000002)throw new Error('BGM_STAGE sequence/bank mapping mismatch');
expect('HOPPER_SE_JUMP',6,3,0x2203);
expect('HOPPER_SE_GOAL',13,4,0x2203);
expect('HOPPER_SE_FALLING',14,4,0x2203);
expect('HOPPER_SE_RESTART',15,4,0x2203);
for(const [name,index] of [['HOPPER_SE_LAND_GREEN',16],['HOPPER_SE_LAND_ORANGE',17],['HOPPER_SE_LAND_BLUE',18],['HOPPER_SE_LAND_PINK',19]])expect(name,index,4,0x2203);

if(cat.files[0].path!=='stream/DUMMY_LOOPED.bcstm'||cat.files[1].path!=='stream/HOPPER_BGM_CONGRATS.bcstm'||cat.files[2].path!=='stream/HOPPER_BGM_STAGE_CLEAR_RISE.bcstm')throw new Error('external stream file table mismatch');
if(!cat.files[5].internal||cat.files[5].size!==9728)throw new Error('BGM_STAGE internal CSEQ file entry mismatch');

console.log({strings:cat.strings.length,files:cat.files.length,sounds:cat.sounds.length,stageMusic:stage});
console.log('BCSAR catalog parser OK');
