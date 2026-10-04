const TILE_ORDER = [0,1,4,5, 2,3,6,7, 8,9,12,13, 10,11,14,15];
const ETC1_MODIFIERS = [[2,8],[5,17],[9,29],[13,42],[18,60],[24,80],[33,106],[47,183]];
const FORMAT_NAMES = ['RGBA8','RGB8','RGBA5551','RGB565','RGBA4','LA8','HILO8','L8','A8','LA4','L4','A4','ETC1','ETC1A4'];
const td = new TextDecoder();

function u32(v,o){ return v.getUint32(o,true); }
function cstr(bytes,o){
  let e=o;
  while(e<bytes.length && bytes[e]!==0)e++;
  return td.decode(bytes.subarray(o,e));
}
function fourcc(bytes,o){ return String.fromCharCode(...bytes.subarray(o,o+4)); }
function clamp(v){ return Math.max(0,Math.min(255,v|0)); }
function nextPow2(v){ let n=1; while(n<v)n<<=1; return n; }
function sign3(v){ return (v&4)?v-8:v; }

function readU64LE(bytes,o){
  const dv=new DataView(bytes.buffer,bytes.byteOffset+o,8);
  return dv.getBigUint64(0,true);
}

function parseDict(bytes, view, dictOffset){
  if(fourcc(bytes,dictOffset)!=='DICT') throw new Error(`CGFX DICT expected at 0x${dictOffset.toString(16)}`);
  const count=u32(view,dictOffset+8);
  const entries=[];
  for(let i=0;i<count;i++){
    const e=dictOffset+0x1C+i*0x10;
    const nameOff=e+8+u32(view,e+8);
    const dataOff=e+12+u32(view,e+12);
    entries.push({name:cstr(bytes,nameOff),offset:dataOff});
  }
  return entries;
}

function dictionaryTable(bytes,view){
  // 3D Hopper predates the later DATA-section layout. The dictionaries are
  // count/self-relative-offset pairs immediately after the 0x14-byte CGFX header.
  const out=[];
  let p=0x14, earliest=bytes.length;
  for(let i=0;i<16 && p+8<=bytes.length;i++,p+=8){
    const count=u32(view,p);
    const rel=u32(view,p+4);
    const offset=rel ? p+4+rel : 0;
    out.push({index:i,count,offset});
    if(offset && offset<earliest)earliest=offset;
    if(p+8>=earliest)break;
  }
  return out;
}

export function parseTextures(cgfxBytes){
  const bytes=cgfxBytes instanceof Uint8Array?cgfxBytes:new Uint8Array(cgfxBytes);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(fourcc(bytes,0)!=='CGFX') throw new Error('Not a CGFX/BCMDL file.');
  const table=dictionaryTable(bytes,view);
  const tex=table.find((d)=>d.index===1 && d.offset);
  if(!tex)return [];
  const entries=parseDict(bytes,view,tex.offset);
  const out=[];
  for(const entry of entries){
    const o=entry.offset;
    if(fourcc(bytes,o+4)!=='TXOB') continue;
    let p=o+0x18;
    const height=u32(view,p); p+=4;
    const width=u32(view,p); p+=4;
    const glFormat=u32(view,p); p+=4;
    const glType=u32(view,p); p+=4;
    const levels=u32(view,p); p+=4;
    p+=8; // texture object + location flag
    const format=u32(view,p); p+=4;
    const imageRel=u32(view,p);
    if(!imageRel)continue;
    const imageOffset=p+imageRel;
    if(imageOffset+0x20>bytes.length)continue;
    const imageHeight=u32(view,imageOffset);
    const imageWidth=u32(view,imageOffset+4);
    const dataSize=u32(view,imageOffset+8);
    const dataOffset=imageOffset+12+u32(view,imageOffset+12);
    if(dataOffset+dataSize>bytes.length) throw new Error(`Texture ${entry.name} is truncated.`);
    out.push({
      name:entry.name,width,height,format,formatName:FORMAT_NAMES[format]??`fmt${format}`,
      glFormat,glType,levels,imageWidth,imageHeight,
      data:bytes.subarray(dataOffset,dataOffset+dataSize),
    });
  }
  return out;
}

function color16(v,fmt){
  if(fmt===2){
    return [((v>>11)&31)*255/31,((v>>6)&31)*255/31,((v>>1)&31)*255/31,(v&1)?255:0];
  }
  if(fmt===3){
    return [((v>>11)&31)*255/31,((v>>5)&63)*255/63,(v&31)*255/31,255];
  }
  return [((v>>12)&15)*17,((v>>8)&15)*17,((v>>4)&15)*17,(v&15)*17];
}

