import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import { canvasFromTexture } from './cgfx.js';
import { textureCoordinateIndexForMapper } from './models.js';

const FLAG_CLAMP_HIGHLIGHT=1;
const FLAG_DISTRIBUTION0=2;
const FLAG_DISTRIBUTION1=4;
const FLAG_GEOMETRIC0=8;
const FLAG_GEOMETRIC1=16;
const FLAG_REFLECTION=32;

function wrapModeToThree(mode){
  if(mode===2)return THREE.RepeatWrapping;
  if(mode===3)return THREE.MirroredRepeatWrapping;
  return THREE.ClampToEdgeWrapping;
}

function makeRawTexture(asset,mapper){
  const tex=new THREE.CanvasTexture(canvasFromTexture(asset));
  tex.colorSpace=THREE.NoColorSpace;
  tex.wrapS=wrapModeToThree(mapper?.wrapS??0);
  tex.wrapT=wrapModeToThree(mapper?.wrapT??0);
  tex.magFilter=(mapper?.magFilter??1)?THREE.LinearFilter:THREE.NearestFilter;
  tex.minFilter=(mapper?.minFilter??1)?THREE.LinearFilter:THREE.NearestFilter;
  tex.generateMipmaps=false;
  return tex;
}

function uvMatrix(coordinator){
  const out=new THREE.Matrix3();
  const m=coordinator?.matrix;
  if(!m?.length)return out.identity();
  out.set(m[0],m[4],m[3], m[1],m[5],m[7], 0,0,1);
  return out;
}

function makeLutTexture(table){
  if(!table?.absolute)throw new Error('Live Hopper shader currently supports absolute lighting LUTs only.');
  const data=new Float32Array(256*4);
  for(let i=0;i<256;i++){
    const v=table.samples[i];
    data[i*4]=v;data[i*4+1]=v;data[i*4+2]=v;data[i*4+3]=1;
  }
  const tex=new THREE.DataTexture(data,256,1,THREE.RGBAFormat,THREE.FloatType);
  tex.colorSpace=THREE.NoColorSpace;
  tex.minFilter=THREE.NearestFilter;tex.magFilter=THREE.NearestFilter;
  tex.wrapS=THREE.ClampToEdgeWrapping;tex.wrapT=THREE.ClampToEdgeWrapping;
  tex.generateMipmaps=false;tex.needsUpdate=true;
  return tex;
}

function resolveLut(selector,luts){
  if(!selector?.sampler)return null;
  const resource=luts?.get(selector.sampler.resourceName);
  const table=resource?.tableMap?.get(selector.sampler.tableName);
  if(!table)throw new Error(`Missing Hopper lighting LUT ${selector.sampler.resourceName}/${selector.sampler.tableName}.`);
  return table;
}

function sourceExpr(code,stageIndex){
  if(code===0)return 'primaryColor';
  if(code===1)return 'primaryFragment';
  if(code===2)return 'secondaryFragment';
  if(code>=3&&code<=6)return `tex${code-3}`;
  if(code===0xd)return 'previousBuffer';
  if(code===0xe)return `constant${stageIndex}`;
  if(code===0xf)return 'previous';
  throw new Error(`Unsupported live PICA TexEnv source 0x${code.toString(16)}.`);
}

function colorModifierExpr(code,src){
  if(code===0)return `${src}.rgb`;
  if(code===1)return `(vec3(1.0)-${src}.rgb)`;
  if(code===2)return `vec3(${src}.a)`;
  if(code===3)return `vec3(1.0-${src}.a)`;
  if(code===4)return `vec3(${src}.r)`;
  if(code===5)return `vec3(1.0-${src}.r)`;
  if(code===8)return `vec3(${src}.g)`;
  if(code===9)return `vec3(1.0-${src}.g)`;
  if(code===12)return `vec3(${src}.b)`;
  if(code===13)return `vec3(1.0-${src}.b)`;
  throw new Error(`Unsupported live PICA color modifier 0x${code.toString(16)}.`);
}

function alphaModifierExpr(code,src){
  const values=[
    `${src}.a`,`(1.0-${src}.a)`, `${src}.r`,`(1.0-${src}.r)`,
    `${src}.g`,`(1.0-${src}.g)`, `${src}.b`,`(1.0-${src}.b)`,
  ];
  if(code<0||code>=values.length)throw new Error(`Unsupported live PICA alpha modifier 0x${code.toString(16)}.`);
  return values[code];
}

