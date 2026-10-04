import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import { canvasFromTexture } from './cgfx.js';
import { VertexUsage } from './models.js';
import { sampleTransformTrack } from './animation.js';

function matrix4From34(m){const out=new THREE.Matrix4();out.set(m[0],m[1],m[2],m[3],m[4],m[5],m[6],m[7],m[8],m[9],m[10],m[11],0,0,0,1);return out;}
function wrapModeToThree(mode){
  if(mode===2)return THREE.RepeatWrapping;
  if(mode===3)return THREE.MirroredRepeatWrapping;
  return THREE.ClampToEdgeWrapping;
}
function makeTexture(asset,mapper,coordinator){
  const tex=new THREE.CanvasTexture(canvasFromTexture(asset));
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=wrapModeToThree(mapper?.wrapS??0);
  tex.wrapT=wrapModeToThree(mapper?.wrapT??0);
  tex.magFilter=(mapper?.magFilter??1)?THREE.LinearFilter:THREE.NearestFilter;
  tex.minFilter=(mapper?.minFilter??1)?THREE.LinearFilter:THREE.NearestFilter;
  tex.generateMipmaps=false;
  if(coordinator?.mappingMethod===0){
    tex.channel=coordinator.sourceCoordinate??0;
    const m=coordinator.matrix;
    if(m?.length===12){
      tex.matrixAutoUpdate=false;
      tex.matrix.set(
        m[0],m[4],m[3],
        m[1],m[5],m[7],
        0,0,1
      );
    }
  }
  return tex;
}
function depthFuncToThree(code){
  return [
    THREE.NeverDepth,
    THREE.AlwaysDepth,
    THREE.EqualDepth,
    THREE.NotEqualDepth,
    THREE.LessDepth,
    THREE.LessEqualDepth,
    THREE.GreaterDepth,
    THREE.GreaterEqualDepth,
  ][code]??THREE.LessEqualDepth;
}
function makeMaterial(material,textures){
  const mapperIndex=Number.isInteger(material?.visibleColorMapper)?material.visibleColorMapper:0;
  const mapper=material?.textureMappers?.[mapperIndex]??material?.textureMappers?.[0]??null;
  const textureName=mapper?.textureName??material?.textureRefs?.[mapperIndex]??material?.textureRefs?.[0]??null;
  const coordinator=material?.visibleTextureCoordinate??null;
  const map=textureName&&textures.has(textureName)?makeTexture(textures.get(textureName),mapper,coordinator):null;
  const blend=material?.blend;
  const alphaBlend=!!(blend?.enabled&&!(blend.colorSource===1&&blend.colorDestination===0));
  const cullMode=material?.rasterization?.cullMode??0;
  const side=cullMode===2?THREE.FrontSide:cullMode===1?THREE.BackSide:THREE.DoubleSide;
  return new THREE.MeshStandardMaterial({
    map,color:0xffffff,roughness:.9,metalness:0,
    transparent:alphaBlend,
    alphaTest:0,
    side,
    depthTest:material?.depth?.testEnabled??true,
    depthWrite:material?.depth?.writeEnabled??true,
    depthFunc:depthFuncToThree(material?.depth?.compareCode),
  });
}
function buildBones(model,group){
  if(!model.skeleton?.bones?.length)return null;
  const source=[...model.skeleton.bones].sort((a,b)=>a.jointId-b.jointId);
  const bones=source.map(src=>{const bone=new THREE.Bone();bone.name=src.name;matrix4From34(src.localMatrix).decompose(bone.position,bone.quaternion,bone.scale);bone.userData.hopperJointId=src.jointId;return bone;});
  const jointToIndex=new Map(source.map((src,i)=>[src.jointId,i]));
  source.forEach((src,i)=>{const parentIndex=jointToIndex.get(src.parentId);if(parentIndex===undefined)group.add(bones[i]);else bones[parentIndex].add(bones[i]);});
  group.updateMatrixWorld(true);
  const boneInverses=source.map(src=>matrix4From34(src.inverseBaseMatrix));
  const skeleton=new THREE.Skeleton(bones,boneInverses);
  return {skeleton,jointToIndex,bones,source};
}
function copyAttribute(geometry,name,attr,itemSize){
  if(!attr)return;
  geometry.setAttribute(name,new THREE.BufferAttribute(new Float32Array(attr.values),itemSize));
}
function bindWorldForPrimitiveSet(primitiveSet,bones){
  if(!bones||primitiveSet.skinningMode===2||!primitiveSet.relatedBones.length)return null;
  const jointId=primitiveSet.relatedBones[0],boneIndex=bones.jointToIndex.get(jointId);
  if(boneIndex===undefined)return null;
  return matrix4From34(bones.source[boneIndex].inverseBaseMatrix).invert();
}
function copyNormalAttribute(geometry,shape,primitiveSet,bones){
  const attr=shape.byUsage.get(VertexUsage.Normal);if(!attr)return;
  const values=new Float32Array(attr.count*3);
  const bindWorld=bindWorldForPrimitiveSet(primitiveSet,bones);
  const normalMatrix=bindWorld?new THREE.Matrix3().getNormalMatrix(bindWorld):null;
  const v=new THREE.Vector3();
  for(let i=0;i<attr.count;i++){
    v.set(
      attr.values[i*attr.components],
      attr.components>1?attr.values[i*attr.components+1]:0,
      attr.components>2?attr.values[i*attr.components+2]:0
    );
    if(normalMatrix)v.applyMatrix3(normalMatrix).normalize();
    values[i*3]=v.x;values[i*3+1]=v.y;values[i*3+2]=v.z;
  }
  geometry.setAttribute('normal',new THREE.BufferAttribute(values,3));
}
function copyPositionAttribute(geometry,shape,primitiveSet,bones){
  const attr=shape.byUsage.get(VertexUsage.Position);if(!attr)return;
  const values=new Float32Array(attr.count*3);
  // Non-smooth CGFX pieces are authored in a single related bone's local
  // bind space. Convert the vertex itself into model bind space here.
  // Shape.PositionOffset is deliberately NOT included: NintendoWare applies
  // that as a separate shape/model transform after vertex processing.
  const bindWorld=bindWorldForPrimitiveSet(primitiveSet,bones);
  const v=new THREE.Vector3();
  for(let i=0;i<attr.count;i++){
    v.set(
      attr.values[i*attr.components],
      attr.components>1?attr.values[i*attr.components+1]:0,
      attr.components>2?attr.values[i*attr.components+2]:0
    );
    if(bindWorld)v.applyMatrix4(bindWorld);
    values[i*3]=v.x;values[i*3+1]=v.y;values[i*3+2]=v.z;
  }
  geometry.setAttribute('position',new THREE.BufferAttribute(values,3));
}
function skinAttributes(shape,primitiveSet,bones){
  if(!bones)return null;
  const boneAttr=shape.byUsage.get(VertexUsage.BoneIndex),weightAttr=shape.byUsage.get(VertexUsage.BoneWeight),count=shape.vertexCount;
  const indices=new Uint16Array(count*4),weights=new Float32Array(count*4),palette=primitiveSet.relatedBones;
  for(let i=0;i<count;i++){
    if(boneAttr){
      let sum=0;
      const components=primitiveSet.skinningMode===2?Math.min(4,boneAttr.components):1;
      for(let j=0;j<components;j++){
        const paletteIndex=Math.round(boneAttr.values[i*boneAttr.components+j]);
        const jointId=palette[paletteIndex]??palette[0]??paletteIndex;
        indices[i*4+j]=bones.jointToIndex.get(jointId)??0;
        const w=primitiveSet.skinningMode===2
          ?(weightAttr?.values[i*weightAttr.components+j]??(j===0?1:0))
          :1;
        weights[i*4+j]=w;sum+=w;
      }
      if(sum>0&&Math.abs(sum-1)>.0001)for(let j=0;j<4;j++)weights[i*4+j]/=sum;
    }else{const jointId=palette[0]??0;indices[i*4]=bones.jointToIndex.get(jointId)??0;weights[i*4]=1;}
  }
  return {indices,weights};
}
function makeGeometry(shape,primitiveSet,indexStream,bones){
  const geometry=new THREE.BufferGeometry();
  copyPositionAttribute(geometry,shape,primitiveSet,bones);
  copyNormalAttribute(geometry,shape,primitiveSet,bones);
  copyAttribute(geometry,'color',shape.byUsage.get(VertexUsage.Color),4);
  copyAttribute(geometry,'uv',shape.byUsage.get(VertexUsage.TextureCoordinate0),2);
  copyAttribute(geometry,'uv1',shape.byUsage.get(VertexUsage.TextureCoordinate1),2);
  copyAttribute(geometry,'uv2',shape.byUsage.get(VertexUsage.TextureCoordinate2),2);
  const skin=skinAttributes(shape,primitiveSet,bones);
  if(skin){geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skin.indices,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skin.weights,4));}
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indexStream.indices),1));
  if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

