import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { liftHopperProgram, gridCoordinate } from '../js/executable.js';

const path=process.argv[2];
if(!path)throw new Error('usage: node tests/code-lift-test.mjs /path/to/3D_Hopper.app');
const b=fs.readFileSync(path);const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const rom=new HopperRom(ab);const p=liftHopperProgram(rom);
const close=(a,b,e=1e-5)=>Math.abs(a-b)<e;
if(p.build.sceneName!=='Game'||p.build.factoryAddress!==0x13ebd4)throw new Error('Game descriptor mismatch');
if(JSON.stringify(p.stages.map(s=>s.count))!=='[10,4,5,3]')throw new Error('stage counts mismatch');
for(const s of p.stages){
  if(!s.records.some(r=>r.type===2))throw new Error(`stage ${s.index} has no type-2 start floor`);
  if(!s.records.some(r=>r.type===3))throw new Error(`stage ${s.index} has no type-3 goal floor`);
}
if(!close(p.physics.gravityPerFrame,.012)||!close(p.physics.landingBouncePerFrame,.42)||!close(p.physics.airVelocityLerp,.03))throw new Error('physics constants mismatch');
if(!close(p.physics.movementRadius,4.25)||!close(p.physics.spawnClearance,7.35)||!close(p.physics.failY,-25))throw new Error('reset constants mismatch');
if(gridCoordinate(3,8,0)!==-8||gridCoordinate(3,8,1)!==0||gridCoordinate(3,8,2)!==8)throw new Error('translated grid math mismatch');
console.log(JSON.stringify({scene:p.build.sceneName,factory:`0x${p.build.factoryAddress.toString(16)}`,stageCounts:p.stages.map(s=>s.count),stageTypes:p.stages.map(s=>s.records.map(r=>r.type)),physics:p.physics},null,2));
console.log('ARM data/code lift OK');
