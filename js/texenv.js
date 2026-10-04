const clamp8=v=>Math.max(0,Math.min(255,Math.trunc(v)));
const vec4=v=>[v?.[0]??0,v?.[1]??0,v?.[2]??0,v?.[3]??0];
const rgb=v=>[v[0],v[1],v[2]];

export const TexEnvSource=Object.freeze({
  PrimaryColor:0,
  PrimaryFragmentColor:1,
  SecondaryFragmentColor:2,
  Texture0:3,
  Texture1:4,
  Texture2:5,
  Texture3:6,
  PreviousBuffer:0xd,
  Constant:0xe,
  Previous:0xf,
});

function sourceColor(code,ctx,stage,previous){
  switch(code){
    case 0:return vec4(ctx.primaryColor);
    case 1:return vec4(ctx.primaryFragmentColor);
    case 2:return vec4(ctx.secondaryFragmentColor);
    case 3:return vec4(ctx.textures?.[0]);
    case 4:return vec4(ctx.textures?.[1]);
    case 5:return vec4(ctx.textures?.[2]);
    case 6:return vec4(ctx.textures?.[3]);
    case 0xd:return vec4(ctx.previousBuffer);
    case 0xe:return vec4(stage.constantRgba);
    case 0xf:return vec4(previous);
    default:throw new Error(`Unsupported PICA TexEnv source 0x${code.toString(16)}.`);
  }
}

function colorModifier(code,value){
  switch(code){
    case 0:return rgb(value);
    case 1:return value.slice(0,3).map(v=>255-v);
    case 2:return [value[3],value[3],value[3]];
    case 3:return [255-value[3],255-value[3],255-value[3]];
    case 4:return [value[0],value[0],value[0]];
    case 5:return [255-value[0],255-value[0],255-value[0]];
    case 8:return [value[1],value[1],value[1]];
    case 9:return [255-value[1],255-value[1],255-value[1]];
    case 12:return [value[2],value[2],value[2]];
    case 13:return [255-value[2],255-value[2],255-value[2]];
    default:throw new Error(`Unsupported PICA color modifier 0x${code.toString(16)}.`);
  }
}

function alphaModifier(code,value){
  const c=[value[3],255-value[3],value[0],255-value[0],value[1],255-value[1],value[2],255-value[2]];
  if(code<0||code>=c.length)throw new Error(`Unsupported PICA alpha modifier 0x${code.toString(16)}.`);
  return c[code];
}

const map3=(a,fn)=>[fn(a[0],0),fn(a[1],1),fn(a[2],2)];
const zip3=(a,b,fn)=>[fn(a[0],b[0],0),fn(a[1],b[1],1),fn(a[2],b[2],2)];

function colorCombine(mode,input){
  const [a,b,c]=input;
  switch(mode){
    case 0:return [...a];
    case 1:return zip3(a,b,(x,y)=>Math.floor(x*y/255));
    case 2:return zip3(a,b,(x,y)=>Math.min(255,x+y));
    case 3:return zip3(a,b,(x,y)=>clamp8(x+y-128));
    case 4:return map3(a,(x,i)=>Math.floor((x*c[i]+b[i]*(255-c[i]))/255));
    case 5:return zip3(a,b,(x,y)=>Math.max(0,x-y));
    case 6:
    case 7:{
      // PICA Dot3 maps both inputs from [0,255] to a signed domain and
      // accumulates the three products back into 8-bit intensity.
      const d=clamp8(
        Math.floor(((a[0]*2-255)*(b[0]*2-255)+128)/256)+
        Math.floor(((a[1]*2-255)*(b[1]*2-255)+128)/256)+
        Math.floor(((a[2]*2-255)*(b[2]*2-255)+128)/256)
      );
      return [d,d,d];
    }
    case 8:return map3(a,(x,i)=>Math.min(255,Math.floor((x*b[i]+255*c[i])/255)));
    case 9:return map3(a,(x,i)=>Math.floor(Math.min(255,x+b[i])*c[i]/255));
    default:throw new Error(`Unsupported PICA color operation ${mode}.`);
  }
}

function alphaCombine(mode,input){
  const [a,b,c]=input;
  switch(mode){
    case 0:return a;
    case 1:return Math.floor(a*b/255);
    case 2:return Math.min(255,a+b);
    case 3:return clamp8(a+b-128);
    case 4:return Math.floor((a*c+b*(255-c))/255);
    case 5:return Math.max(0,a-b);
    case 8:return Math.min(255,Math.floor((a*b+255*c)/255));
    case 9:return Math.floor(Math.min(255,a+b)*c/255);
    default:throw new Error(`Unsupported PICA alpha operation ${mode}.`);
  }
}

function scaled(value,multiplier){
  return clamp8(value*multiplier);
}

export function evaluateTexEnvStage(stage,ctx,previous=[0,0,0,0]){
  const sourcesColor=stage.colorSources.map(code=>sourceColor(code,ctx,stage,previous));
  const sourcesAlpha=stage.alphaSources.map(code=>sourceColor(code,ctx,stage,previous));
  const colorInputs=sourcesColor.map((v,i)=>colorModifier(stage.colorModifiers[i]??0,v));
  const alphaInputs=sourcesAlpha.map((v,i)=>alphaModifier(stage.alphaModifiers[i]??0,v));
  const color=colorCombine(stage.colorMode,colorInputs).map(v=>scaled(v,stage.colorMultiplier??1));
  const alpha=scaled(alphaCombine(stage.alphaMode,alphaInputs),stage.alphaMultiplier??1);
  return [...color,alpha];
}

export function evaluateTexEnv(fragmentShader,ctx){
  if(!fragmentShader?.stages?.length)throw new Error('Fragment shader has no TexEnv stages.');
  let previous=vec4(ctx.initialPrevious);
  for(const stage of fragmentShader.stages)previous=evaluateTexEnvStage(stage,ctx,previous);
  return previous;
}

export function alphaTestPass(alpha,alphaTest){
  if(!alphaTest?.enabled)return true;
  const ref=alphaTest.reference??0;
  switch(alphaTest.function){
    case 0:return false;
    case 1:return true;
    case 2:return alpha===ref;
    case 3:return alpha!==ref;
    case 4:return alpha<ref;
    case 5:return alpha<=ref;
    case 6:return alpha>ref;
    case 7:return alpha>=ref;
    default:throw new Error(`Unsupported PICA alpha test function ${alphaTest.function}.`);
  }
}