function combineColorExpr(mode,a,b,c){
  if(mode===0)return a;
  if(mode===1)return `(${a}*${b})`;
  if(mode===2)return `min(vec3(1.0),${a}+${b})`;
  if(mode===3)return `clamp(${a}+${b}-vec3(0.5019607843137255),0.0,1.0)`;
  if(mode===4)return `(${a}*${c}+${b}*(vec3(1.0)-${c}))`;
  if(mode===5)return `max(vec3(0.0),${a}-${b})`;
  if(mode===8)return `min(vec3(1.0),${a}*${b}+${c})`;
  if(mode===9)return `(min(vec3(1.0),${a}+${b})*${c})`;
  throw new Error(`Unsupported live PICA color operation ${mode}.`);
}

function combineAlphaExpr(mode,a,b,c){
  if(mode===0)return a;
  if(mode===1)return `(${a}*${b})`;
  if(mode===2)return `min(1.0,${a}+${b})`;
  if(mode===3)return `clamp(${a}+${b}-0.5019607843137255,0.0,1.0)`;
  if(mode===4)return `(${a}*${c}+${b}*(1.0-${c}))`;
  if(mode===5)return `max(0.0,${a}-${b})`;
  if(mode===8)return `min(1.0,${a}*${b}+${c})`;
  if(mode===9)return `(min(1.0,${a}+${b})*${c})`;
  throw new Error(`Unsupported live PICA alpha operation ${mode}.`);
}

function q8(expr){return `(floor(clamp(${expr},0.0,1.0)*255.0)/255.0)`;}

function buildTexEnvCode(fragmentShader){
  return fragmentShader.stages.map((stage,i)=>{
    const cs=stage.colorSources.map(code=>sourceExpr(code,i));
    const as=stage.alphaSources.map(code=>sourceExpr(code,i));
    const cm=cs.map((src,n)=>colorModifierExpr(stage.colorModifiers[n]??0,src));
    const am=as.map((src,n)=>alphaModifierExpr(stage.alphaModifiers[n]??0,src));
    const color=combineColorExpr(stage.colorMode,cm[0],cm[1],cm[2]);
    const alpha=combineAlphaExpr(stage.alphaMode,am[0],am[1],am[2]);
    const constant=stage.constantRgba.map(v=>(v/255).toFixed(9)).join(',');
    return `
      vec4 constant${i}=vec4(${constant});
      previous=vec4(
        ${q8(`(${color})*${stage.colorMultiplier??1}.0`)},
        ${q8(`(${alpha})*${stage.alphaMultiplier??1}.0`)}
      );`;
  }).join('\n');
}

function lutInputExpr(selector){
  switch(selector?.inputCommand){
    case 0:return 'dot(n,h)';
    case 1:return 'dot(v,h)';
    case 2:return 'dot(n,v)';
    case 3:return 'dot(l,n)';
    default:throw new Error(`Live Hopper shader does not yet use LUT input ${selector?.inputCommand}.`);
  }
}

function buildLightingCode(material,lutUniforms){
  const config=material.fragmentShader.fragmentLighting;
  if(config.flags&FLAG_REFLECTION)throw new Error('Reflection LUT lighting is not used by supported Hopper cat materials.');
  const table=material.fragmentShader.fragmentLightingTable;
  let d0='1.0',d1='1.0';
  if(config.flags&FLAG_DISTRIBUTION0){
    const selector=table?.distribution0;
    lutUniforms.push({name:'uLutD0',selector});
    d0=`sampleAbsoluteLut(uLutD0,${lutInputExpr(selector)},${selector.scaleValue}.0)`;
  }
  if(config.flags&FLAG_DISTRIBUTION1){
    const selector=table?.distribution1;
    lutUniforms.push({name:'uLutD1',selector});
    d1=`sampleAbsoluteLut(uLutD1,${lutInputExpr(selector)},${selector.scaleValue}.0)`;
  }
  return `
    vec3 n=normalize(vNormal);
    vec3 v=normalize(vViewPosition);
    vec3 l=normalize((viewMatrix*vec4(uLightDirection,0.0)).xyz);
    vec3 h=normalize(v+l);
    float cosLN=dot(l,n);
    float ln=max(cosLN,0.0);

    vec3 primaryRgb=uEmission.rgb+
      uAmbient.rgb*uSceneAmbient.rgb+
      uAmbient.rgb*uLightAmbient.rgb+
      uDiffuse.rgb*uLightDiffuse.rgb*clamp(ln,0.0,1.0);

    vec3 spec0=uSpecular0.rgb*${d0};
    vec3 spec1=uSpecular1.rgb*${d1};
    float hh=abs(dot(h,h));
    float geometric=hh>0.0?ln/hh:0.0;
    ${config.flags&FLAG_GEOMETRIC0?'spec0*=geometric;':''}
    ${config.flags&FLAG_GEOMETRIC1?'spec1*=geometric;':''}
    vec3 secondaryRgb=spec0*uLightSpecular0.rgb+spec1*uLightSpecular1.rgb;
    ${config.flags&FLAG_CLAMP_HIGHLIGHT?'if(cosLN<0.0)secondaryRgb=vec3(0.0);':''}
    vec4 primaryFragment=vec4(clamp(primaryRgb,0.0,1.0),1.0);
    vec4 secondaryFragment=vec4(clamp(secondaryRgb,0.0,1.0),1.0);
  `;
}

