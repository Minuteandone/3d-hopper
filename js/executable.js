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
const STAGE_GLOBAL_INITIALIZER=0x16b424;
const STARTUP_FLOOR_RECORD_VA=0x19e0c8;
const CONTROL_DEGREES_SCALE_VA=0x1517d8;
const PROTOTYPE_TRIG_TABLE_VA=0x1949c8;
const EXPECTED_SIGNATURES={
  0x13c034:0xe92d4ff0,
  0x13c81c:0xe92d4ff0,
  0x13ebd4:0xe59f0018,
  0x13f550:0xe92d47f0,
  0x1517dc:0xe92d4ff0,
  0x16b424:0xe59f03c0,
  0x16b7e8:0xe12fff1e,
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
    secondFlag:exe.readU8(va+0x2d),
  };
}

/**
 * Translation of ARM/VFP routine 0x16B424..0x16B7E8.
 * The stage arrays are C++ globals whose position/motion fields are filled at startup.
 */
function applyStageGlobalConstructor(exe,stages,startupFloor){
  const f=va=>exe.readF32(va);
  const C={
    zero:f(0x16b7f4),eighty:f(0x16b7f8),
    y45:f(0x16b800),neg8:f(0x16b804),six:f(0x16b808),three:f(0x16b80c),
    eight:f(0x16b810),neg16:f(0x16b814),nine:f(0x16b818),twelve:f(0x16b81c),fifteen:f(0x16b820),
    eighteen:f(0x16b824),four:f(0x16b828),twentyTwo:f(0x16b82c),neg4:f(0x16b830),ten:f(0x16b834),
    two:f(0x16b838),neg10:f(0x16b83c),y475:f(0x16b840),neg20:f(0x16b844),y95:f(0x16b848),
    neg32:f(0x16b84c),neg9:f(0x16b850),neg3:f(0x16b854),neg275:f(0x16b858),sixteen:f(0x16b85c),
  };
  startupFloor.position=[C.zero,C.eighty,C.zero];
  startupFloor.offset=[C.zero,C.zero,C.zero];
  startupFloor.initializedBy=STAGE_GLOBAL_INITIALIZER;

  const set=(stage,index,position,offset=[C.zero,C.zero,C.zero])=>{
    const r=stages[stage].records[index];
    r.position=[...position];r.offset=[...offset];r.initializedBy=STAGE_GLOBAL_INITIALIZER;
  };

  set(0,0,[C.zero,C.y45,C.zero]);
  set(0,1,[C.neg8,C.six,C.neg8]);
  set(0,2,[C.zero,C.three,C.neg8]);
  set(0,3,[C.eight,C.zero,C.neg8]);
  set(0,4,[C.neg8,C.three,C.neg16]);
  set(0,5,[C.zero,C.three,C.neg16]);
  set(0,6,[C.eight,C.zero,C.neg16]);
  set(0,7,[C.neg8,C.nine,C.neg16]);
  set(0,8,[C.zero,C.twelve,C.neg16]);
  set(0,9,[C.eight,C.fifteen,C.neg16]);

  set(1,0,[C.zero,C.zero,C.zero]);
  set(1,1,[C.eighteen,C.four,C.zero]);
  set(1,2,[C.twentyTwo,C.eight,C.neg4]);
  set(1,3,[C.ten,C.twelve,C.zero]);

  set(2,0,[C.zero,C.two,C.zero]);
  set(2,1,[C.zero,C.zero,C.neg10]);
  set(2,2,[C.six,C.y475,C.neg20]);
  set(2,3,[C.zero,C.y95,C.neg32]);
  set(2,4,[C.neg9,C.neg3,C.neg275]);

  set(3,0,[C.zero,C.zero,C.zero]);
  set(3,1,[C.eight,C.zero,C.neg16],[C.neg8,C.zero,C.eight]);
  set(3,2,[C.sixteen,C.zero,C.neg32]);
  return stages;
}

function readPrototypeTrigTable(exe){
  const table=new Float32Array(256*4);
  for(let i=0;i<table.length;i++)table[i]=exe.readF32(PROTOTYPE_TRIG_TABLE_VA+i*4);
  return table;
}

/**
 * Translation of 0x15BD0C for the angle range used by Hopper controls.
 * The ROM table stores [sin, cos, sinSlope, cosSlope] for 256 steps/turn.
 */
export function prototypeSinCos(table,angleUnits){
  let x=Math.abs(angleUnits);
  while(x>=65536)x-=65536;
  const whole=Math.floor(x),fraction=x-whole,index=(whole&255)*4;
  let sin=table[index]+fraction*table[index+2];
  const cos=table[index+1]+fraction*table[index+3];
  if(angleUnits<0)sin=-sin;
  return {sin,cos};
}

