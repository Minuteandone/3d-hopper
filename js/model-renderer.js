import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import { canvasFromTexture } from './cgfx.js';
import { VertexUsage } from './models.js';

function matrix4From34(m){const out=new THREE.Matrix4();out.set(m[0],m[1],m[2],m[3],m[4],m[5],m[6],m[7],m[8],m[9],m[10],m[11],0,0,0,1);return out;}
function makeTexture(asset){const tex=new THREE.CanvasTexture(canvasFromTexture(asset));tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=THREE.RepeatWrapping;tex.wrapT=THREE.RepeatWrapping;tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;return tex;}
function makeMaterial(material,textures){
  const refs=material?.textureRefs??[];
  const textureName=[...refs].reverse().find(name=>textures.has(name));
  const map=textureName?makeTexture(textures.get(textureName)):null;
  return new THREE.MeshStandardMaterial({map,color:0xffffff,roughness:.9,metalness:0,transparent:!!map,alphaTest:map?0.01:0,side:THREE.DoubleSide});
}
function buildBones(model,group){
  if(!model.skeleton?.bones?.length)return null;
  const source=[...model.skeleton.bones].sort((a,b)=>a.jointId-b.jointId);
  const bones=source.map(src=>{const bone=new THREE.Bone();bone.name=src.name;matrix4From34(src.localMatrix).decompose(bone.position,bone.quaternion,bone.scale);bone.userData.hopperJointId=src.jointId;return bone;});
  const jointToIndex=new Map(source.map((src,i)=>[src.jointId,i]));
  source.forEach((src,i)=>{const parentIndex=jointToIndex.get(src.parentId);if(parentIndex===undefined)group.add(bones[i]);else bones[parentIndex].add(bones[i]);});
  group.updateMatrixWorld(true);
  const skeleton=new THREE.Skeleton(bones);skeleton.calculateInverses();
  return {skeleton,jointToIndex,bones,source};
}
function copyAttribute(geometry,name,attr,itemSize){if(attr)geometry.setAttribute(name,new THREE.BufferAttribute(new Float32Array(attr.values),itemSize));}
function skinAttributes(shape,primitiveSet,bones){
  if(!bones)return null;
  const boneAttr=shape.byUsage.get(VertexUsage.BoneIndex),weightAttr=shape.byUsage.get(VertexUsage.BoneWeight),count=shape.vertexCount;
  const indices=new Uint16Array(count*4),weights=new Float32Array(count*4),palette=primitiveSet.relatedBones;
  for(let i=0;i<count;i++){
    if(boneAttr){
      let sum=0;
      for(let j=0;j<Math.min(4,boneAttr.components);j++){
        const paletteIndex=Math.round(boneAttr.values[i*boneAttr.components+j]);
        const jointId=palette[paletteIndex]??palette[0]??paletteIndex;
        indices[i*4+j]=bones.jointToIndex.get(jointId)??0;
        const w=weightAttr?.values[i*weightAttr.components+j]??(j===0?1:0);weights[i*4+j]=w;sum+=w;
      }
      if(sum>0&&Math.abs(sum-1)>.0001)for(let j=0;j<4;j++)weights[i*4+j]/=sum;
    }else{const jointId=palette[0]??0;indices[i*4]=bones.jointToIndex.get(jointId)??0;weights[i*4]=1;}
  }
  return {indices,weights};
}
function makeGeometry(shape,primitiveSet,indexStream,bones){
  const geometry=new THREE.BufferGeometry();
  copyAttribute(geometry,'position',shape.byUsage.get(VertexUsage.Position),3);
  copyAttribute(geometry,'normal',shape.byUsage.get(VertexUsage.Normal),3);
  copyAttribute(geometry,'uv',shape.byUsage.get(VertexUsage.TextureCoordinate0),2);
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
      if(!stream.visible||stream.indices.length<3)continue;
      const geometry=makeGeometry(shape,primitiveSet,stream,bones);
      const object=bones?new THREE.SkinnedMesh(geometry,material):new THREE.Mesh(geometry,material);
      object.name=meshInfo.name||`${model.name}_mesh`;object.castShadow=shadows;object.receiveShadow=shadows;
      if(bones)object.bind(bones.skeleton,new THREE.Matrix4());
      group.add(object);
    }
  }
  group.userData.hopperSkeleton=bones;group.userData.hopperMaterials=materials;
  return group;
}
export function disposeModelInstance(root){
  const materials=new Set();root.traverse(obj=>{obj.geometry?.dispose?.();for(const mat of (Array.isArray(obj.material)?obj.material:[obj.material]))if(mat){materials.add(mat);mat.map?.dispose?.();}});
  for(const mat of materials)mat.dispose?.();
}
