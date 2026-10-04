import { evaluateTexEnvStage,evaluateTexEnv,alphaTestPass } from '../js/texenv.js';

const stage=(over={})=>({
  colorSources:[0,3,14],alphaSources:[0,3,14],
  colorModifiers:[0,0,0],alphaModifiers:[0,0,0],
  colorMode:0,alphaMode:0,
  constantRgba:[10,20,30,40],
  colorMultiplier:1,alphaMultiplier:1,
  ...over,
});
const ctx={
  primaryColor:[100,120,140,160],
  primaryFragmentColor:[80,100,120,140],
  secondaryFragmentColor:[20,30,40,50],
  textures:[[60,70,80,90],[200,180,160,140],[5,10,15,20]],
  previousBuffer:[9,8,7,6],
};

let out=evaluateTexEnvStage(stage(),ctx);
if(JSON.stringify(out)!=='[100,120,140,160]')throw new Error(`replace/source mismatch ${JSON.stringify(out)}`);

out=evaluateTexEnvStage(stage({
  colorSources:[1,3,14],alphaSources:[1,3,14],
  colorMode:3,alphaMode:3,
}),ctx);
if(JSON.stringify(out)!=='[12,42,72,102]')throw new Error(`AddSigned mismatch ${JSON.stringify(out)}`);

out=evaluateTexEnvStage(stage({
  colorSources:[1,3,14],alphaSources:[1,3,14],
  colorMode:1,alphaMode:1,
}),ctx);
if(JSON.stringify(out)!=='[18,27,37,49]')throw new Error(`modulate mismatch ${JSON.stringify(out)}`);

out=evaluateTexEnvStage(stage({
  colorSources:[2,15,14],alphaSources:[15,3,14],
  colorMode:2,alphaMode:2,
}),ctx,[12,42,72,102]);
if(JSON.stringify(out)!=='[32,72,112,192]')throw new Error(`previous/add mismatch ${JSON.stringify(out)}`);

out=evaluateTexEnvStage(stage({
  colorSources:[14,0,0],alphaSources:[14,0,0],
  colorModifiers:[1,0,0],alphaModifiers:[1,0,0],
  colorMode:0,alphaMode:0,colorMultiplier:2,alphaMultiplier:2,
}),ctx);
if(JSON.stringify(out)!=='[255,255,255,255]')throw new Error(`modifier/scale mismatch ${JSON.stringify(out)}`);

const shader={stages:[
  stage({colorSources:[1,3,14],alphaSources:[1,3,14],colorMode:3,alphaMode:3}),
  stage({colorSources:[2,15,14],alphaSources:[15,3,14],colorMode:2,alphaMode:2}),
]};
out=evaluateTexEnv(shader,ctx);
if(JSON.stringify(out)!=='[32,72,112,192]')throw new Error(`multi-stage chain mismatch ${JSON.stringify(out)}`);

for(const [fn,expected] of [[0,false],[1,true],[2,true],[3,false],[4,false],[5,true],[6,false],[7,true]]){
  if(alphaTestPass(128,{enabled:true,function:fn,reference:128})!==expected)throw new Error(`alpha test ${fn} mismatch`);
}
if(!alphaTestPass(0,{enabled:false,function:0,reference:255}))throw new Error('disabled alpha test must pass');

console.log('PICA TexEnv arithmetic OK');
