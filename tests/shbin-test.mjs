import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { parseBinaryShaders } from '../js/shbin.js';

const path=process.argv[2];
if(!path)throw new Error('usage: node tests/shbin-test.mjs /path/to/3D_Hopper.app');
const b=fs.readFileSync(path),ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const rom=new HopperRom(ab),shaders=parseBinaryShaders(rom.get('gfx/hopper_cat.bcmdl'));

if(shaders.length!==2)throw new Error(`expected 2 cat binary shaders, got ${shaders.length}`);
if(shaders[0].name!=='DefaultShader'||shaders[1].name!=='ParticleDefaultShader')
  throw new Error(`unexpected cat shader names ${shaders.map(s=>s.name).join(',')}`);

const shader=shaders[0],lib=shader.library;
if(shader.revision!==0x03000000)throw new Error(`DefaultShader revision mismatch 0x${shader.revision.toString(16)}`);
if(lib.executableCount!==3)throw new Error(`DefaultShader DVLE count mismatch ${lib.executableCount}`);
const v=lib.executables[0];
if(v.shaderType!==0||v.inputMask!==0x0fff||v.outputMask!==0x007f)
  throw new Error('DefaultShader program 0 masks/type mismatch');

const outputs=v.outputs.map(o=>[o.name,o.register,o.mask]);
const expected=[
  ['position',0,0xf],
  ['normalquat',1,0xf],
  ['view',2,0xf],
  ['color',3,0xf],
  ['texcoord0',4,0x3],
  ['texcoord0w',4,0x4],
  ['texcoord1',5,0x3],
  ['texcoord2',6,0x3],
];
if(JSON.stringify(outputs)!==JSON.stringify(expected))
  throw new Error(`DefaultShader output map mismatch ${JSON.stringify(outputs)}`);

const uniforms=new Map(v.uniforms.map(u=>[u.name,u]));
const expectUniform=(name,start,end=start)=>{
  const u=uniforms.get(name);
  if(!u||u.start!==start||u.end!==end)throw new Error(`${name} uniform mismatch: ${JSON.stringify(u)}`);
};
expectUniform('aPosition.xyz',0x00);
expectUniform('aNormal.xyz',0x01);
expectUniform('aTangent.xyz',0x02);
expectUniform('aColor',0x03);
expectUniform('aTexCoord0.xy',0x04);
expectUniform('aTexCoord1.xy',0x05);
expectUniform('aTexCoord2.xy',0x06);
expectUniform('aBoneIndex',0x07);
expectUniform('aBoneWeight',0x08);
expectUniform('ProjMtx',0x10,0x13);
expectUniform('ViewMtx',0x14,0x16);
expectUniform('WrldMtx',0x17,0x19);
expectUniform('PosOffs',0x1a);
expectUniform('TexMtx0',0x1f,0x21);
expectUniform('TexMtx1',0x22,0x24);
expectUniform('TexMtx2',0x25,0x27);
expectUniform('NormMtx',0x28,0x2a);

console.log({shader:shader.name,dvles:lib.executableCount,outputs,uniformCount:v.uniforms.length});
console.log('embedded DefaultShader DVLE metadata OK');
