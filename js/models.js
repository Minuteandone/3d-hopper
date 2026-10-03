const td = new TextDecoder();

const DATA_TYPE_BYTES = new Map([
  [0x1400, 1],
  [0x1401, 1],
  [0x1402, 2],
  [0x1406, 4],
]);

export const VertexUsage = Object.freeze({
  Position: 0, Normal: 1, Tangent: 2, Color: 3,
  TextureCoordinate0: 4, TextureCoordinate1: 5, TextureCoordinate2: 6,
  BoneIndex: 7, BoneWeight: 8,
});

function bytesOf(input){return input instanceof Uint8Array?input:new Uint8Array(input);}
function viewOf(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function fourcc(bytes,off){if(off<0||off+4>bytes.length)return '';return String.fromCharCode(bytes[off],bytes[off+1],bytes[off+2],bytes[off+3]);}
function cstr(bytes,off){if(!off||off<0||off>=bytes.length)return '';let end=off;while(end<bytes.length&&bytes[end]!==0)end++;return td.decode(bytes.subarray(off,end));}
function u32(view,off){return view.getUint32(off,true);}
function s32(view,off){return view.getInt32(off,true);}
function u16(view,off){return view.getUint16(off,true);}
function s16(view,off){return view.getInt16(off,true);}
function f32(view,off){return view.getFloat32(off,true);}
function rel32(view,off){const rel=u32(view,off);return rel===0?0:off+rel;}
function checked(bytes,off,len,label){if(off<0||len<0||off+len>bytes.length)throw new Error(`${label} is outside the CGFX file (0x${off.toString(16)} + 0x${len.toString(16)}).`);}

export function parseDict(input,dictOffset){
  const bytes=bytesOf(input),view=viewOf(bytes);
  checked(bytes,dictOffset,0x1c,'DICT');
  if(fourcc(bytes,dictOffset)!=='DICT')throw new Error(`Expected DICT at 0x${dictOffset.toString(16)}.`);
  const count=u32(view,dictOffset+8),entries=[];
  for(let i=0;i<count;i++){
    const entry=dictOffset+0x1c+i*0x10;
    checked(bytes,entry,0x10,'DICT entry');
    const nameOffset=rel32(view,entry+8),dataOffset=rel32(view,entry+12);
    entries.push({name:cstr(bytes,nameOffset),offset:dataOffset});
  }
  return entries;
}

export function prototypeDictionary(input,index){
  const bytes=bytesOf(input),view=viewOf(bytes);
  if(fourcc(bytes,0)!=='CGFX')throw new Error('Not a CGFX/BCMDL file.');
  const descriptor=0x14+index*8;
  checked(bytes,descriptor,8,'CGFX dictionary descriptor');
  const count=u32(view,descriptor),offset=rel32(view,descriptor+4);
  if(!count||!offset||fourcc(bytes,offset)!=='DICT')return [];
  return parseDict(bytes,offset);
}

function readAttribute(bytes,view,offset){
  checked(bytes,offset,0x28,'vertex attribute');
  const type=u32(view,offset),usage=u32(view,offset+4),flags=u32(view,offset+8);
  const format=u32(view,offset+0x0c),components=u32(view,offset+0x10),scale=f32(view,offset+0x14),byteLength=u32(view,offset+0x18);
  const bytesPerComponent=DATA_TYPE_BYTES.get(format);
  if(!bytesPerComponent||!components)throw new Error(`Unsupported vertex format 0x${format.toString(16)} at 0x${offset.toString(16)}.`);
  const dataOffset=offset+0x28;
  checked(bytes,dataOffset,byteLength,'vertex data');
  const count=Math.floor(byteLength/(components*bytesPerComponent));
  const values=new Float32Array(count*components);
  let p=dataOffset;
  for(let i=0;i<values.length;i++){
    let value;
    switch(format){
      case 0x1400:value=view.getInt8(p);break;
      case 0x1401:value=view.getUint8(p);break;
      case 0x1402:value=view.getInt16(p,true);break;
      case 0x1406:value=view.getFloat32(p,true);break;
      default:value=0;
    }
    values[i]=value*scale;p+=bytesPerComponent;
  }
  return {offset,type,usage,flags,format,components,scale,byteLength,count,values};
}

function readIndexStream(bytes,view,offset){
  checked(bytes,offset,0x2c,'index stream');
  const format=u32(view,offset),primitiveMode=bytes[offset+4],visible=bytes[offset+5]!==0;
  const byteLength=u32(view,offset+8),dataOffset=rel32(view,offset+0x0c);
  checked(bytes,dataOffset,byteLength,'index data');
  let indices;
  if(format===0x1401)indices=Uint32Array.from(bytes.subarray(dataOffset,dataOffset+byteLength));
  else if(format===0x1403){const count=Math.floor(byteLength/2);indices=new Uint32Array(count);for(let i=0;i<count;i++)indices[i]=u16(view,dataOffset+i*2);}
  else throw new Error(`Unsupported index format 0x${format.toString(16)}.`);
  return {offset,format,primitiveMode,visible,byteLength,indices};
}

function readPrimitive(bytes,view,offset){
  checked(bytes,offset,0x10,'primitive');
  const indexStreamCount=u32(view,offset),indexStreamArray=rel32(view,offset+4);
  const bufferObjectCount=u32(view,offset+8),bufferObjectArray=rel32(view,offset+0x0c),indexStreams=[];
  for(let i=0;i<indexStreamCount;i++)indexStreams.push(readIndexStream(bytes,view,rel32(view,indexStreamArray+i*4)));
  return {offset,bufferObjectCount,bufferObjectArray,indexStreams};
}

function readPrimitiveSet(bytes,view,offset){
  checked(bytes,offset,0x14,'primitive set');
  const relatedBoneCount=u32(view,offset),relatedBoneArray=rel32(view,offset+4),skinningMode=u32(view,offset+8);
  const primitiveCount=u32(view,offset+0x0c),primitiveArray=rel32(view,offset+0x10),relatedBones=[];
  if(relatedBoneArray){checked(bytes,relatedBoneArray,relatedBoneCount*4,'related-bone array');for(let i=0;i<relatedBoneCount;i++)relatedBones.push(u32(view,relatedBoneArray+i*4));}
  const primitives=[];for(let i=0;i<primitiveCount;i++)primitives.push(readPrimitive(bytes,view,rel32(view,primitiveArray+i*4)));
  return {offset,relatedBones,skinningMode,primitives};
}

function readShape(bytes,view,offset){
  checked(bytes,offset,0x54,'shape');
  if(fourcc(bytes,offset+4)!=='SOBJ')throw new Error(`Shape SOBJ missing at 0x${offset.toString(16)}.`);
  const name=cstr(bytes,rel32(view,offset+0x0c));
  const positionOffset=[f32(view,offset+0x1c),f32(view,offset+0x20),f32(view,offset+0x24)];
  const primitiveSetCount=u32(view,offset+0x34),primitiveSetArray=rel32(view,offset+0x38),baseAddress=u32(view,offset+0x3c);
  const attributeCount=u32(view,offset+0x48),attributeArray=rel32(view,offset+0x4c),primitiveSets=[],attributes=[];
  for(let i=0;i<primitiveSetCount;i++)primitiveSets.push(readPrimitiveSet(bytes,view,rel32(view,primitiveSetArray+i*4)));
  for(let i=0;i<attributeCount;i++)attributes.push(readAttribute(bytes,view,rel32(view,attributeArray+i*4)));
  const byUsage=new Map(attributes.map(a=>[a.usage,a])),positions=byUsage.get(VertexUsage.Position);
  return {offset,name,positionOffset,baseAddress,primitiveSets,attributes,byUsage,vertexCount:positions?.count??0};
}

function readMesh(bytes,view,offset){
  checked(bytes,offset,0x2c,'mesh');
  if(fourcc(bytes,offset+4)!=='SOBJ')throw new Error(`Mesh SOBJ missing at 0x${offset.toString(16)}.`);
  return {offset,name:cstr(bytes,rel32(view,offset+0x0c)),shapeIndex:u32(view,offset+0x18),materialIndex:u32(view,offset+0x1c),visible:bytes[offset+0x24]!==0,renderPriority:bytes[offset+0x25],meshNodeVisibilityIndex:s16(view,offset+0x26)};
}

function matrix34(view,off){const out=new Float32Array(12);for(let i=0;i<12;i++)out[i]=f32(view,off+i*4);return out;}

function readSkeleton(bytes,view,offset){
  if(!offset)return null;
  checked(bytes,offset,0x2c,'skeleton');
  if(fourcc(bytes,offset+4)!=='SOBJ')return null;
  const boneCount=u32(view,offset+0x18),boneDict=rel32(view,offset+0x1c);
  if(!boneCount||!boneDict||fourcc(bytes,boneDict)!=='DICT')return null;
  const bones=parseDict(bytes,boneDict).map(entry=>{
    const o=entry.offset;checked(bytes,o,0xe0,'bone');
    return {offset:o,name:cstr(bytes,rel32(view,o)),flags:u32(view,o+4),jointId:u32(view,o+8),parentId:s32(view,o+0x0c),
      scale:[f32(view,o+0x20),f32(view,o+0x24),f32(view,o+0x28)],rotation:[f32(view,o+0x2c),f32(view,o+0x30),f32(view,o+0x34)],translation:[f32(view,o+0x38),f32(view,o+0x3c),f32(view,o+0x40)],
      localMatrix:matrix34(view,o+0x44),worldMatrix:matrix34(view,o+0x74),inverseBaseMatrix:matrix34(view,o+0xa4)};
  });
  return {offset,name:cstr(bytes,rel32(view,offset+0x0c)),boneCount,scalingRule:u32(view,offset+0x24),flags:u32(view,offset+0x28),bones};
}

function findMaterialTextureRefs(bytes,view,materialOffset){
  const refs=[],end=Math.min(bytes.length-0x20,materialOffset+0x700);
  for(let p=materialOffset;p<=end;p+=4){
    if(u32(view,p)!==0x404||fourcc(bytes,p+4)!=='TXOB')continue;
    const name=cstr(bytes,rel32(view,p+0x18));
    if(name&&!refs.includes(name))refs.push(name);
  }
  return refs;
}

function readModel(bytes,view,offset){
  checked(bytes,offset,0xd8,'CMDL');
  if(fourcc(bytes,offset+4)!=='CMDL')throw new Error(`CMDL missing at 0x${offset.toString(16)}.`);
  const meshCount=u32(view,offset+0xb4),meshArray=rel32(view,offset+0xb8),materialCount=u32(view,offset+0xbc),materialDictOffset=rel32(view,offset+0xc0);
  const shapeCount=u32(view,offset+0xc4),shapeArray=rel32(view,offset+0xc8),skeletonOffset=rel32(view,offset+0xd4),meshes=[],shapes=[];
  for(let i=0;i<meshCount;i++)meshes.push(readMesh(bytes,view,rel32(view,meshArray+i*4)));
  for(let i=0;i<shapeCount;i++)shapes.push(readShape(bytes,view,rel32(view,shapeArray+i*4)));
  const materialEntries=materialDictOffset?parseDict(bytes,materialDictOffset):[];
  const materials=materialEntries.slice(0,materialCount).map(entry=>({name:entry.name,offset:entry.offset,textureRefs:findMaterialTextureRefs(bytes,view,entry.offset)}));
  return {offset,name:cstr(bytes,rel32(view,offset+0x0c)),flags:u32(view,offset+0x18),
    scale:[f32(view,offset+0x30),f32(view,offset+0x34),f32(view,offset+0x38)],rotation:[f32(view,offset+0x3c),f32(view,offset+0x40),f32(view,offset+0x44)],translation:[f32(view,offset+0x48),f32(view,offset+0x4c),f32(view,offset+0x50)],
    localMatrix:matrix34(view,offset+0x54),worldMatrix:matrix34(view,offset+0x84),meshes,materials,shapes,skeleton:readSkeleton(bytes,view,skeletonOffset)};
}

export function parseModels(input){const bytes=bytesOf(input),view=viewOf(bytes);return prototypeDictionary(bytes,0).map(entry=>readModel(bytes,view,entry.offset));}

export function modelMapFromRom(rom){
  const paths=['gfx/hopper_cat.bcmdl','gfx/hopper_effect.bcmdl','gfx/hopper_map_floor01.bcmdl','gfx/hopper_map_floor02.bcmdl','gfx/hopper_title.bcmdl','gfx/test02_plane.bcmdl'];
  const map=new Map();
  for(const path of paths){if(!rom.has(path))continue;for(const model of parseModels(rom.get(path)))map.set(model.name,{...model,source:path});}
  return map;
}
