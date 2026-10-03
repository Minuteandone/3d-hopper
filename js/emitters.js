import { prototypeDictionary } from './models.js';

const td = new TextDecoder();

function bytesOf(input){return input instanceof Uint8Array?input:new Uint8Array(input);}
function viewOf(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function u32(view,off){return view.getUint32(off,true);}
function f32(view,off){return view.getFloat32(off,true);}
function rel32(view,off){const r=u32(view,off);return r?off+r:0;}
function cstr(bytes,off){if(!off||off<0||off>=bytes.length)return '';let end=off;while(end<bytes.length&&bytes[end]!==0)end++;return td.decode(bytes.subarray(off,end));}
function fourcc(bytes,off){if(off<0||off+4>bytes.length)return '';return String.fromCharCode(...bytes.subarray(off,off+4));}
function checked(bytes,off,len,label){if(off<0||len<0||off+len>bytes.length)throw new Error(`${label} outside CGFX at 0x${off.toString(16)}.`);}

const PEMT_SIZE_BY_KIND = new Map([
  [8, 0xDC],
  [1, 0xF0],
  [4, 0xF8],
]);

function vec3(view,off){return [f32(view,off),f32(view,off+4),f32(view,off+8)];}

/**
 * Parse the early 2010 NintendoWare PEMT objects used by 3D Hopper.
 *
 * Only fields whose structure is currently proven are named. The emitter-specific
 * tail is retained as raw u32/f32 words so later reverse-engineering can add
 * semantics without changing binary boundaries or guessing.
 */
export function parseEmitter(input,offset){
  const bytes=bytesOf(input),view=viewOf(bytes);
  checked(bytes,offset,0xDC,'PEMT');
  if(fourcc(bytes,offset+4)!=='PEMT')throw new Error(`PEMT missing at 0x${offset.toString(16)}.`);

  const kind=u32(view,offset+0xD8);
  const binarySize=PEMT_SIZE_BY_KIND.get(kind);
  if(!binarySize)throw new Error(`Unsupported Hopper PEMT kind ${kind} at 0x${offset.toString(16)}.`);
  checked(bytes,offset,binarySize,'PEMT object');

  const tailWords=[];
  for(let p=offset+0xDC;p<offset+binarySize;p+=4){
    tailWords.push({
      offset:p-offset,
      u32:u32(view,p),
      f32:f32(view,p),
    });
  }

  return {
    offset,
    binarySize,
    kind,
    name:cstr(bytes,rel32(view,offset+0x0C)),
    scale:vec3(view,offset+0x30),
    rotation:vec3(view,offset+0x3C),
    translation:vec3(view,offset+0x48),
    common:{
      valueB4:u32(view,offset+0xB4),
      valueB8:u32(view,offset+0xB8),
      valueBC:u32(view,offset+0xBC),
      valueC0u32:u32(view,offset+0xC0),
      valueC0f32:f32(view,offset+0xC0),
      valueC4:u32(view,offset+0xC4),
      valueC8:u32(view,offset+0xC8),
      valueCC:u32(view,offset+0xCC),
      valueD0:u32(view,offset+0xD0),
      valueD4:u32(view,offset+0xD4),
    },
    tailWords,
  };
}

export function parseEmitters(input){
  const bytes=bytesOf(input);
  return prototypeDictionary(bytes,11).map(entry=>{
    const emitter=parseEmitter(bytes,entry.offset);
    if(entry.name&&emitter.name&&entry.name!==emitter.name){
      throw new Error(`PEMT dictionary/name mismatch: ${entry.name} != ${emitter.name}.`);
    }
    return {...emitter,name:entry.name||emitter.name};
  });
}

export function emitterMapFromRom(rom){
  const map=new Map();
  if(!rom.has('gfx/hopper_effect.bcmdl'))return map;
  for(const emitter of parseEmitters(rom.get('gfx/hopper_effect.bcmdl'))){
    map.set(emitter.name,{...emitter,source:'gfx/hopper_effect.bcmdl'});
  }
  return map;
}
