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
export function createFloorRuntime(record,floorBuilder={collisionHeight:.4}){
  return {
    record,
    index:record.index,
    center:record.position.map((v,i)=>v+record.offset[i]),
    velocity:[0,0,0],
    timer:0,
    activeFlag:record.flag,
    secondaryFlag:0,
    width:record.columns*record.spacing,
    height:floorBuilder.collisionHeight,
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

function pointOnSegmentAtY(start,end,y){
  const dy=end.y-start.y;
  if(dy===0)return null;
  const t=(y-start.y)/dy;
  return {
    x:start.x+(end.x-start.x)*t,
    y,
    z:start.z+(end.z-start.z)*t,
    t,
  };
}

/**
 * Translation of 0x1520A8. The incoming horizontalCollisionSize is added to
 * the native X/Z extents before halving, so 0.8 expands each side by 0.4.
 */
export function floorContainsHorizontalPoint(floor,x,z,horizontalCollisionSize){
  const halfX=(floor.width+horizontalCollisionSize)*.5;
  const halfZ=(floor.depth+horizontalCollisionSize)*.5;
  return x>=floor.center[0]-halfX&&x<=floor.center[0]+halfX&&
         z>=floor.center[2]-halfZ&&z<=floor.center[2]+halfZ;
}

/** Translation of downward-facing helper 0x13F648. */
export function intersectFloorTop(floor,start,end,horizontalCollisionSize){
  const planeY=floor.center[1]+floor.height*.5;
  if(start.y<planeY||end.y>planeY)return null;
  const hit=pointOnSegmentAtY(start,end,planeY);
  if(!hit||!floorContainsHorizontalPoint(floor,hit.x,hit.z,horizontalCollisionSize))return null;
  return hit;
}

/** Translation of upward-facing helper 0x13F784. */
export function intersectFloorBottom(floor,start,end,horizontalCollisionSize){
  const planeY=floor.center[1]-floor.height*.5;
  if(start.y>planeY||end.y<planeY)return null;
  const hit=pointOnSegmentAtY(start,end,planeY);
  if(!hit||!floorContainsHorizontalPoint(floor,hit.x,hit.z,horizontalCollisionSize))return null;
  return hit;
}

/** State-3 counters reset by 0x13B74C before the final ending update begins. */
export function createEndingRuntime(){
  return {
    mainCounter:0,
    postShowerCounter:0,
    state:3,
    starShowerStarted:false,
  };
}

/**
 * Counter/state portion of dedicated ending updater 0x13E630.
 * Rendering, quaternion interpolation, camera/controller writes, particle
 * activation, and sound calls are surfaced as events rather than guessed here.
 */
export function tickEndingRuntime(runtime,ending,{confirm=false}={}){
  if(runtime.state!==3)return {state:runtime.state,events:[],riseY:0};
  const events=[];
  const frame=runtime.mainCounter;

  if(frame===ending.introUpdates)events.push({type:'frame60-controller',values:[...ending.frame60Controller]});
  if(frame===ending.starShowerUpdate){
    runtime.starShowerStarted=true;
    events.push({type:'starshower',slot:ending.starShowerEffectSlot,y:ending.starShowerY});
  }

  if(frame>ending.starShowerUpdate){
    if(confirm){
      runtime.state=5;
      events.push({type:'enter-state5',reason:'confirm'});
      return {state:runtime.state,events,riseY:ending.risePerUpdate};
    }
    runtime.postShowerCounter++;
    if(runtime.postShowerCounter>=ending.postShowerTimeoutUpdates){
      runtime.state=5;
      events.push({type:'enter-state5',reason:'timeout'});
      return {state:runtime.state,events,riseY:ending.risePerUpdate};
    }
  }

  runtime.mainCounter++;
  return {state:runtime.state,events,riseY:ending.risePerUpdate};
}

function overlapsVerticalSlab(lowerY,upperY,floor){
  const half=floor.height*.5;
  return floor.center[1]+half>=lowerY&&floor.center[1]-half<=upperY;
}
function insideExpandedAxis(value,center,extent,size){
  const half=(extent+size)*.5;
  return value>=center-half&&value<=center+half;
}

/**
 * Translation of 0x13B8AC's lower-point movement/clamping.
 * The routine applies Y first, then clamps X, then clamps Z. The X test uses
 * the old Z coordinate; the Z test uses the already-clamped X coordinate.
 * The upper argument is the separately stored upper collision point from the
 * previous update, matching the native routine.
 */
export function applyLowerSideCollision(lower,upper,movement,floors,horizontalCollisionSize){
  const next={x:lower.x,y:lower.y+movement.y,z:lower.z};

  let x=lower.x+movement.x;
  if(movement.x>0){
    for(const floor of floors){
      if(!overlapsVerticalSlab(next.y,upper.y,floor))continue;
      const boundary=floor.center[0]-(floor.width+horizontalCollisionSize)*.5;
      if(lower.x<=boundary&&x>boundary&&insideExpandedAxis(lower.z,floor.center[2],floor.depth,horizontalCollisionSize))x=boundary;
    }
  }else if(movement.x<0){
    for(const floor of floors){
      if(!overlapsVerticalSlab(next.y,upper.y,floor))continue;
      const boundary=floor.center[0]+(floor.width+horizontalCollisionSize)*.5;
      if(lower.x>=boundary&&x<boundary&&insideExpandedAxis(lower.z,floor.center[2],floor.depth,horizontalCollisionSize))x=boundary;
    }
  }
  next.x=x;

  let z=lower.z+movement.z;
  if(movement.z>0){
    for(const floor of floors){
      if(!overlapsVerticalSlab(next.y,upper.y,floor))continue;
      const boundary=floor.center[2]-(floor.depth+horizontalCollisionSize)*.5;
      if(lower.z<=boundary&&z>boundary&&insideExpandedAxis(next.x,floor.center[0],floor.width,horizontalCollisionSize))z=boundary;
    }
  }else if(movement.z<0){
    for(const floor of floors){
      if(!overlapsVerticalSlab(next.y,upper.y,floor))continue;
      const boundary=floor.center[2]+(floor.depth+horizontalCollisionSize)*.5;
      if(lower.z>=boundary&&z<boundary&&insideExpandedAxis(next.x,floor.center[0],floor.width,horizontalCollisionSize))z=boundary;
    }
  }
  next.z=z;
  return next;
}

/**
 * Collision-body portion of 0x13D5E0..0x13D7E4.
 * Builds the target upper collision point from transformed control input,
 * then sweeps the previous upper point upward through floor bottoms.
 */
export function updateUpperCollisionPoint(lower,previousUpper,input,floors,physics){
  const leanX=input.x*physics.upperLeanInputScale;
  const leanZ=input.z*physics.upperLeanInputScale;
  const leanLength=Math.hypot(leanX,leanZ);
  const up=Math.sqrt(Math.max(0,1-leanLength));
  const length=physics.upperCollisionLength;
  let target={
    x:lower.x+leanX*length,
    y:lower.y+up*length,
    z:lower.z+leanZ*length,
  };

  if(target.y>previousUpper.y){
    for(const floor of floors){
      const hit=intersectFloorBottom(
        floor,previousUpper,target,physics.upperHorizontalCollisionSize
      );
      if(!hit)continue;
      let dx=hit.x-lower.x,dy=hit.y-lower.y,dz=hit.z-lower.z;
      const d=Math.hypot(dx,dy,dz);
      if(d>length&&d>0){
        const scale=length/d;dx*=scale;dy*=scale;dz*=scale;
      }
      target={x:lower.x+dx,y:lower.y+dy,z:lower.z+dz};
      break;
    }
  }
  return target;
}

/**
 * Translation of normal Game view-target update 0x13E598..0x13E620.
 * The view controller follows lower X/Z directly while Y tracks the current
 * floor center with a 0.15 lerp, except when falling below that floor.
 */
export function updateViewTarget(followY,lower,verticalVelocity,currentFloor,lerp){
  const floorY=currentFloor?.center?.[1]??lower.y;
  const y=(verticalVelocity<0&&lower.y<floorY)
    ?lower.y
    :followY+(floorY-followY)*lerp;
  return {x:lower.x,y,z:lower.z};
}

/**
 * Model-controller animation slot clock used by 0x101870.
 * Hopper's cat uses slot 0; the generic controller supports 16 slots.
 */
export function createAnimationSlot(config,{loop=false}={}){
  return {
    current:config.current,
    start:config.start,
    end:config.end,
    step:config.step,
    loop:!!loop,
  };
}

export function retimeAnimationSlot(slot,config){
  slot.current=config.current;
  slot.start=config.start;
  slot.end=config.end;
  slot.step=config.step;
  return slot;
}

/**
 * Translation of the slot-clock portion of 0x101870.
 * The native controller increments before evaluating the animation frame.
 */
export function tickAnimationSlot(slot){
  slot.current+=slot.step;
  if(slot.current>slot.end){
    if(!slot.loop)slot.current=slot.end;
    else{
      while(slot.current>slot.end)slot.current-=slot.end;
      slot.current+=slot.start;
    }
  }
  return slot.current;
}
