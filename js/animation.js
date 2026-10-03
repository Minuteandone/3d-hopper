import { parseDict, prototypeDictionary } from './models.js';

const td = new TextDecoder();

function bytesOf(input){return input instanceof Uint8Array?input:new Uint8Array(input);}
function viewOf(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function u32(v,o){return v.getUint32(o,true);}
function f32(v,o){return v.getFloat32(o,true);}
function rel32(v,o){const r=u32(v,o);return r?o+r:0;}
function cstr(bytes,o){if(!o||o<0||o>=bytes.length)return '';let e=o;while(e<bytes.length&&bytes[e])e++;return td.decode(bytes.subarray(o,e));}
function fourcc(bytes,o){return o>=0&&o+4<=bytes.length?String.fromCharCode(...bytes.subarray(o,o+4)):'';}
function checked(bytes,o,n,label){if(o<0||n<0||o+n>bytes.length)throw new Error(`${label} outside CGFX at 0x${o.toString(16)}.`);}

function parseHermite128Segment(bytes,view,offset){
  checked(bytes,offset,0x18,'CANM curve segment');
  const startFrame=f32(view,offset),endFrame=f32(view,offset+4),flags=u32(view,offset+8);
  const interpolation=flags&0xf,quantization=flags>>>5;
  if(interpolation!==8||quantization!==0)throw new Error(`Unsupported Hopper CANM curve segment flags 0x${flags.toString(16)}.`);
  const keyCount=u32(view,offset+0x0c),speed=f32(view,offset+0x10),keys=[];
  let p=offset+0x14;
  checked(bytes,p,keyCount*16,'CANM Hermite keys');
  for(let i=0;i<keyCount;i++,p+=16)keys.push({frame:f32(view,p),value:f32(view,p+4),inSlope:f32(view,p+8),outSlope:f32(view,p+12)});
  return {offset,startFrame,endFrame,flags,interpolation:'hermite',quantization:'Hermite128',speed,keys};
}

export function parseFloatCurve(input,offset){
  const bytes=bytesOf(input),view=viewOf(bytes);
  checked(bytes,offset,0x18,'CANM curve');
  const startFrame=f32(view,offset),endFrame=f32(view,offset+4),repeatFlags=u32(view,offset+8),unknown=u32(view,offset+0x0c),segmentCount=u32(view,offset+0x10);
  if(!Number.isFinite(startFrame)||!Number.isFinite(endFrame)||endFrame<startFrame||segmentCount<1||segmentCount>32)throw new Error(`Invalid CANM curve at 0x${offset.toString(16)}.`);
  const segments=[];
  for(let i=0;i<segmentCount;i++)segments.push(parseHermite128Segment(bytes,view,rel32(view,offset+0x14+i*4)));
  return {offset,startFrame,endFrame,repeatFlags,unknown,segments};
}

function parseTransformTrack(bytes,view,entry,revision){
  const offset=entry.offset,flags=u32(view,offset),path=cstr(bytes,rel32(view,offset+4));
  let p=offset+8;
  // Hopper's revision 2 CANM stores two legacy words here. Later revision 7+
  // tracks removed them, but the transform slots/flags stayed compatible.
  if((revision>>>24)<7)p+=8;
  const segmentType=u32(view,p);p+=4;
  if(segmentType!==5)throw new Error(`Unsupported skeletal CANM segment type ${segmentType} for ${path||entry.name}.`);
  const groups={scale:[null,null,null],rotation:[null,null,null],translation:[null,null,null]};
  let missingMask=0x10000,constantMask=0x40;
  // Native Euler transform has ten slots: scale XYZ, rotation XYZW
  // (W is an unused placeholder here), then translation XYZ.
  for(let element=0;element<10;element++){
    const slot=p;p+=4;
    if(element===6){missingMask<<=1;constantMask<<=1;continue;}
    const missing=(flags&missingMask)!==0,constant=(flags&constantMask)!==0;
    let value;
    if(missing)value={kind:'absent'};
    else if(constant)value={kind:'constant',value:f32(view,slot)};
    else value={kind:'curve',curve:parseFloatCurve(bytes,rel32(view,slot))};
    if(element<3)groups.scale[element]=value;
    else if(element<6)groups.rotation[element-3]=value;
    else groups.translation[element-7]=value;
    missingMask<<=1;constantMask<<=1;
  }
  return {offset,name:entry.name,path:path||entry.name,flags,segmentType,...groups};
}

export function parseSkeletalAnimations(input){
  const bytes=bytesOf(input),view=viewOf(bytes);
  // This 2010 prototype puts skeletal CANM in descriptor 8.
  return prototypeDictionary(bytes,8).map(entry=>{
    const o=entry.offset;
    checked(bytes,o,0x28,'CANM');
    if(fourcc(bytes,o)!=='CANM')throw new Error(`CANM missing at 0x${o.toString(16)}.`);
    const revision=u32(view,o+4),name=cstr(bytes,rel32(view,o+8)),targetGroup=cstr(bytes,rel32(view,o+0x0c));
    const loopMode=u32(view,o+0x10),frameCount=f32(view,o+0x14),memberCount=u32(view,o+0x18),memberDictOffset=rel32(view,o+0x1c);
    const entries=parseDict(bytes,memberDictOffset).slice(0,memberCount);
    return {offset:o,name:name||entry.name,revision,targetGroup,loopMode,frameCount,tracks:entries.map(e=>parseTransformTrack(bytes,view,e,revision))};
  });
}

export function skeletalAnimationMapFromRom(rom){
  const map=new Map();
  if(rom.has('gfx/hopper_cat.bcmdl')){
    for(const animation of parseSkeletalAnimations(rom.get('gfx/hopper_cat.bcmdl')))map.set(animation.name,{...animation,source:'gfx/hopper_cat.bcmdl'});
  }
  return map;
}

function hermite(a,b,frame){
  const span=b.frame-a.frame;if(span<=0)return b.value;
  const t=Math.max(0,Math.min(1,(frame-a.frame)/span)),t2=t*t,t3=t2*t;
  const h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2;
  return h00*a.value+h10*(a.outSlope*span)+h01*b.value+h11*(b.inSlope*span);
}

export function sampleCurve(curve,frame){
  const segment=curve.segments.find(s=>frame>=s.startFrame&&frame<=s.endFrame)??curve.segments.at(-1);
  const keys=segment.keys;
  if(!keys.length)return 0;
  if(frame<=keys[0].frame)return keys[0].value;
  if(frame>=keys.at(-1).frame)return keys.at(-1).value;
  for(let i=1;i<keys.length;i++)if(frame<=keys[i].frame)return hermite(keys[i-1],keys[i],frame);
  return keys.at(-1).value;
}

export function sampleAnimatedValue(value,frame,fallback){
  if(!value||value.kind==='absent')return fallback;
  if(value.kind==='constant')return value.value;
  return sampleCurve(value.curve,frame);
}

export function sampleTransformTrack(track,frame,bind){
  return {
    scale:track.scale.map((v,i)=>sampleAnimatedValue(v,frame,bind.scale[i])),
    rotation:track.rotation.map((v,i)=>sampleAnimatedValue(v,frame,bind.rotation[i])),
    translation:track.translation.map((v,i)=>sampleAnimatedValue(v,frame,bind.translation[i])),
  };
}