export function createModelInstance(model,textures,{shadows=true}={}){
  const group=new THREE.Group();group.name=model.name;group.userData.hopperModel=model;
  const bones=buildBones(model,group);
  const materials=model.materials.map(m=>makeMaterial(m,textures));
  for(const meshInfo of model.meshes){
    if(meshInfo.visible===false)continue;
    const shape=model.shapes[meshInfo.shapeIndex];if(!shape)continue;
    const material=materials[meshInfo.materialIndex]??new THREE.MeshStandardMaterial({color:0xffffff});
    for(const primitiveSet of shape.primitiveSets)for(const primitive of primitiveSet.primitives)for(const stream of primitive.indexStreams){
      if(stream.indices.length<3)continue;
      const geometry=makeGeometry(shape,primitiveSet,stream,bones);
      const skinned=!!geometry.getAttribute('skinIndex');
      const object=skinned?new THREE.SkinnedMesh(geometry,material):new THREE.Mesh(geometry,material);
      object.name=meshInfo.name||`${model.name}_mesh`;object.castShadow=shadows;object.receiveShadow=shadows;
      if(skinned)object.bind(bones.skeleton,new THREE.Matrix4());
      // CMDLViewer applies Shape.PositionOffset with glTranslate *after*
      // vertex/bone processing. Keep it outside the skinning transform.
      object.position.set(shape.positionOffset[0],shape.positionOffset[1],shape.positionOffset[2]);
      group.add(object);
    }
  }
  group.userData.hopperSkeleton=bones;group.userData.hopperMaterials=materials;group.userData.hopperAnimationMaps=new Map();
  return group;
}

