import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { HopperRom } from '../js/rom.js';
import { parseTextures, decodeTexture, textureMapFromRom } from '../js/cgfx.js';
import { decodeBcstm } from '../js/audio.js';
import { parseModels } from '../js/models.js';

const path=process.argv[2];
if(!path) throw new Error('usage: node tests/rom-test.mjs /path/to/3D_Hopper.app');

const b=fs.readFileSync(path);
const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const rom=new HopperRom(ab);
console.log(rom.meta);
console.log(rom.list());
if(rom.files.size!==16) throw new Error(`expected 16 ROFS files, got ${rom.files.size}`);

const title=parseTextures(rom.get('gfx/hopper_title.bcmdl'));
if(title.length!==6) throw new Error(`expected 6 title textures, got ${title.length}`);
for(const t of title){
  const d=decodeTexture(t);
  if(d.data.length!==t.width*t.height*4) throw new Error(`bad decode ${t.name}`);
}

const all=textureMapFromRom(rom);
console.log('textures', [...all.values()].map(t=>`${t.name}:${t.width}x${t.height}/${t.formatName}`).join(', '));
if(all.size<20) throw new Error(`expected 20+ textures, got ${all.size}`);

const cat=parseModels(rom.get('gfx/hopper_cat.bcmdl')).find(m=>m.name==='neko_hopping_model');
if(!cat) throw new Error('neko_hopping_model missing');
if(cat.shapes.map(s=>s.vertexCount).join(',')!=='494,211,21') throw new Error('unexpected cat vertex counts');
if(cat.skeleton?.bones.length!==24) throw new Error(`expected 24 cat bones, got ${cat.skeleton?.bones.length??0}`);
if(cat.materials[0]?.textureRefs[0]!=='hopping'||!cat.materials[1]?.textureRefs.includes('nekopper')) throw new Error('cat material texture references were not recovered');
if(cat.materials[0]?.blend?.colorSource!==1||cat.materials[0]?.blend?.colorDestination!==0) throw new Error('hopping material blend state mismatch');
if(cat.materials[1]?.blend?.colorSource!==1||cat.materials[1]?.blend?.colorDestination!==0) throw new Error('nekopper material blend state mismatch');
if(cat.materials[0]?.rasterization?.cullMode!==2||cat.materials[1]?.rasterization?.cullMode!==2) throw new Error('cat culling mode mismatch');
if(cat.materials[0]?.depth?.flags!==3||!cat.materials[0].depth.testEnabled||!cat.materials[0].depth.writeEnabled)throw new Error('cat depth state mismatch');
if(cat.materials[1]?.depth?.flags!==3||!cat.materials[1].depth.testEnabled||!cat.materials[1].depth.writeEnabled)throw new Error('nekopper depth state mismatch');
if(cat.materials[0]?.visibleColorMapper!==0||cat.materials[1]?.visibleColorMapper!==1) throw new Error('cat TexEnv visible mapper selection mismatch');
const hopMapper=cat.materials[0]?.textureMappers?.[0];
if(hopMapper?.textureName!=='hopping'||hopMapper.config!==0x2206||hopMapper.wrapS!==2||hopMapper.wrapT!==2||hopMapper.minFilter!==1||hopMapper.magFilter!==1)throw new Error('hopping sampler state mismatch');
const nekoMapper=cat.materials[1]?.textureMappers?.[1];
if(nekoMapper?.textureName!=='nekopper'||nekoMapper.config!==0x2200||nekoMapper.wrapS!==2||nekoMapper.wrapT!==2||nekoMapper.minFilter!==0||nekoMapper.magFilter!==0)throw new Error('nekopper sampler state mismatch');
const hoppingMat=cat.materials[0],nekopperMat=cat.materials[1];
if(hoppingMat.visibleColorMapper!==0||nekopperMat.visibleColorMapper!==1)throw new Error('cat visible color mapper must come from TexEnv');
if(hoppingMat.texCoordConfig!==0||nekopperMat.texCoordConfig!==3)throw new Error('cat texture-coordinate config mismatch');
const hopCoord=hoppingMat.visibleTextureCoordinate,nekoCoord=nekopperMat.visibleTextureCoordinate;
if(!hopCoord||hopCoord.sourceCoordinate!==0||hopCoord.mappingMethod!==0)throw new Error('hopping visible texture coordinate mismatch');
if(!nekoCoord||nekoCoord.sourceCoordinate!==0||nekoCoord.mappingMethod!==0||nekoCoord.referenceCamera!==-1)throw new Error('nekopper visible texture coordinate mismatch');
const identity34=[1,0,0,0,0,1,0,0,0,0,1,0];
for(const [name,coord] of [['hopping',hopCoord],['nekopper',nekoCoord]])
  for(let i=0;i<12;i++)if(Math.abs(coord.matrix[i]-identity34[i])>1e-6)throw new Error(`${name} visible texture matrix mismatch at ${i}`);
