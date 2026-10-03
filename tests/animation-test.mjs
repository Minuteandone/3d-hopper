import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { parseModels } from '../js/models.js';
import { parseSkeletalAnimations, sampleTransformTrack } from '../js/animation.js';

const path=process.argv[2];
if(!path)throw new Error('usage: node tests/animation-test.mjs /path/to/3D_Hopper.app');
const b=fs.readFileSync(path),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const rom=new HopperRom(ab),bytes=rom.get('gfx/hopper_cat.bcmdl');
const animations=parseSkeletalAnimations(bytes),models=parseModels(bytes);
if(animations.length!==1)throw new Error(`expected 1 skeletal animation, got ${animations.length}`);
const a=animations[0];
if(a.name!=='neko_hopping_jump'||a.frameCount!==48||a.tracks.length!==18)throw new Error('animation header mismatch');
let curves=0;
for(const t of a.tracks)for(const g of [t.scale,t.rotation,t.translation])for(const v of g)if(v?.kind==='curve'){
  curves++;
  if(v.curve.segments.length!==1||v.curve.segments[0].quantization!=='Hermite128')throw new Error('unexpected curve encoding');
}
if(curves!==59)throw new Error(`expected 59 Hermite curves, got ${curves}`);
const root=a.tracks.find(t=>t.path==='rootJt');
if(root.rotation[0].kind!=='absent'||root.rotation[1].kind!=='constant'||root.rotation[2].kind!=='absent')throw new Error('root rotation flags decoded incorrectly');
const body=a.tracks.find(t=>t.path==='hopping_bodyPg');
if(body.translation[0].kind!=='constant'||body.translation[1].kind!=='curve'||body.translation[2].kind!=='constant')throw new Error('body translation flags decoded incorrectly');
const shoulder=a.tracks.find(t=>t.path==='shoulderLJt');
if(!shoulder.rotation.every(v=>v.kind==='curve')||!shoulder.translation.every(v=>v.kind==='constant'))throw new Error('shoulder flags decoded incorrectly');
const model=models.find(m=>m.name==='neko_hopping_model'),bone=model.skeleton.bones.find(b=>b.name==='hopping_bodyPg');
const f0=sampleTransformTrack(body,0,bone),f24=sampleTransformTrack(body,24,bone);
if(Math.abs(f0.translation[1]-(-0.572205))>.01)throw new Error(`body frame0 unexpected ${f0.translation[1]}`);
if(Math.abs(f24.translation[1]-0.1408)>.01)throw new Error(`body frame24 unexpected ${f24.translation[1]}`);
console.log({name:a.name,frames:a.frameCount,tracks:a.tracks.length,curves,rootStates:root.rotation.map(v=>v.kind),bodyY0:f0.translation[1],bodyY24:f24.translation[1]});
console.log('prototype CANM transform animation parser OK');
