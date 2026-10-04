import { prototypeDictionary, parseDict } from './models.js';

const td=new TextDecoder();

function bytesOf(input){return input instanceof Uint8Array?input:new Uint8Array(input);}
function viewOf(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function fourcc(bytes,o){return o>=0&&o+4<=bytes.length?String.fromCharCode(...bytes.subarray(o,o+4)):'';}
function u32(v,o){return v.getUint32(o,true);}
function f32(v,o){return v.getFloat32(o,true);}
function rel32(v,o){const r=u32(v,o);return r?o+r:0;}
function cstr(bytes,o){if(!o||o<0||o>=bytes.length)return '';let e=o;while(e<bytes.length&&bytes[e])e++;return td.decode(bytes.subarray(o,e));}
function checked(bytes,o,n,label){if(o<0||n<0||o+n>bytes.length)throw new Error(`${label} outside LUTS data.`);}

/**
 * Parse the revision-2 lookup-table sampler used by Hopper.
 *
 * This prototype stores three contiguous payloads:
 *   +0x28 : 256 authored float samples
 *   slopes pointer : 256 float deltas
 *   command pointer: 0x408-byte PICA LUT command stream
 *
 * Later CGFX revisions dropped these direct float arrays and use a different
 * object discriminator, so this intentionally does not pretend to be generic.
 */
export function parsePrototypeLutSampler(input,offset){
  const bytes=bytesOf(input),view=viewOf(bytes);
  checked(bytes,offset,0xc30,'prototype LUT sampler');
  const type=u32(view,offset);
  if(type!==1)throw new Error(`Unsupported prototype LUT sampler type ${type} at 0x${offset.toString(16)}.`);

  const slopesOffset=rel32(view,offset+0x20);
  const commandsOffset=rel32(view,offset+0x24);
  const samplesOffset=offset+0x28;
  if(slopesOffset-samplesOffset!==0x400||commandsOffset-slopesOffset!==0x400){
    throw new Error(`Unexpected prototype LUT payload layout at 0x${offset.toString(16)}.`);
  }
  checked(bytes,commandsOffset,0x408,'prototype LUT command stream');

  const samples=new Float32Array(256),deltas=new Float32Array(256);
  for(let i=0;i<256;i++){
    samples[i]=f32(view,samplesOffset+i*4);
    deltas[i]=f32(view,slopesOffset+i*4);
  }

  return {
    offset,type,
    name:cstr(bytes,rel32(view,offset+4)),
    absoluteRaw:u32(view,offset+8),
    absolute:u32(view,offset+8)!==0,
    headerWords:[
      u32(view,offset+0x0c),u32(view,offset+0x10),u32(view,offset+0x14),
      u32(view,offset+0x18),u32(view,offset+0x1c),
    ],
    samples,deltas,
    commands:bytes.slice(commandsOffset,commandsOffset+0x408),
  };
}

export function parsePrototypeLuts(input){
  const bytes=bytesOf(input),view=viewOf(bytes);
  const map=new Map();
  for(const entry of prototypeDictionary(bytes,2)){
    const o=entry.offset;
    checked(bytes,o,0x20,'prototype LUTS');
    if(fourcc(bytes,o+4)!=='LUTS')throw new Error(`LUTS missing at 0x${o.toString(16)}.`);
    const revision=u32(view,o+8);
    if(revision!==0x02000000)throw new Error(`Unsupported Hopper LUTS revision 0x${revision.toString(16)}.`);
    const name=cstr(bytes,rel32(view,o+0x0c));
    const count=u32(view,o+0x18),dict=rel32(view,o+0x1c);
    const tables=parseDict(bytes,dict).slice(0,count).map(t=>parsePrototypeLutSampler(bytes,t.offset));
    map.set(entry.name||name,{offset:o,revision,name:entry.name||name,tables});
  }
  // Keep return values simple/serializable while also offering name lookup.
  return [...map.values()].map(lut=>({
    ...lut,
    tableMap:new Map(lut.tables.map(table=>[table.name,table])),
  }));
}

export function prototypeLutMapFromRom(rom){
  const out=new Map();
  if(!rom.has('gfx/hopper_cat.bcmdl'))return out;
  for(const lut of parsePrototypeLuts(rom.get('gfx/hopper_cat.bcmdl')))out.set(lut.name,{...lut,source:'gfx/hopper_cat.bcmdl'});
  return out;
}

/**
 * Evaluate Hopper's revision-2 absolute LUT using the same logical mapping
 * SPICA uses when expanding it to a 512-entry signed texture:
 * negative inputs hold sample[0], positive inputs traverse samples[0..255].
 *
 * This helper deliberately supports only the absolute tables present in Hopper.
 */
export function samplePrototypeAbsoluteLut(table,input,scale=1){
  if(!table.absolute)throw new Error('Signed prototype LUT sampling is not implemented for this Hopper-only helper.');
  const x=Math.max(0,Math.min(1,input));
  // The native table is 256 samples over the non-negative half. Linear
  // interpolation mirrors the GPU's filtered lookup closely without inventing
  // a curve fit.
  const p=x*255,i=Math.floor(p),t=p-i;
  const a=table.samples[i],b=table.samples[Math.min(255,i+1)];
  return Math.min(a+(b-a)*t,1/scale)*scale;
}
