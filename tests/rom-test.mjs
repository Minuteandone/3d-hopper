import fs from 'node:fs';
import { HopperRom } from '../js/rom.js';
import { parseTextures, decodeTexture, textureMapFromRom } from '../js/cgfx.js';

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
console.log('ROM parser + CGFX texture decoder OK');