if(Math.abs(nekopperMat.textureCoordinators[0].rotate-1.1170107126)>1e-6)throw new Error('nekopper mask-coordinate rotation mismatch');
const hoppingStage0=hoppingMat.fragmentShader?.stages?.[0];
if(hoppingStage0?.colorMode!==3||hoppingStage0?.alphaMode!==1||
   JSON.stringify(hoppingStage0.colorSources.slice(0,2))!=='[1,3]'||
   JSON.stringify(hoppingStage0.alphaSources.slice(0,2))!=='[0,3]')throw new Error('hopping TexEnv stage 0 mismatch');
const nekoStage0=nekopperMat.fragmentShader?.stages?.[0];
const nekoStage1=nekopperMat.fragmentShader?.stages?.[1];
if(nekoStage0?.colorMode!==3||nekoStage0?.alphaMode!==1||
   JSON.stringify(nekoStage0.colorSources.slice(0,2))!=='[1,4]'||
   JSON.stringify(nekoStage0.alphaSources.slice(0,2))!=='[0,3]')throw new Error('nekopper TexEnv stage 0 mismatch');
if(nekoStage1?.colorMode!==2||nekoStage1?.alphaMode!==2||
   JSON.stringify(nekoStage1.colorSources.slice(0,2))!=='[2,15]'||
   JSON.stringify(nekoStage1.alphaSources.slice(0,2))!=='[15,3]')throw new Error('nekopper TexEnv stage 1 mismatch');
if(hoppingMat.fragmentShader?.alphaTest?.enabled||nekopperMat.fragmentShader?.alphaTest?.enabled)throw new Error('cat alpha test should be disabled');

if(cat.shapes.map(s=>s.primitiveSets.map(p=>p.skinningMode)).flat().join(',')!=='2,2,2,0,0') throw new Error('cat skinning modes mismatch');
const catSets=cat.shapes.flatMap((shape,shapeIndex)=>shape.primitiveSets.map(ps=>({shapeIndex,shape,ps})));
for(const {shapeIndex,shape,ps} of catSets){
  const hasBoneIndex=shape.byUsage.has(7),hasBoneWeight=shape.byUsage.has(8);
  if(ps.skinningMode===2&&(!hasBoneIndex||!hasBoneWeight))throw new Error(`shape ${shapeIndex}: smooth skinning lacks bone streams`);
  if(ps.skinningMode===0&&(hasBoneIndex||hasBoneWeight))throw new Error(`shape ${shapeIndex}: non-smooth primitive unexpectedly has bone streams`);
}
if(JSON.stringify(cat.shapes[1].primitiveSets[0].relatedBones)!=='[2]'||
   JSON.stringify(cat.shapes[2].primitiveSets[0].relatedBones)!=='[23]')throw new Error('single-bone primitive palettes mismatch');
const expectedShapeOffsets=[
  [0.0000080125,2.42500997,-0.286096007],
  [-0.00603182,2.50541997,0.0272913],
  [0,0.46392599,0],
];
for(let i=0;i<3;i++)for(let axis=0;axis<3;axis++)
  if(Math.abs(cat.shapes[i].positionOffset[axis]-expectedShapeOffsets[i][axis])>1e-5)
    throw new Error(`shape ${i} position offset mismatch`);

