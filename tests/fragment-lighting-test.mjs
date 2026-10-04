import { evaluateFragmentLighting, FragmentLightingFlags, decodeBumpSurface } from '../js/fragment-lighting.js';

const constantTable=value=>({
  absolute:true,
  samples:Float32Array.from({length:256},()=>value),
});
const lutMap=new Map([
  ['testLut',{tableMap:new Map([['D0',constantTable(.5)]])}],
]);

const selector={
  inputCommand:0,
  inputName:'CosNormalHalf',
  scaleCommand:0,
  scaleValue:1,
  sampler:{resourceName:'testLut',tableName:'D0'},
};
const material={
  materialColor:{
    emission:[0,0,0,0],
    ambient:[0,0,0,1],
    diffuse:[1,.5,.25,1],
    specular0:[1,.5,.25,0],
    specular1:[0,0,0,0],
  },
  fragmentShader:{
    fragmentLighting:{
      flags:FragmentLightingFlags.Distribution0|FragmentLightingFlags.GeometricFactor0,
    },
    fragmentLightingTable:{distribution0:selector},
  },
};

const close=(a,b,e=1e-7)=>Math.abs(a-b)<=e;
const eq4=(actual,expected,label)=>{
  if(actual.length!==4)throw new Error(`${label}: expected vec4`);
  for(let i=0;i<4;i++)if(!close(actual[i],expected[i]))throw new Error(`${label}[${i}] ${actual[i]} != ${expected[i]}`);
};

let out=evaluateFragmentLighting({
  material,lutMap,
  normal:[0,0,1],view:[0,0,1],light:[0,0,1],
  sceneAmbient:[0,0,0,1],
  lightAmbient:[0,0,0,1],
  lightDiffuse:[1,1,1,1],
  lightSpecular0:[1,1,1,1],
  lightSpecular1:[1,1,1,1],
});
eq4(out.primary,[1,.5,.25,1],'front primary');
eq4(out.secondary,[.5,.25,.125,1],'front secondary');
if(!close(out.terms.cosLightNormal,1)||!close(out.terms.geometric,1))throw new Error('front lighting terms mismatch');

const clampMaterial={
  ...material,
  fragmentShader:{
    ...material.fragmentShader,
    fragmentLighting:{flags:FragmentLightingFlags.ClampHighlight},
    fragmentLightingTable:null,
  },
};
out=evaluateFragmentLighting({
  material:clampMaterial,lutMap,
  normal:[0,0,1],view:[0,1,0],light:[0,0,-1],
  sceneAmbient:[0,0,0,1],
  lightAmbient:[0,0,0,1],
  lightDiffuse:[1,1,1,1],
  lightSpecular0:[1,1,1,1],
  lightSpecular1:[1,1,1,1],
});
eq4(out.primary,[0,0,0,1],'back primary');
eq4(out.secondary,[0,0,0,1],'back secondary');

console.log('PICA fragment-light equation OK');

const bump=decodeBumpSurface({bumpMode:1,bumpRenormalize:true},[.6,.4,.2,.9]);
if(!close(bump.normal[0],.2)||!close(bump.normal[1],-.2)||
   !close(bump.normal[2],Math.sqrt(.92)))throw new Error(`bump normal mismatch ${JSON.stringify(bump.normal)}`);
if(!close(bump.tangent[0],1)||!close(bump.tangent[1],0)||!close(bump.tangent[2],0))throw new Error('bump tangent fallback mismatch');

const tangentMode=decodeBumpSurface({bumpMode:2,bumpRenormalize:false},[.75,.25,1,1]);
if(!close(tangentMode.normal[2],1)||!close(tangentMode.tangent[0],.5)||
   !close(tangentMode.tangent[1],-.5)||!close(tangentMode.tangent[2],1))throw new Error('tangent bump mode mismatch');
