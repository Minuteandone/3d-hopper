const td=new TextDecoder();

function bytesOf(input){return input instanceof Uint8Array?input:new Uint8Array(input);}
function viewOf(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function fourcc(bytes,o){return o>=0&&o+4<=bytes.length?String.fromCharCode(...bytes.subarray(o,o+4)):'';}
function u8(bytes,o){return bytes[o];}
function u16(v,o){return v.getUint16(o,true);}
function u32(v,o){return v.getUint32(o,true);}
function checked(bytes,o,n,label){if(o<0||n<0||o+n>bytes.length)throw new Error(`${label} is outside BCSAR.`);}
function cstr(bytes,o,max=bytes.length-o){checked(bytes,o,Math.max(0,Math.min(max,bytes.length-o)),'BCSAR string');let e=o,lim=Math.min(bytes.length,o+max);while(e<lim&&bytes[e])e++;return td.decode(bytes.subarray(o,e));}
function add(base,rel,bytes,label){const o=base+rel;checked(bytes,o,0,label);return o;}

function parseOffsetTable(bytes,view,table,expectedType){
  checked(bytes,table,4,'BCSAR table');const count=u32(view,table),out=[];
  for(let i=0;i<count;i++){
    const ref=table+4+i*8;checked(bytes,ref,8,'BCSAR table entry');
    if(u16(view,ref)!==expectedType)throw new Error(`Unexpected BCSAR table entry type 0x${u16(view,ref).toString(16)}.`);
    out.push(add(table,u32(view,ref+4),bytes,'BCSAR table target'));
  }
  return out;
}

export function parseBcsar(input){
  const bytes=bytesOf(input),view=viewOf(bytes);
  checked(bytes,0,0x20,'BCSAR header');
  if(fourcc(bytes,0)!=='CSAR'||u16(view,4)!==0xfeff)throw new Error('Not a little-endian NintendoWare BCSAR.');
  const sectionCount=u32(view,16),sections=new Map();
  for(let i=0;i<sectionCount;i++){
    const r=20+i*12;checked(bytes,r,12,'BCSAR section reference');
    sections.set(u16(view,r),{offset:u32(view,r+4),size:u32(view,r+8)});
  }
  const strg=sections.get(0x2000),info=sections.get(0x2001),file=sections.get(0x2002);
  if(!strg||!info||!file||fourcc(bytes,strg.offset)!=='STRG'||fourcc(bytes,info.offset)!=='INFO'||fourcc(bytes,file.offset)!=='FILE')throw new Error('BCSAR is missing STRG/INFO/FILE.');

  let stringTable=0;
  for(let i=0;i<2;i++){
    const r=strg.offset+8+i*8;checked(bytes,r,8,'STRG reference');
    if(u16(view,r)===0x2400)stringTable=add(r,u32(view,r+4),bytes,'BCSAR string table');
  }
  if(!stringTable)throw new Error('BCSAR string table missing.');
  const stringCount=u32(view,stringTable),strings=[];
  for(let i=0;i<stringCount;i++){
    const r=stringTable+4+i*12;checked(bytes,r,12,'BCSAR string ref');
    if(u16(view,r)!==0x1f01)throw new Error('Invalid BCSAR string reference.');
    strings.push(cstr(bytes,add(stringTable,u32(view,r+4),bytes,'BCSAR string'),u32(view,r+8)));
  }

  const tables=new Map();
  for(let i=0;i<8;i++){
    const r=info.offset+8+i*8;checked(bytes,r,8,'BCSAR INFO table ref');
    const type=u16(view,r);
    if(type!==0xffff)tables.set(type,add(info.offset+8,u32(view,r+4),bytes,'BCSAR INFO table'));
  }
  const fileTable=tables.get(0x2106),soundTable=tables.get(0x2100);
  if(!fileTable||!soundTable)throw new Error('BCSAR file/sound table missing.');

  const files=parseOffsetTable(bytes,view,fileTable,0x220a).map((o,index)=>{
    const type=u16(view,o);
    if(type===0x220d)return {index,type,internal:false,path:cstr(bytes,o+12)};
    if(type!==0x220c)throw new Error(`Unknown BCSAR file entry type 0x${type.toString(16)}.`);
    const subtype=u16(view,o+12),entry={index,type,internal:true,subtype};
    if(subtype!==0xffff){entry.offset=u32(view,o+16);entry.size=u32(view,o+20);}
    return entry;
  });

  const sounds=parseOffsetTable(bytes,view,soundTable,0x2200).map((o,index)=>{
    checked(bytes,o,24,'BCSAR sound entry');
    const fileId=u32(view,o),playerReference=u32(view,o+4),volume=u8(bytes,o+8),remoteFilter=u8(bytes,o+9),type=u16(view,o+12);
    const detail=add(o+16,u32(view,o+16),bytes,'BCSAR sound detail');
    const optionMask=u32(view,o+20),options=new Map();let p=o+24;
    for(let bit=0;bit<32;bit++)if(optionMask&(2**bit)){if(p+4>detail)throw new Error('BCSAR sound options overlap detail.');options.set(bit,u32(view,p));p+=4;}
    const nameId=options.get(0)??0xffffffff;
    const name=nameId!==0xffffffff&&nameId<strings.length?strings[nameId]:'';
    const sound={index,name,nameId,fileId,playerReference,volume,remoteFilter,type,optionMask,options};
    if(type===0x2203){
      sound.sequenceOffset=u32(view,detail);
      const bankCount=u32(view,detail+8);if(bankCount>4)throw new Error('BCSAR sequence bank list is too large.');
      sound.bankReferences=[];for(let i=0;i<bankCount;i++)sound.bankReferences.push(u32(view,detail+12+i*4));
    }
    return sound;
  });

  return {strings,files,sounds,byName:new Map(sounds.filter(s=>s.name).map(s=>[s.name,s])),sections};
}

export function bcsarFromRom(rom){
  return parseBcsar(rom.get('sound/cplay.bcsar'));
}
