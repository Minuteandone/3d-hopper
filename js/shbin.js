import { prototypeDictionary } from './models.js';

const td=new TextDecoder();

function bytesOf(input){return input instanceof Uint8Array?input:new Uint8Array(input);}
function viewOf(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function fourcc(bytes,o){return o>=0&&o+4<=bytes.length?String.fromCharCode(...bytes.subarray(o,o+4)):'';}
function u8(bytes,o){return bytes[o];}
function u16(view,o){return view.getUint16(o,true);}
function u32(view,o){return view.getUint32(o,true);}
function rel(base,offset){return base+offset;}
function checked(bytes,o,n,label){if(o<0||n<0||o+n>bytes.length)throw new Error(`${label} outside shader binary.`);}
function cstr(bytes,o,max=0x400){
  checked(bytes,o,0,'shader symbol');
  let e=o,limit=Math.min(bytes.length,o+max);
  while(e<limit&&bytes[e])e++;
  return td.decode(bytes.subarray(o,e));
}
function rel32(view,field){const r=u32(view,field);return r?field+r:0;}

const OUTPUT_NAMES=new Map([
  [0,'position'],[1,'normalquat'],[2,'color'],[3,'texcoord0'],
  [4,'texcoord0w'],[5,'texcoord1'],[6,'texcoord2'],[8,'view'],
]);

function registerName(index){
  if(index<=0x0f)return `v${index}`;
  if(index>=0x10&&index<=0x6f)return `c${index-0x10}`;
  if(index>=0x70&&index<=0x73)return `i${index-0x70}`;
  if(index>=0x78&&index<=0x87)return `b${index-0x78}`;
  return `r0x${index.toString(16)}`;
}

function parseDvle(bytes,view,dvlbOffset,offset,index){
  checked(bytes,offset,0x40,'DVLE');
  if(fourcc(bytes,offset)!=='DVLE')throw new Error(`DVLE missing at 0x${offset.toString(16)}.`);
  const outputOffset=rel(offset,u32(view,offset+0x28));
  const outputCount=u32(view,offset+0x2c);
  const labelOffset=rel(offset,u32(view,offset+0x20));
  const labelCount=u32(view,offset+0x24);
  const symbolOffset=rel(offset,u32(view,offset+0x38));
  const symbolSize=u32(view,offset+0x3c);
  checked(bytes,symbolOffset,symbolSize,'DVLE symbol table');

  const labels=[];
  for(let i=0;i<labelCount;i++){
    const o=labelOffset+i*0x10;checked(bytes,o,0x10,'DVLE label');
    const id=u16(view,o),unknown=u16(view,o+2),programOffsetWords=u32(view,o+4),programWords=u32(view,o+8),nameOffset=u32(view,o+0x0c);
    labels.push({
      id,unknown,programOffsetWords,programWords,
      name:cstr(bytes,symbolOffset+nameOffset,Math.max(1,symbolSize-nameOffset)),
    });
  }

  const outputs=[];
  for(let i=0;i<outputCount;i++){
    const o=outputOffset+i*8;checked(bytes,o,8,'DVLE output');
    const type=u16(view,o),register=u16(view,o+2),mask=u16(view,o+4),unknown=u16(view,o+6);
    outputs.push({type,name:OUTPUT_NAMES.get(type)??`unknown_${type}`,register,mask,unknown});
  }

  const uniformOffset=rel(offset,u32(view,offset+0x30));
  const uniformCount=u32(view,offset+0x34),uniforms=[];
  for(let i=0;i<uniformCount;i++){
    const o=uniformOffset+i*8;checked(bytes,o,8,'DVLE uniform');
    const nameOffset=u32(view,o),start=u16(view,o+4),end=u16(view,o+6);
    const name=cstr(bytes,symbolOffset+nameOffset,Math.max(1,symbolSize-nameOffset));
    uniforms.push({name,start,end,startRegister:registerName(start),endRegister:registerName(end)});
  }

  return {
    index,offset,
    version:u16(view,offset+4),
    shaderType:u8(bytes,offset+6),
    mergeOutmaps:u8(bytes,offset+7)!==0,
    mainOffsetWords:u32(view,offset+8),
    endMainOffsetWords:u32(view,offset+0x0c),
    inputMask:u16(view,offset+0x10),
    outputMask:u16(view,offset+0x12),
    labels,outputs,uniforms,
    symbolOffset,symbolSize,
  };
}

export function parseDvlib(input,dvlbOffset){
  const bytes=bytesOf(input),view=viewOf(bytes);
  checked(bytes,dvlbOffset,8,'DVLB');
  if(fourcc(bytes,dvlbOffset)!=='DVLB')throw new Error(`DVLB missing at 0x${dvlbOffset.toString(16)}.`);
  const executableCount=u32(view,dvlbOffset+4);
  const dvleOffsets=[];
  for(let i=0;i<executableCount;i++){
    const field=dvlbOffset+8+i*4;checked(bytes,field,4,'DVLE offset');
    dvleOffsets.push(rel(dvlbOffset,u32(view,field)));
  }
  const dvlpOffset=dvlbOffset+8+executableCount*4;
  checked(bytes,dvlpOffset,0x28,'DVLP');
  if(fourcc(bytes,dvlpOffset)!=='DVLP')throw new Error(`DVLP missing at 0x${dvlpOffset.toString(16)}.`);
  const dvlp={
    offset:dvlpOffset,
    version:u32(view,dvlpOffset+4),
    programOffset:rel(dvlpOffset,u32(view,dvlpOffset+8)),
    programWords:u32(view,dvlpOffset+0x0c),
    operandOffset:rel(dvlpOffset,u32(view,dvlpOffset+0x10)),
    operandCount:u32(view,dvlpOffset+0x14),
    symbolOffset:rel(dvlpOffset,u32(view,dvlpOffset+0x20)),
    symbolSize:u32(view,dvlpOffset+0x24),
  };
  const executables=dvleOffsets.map((o,i)=>parseDvle(bytes,view,dvlbOffset,o,i));
  return {offset:dvlbOffset,executableCount,dvlp,executables};
}

export function parseBinaryShader(input,offset){
  const bytes=bytesOf(input),view=viewOf(bytes);
  checked(bytes,offset,0x38,'prototype binary SHDR');
  if(fourcc(bytes,offset+4)!=='SHDR')throw new Error(`SHDR missing at 0x${offset.toString(16)}.`);
  const name=cstr(bytes,rel32(view,offset+0x0c));
  // Hopper's revision-3 binary SHDR places its embedded DVLB at +0x38.
  const dvlbOffset=offset+0x38;
  return {
    offset,
    type:u32(view,offset),
    revision:u32(view,offset+8),
    name,
    library:parseDvlib(bytes,dvlbOffset),
  };
}

export function parseBinaryShaders(input){
  const bytes=bytesOf(input);
  return prototypeDictionary(bytes,4).map(entry=>{
    const shader=parseBinaryShader(bytes,entry.offset);
    if(entry.name&&shader.name&&entry.name!==shader.name)
      throw new Error(`Binary SHDR dictionary/name mismatch: ${entry.name} != ${shader.name}.`);
    return {...shader,name:entry.name||shader.name};
  });
}

export function binaryShaderMapFromRom(rom){
  const out=new Map();
  for(const path of ['gfx/hopper_cat.bcmdl','gfx/hopper_effect.bcmdl','gfx/hopper_map_floor01.bcmdl','gfx/hopper_map_floor02.bcmdl','gfx/hopper_misc.bcmdl','gfx/hopper_title.bcmdl']){
    if(!rom.has(path))continue;
    for(const shader of parseBinaryShaders(rom.get(path))){
      if(!out.has(shader.name))out.set(shader.name,{...shader,source:path});
    }
  }
  return out;
}