/** Translation of control-space helper 0x1516CC with Y=0. */
export function transformControlVector(controls,stageIndex,x,z){
  const heading=controls.stageSetup[stageIndex]?.controlHeadingDegrees??0;
  const units=heading*controls.degreesToTrigUnits;
  const {sin,cos}=prototypeSinCos(controls.trigTable,units);
  return {x:cos*x+sin*z,z:-sin*x+cos*z};
}

export function gridCoordinate(count,spacing,index){
  return 0.5*(1-count)*spacing+index*spacing;
}

/** Translation of the ordinary moving-floor sine branch at 0x13DD58..0x13DF18. */
export function movingFloorAt(record,timer){
  if(!(record.parameter>0))return {timer:0,position:[...record.position],velocity:[0,0,0]};
  const next=(timer+1)>=record.parameter?0:(timer+1);
  const wave=Math.sin((Math.PI*2*next)/record.parameter);
  const position=record.position.map((v,i)=>v+record.offset[i]*wave);
  return {timer:next,position,wave};
}

/**
 * Lift identified game-specific data and constants into a browser-friendly program description.
 * This is a narrow source translation of identified ARM routines, not CPU emulation.
 */
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
  const startupFloor=readFloorRecord(exe,STARTUP_FLOOR_RECORD_VA,-1);
  applyStageGlobalConstructor(exe,stages,startupFloor);

  const trigTable=readPrototypeTrigTable(exe);
  const controls={
    degreesToTrigUnits:exe.readF32(CONTROL_DEGREES_SCALE_VA),
    trigTable,
    // 0x1517DC writes these orientation triples into game+4. 0x1516CC
    // consumes only the third component when rotating analog input.
    stageSetup:[
      {orientation:[exe.readF32(0x151b70),exe.readF32(0x151b74),exe.readF32(0x151b7c)]},
      {orientation:[exe.readF32(0x151b88),exe.readF32(0x151f2c),exe.readF32(0x151b7c)]},
      {orientation:[exe.readF32(0x151b88),exe.readF32(0x151f34),exe.readF32(0x151f38)]},
      {orientation:[exe.readF32(0x151b70),exe.readF32(0x151b74),exe.readF32(0x151b7c)]},
    ],
    sourceAddress:0x1516cc,
  };
  for(const stage of controls.stageSetup)stage.controlHeadingDegrees=stage.orientation[2];

  const physics={
    gravityPerUpdate:exe.readF32(0x13cce4),
    state2GravityPerUpdate:exe.readF32(0x13ccf8),
    state2DisplacementScale:exe.readF32(0x13ccf4),
    landingBouncePerUpdate:exe.readF32(0x13d328),
    inputScale:exe.readF32(0x13d7bc),
    floorHitInputScale:exe.readF32(0x13d7c0),
    airVelocityLerp:exe.readF32(0x13d7c4),
    movementVectorScale:exe.readF32(0x13d7c8),
    horizontalCollisionSize:exe.readF32(0x151b8c),
    upperCollisionOffset:exe.readF32(0x151b90),
    spawnClearance:exe.readF32(0x151f3c),
    failY:exe.readF32(0x13cccc),
    verticalCollisionEpsilon:exe.readF32(0x13ccfc),
  };
  const floorBuilder={
    recordStride:48,
    gridCenterFactor:exe.readF32(0x13c4d8),
    collisionHeight:exe.readF32(0x13c4e0),
    verticalModelScale:exe.readF32(0x13c4e0),
    tileModelScale:exe.readF32(0x13c4e4),
    sourceAddress:0x13c034,
  };
  if(!near(floorBuilder.gridCenterFactor,0.5)||!near(floorBuilder.collisionHeight,0.4)||!near(floorBuilder.tileModelScale,0.1)){
    throw new Error('Floor-builder constants do not match the supported build.');
  }
  return {
    build:{
      title:exe.meta.title,sceneName:exe.readString(sceneNamePtr),sceneNamePtr,factoryAddress:factory,
      routines:{
        floorBuilder:0x13c034,gameplayUpdate:0x13c81c,stageConstruction:0x13f550,
        stateSetup:0x1517dc,stageGlobalInitializer:STAGE_GLOBAL_INITIALIZER,startupSetup:0x13f8c0,movingFloorUpdate:0x13dd58,
      },
    },
    stages,startupFloor,controls,physics,floorBuilder,
    initialState:{stageIndex:0,stage2ExtraCounter:2},
    executable:exe,
  };
}
