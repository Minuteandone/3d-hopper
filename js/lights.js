import { prototypeDictionary } from './models.js';

const td=new TextDecoder();

function bytesOf(input){return input instanceof Uint8Array?input:new Uint8Array(input);}
function viewOf(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function fourcc(bytes,o){return o>=0&&o+4<=bytes.length?String.fromCharCode(...bytes.subarray(o,o+4)):'';}
function u32(v,o){return v.getUint32(o,true);}
function f32(v,o){return v.getFloat32(o,true);}
function rel32(v,o){const r=u32(v,o);return r?o+r:0;}
function cstr(bytes,o){if(!o||o<0||o>=bytes.length)return '';let e=o;while(e<bytes.length&&bytes[e])e++;return td.decode(bytes.subarray(o,e));}
function checked(bytes,o,n,label){if(o<0||n<0||o+n>bytes.length)throw new Error(`${label} outside CFLT data.`);}
function color4(view,o){return [f32(view,o),f32(view,o+4),f32(view,o+8),f32(view,o+12)];}

/**
 * Parse the revision-4 CFLT layout used by the June 2010 Hopper prototype.
 *
 * Revision 4 predates the later NintendoWare CFLT layout by four bytes in the
 * transform/light boundary. The color/light tail in this build begins at:
 *   +0xB0 enabled, +0xB4 kind, +0xB8 ambient,
 *   +0xC8 diffuse, +0xD8 spec0, +0xE8 spec1,
 *   +0xF8 packed colors, +0x108 direction.
 *
 * This is intentionally strict and is NOT a generic modern-CGFX CFLT parser.
 */
export function parsePrototypeFragmentLight(input,offset){
  const bytes=bytesOf(input),view=viewOf(bytes);
  checked(bytes,offset,0x124,'prototype CFLT');
  if(fourcc(bytes,offset+4)!=='CFLT')throw new Error(`CFLT missing at 0x${offset.toString(16)}.`);
  const revision=u32(view,offset+8);
  if(revision!==0x04000000)throw new Error(`Unsupported prototype CFLT revision 0x${revision.toString(16)}.`);

  const direction=[f32(view,offset+0x108),f32(view,offset+0x10c),f32(view,offset+0x110)];
  return {
    offset,
    revision,
    name:cstr(bytes,rel32(view,offset+0x0c)),
    enabled:u32(view,offset+0xb0)!==0,
    lightType:u32(view,offset+0xb4),
    ambient:color4(view,offset+0xb8),
    diffuse:color4(view,offset+0xc8),
    specular0:color4(view,offset+0xd8),
    specular1:color4(view,offset+0xe8),
    packed:{
      ambient:u32(view,offset+0xf8),
      diffuse:u32(view,offset+0xfc),
      specular0:u32(view,offset+0x100),
      specular1:u32(view,offset+0x104),
    },
    direction,
    directionLength:Math.hypot(...direction),
    distanceSamplerOffset:rel32(view,offset+0x114),
    angleSamplerOffset:rel32(view,offset+0x118),
    attenuationScaleBits:u32(view,offset+0x11c),
    attenuationBiasBits:u32(view,offset+0x120),
  };
}

export function parsePrototypeFragmentLights(input){
  const bytes=bytesOf(input);
  return prototypeDictionary(bytes,6).map(entry=>{
    const light=parsePrototypeFragmentLight(bytes,entry.offset);
    if(entry.name&&light.name&&entry.name!==light.name)throw new Error(`CFLT dictionary/name mismatch: ${entry.name} != ${light.name}`);
    return {...light,name:entry.name||light.name};
  });
}

export function fragmentLightMapFromRom(rom){
  const map=new Map();
  if(!rom.has('gfx/hopper_misc.bcmdl'))return map;
  for(const light of parsePrototypeFragmentLights(rom.get('gfx/hopper_misc.bcmdl')))map.set(light.name,{...light,source:'gfx/hopper_misc.bcmdl'});
  return map;
}