function makeTextureUniforms(material,textures,uniforms,owned){
  const declarations=[],vertexLines=[],fragmentLines=[];
  for(let i=0;i<material.textureMappers.length&&i<4;i++){
    const mapper=material.textureMappers[i];
    if(!mapper?.textureName||!textures.has(mapper.textureName))continue;
    const coordIndex=textureCoordinateIndexForMapper(material.texCoordConfig,i);
    const coord=material.textureCoordinators[coordIndex];
    if(!coord||coord.mappingMethod!==0||coord.sourceCoordinate<0||coord.sourceCoordinate>2){
      throw new Error(`Unsupported Hopper texture coordinate for ${material.name} mapper ${i}.`);
    }
    const tex=makeRawTexture(textures.get(mapper.textureName),mapper);owned.push(tex);
    uniforms[`uTex${i}`]={value:tex};
    uniforms[`uTexMatrix${i}`]={value:uvMatrix(coord)};
    declarations.push(`uniform sampler2D uTex${i}; uniform mat3 uTexMatrix${i}; varying vec2 vTexUv${i};`);
    const attr=coord.sourceCoordinate===0?'uv':coord.sourceCoordinate===1?'uv1':'uv2';
    vertexLines.push(`vTexUv${i}=(uTexMatrix${i}*vec3(${attr},1.0)).xy;`);
    fragmentLines.push(`vec4 tex${i}=texture2D(uTex${i},vTexUv${i});`);
  }
  for(let i=0;i<4;i++)if(!fragmentLines.some(line=>line.startsWith(`vec4 tex${i}=`)))fragmentLines.push(`vec4 tex${i}=vec4(1.0);`);
  return {declarations:declarations.join('\n'),vertexLines:vertexLines.join('\n'),fragmentLines:fragmentLines.join('\n')};
}

function alphaDiscardCode(alphaTest){
  if(!alphaTest?.enabled)return '';
  const ref=(alphaTest.reference??0)/255;
  const a='previous.a';
  const cond=[
    'true','false', `abs(${a}-${ref})>0.0019607843`, `abs(${a}-${ref})<=0.0019607843`,
    `${a}>=${ref}`,`${a}>${ref}`,`${a}<=${ref}`,`${a}<${ref}`,
  ][alphaTest.function];
  if(cond===undefined)throw new Error(`Unsupported PICA alpha test function ${alphaTest.function}.`);
  return `if(${cond})discard;`;
}

function makeSide(cullMode){
  return cullMode===2?THREE.FrontSide:cullMode===1?THREE.BackSide:THREE.DoubleSide;
}
function depthFuncToThree(code){
  return [THREE.NeverDepth,THREE.AlwaysDepth,THREE.EqualDepth,THREE.NotEqualDepth,THREE.LessDepth,THREE.LessEqualDepth,THREE.GreaterDepth,THREE.GreaterEqualDepth][code]??THREE.LessEqualDepth;
}

export function canUseLivePicaMaterial(material,renderResources){
  if(!material?.fragmentShader||!renderResources?.fragmentLights||!renderResources?.luts)return false;
  if(material.lightSetIndex!==1)return false;
  if(!['hoppingMt','nekopperMt'].includes(material.name))return false;
  return renderResources.fragmentLights.has('Light1');
}

