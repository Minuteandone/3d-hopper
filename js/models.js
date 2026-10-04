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

function readMaterialColor(view,offset){
  const read4=o=>[f32(view,o),f32(view,o+4),f32(view,o+8),f32(view,o+12)];
  return {
    emission:read4(offset),
    ambient:read4(offset+0x10),
    diffuse:read4(offset+0x20),
    specular0:read4(offset+0x30),
    specular1:read4(offset+0x40),
    constants:Array.from({length:6},(_,i)=>read4(offset+0x50+i*0x10)),
  };
}

function readMaterialTextureMappers(bytes,view,materialOffset){
  // Prototype TexInfo mirrors the PICA texture-unit config at +0x24:
  // bit 1 mag filter, bit 2 min filter, bits 8..10 wrap T, bits 12..14 wrap S.
  const mappers=[];
  for(const field of [0x2b4,0x2b8,0x2bc]){
    const texInfo=rel32(view,materialOffset+field);
    if(!texInfo)continue;
    checked(bytes,texInfo,0x4c,'prototype TexInfo');
    const txob=rel32(view,texInfo+8);
    const sampler=rel32(view,texInfo+0x0c);
    if(!txob||!sampler)throw new Error(`Incomplete prototype TexInfo at 0x${texInfo.toString(16)}.`);
    checked(bytes,txob,0x1c,'reference TXOB');
    checked(bytes,sampler,0x0c,'prototype texture sampler');
    if(u32(view,txob)!==0x404||fourcc(bytes,txob+4)!=='TXOB'){
      throw new Error(`Material texture mapper at 0x${texInfo.toString(16)} does not reference a TXOB.`);
    }
    const textureName=cstr(bytes,rel32(view,txob+0x18));
    const config=u32(view,texInfo+0x24);
    const minFilter=(config>>>2)&1,magFilter=(config>>>1)&1;
    const minFilterGl=u32(view,sampler+8);
    const expectedMinFilterGl=minFilter?0x2601:0x2600;
    if(minFilterGl!==expectedMinFilterGl){
      throw new Error(`PICA/GL min-filter mismatch for ${textureName}: config=${minFilter}, GL=0x${minFilterGl.toString(16)}.`);
    }
    mappers.push({
      textureName,
      texInfoOffset:texInfo,
      samplerOffset:sampler,
      config,
      wrapS:(config>>>12)&7,
      wrapT:(config>>>8)&7,
      minFilter,
      magFilter,
      minFilterGl,
    });
  }
  return mappers;
}

function readTextureCoordinator(bytes,view,offset,hashOffset){
  checked(bytes,offset,0x58,'prototype texture coordinator');
  const matrix=new Float32Array(12);
  for(let i=0;i<12;i++)matrix[i]=f32(view,offset+0x28+i*4);
  return {
    offset,
    sourceCoordinate:u32(view,offset),
    mappingMethod:u32(view,offset+4),
    referenceCamera:s32(view,offset+8),
    matrixMode:u32(view,offset+0x0c),
    scale:[f32(view,offset+0x10),f32(view,offset+0x14)],
    rotate:f32(view,offset+0x18),
    translate:[f32(view,offset+0x1c),f32(view,offset+0x20)],
    flags:u32(view,offset+0x24),
    matrix,
    hash:u32(view,hashOffset),
  };
}

function readTextureCoordinators(bytes,view,materialOffset){
  return [
    readTextureCoordinator(bytes,view,materialOffset+0x1a0,materialOffset+0x1f8),
    readTextureCoordinator(bytes,view,materialOffset+0x1fc,materialOffset+0x254),
    readTextureCoordinator(bytes,view,materialOffset+0x258,materialOffset+0x2b0),
  ];
}

export function textureCoordinateIndexForMapper(texCoordConfig,mapperIndex){
  if(mapperIndex===2&&(texCoordConfig===1||texCoordConfig===2||texCoordConfig===3))return 1;
  return mapperIndex;
}

function readFragmentShaderState(bytes,view,materialOffset){
  const offset=rel32(view,materialOffset+0x2c8);
  if(!offset)return null;
  checked(bytes,offset,0xe0,'prototype fragment shader state');

  const fragmentLighting={
    flags:u32(view,offset+0x10),
    layerConfig:u32(view,offset+0x14),
    fresnelConfig:u32(view,offset+0x18),
    bumpTextureIndex:u32(view,offset+0x1c),
    bumpMode:u32(view,offset+0x20),
    bumpRenormalize:u32(view,offset+0x24)!==0,
  };
  const expectedHeaders=[0x804f00c0,0x804f00c8,0x804f00d0,0x804f00d8,0x804f00f0,0x804f00f8];
  const stages=[];
  for(let i=0;i<6;i++){
    const o=offset+0x30+i*0x1c;
    const constant=u32(view,o);
    const source=u32(view,o+4);
    const address=u32(view,o+8);
    const operands=u32(view,o+0x0c);
    const combine=u32(view,o+0x10);
    const constantColor=u32(view,o+0x14);
    const scale=u32(view,o+0x18);
    if(address!==expectedHeaders[i])throw new Error(`Unexpected Hopper TexEnv stage ${i} command 0x${address.toString(16)}.`);
    stages.push({
      index:i,constant,source,address,operands,combine,constantColor,scale,
      colorSources:[source&0xf,(source>>>4)&0xf,(source>>>8)&0xf],
      alphaSources:[(source>>>16)&0xf,(source>>>20)&0xf,(source>>>24)&0xf],
      colorMode:combine&0xf,
      alphaMode:(combine>>>16)&0xf,
    });
  }

  const alphaParam=u32(view,offset+0xd8),alphaHeader=u32(view,offset+0xdc);
  if(alphaHeader!==0x000f0104)throw new Error(`Unexpected Hopper alpha-test command 0x${alphaHeader.toString(16)}.`);
  return {
    offset,fragmentLighting,stages,
    alphaTest:{
      enabled:(alphaParam&1)!==0,
      function:(alphaParam>>>4)&7,
      reference:(alphaParam>>>8)&0xff,
      commandParam:alphaParam,
      commandHeader:alphaHeader,
    },
  };
}