export function decodeTexture(tex){
  const {width,height,format,data}=tex;
  const W=nextPow2(width), H=nextPow2(height);
  const out=new Uint8ClampedArray(width*height*4);
  let offs=0;
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const put=(x,y,r,g,b,a=255)=>{
    if(x<0||y<0||x>=width||y>=height)return;
    const k=(y*width+x)*4;
    out[k]=clamp(r);out[k+1]=clamp(g);out[k+2]=clamp(b);out[k+3]=clamp(a);
  };

  if(format<=11){
    if(format===6)throw new Error('HILO8 texture decoding is not implemented; it is not equivalent to LA8.');
    const bpt=[256,192,128,128,128,128,128,64,64,64,32,32][format];
    for(let y=0;y<H;y+=8){
      for(let x=0;x<W;x+=8){
        for(let i=0;i<64;i++){
          const x2=i&7, y2=i>>3;
          const pos=TILE_ORDER[(x2&3)+(y2&3)*4]+16*(x2>>2)+32*(y2>>2);
          let o;
          if(format===0){
            o=offs+pos*4; if(o+3<data.length){const a=data[o],b=data[o+1],g=data[o+2],r=data[o+3];put(x+x2,y+y2,r,g,b,a);}
          } else if(format===1){
            o=offs+pos*3; if(o+2<data.length){const b=data[o],g=data[o+1],r=data[o+2];put(x+x2,y+y2,r,g,b,255);}
          } else if(format>=2&&format<=4){
            o=offs+pos*2; if(o+1<data.length)put(x+x2,y+y2,...color16(view.getUint16(o,true),format));
          } else if(format===5){
            o=offs+pos*2; if(o+1<data.length){const a=data[o],l=data[o+1];put(x+x2,y+y2,l,l,l,a);}
          } else if(format===7){
            o=offs+pos; if(o<data.length){const l=data[o];put(x+x2,y+y2,l,l,l,255);}
          } else if(format===8){
            o=offs+pos; if(o<data.length)put(x+x2,y+y2,255,255,255,data[o]);
          } else if(format===9){
            o=offs+pos; if(o<data.length){const v=data[o],l=(v>>4)*17,a=(v&15)*17;put(x+x2,y+y2,l,l,l,a);}
          } else if(format===10||format===11){
            o=offs+(pos>>1); if(o<data.length){const v=((data[o]>>((pos&1)*4))&15)*17; format===10?put(x+x2,y+y2,v,v,v,255):put(x+x2,y+y2,255,255,255,v);}
          }
        }
        offs+=bpt;
      }
    }
  } else if(format===12||format===13){
    for(let y=0;y<H;y+=8){
      for(let x=0;x<W;x+=8){
        for(let iy=0;iy<8;iy+=4){
          for(let ix=0;ix<8;ix+=4){
            let alpha=0xffffffffffffffffn;
            if(format===13){ if(offs+8>data.length)break; alpha=readU64LE(data,offs);offs+=8; }
            if(offs+8>data.length)break;
            const d=readU64LE(data,offs); offs+=8;
            const diff=((d>>33n)&1n)!==0n, flip=((d>>32n)&1n)!==0n;
            let r1,g1,b1,r2,g2,b2;
            if(diff){
              let r=Number((d>>59n)&31n),g=Number((d>>51n)&31n),b=Number((d>>43n)&31n);
              r1=(r<<3)|((r&0x1c)>>2);g1=(g<<3)|((g&0x1c)>>2);b1=(b<<3)|((b&0x1c)>>2);
              r+=sign3(Number((d>>56n)&7n));g+=sign3(Number((d>>48n)&7n));b+=sign3(Number((d>>40n)&7n));
              r2=(r<<3)|((r&0x1c)>>2);g2=(g<<3)|((g&0x1c)>>2);b2=(b<<3)|((b&0x1c)>>2);
            }else{
              r1=Number((d>>60n)&15n)*17;g1=Number((d>>52n)&15n)*17;b1=Number((d>>44n)&15n)*17;
              r2=Number((d>>56n)&15n)*17;g2=Number((d>>48n)&15n)*17;b2=Number((d>>40n)&15n)*17;
            }
            const t1=Number((d>>37n)&7n),t2=Number((d>>34n)&7n);
            for(let py=0;py<4;py++)for(let px=0;px<4;px++){
              const bit=BigInt(px*4+py);
              const val=Number((d>>bit)&1n),neg=((d>>(bit+16n))&1n)!==0n;
              const first=(flip&&py<2)||(!flip&&px<2);
              const base=first?[r1,g1,b1]:[r2,g2,b2];
              const add=ETC1_MODIFIERS[first?t1:t2][val]*(neg?-1:1);
              const a=Number((alpha>>(bit*4n))&15n)*17;
              put(x+ix+px,y+iy+py,base[0]+add,base[1]+add,base[2]+add,a);
            }
          }
        }
      }
    }
  } else {
    throw new Error(`Unsupported 3DS texture format ${format}.`);
  }
  return {width,height,data:out};
}

export function imageDataFromTexture(tex){
  const d=decodeTexture(tex);
  if(typeof ImageData!=='undefined')return new ImageData(d.data,d.width,d.height);
  return d;
}

export function canvasFromTexture(tex){
  if(typeof document==='undefined') throw new Error('canvasFromTexture is browser-only.');
  const d=decodeTexture(tex);
  const c=document.createElement('canvas');c.width=d.width;c.height=d.height;
  const ctx=c.getContext('2d');ctx.putImageData(new ImageData(d.data,d.width,d.height),0,0);
  return c;
}

export function textureMapFromRom(rom){
  const files=[
    'gfx/hopper_cat.bcmdl','gfx/hopper_effect.bcmdl','gfx/hopper_map_floor01.bcmdl',
    'gfx/hopper_map_floor02.bcmdl','gfx/hopper_misc.bcmdl','gfx/hopper_title.bcmdl','gfx/thanks_tex.bcmdl'
  ];
  const map=new Map();
  for(const path of files){
    if(!rom.has(path))continue;
    for(const tex of parseTextures(rom.get(path)))map.set(tex.name,{...tex,source:path});
  }
  return map;
}
