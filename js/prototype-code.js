// Source translation notes for the June 7, 2010 3D Hopper executable.
//
// These values are read from the unencrypted ARM .text in 3D_Hopper.app.
// We keep the ROM out of git and translate the observed behavior instead of
// shipping Nintendo's executable bytes.
//
// Main gameplay motion routine: 0x0013c81c
//   0x13cce4 = 0.012f  normal vertical acceleration per 60 Hz tick
//   0x13ccf8 = 0.006f  half acceleration used when state byte == 2
//   0x13d328 = 0.42f   base vertical impulse added after a floor collision
//   0x13d7c4 = 0.03f   horizontal velocity interpolation factor
//   0x13d7c8 = 0.20f   analog movement-vector scale
// State byte lives at game object + 0x28dac.
// Initialization at 0x1406d4 writes state 0.
// 0x13ca90 writes state 1, 0x13d198 writes 2, 0x13d184 writes 3,
// 0x13eba4 writes 4, and 0x13e890 writes 5.

export const PROTOTYPE_HZ=60;
export const PROTOTYPE_DT=1/PROTOTYPE_HZ;
export const HopperState=Object.freeze({S0:0,S1:1,S2:2,S3:3,S4:4,S5:5});
export const HopperMotion=Object.freeze({
  gravityPerTick:.012,
  transitionGravityPerTick:.006,
  collisionImpulseBase:.42,
  steeringLerp:.03,
  analogScale:.20,
});

export function stepPrototypeVelocity(body,input,state=HopperState.S1){
  const targetX=input.x*HopperMotion.analogScale;
  const targetZ=input.z*HopperMotion.analogScale;
  body.vx+=(targetX-body.vx)*HopperMotion.steeringLerp;
  body.vz+=(targetZ-body.vz)*HopperMotion.steeringLerp;
  body.vy-=state===HopperState.S2?HopperMotion.transitionGravityPerTick:HopperMotion.gravityPerTick;
}

export function integratePrototypePosition(body){
  body.x+=body.vx;body.y+=body.vy;body.z+=body.vz;
}

export function prototypeBounce(body,platformBounce=0){
  body.vy=HopperMotion.collisionImpulseBase+platformBounce;
}