export function makeLivePicaMaterial(material,textures,renderResources){
  if(!canUseLivePicaMaterial(material,renderResources))throw new Error(`Unsupported live PICA material ${material?.name}.`);
  const light=renderResources.fragmentLights.get('Light1');
  const owned=[];
  const uniforms={
    uEmission:{value:new THREE.Vector4(...material.materialColor.emission)},
    uAmbient:{value:new THREE.Vector4(...material.materialColor.ambient)},
    uDiffuse:{value:new THREE.Vector4(...material.materialColor.diffuse)},
    uSpecular0:{value:new THREE.Vector4(...material.materialColor.specular0)},
    uSpecular1:{value:new THREE.Vector4(...material.materialColor.specular1)},
    // Scene/environment ambient has not yet been recovered for Hopper.
    uSceneAmbient:{value:new THREE.Vector4(0,0,0,1)},
    uLightAmbient:{value:new THREE.Vector4(...light.ambient)},
    uLightDiffuse:{value:new THREE.Vector4(...light.diffuse)},
    uLightSpecular0:{value:new THREE.Vector4(...light.specular0)},
    uLightSpecular1:{value:new THREE.Vector4(...light.specular1)},
    uLightDirection:{value:new THREE.Vector3(...light.direction)},
  };
  const tex=makeTextureUniforms(material,textures,uniforms,owned);
  const lutUniforms=[];
  const lightingCode=buildLightingCode(material,lutUniforms);
  for(const item of lutUniforms){
    const table=resolveLut(item.selector,renderResources.luts);
    const lutTex=makeLutTexture(table);owned.push(lutTex);
    uniforms[item.name]={value:lutTex};
  }

  const shader=new THREE.ShaderMaterial({
    uniforms,
    vertexColors:true,
    transparent:!!(material.blend?.enabled&&!(material.blend.colorSource===1&&material.blend.colorDestination===0)),
    side:makeSide(material.rasterization?.cullMode??0),
    depthTest:material.depth?.testEnabled??true,
    depthWrite:material.depth?.writeEnabled??true,
    depthFunc:depthFuncToThree(material.depth?.compareCode),
    toneMapped:false,
    fog:false,
    vertexShader:`
      attribute vec4 color;
      attribute vec2 uv1;
      attribute vec2 uv2;
      varying vec4 vPrimaryColor;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      ${tex.declarations}
      #include <common>
      #include <skinning_pars_vertex>
      void main(){
        vPrimaryColor=color;
        ${tex.vertexLines}
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>
        vNormal=normalize(transformedNormal);
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mvPosition=modelViewMatrix*vec4(transformed,1.0);
        gl_Position=projectionMatrix*mvPosition;
        vViewPosition=-mvPosition.xyz;
      }
    `,
    fragmentShader:`
      precision highp float;
      varying vec4 vPrimaryColor;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      uniform vec4 uEmission,uAmbient,uDiffuse,uSpecular0,uSpecular1;
      uniform vec4 uSceneAmbient,uLightAmbient,uLightDiffuse,uLightSpecular0,uLightSpecular1;
      uniform vec3 uLightDirection;
      ${tex.declarations}
      ${lutUniforms.map(x=>`uniform sampler2D ${x.name};`).join('\n')}
      float sampleAbsoluteLut(sampler2D tex,float inputValue,float scaleValue){
        float x=clamp(inputValue,0.0,1.0);
        float p=x*255.0;
        float i=floor(p),t=p-i;
        float a=texture2D(tex,vec2((i+0.5)/256.0,0.5)).r;
        float b=texture2D(tex,vec2((min(i+1.0,255.0)+0.5)/256.0,0.5)).r;
        return min(mix(a,b,t),1.0/scaleValue)*scaleValue;
      }
      void main(){
        vec4 primaryColor=clamp(vPrimaryColor,0.0,1.0);
        vec4 previousBuffer=vec4(0.0);
        vec4 previous=vec4(0.0);
        ${tex.fragmentLines}
        ${lightingCode}
        ${buildTexEnvCode(material.fragmentShader)}
        ${alphaDiscardCode(material.fragmentShader.alphaTest)}
        gl_FragColor=previous;
      }
    `,
  });
  shader.name=`Hopper PICA ${material.name}`;
  shader.userData.hopperOwnedTextures=owned;
  shader.userData.hopperPicaMaterial=true;
  shader.userData.hopperSceneAmbientRecovered=false;
  shader.userData.hopperBumpPending=material.fragmentShader.fragmentLighting.bumpMode!==0;
  return shader;
}
