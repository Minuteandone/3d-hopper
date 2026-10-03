import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import { canvasFromTexture } from './cgfx.js';

function makeTexture(asset){
  const tex=new THREE.CanvasTexture(canvasFromTexture(asset));
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=THREE.ClampToEdgeWrapping;tex.wrapT=THREE.ClampToEdgeWrapping;
  tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;
  return tex;
}

function textureForEmitter(name,assets){
  const candidates=
    name.includes('stamp')?['hopper_stamp01']:
    name.includes('headpat')?['hopper_headpat01']:
    name.includes('flooreffect')?['hopper_flooreffect01']:
    name.includes('goal')?['hopper_goal01','hopper_spark01']:
    name.includes('starshower')?['hopper_star01','hopper_spark01']:
    name.includes('star01')||name.includes('star02')?['hopper_star01','hopper_spark01']:
    name.includes('opening')?['hopper_particle01','hopper_spark01']:
    ['hopper_spark01','hopper_particle01'];
  for(const key of candidates)if(assets.has(key))return makeTexture(assets.get(key));
  return null;
}

function roleMotion(role,index,count){
  const angle=(index/Math.max(1,count))*Math.PI*2+Math.random()*.6;
  if(role==='landing-stamp')return {velocity:new THREE.Vector3(0,.025,0),spread:.15,scale:1.1};
  if(role==='floor-effect')return {velocity:new THREE.Vector3(Math.cos(angle)*.035,.04,Math.sin(angle)*.035),spread:.7,scale:.7};
  if(role.includes('goal'))return {velocity:new THREE.Vector3(Math.cos(angle)*(.06+Math.random()*.05),.05+Math.random()*.08,Math.sin(angle)*(.06+Math.random()*.05)),spread:.6,scale:.9};
  if(role.includes('starshower'))return {velocity:new THREE.Vector3((Math.random()-.5)*.06,-.02-Math.random()*.04,(Math.random()-.5)*.06),spread:4.5,scale:.65};
  return {velocity:new THREE.Vector3(Math.cos(angle)*.05,.05+Math.random()*.04,Math.sin(angle)*.05),spread:.5,scale:.7};
}

/**
 * Browser host for original PEMT resources.
 *
 * Resource selection, effect slots, source textures and several numeric inputs
 * are ROM-derived. Particle integration itself is deliberately a Three.js
 * approximation until NintendoWare's early PEMT runtime is fully translated.
 */
export class HopperEffectHost {
  constructor(scene,assets,registry){
    this.scene=scene;this.assets=assets;this.registry=registry;this.live=[];
    this.textures=new Map();
  }

  #texture(entry){
    if(!this.textures.has(entry.slot))this.textures.set(entry.slot,textureForEmitter(entry.name,this.assets));
    return this.textures.get(entry.slot);
  }

  spawnSlot(slot,position,{roleOverride=null}={}){
    const entry=this.registry[slot];if(!entry)return [];
    const emitter=entry.emitter,role=roleOverride??entry.role,texture=this.#texture(entry);
    // valueC8 strongly tracks authored burst density in Hopper, but its formal
    // NintendoWare field name is still unknown; keep this use heuristic.
    const authored=Math.max(1,Math.min(32,emitter.common.valueC8||1));
    const count=role==='landing-stamp'?1:authored;
    const lifeFrames=Math.max(8,Math.min(180,emitter.common.valueD4||45));
    const baseScale=Math.max(.25,Math.min(2.4,Number.isFinite(emitter.common.valueC0f32)?emitter.common.valueC0f32:1));
    const made=[];
    for(let i=0;i<count;i++){
      const mat=new THREE.SpriteMaterial({map:texture,color:0xffffff,transparent:true,depthWrite:false});
      const sprite=new THREE.Sprite(mat),motion=roleMotion(role,i,count);
      sprite.position.copy(position);
      sprite.position.x+=(Math.random()-.5)*motion.spread;
      sprite.position.y+=(Math.random()-.5)*motion.spread*.35;
      sprite.position.z+=(Math.random()-.5)*motion.spread;
      const scale=baseScale*motion.scale*(.7+Math.random()*.6);sprite.scale.set(scale,scale,1);
      this.scene.add(sprite);
      const particle={sprite,velocity:motion.velocity,age:0,life:lifeFrames/60,role,startScale:scale};
      this.live.push(particle);made.push(particle);
    }
    return made;
  }

  update(dt){
    const frames=dt*60;
    for(let i=this.live.length-1;i>=0;i--){
      const p=this.live[i];p.age+=dt;
      p.sprite.position.addScaledVector(p.velocity,frames);
      if(p.role.includes('starshower'))p.velocity.y-=.0015*frames;
      else p.velocity.y-=.0025*frames;
      const t=Math.max(0,1-p.age/p.life);p.sprite.material.opacity=t;
      if(p.role==='landing-stamp'){const s=p.startScale*(1+(1-t)*.8);p.sprite.scale.set(s,s,1);}
      if(p.age>=p.life){this.scene.remove(p.sprite);p.sprite.material.dispose();this.live.splice(i,1);}
    }
  }

  clear(){
    for(const p of this.live){this.scene.remove(p.sprite);p.sprite.material.dispose();}
    this.live.length=0;
  }

  dispose(){
    this.clear();
    for(const tex of this.textures.values())tex?.dispose?.();
    this.textures.clear();
  }
}