const TEXENV_INPUT_COUNTS=[1,2,2,2,3,2,2,2,3,3];

/**
 * Return the first physical texture mapper (0..2) that an active TexEnv
 * color operation actually reads. Source IDs 3/4/5 are Texture0/1/2.
 * Unused padding source nibbles are ignored according to combiner mode.
 */
export function firstColorTextureMapper(fragmentShader){
  if(!fragmentShader)return null;
  for(const stage of fragmentShader.stages){
    const count=TEXENV_INPUT_COUNTS[stage.colorMode]??3;
    for(const source of stage.colorSources.slice(0,count)){
      if(source>=3&&source<=5)return source-3;
    }
  }
  return null;
}

function readModel(bytes,view,offset){
  checked(bytes,offset,0xd8,'CMDL');
  if(fourcc(bytes,offset+4)!=='CMDL')throw new Error(`CMDL missing at 0x${offset.toString(16)}.`);
  const meshCount=u32(view,offset+0xb4),meshArray=rel32(view,offset+0xb8),materialCount=u32(view,offset+0xbc),materialDictOffset=rel32(view,offset+0xc0);
  const shapeCount=u32(view,offset+0xc4),shapeArray=rel32(view,offset+0xc8),skeletonOffset=rel32(view,offset+0xd4),meshes=[],shapes=[];
  for(let i=0;i<meshCount;i++)meshes.push(readMesh(bytes,view,rel32(view,meshArray+i*4)));
  for(let i=0;i<shapeCount;i++)shapes.push(readShape(bytes,view,rel32(view,shapeArray+i*4)));
  const materialEntries=materialDictOffset?parseDict(bytes,materialDictOffset):[];
  const materials=materialEntries.slice(0,materialCount).map(entry=>{
    const o=entry.offset;
    checked(bytes,o,0x164,'prototype MTOB');
    if(fourcc(bytes,o+4)!=='MTOB')throw new Error(`MTOB missing at 0x${o.toString(16)}.`);
    const revision=u32(view,o+8);
    if(revision!==0x04000000)throw new Error(`Unsupported Hopper MTOB revision 0x${revision.toString(16)}.`);
    // Verified against this prototype's rev-4 material layout.
    const materialFlags=u32(view,o+0x18);
    const materialColor=readMaterialColor(view,o+0x24);
    const cullCommandParam=u32(view,o+0x11c);
    const cullCommandHeader=u32(view,o+0x120);
    if(cullCommandHeader!==0x00010040)throw new Error(`Unexpected Hopper face-culling command 0x${cullCommandHeader.toString(16)}.`);
    const cullMode=cullCommandParam&3;
    const depthFlags=u32(view,o+0x128);
    const depthCommand1=u32(view,o+0x12c);
    const depthCommand2=u32(view,o+0x130);
    const depthCommand3=u32(view,o+0x134);
    const depthCommand4=u32(view,o+0x138);
    const blendMode=u32(view,o+0x13c);
    const blendCommand1=u32(view,o+0x150);
    const blendCommand3=u32(view,o+0x158);
    const blendEnabled=((blendCommand1>>>8)&0xff)===1;
    const colorSource=(blendCommand3>>>16)&0xf;
    const colorDestination=(blendCommand3>>>20)&0xf;
    const texCoordConfig=u32(view,o+0x1c);
    const textureCoordinators=readTextureCoordinators(bytes,view,o);
    const textureMappers=readMaterialTextureMappers(bytes,view,o);
    const textureRefs=textureMappers.map(m=>m.textureName);
    const fragmentShader=readFragmentShaderState(bytes,view,o);
    const lightSetIndex=u32(view,o+0x2d8);
    const visibleColorMapper=firstColorTextureMapper(fragmentShader);
    const visibleTextureCoordinate=Number.isInteger(visibleColorMapper)
      ?textureCoordinators[textureCoordinateIndexForMapper(texCoordConfig,visibleColorMapper)]??null
      :null;
    return {
      name:entry.name,offset:o,revision,flags:materialFlags,materialColor,
      lightSetIndex,
      texCoordConfig,textureCoordinators,
      textureMappers,textureRefs,
      visibleColorMapper,visibleTextureCoordinate,
      rasterization:{cullMode,commandParam:cullCommandParam,commandHeader:cullCommandHeader},
      depth:{
        flags:depthFlags,
        testEnabled:(depthFlags&1)!==0,
        writeEnabled:(depthFlags&2)!==0,
        compareCode:(depthCommand1>>>4)&7,
        command1:depthCommand1,command2:depthCommand2,command3:depthCommand3,command4:depthCommand4,
      },
      fragmentShader,
      blend:{mode:blendMode,enabled:blendEnabled,colorSource,colorDestination,command1:blendCommand1,command3:blendCommand3},
    };
  });
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