for(const shape of cat.shapes)for(const ps of shape.primitiveSets)for(const prim of ps.primitives)for(const stream of prim.indexStreams)if(stream.primitiveMode!==0)throw new Error('unexpected cat primitive mode');
const floor1=parseModels(rom.get('gfx/hopper_map_floor01.bcmdl')).find(m=>m.name==='hopper_floor01_model');
const floor2=parseModels(rom.get('gfx/hopper_map_floor02.bcmdl')).find(m=>m.name==='hopper_floor02_model');
for(const floor of [floor1,floor2]){
  if(!floor)throw new Error('floor model missing');
  if(floor.materials[0]?.rasterization?.cullMode!==2)throw new Error(`${floor.name}: expected back-face culling`);
  if(floor.materials[0]?.depth?.flags!==3||!floor.materials[0].depth.testEnabled||!floor.materials[0].depth.writeEnabled)throw new Error(`${floor.name}: floor depth state mismatch`);
  const blend=floor.materials[0]?.blend;
  if(blend?.colorSource!==6||blend?.colorDestination!==7)throw new Error(`${floor.name}: expected SRC_ALPHA/ONE_MINUS_SRC_ALPHA blend state`);
  const mapper=floor.materials[0]?.textureMappers?.[0];
  if(mapper?.config!==0x6||mapper.wrapS!==0||mapper.wrapT!==0||mapper.minFilter!==1||mapper.magFilter!==1)throw new Error(`${floor.name}: floor sampler state mismatch`);
}

const titleModels=parseModels(rom.get('gfx/hopper_title.bcmdl'));
for(const name of ['title_model','pressA_model','congratulations_model']){
  const model=titleModels.find(m=>m.name===name);
  if(!model)throw new Error(`${name} missing`);
  const depth=model.materials[0]?.depth;
  if(depth?.flags!==1||!depth.testEnabled||depth.writeEnabled)throw new Error(`${name}: expected depth-test without depth-write`);
}

for(const modelPath of ['gfx/hopper_cat.bcmdl','gfx/hopper_map_floor01.bcmdl','gfx/hopper_map_floor02.bcmdl','gfx/hopper_title.bcmdl']){
  for(const model of parseModels(rom.get(modelPath))){
    for(const shape of model.shapes){
      for(const ps of shape.primitiveSets) for(const prim of ps.primitives) for(const stream of prim.indexStreams){
        const max=Math.max(...stream.indices);
        if(max>=shape.vertexCount) throw new Error(`${model.name}: index ${max} >= ${shape.vertexCount}`);
      }
    }
  }
}

const pcmHash=channel=>{
  const bytes=Buffer.allocUnsafe(channel.length*2);
  for(let i=0;i<channel.length;i++)bytes.writeInt16LE(channel[i],i*2);
  return createHash('sha256').update(bytes).digest('hex');
};
const bgm=decodeBcstm(rom.get('sound/stream/DUMMY_LOOPED.bcstm'));
if(bgm.sampleRate!==32000||bgm.channels.length!==2||bgm.sampleCount!==245760||!bgm.loop||bgm.seekInterval!==14336) throw new Error('unexpected looping BCSTM metadata');
if(pcmHash(bgm.channels[0])!=='364e599b154e5f930f7ace4879c6bfe978e90967e3dbc1d948d3e4bfbe67ff3a'||pcmHash(bgm.channels[1])!=='6f03896aeb84f3d0df18e38500cef052327a5acccbffd443c3296704c2c6e522')throw new Error('looping BCSTM PCM does not match SEEK-aware DSP decode');
const congrats=decodeBcstm(rom.get('sound/stream/HOPPER_BGM_CONGRATS.bcstm'));
if(congrats.sampleRate!==32000||congrats.channels.length!==2||congrats.sampleCount!==465610||congrats.loop||congrats.seekInterval!==14336) throw new Error('unexpected congratulations BCSTM metadata');
if(pcmHash(congrats.channels[0])!=='fd0a9d1a093a2bccd5d1b89f6b9cc7ec8af2cc2564c582a1fec737a242f5307e'||pcmHash(congrats.channels[1])!=='a2e990aeecef8e28bf85c4decb18574f8d78427c545d94405acc97d4271c68fe')throw new Error('congratulations BCSTM PCM does not match SEEK-aware DSP decode');

console.log('ROM + textures + actual BCMDL models/skeletons + BCSTM audio OK');
