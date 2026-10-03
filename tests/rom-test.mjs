import fs from 'node:fs';
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

const bgm=decodeBcstm(rom.get('sound/stream/DUMMY_LOOPED.bcstm'));
if(bgm.sampleRate!==32000||bgm.channels.length!==2||bgm.sampleCount!==245760||!bgm.loop) throw new Error('unexpected looping BCSTM metadata');
const congrats=decodeBcstm(rom.get('sound/stream/HOPPER_BGM_CONGRATS.bcstm'));
if(congrats.sampleRate!==32000||congrats.channels.length!==2||congrats.sampleCount!==465610||congrats.loop) throw new Error('unexpected congratulations BCSTM metadata');

console.log('ROM + textures + actual BCMDL models/skeletons + BCSTM audio OK');
