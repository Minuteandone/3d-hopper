/**
 * Effect slot table translated from Hopper's original game constructor.
 *
 * The browser keeps this separate from the PEMT parser: these slot numbers and
 * allocation counts come from ARM game code, while emitter binary data comes
 * from gfx/hopper_effect.bcmdl.
 */
export const HOPPER_EFFECT_SLOTS = Object.freeze([
  {slot:0,  name:'hopper_opening01Emitter',      instances:1},
  {slot:1,  name:'hopper_e_stamp01Emitter',      instances:3},
  {slot:2,  name:'hopper_e_star01Emitter',       instances:1},
  {slot:3,  name:'hopper_e_star02Emitter',       instances:1},
  {slot:4,  name:'hopper_e_headpat01Emitter',    instances:3},
  {slot:5,  name:'hopper_e_starshower00Emitter', instances:1},
  {slot:6,  name:'hopper_e_starshower01Emitter', instances:1},
  {slot:7,  name:'hopper_e_starshower02Emitter', instances:1},
  {slot:8,  name:'hopper_e_starshower03Emitter', instances:1},
  {slot:9,  name:'hopper_e_starshower04Emitter', instances:1},
  {slot:10, name:'hopper_e_goal01Emitter',       instances:1},
  {slot:11, name:'hopper_e_goal02Emitter',       instances:1},
  {slot:12, name:'hopper_e_goal03Emitter',       instances:1},
  {slot:13, name:'hopper_e_goal04Emitter',       instances:1},
  {slot:14, name:'hopper_e_goal05Emitter',       instances:1},
  {slot:15, name:'hopper_flooreffect01Emitter',  instances:1},
]);

export const HOPPER_EFFECT_SLOT_BY_NAME = new Map(HOPPER_EFFECT_SLOTS.map(e=>[e.name,e]));

/** Stages 1-3 use goal01/02; Stage 4 switches to goal03/04. */
export function goalEffectSlots(stageIndex){
  if(!Number.isInteger(stageIndex)||stageIndex<0||stageIndex>3)throw new RangeError('stageIndex must be 0..3');
  return stageIndex===3?[12,13]:[10,11];
}

/** The separate ending shower starts at original end-sequence frame 240. */
export const ENDING_STARSHOWER = Object.freeze({slot:5,startFrame:240});

export function bindEffectRegistry(emitterMap){
  return HOPPER_EFFECT_SLOTS.map(entry=>{
    const emitter=emitterMap.get(entry.name);
    if(!emitter)throw new Error(`ROM effect registry is missing ${entry.name} (slot ${entry.slot}).`);
    return {...entry,emitter};
  });
}
