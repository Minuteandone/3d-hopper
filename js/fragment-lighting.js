import { samplePrototypeAbsoluteLut } from './luts.js';

const FLAG_CLAMP_HIGHLIGHT=1;
const FLAG_DISTRIBUTION0=2;
const FLAG_DISTRIBUTION1=4;
const FLAG_GEOMETRIC0=8;
const FLAG_GEOMETRIC1=16;
const FLAG_REFLECTION=32;

const clamp01=v=>Math.max(0,Math.min(1,v));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const length=v=>Math.hypot(v[0],v[1],v[2]);
const normalize=v=>{const n=length(v);return n>0?[v[0]/n,v[1]/n,v[2]/n]:[0,0,0];};
const add3=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mulColor=(a,b)=>[a[0]*b[0],a[1]*b[1],a[2]*b[2],a[3]*b[3]];
const scaleColor=(a,s)=>[a[0]*s,a[1]*s,a[2]*s,a[3]*s];
const addColor=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2],a[3]+b[3]];
const clampColor=a=>a.map(clamp01);

function resolveTable(selector,lutMap){
  if(!selector?.sampler)return null;
  const resource=lutMap.get(selector.sampler.resourceName);
  const table=resource?.tableMap?.get(selector.sampler.tableName);
  if(!table)throw new Error(`Missing lighting LUT ${selector.sampler.resourceName}/${selector.sampler.tableName}.`);
  return table;
}

function inputValue(selector,{normal,view,half,light,tangent,lightDirection}){
  switch(selector.inputCommand){
    case 0:return dot(normal,half);
    case 1:return dot(view,half);
    case 2:return dot(normal,view);
    case 3:return dot(light,normal);
    case 4:
      if(!lightDirection)throw new Error('CosLightSpot requires lightDirection.');
      return dot(light,normalize(lightDirection));
    case 5:{
      if(!tangent)throw new Error('CosPhi requires tangent.');
      const nn=dot(normal,normal)||1;
      const nh=dot(normal,half);
      const projected=[
        half[0]-normal[0]*nh/nn,
        half[1]-normal[1]*nh/nn,
        half[2]-normal[2]*nh/nn,
      ];
      return dot(projected,normalize(tangent));
    }
    default:throw new Error(`Unsupported PICA LUT input ${selector.inputCommand}.`);
  }
}

function sampleSelector(selector,vectors,lutMap){
  const table=resolveTable(selector,lutMap);
  if(!table)return 1;
  return samplePrototypeAbsoluteLut(table,inputValue(selector,vectors),selector.scaleValue??1);
}

/**
 * CPU translation of Hopper's PICA fragment-light portion.
 * It deliberately excludes bump-normal creation, texture combiners,
 * attenuation, and scene/environment discovery.
 *
 * Inputs normal/view/light should already be in the same coordinate space.
 * The view vector points from the fragment toward the camera.
 */
export function evaluateFragmentLighting({
  material,
  lutMap,
  normal,
  view,
  light,
  sceneAmbient=[0,0,0,1],
  lightAmbient=[0,0,0,1],
  lightDiffuse=[1,1,1,1],
  lightSpecular0=[1,1,1,1],
  lightSpecular1=[1,1,1,1],
  twoSidedDiffuse=false,
  tangent=null,
  lightDirection=null,
}){
  const shader=material.fragmentShader;
  if(!shader)throw new Error('Material has no parsed fragment shader.');
  const config=shader.fragmentLighting;
  const table=shader.fragmentLightingTable;
  const colors=material.materialColor;
  const n=normalize(normal),v=normalize(view),l=normalize(light);
  const h=normalize(add3(v,l));
  const cosLN=dot(l,n);
  const ln=twoSidedDiffuse?Math.abs(cosLN):Math.max(cosLN,0);
  const vectors={normal:n,view:v,half:h,light:l,tangent,lightDirection};

  let primary=addColor(colors.emission,mulColor(colors.ambient,sceneAmbient));
  primary=addColor(primary,addColor(
    mulColor(colors.ambient,lightAmbient),
    scaleColor(mulColor(colors.diffuse,lightDiffuse),clamp01(ln))
  ));

  let spec0=[...colors.specular0],spec1=[...colors.specular1];
  if(config.flags&FLAG_DISTRIBUTION0)spec0=scaleColor(spec0,sampleSelector(table?.distribution0,vectors,lutMap));
  if(config.flags&FLAG_DISTRIBUTION1)spec1=scaleColor(spec1,sampleSelector(table?.distribution1,vectors,lutMap));

  let geometric=1;
  if(config.flags&(FLAG_GEOMETRIC0|FLAG_GEOMETRIC1)){
    const hh=Math.abs(dot(h,h));
    geometric=hh>0?ln/hh:0;
    if(config.flags&FLAG_GEOMETRIC0)spec0=scaleColor(spec0,geometric);
    if(config.flags&FLAG_GEOMETRIC1)spec1=scaleColor(spec1,geometric);
  }

  if(config.flags&FLAG_REFLECTION){
    throw new Error('Reflection LUT lighting is not used by Hopper cat materials and is not translated here yet.');
  }

  let secondary=addColor(mulColor(spec0,lightSpecular0),mulColor(spec1,lightSpecular1));
  if((config.flags&FLAG_CLAMP_HIGHLIGHT)&&cosLN<0)secondary=scaleColor(secondary,0);

  return {
    primary:clampColor(primary),
    secondary:clampColor(secondary),
    terms:{cosLightNormal:cosLN,geometric},
  };
}

export const FragmentLightingFlags=Object.freeze({
  ClampHighlight:FLAG_CLAMP_HIGHLIGHT,
  Distribution0:FLAG_DISTRIBUTION0,
  Distribution1:FLAG_DISTRIBUTION1,
  GeometricFactor0:FLAG_GEOMETRIC0,
  GeometricFactor1:FLAG_GEOMETRIC1,
  Reflection:FLAG_REFLECTION,
});
