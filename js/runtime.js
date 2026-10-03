import { movingFloorAt } from './executable.js';

export function createGameState(program){
  return {
    stageIndex:program.initialState.stageIndex,
    stage2ExtraCounter:program.initialState.stage2ExtraCounter,
    currentFloorIndex:0,
    falls:0,
  };
}

/** Translation of the stage-count branch at 0x13F5E8..0x13F60C. */
export function activeStageRecords(program,state,stageIndex=state.stageIndex){
  const stage=program.stages[stageIndex];
  if(!stage)throw new RangeError(`No Hopper stage ${stageIndex}.`);
  let count=stage.count;
  if(stageIndex===2&&state.stage2ExtraCounter===0)count--;
  return stage.records.slice(0,count);
}

/** Translation of the runtime fields populated near the end of floor builder 0x13C034. */
export function createFloorRuntime(record){
  return {
    record,
    index:record.index,
    center:record.position.map((v,i)=>v+record.offset[i]),
    velocity:[0,0,0],
    timer:0,
    activeFlag:record.flag,
    secondaryFlag:0,
    width:record.columns*record.spacing,
    halfHeight:.4,
    depth:record.rows*record.spacing,
  };
}

/**
 * Normal moving-floor update translated from 0x13DD8C..0x13DF18.
 * It preserves the original one-frame velocity staging: current += previous velocity,
 * then the next velocity is calculated from the new sine target.
 */
export function tickFloorRuntime(floor){
  for(let i=0;i<3;i++)floor.center[i]+=floor.velocity[i];
  const r=floor.record;
  if(!(r.parameter>0)||r.secondFlag!==0)return floor;
  const motion=movingFloorAt(r,floor.timer);
  floor.timer=motion.timer;
  for(let i=0;i<3;i++)floor.velocity[i]=motion.position[i]-floor.center[i];
  return floor;
}

/** From the fail/reset branch at 0x13C8A0..0x13C8D0. */
export function noteFall(program,state){
  state.falls++;
  const stage=program.stages[state.stageIndex];
  if(state.stageIndex===2&&state.currentFloorIndex===stage.count-1&&state.stage2ExtraCounter>0){
    state.stage2ExtraCounter--;
  }
}

export function findStartRecord(records){return records.find(r=>r.type===2)??records[0];}
export function findGoalRecord(records){return records.find(r=>r.type===3)??records.at(-1);}

/**
 * Translation of the horizontal-velocity branch at 0x13D4A8..0x13D57C.
 * floorHitThisUpdate is the collision index test (r10 >= 0), not a persistent
 * grounded state.
 */
export function updateHorizontalVelocity(velocity,input,floorHitThisUpdate,physics){
  const next={x:velocity.x,z:velocity.z};
  if(floorHitThisUpdate){
    const tx=input.x*physics.floorHitInputScale;
    const tz=input.z*physics.floorHitInputScale;
    if(Math.abs(next.x)<Math.abs(tx))next.x=tx;
    if(Math.abs(next.z)<Math.abs(tz))next.z=tz;
  }else{
    const tx=input.x*physics.inputScale;
    const tz=input.z*physics.inputScale;
    next.x+=(tx-next.x)*physics.airVelocityLerp;
    next.z+=(tz-next.z)*physics.airVelocityLerp;
  }
  return next;
}