function setBindTransform(bone,source){
  bone.position.set(source.translation[0],source.translation[1],source.translation[2]);
  bone.rotation.set(source.rotation[0],source.rotation[1],source.rotation[2],'XYZ');
  bone.scale.set(source.scale[0],source.scale[1],source.scale[2]);
}

export function resetSkeletonPose(root){
  const rig=root.userData.hopperSkeleton;if(!rig)return;
  for(let i=0;i<rig.bones.length;i++)setBindTransform(rig.bones[i],rig.source[i]);
  root.updateMatrixWorld(true);rig.skeleton.update();
}

export function applySkeletalAnimation(root,animation,frame,{loop=true}={}){
  const rig=root.userData.hopperSkeleton;if(!rig||!animation)return;
  const count=animation.frameCount||1;
  const f=loop?((frame%count)+count)%count:Math.max(0,Math.min(count,frame));
  let tracks=root.userData.hopperAnimationMaps.get(animation.name);
  if(!tracks){tracks=new Map(animation.tracks.map(track=>[track.path||track.name,track]));root.userData.hopperAnimationMaps.set(animation.name,tracks);}
  for(let i=0;i<rig.bones.length;i++){
    const bone=rig.bones[i],source=rig.source[i],track=tracks.get(source.name);
    if(!track){setBindTransform(bone,source);continue;}
    const t=sampleTransformTrack(track,f,source);
    bone.position.set(t.translation[0],t.translation[1],t.translation[2]);
    bone.rotation.set(t.rotation[0],t.rotation[1],t.rotation[2],'XYZ');
    bone.scale.set(t.scale[0],t.scale[1],t.scale[2]);
  }
  root.updateMatrixWorld(true);rig.skeleton.update();
}

export function disposeModelInstance(root){
  const materials=new Set();root.traverse(obj=>{obj.geometry?.dispose?.();for(const mat of (Array.isArray(obj.material)?obj.material:[obj.material]))if(mat){materials.add(mat);mat.map?.dispose?.();}});
  for(const mat of materials)mat.dispose?.();
}
