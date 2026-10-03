const td = new TextDecoder();

function u16(v,o){return v.getUint16(o,true);}
function u32(v,o){return v.getUint32(o,true);}
function f32(v,o){return v.getFloat32(o,true);}
function ascii(bytes,o,n){return String.fromCharCode(...bytes.subarray(o,o+n));}
function zstr(bytes,o,max=0x400){
  let e=o,lim=Math.min(bytes.length,o+max);
  while(e<lim&&bytes[e]!==0)e++;
  return td.decode(bytes.subarray(o,e));
}

const GAME_DESCRIPTOR_VA=0x191120;
const EXPECTED_SIGNATURES={
  0x13c034:0xe92d4ff0,
  0x13c81c:0xe92d4ff0,
  0x13ebd4:0xe59f0018,
  0x13f550:0xe92d47f0,
  0x1517dc:0xe92d4ff0,
};

export class HopperExecutable {
  constructor(buffer){
    this.buffer=buffer;
    this.bytes=new Uint8Array(buffer);
    this.view=new DataView(buffer);
    this.sections=new Map();
    this.segments=[];
    this.meta={};
    this.#parse();
  }

  #parse(){
    if(this.bytes.length<0xc00||ascii(this.bytes,0x100,4)!=='NCCH')throw new Error('No NCCH executable image found.');
    const title=zstr(this.bytes,0x200,8);
    const defs=[['.text',0x210,0x218],['.ro',0x220,0x228],['.rw',0x230,0x238]];
    const exefsHeader=0xa00;
    const disk=new Map();
    for(let i=0;i<10;i++){
      const p=exefsHeader+i*16;
      const name=zstr(this.bytes,p,8);
      if(!name)continue;
      disk.set(name,{name,fileOffset:u32(this.view,p+8),size:u32(this.view,p+12)});
    }
    for(const [name,vaOff,sizeOff] of defs){
      const virtualAddress=u32(this.view,vaOff),memorySize=u32(this.view,sizeOff);
      const d=disk.get(name);
      if(!d)throw new Error(`Missing ExeFS section ${name}.`);
      let fileOffset=d.fileOffset;
      if(fileOffset<0xc00||fileOffset+d.size>this.bytes.length)fileOffset=0xc00+d.fileOffset;
      const section={name,virtualAddress,memorySize,fileOffset,fileSize:d.size};
      this.sections.set(name,section);this.segments.push(section);
    }
    this.meta={title,format:'prototype ExeFS',entryPoint:0x100000};
  }

  vaToOffset(va,size=1){
    for(const s of this.segments){
      if(va>=s.virtualAddress&&va+size<=s.virtualAddress+s.fileSize)return s.fileOffset+(va-s.virtualAddress);
    }
    throw new RangeError(`VA 0x${va.toString(16)} is outside the mapped Hopper executable.`);
  }
  readU8(va){return this.bytes[this.vaToOffset(va)];}
  readU16(va){return u16(this.view,this.vaToOffset(va,2));}
  readU32(va){return u32(this.view,this.vaToOffset(va,4));}
  readF32(va){return f32(this.view,this.vaToOffset(va,4));}
  readString(va,max=0x400){return zstr(this.bytes,this.vaToOffset(va),max);}
  slice(va,size){const o=this.vaToOffset(va,size);return this.bytes.subarray(o,o+size);}
}

function near(a,b,eps=1e-5){return Math.abs(a-b)<=eps;}
function assertBuild(exe){
  const errors=[];
  for(const [addr,expected] of Object.entries(EXPECTED_SIGNATURES)){
    const va=Number(addr),got=exe.readU32(va);
    if(got!==expected)errors.push(`0x${va.toString(16)}: expected ARM word 0x${expected.toString(16)}, got 0x${got.toString(16)}`);
  }
  const scenePtr=exe.readU32(GAME_DESCRIPTOR_VA),scene=exe.readString(scenePtr),factory=exe.readU32(GAME_DESCRIPTOR_VA+4);
  if(scene!=='Game')errors.push(`scene descriptor is ${JSON.stringify(scene)}, not "Game"`);
  if(factory!==0x13ebd4)errors.push(`Game factory is 0x${factory.toString(16)}, not 0x13ebd4`);
  if(errors.length)throw new Error(`Unsupported 3D Hopper executable build:\n${errors.join('\n')}`);
}

function readFloorRecord(exe,va,index){
  return {
    index,address:va,
    position:[exe.readF32(va),exe.readF32(va+4),exe.readF32(va+8)],
    columns:exe.readU32(va+0x0c),
    rows:exe.readU32(va+0x10),
    spacing:exe.readF32(va+0x14),
    type:exe.readU8(va+0x18),
    offset:[exe.readF32(va+0x1c),exe.readF32(va+0x20),exe.readF32(va+0x24)],
    parameter:exe.readU32(va+0x28),
    flag:exe.readU8(va+0x2c),
  };
}

export function liftHopperProgram(romOrBuffer){
  const buffer=romOrBuffer?.buffer instanceof ArrayBuffer?romOrBuffer.buffer:romOrBuffer;
  const exe=new HopperExecutable(buffer);
  assertBuild(exe);
  const sceneNamePtr=exe.readU32(GAME_DESCRIPTOR_VA);
  const factory=exe.readU32(GAME_DESCRIPTOR_VA+4);
  const stages=[];
  for(let i=0;i<4;i++){
    const d=GAME_DESCRIPTOR_VA+8+i*16;
    const recordsAddress=exe.readU32(d),count=exe.readU32(d+4),kind=exe.readU32(d+8),id=exe.readU32(d+12);
    const records=[];
    for(let j=0;j<count;j++)records.push(readFloorRecord(exe,recordsAddress+j*48,j));
    stages.push({index:i,address:d,recordsAddress,count,kind,id,records});
  }
  const physics={
    gravityPerFrame:exe.readF32(0x13cce4),
    specialGravityPerFrame:exe.readF32(0x13ccf8),
    specialPredictionScale:exe.readF32(0x13ccf4),
    landingBouncePerFrame:exe.readF32(0x13d328),
    inputScale:exe.readF32(0x13d7bc),
    groundedInputScale:exe.readF32(0x13d7c0),
    airVelocityLerp:exe.readF32(0x13d7c4),
    movementVectorScale:exe.readF32(0x13d7c8),
    collisionSkin:exe.readF32(0x151b8c),
    movementRadius:exe.readF32(0x151b90),
    spawnClearance:exe.readF32(0x151f3c),
    failY:exe.readF32(0x13cccc),
    fixedHz:60,
  };
  const floorBuilder={
    recordStride:48,
    gridCenterFactor:exe.readF32(0x13c4d8),
    tileModelScale:exe.readF32(0x13c4e4),
    sourceAddress:0x13c034,
  };
  if(!near(floorBuilder.gridCenterFactor,0.5)||!near(floorBuilder.tileModelScale,0.1))throw new Error('Floor-builder constants do not match the supported build.');
  return {
    build:{title:exe.meta.title,sceneName:exe.readString(sceneNamePtr),sceneNamePtr,factoryAddress:factory,
      routines:{floorBuilder:0x13c034,gameplayUpdate:0x13c81c,stageConstruction:0x13f550,playerReset:0x1517dc}},
    stages,physics,floorBuilder,executable:exe,
  };
}

export function gridCoordinate(count,spacing,index){
  return 0.5*(1-count)*spacing+index*spacing;
}
