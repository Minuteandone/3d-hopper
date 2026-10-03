# Reverse-engineering notes — safe/source-level summary

These notes document the translated behavior without containing the original executable or a raw disassembly.

## Executable layout

The June 2010 image uses a prototype NCCH/ExeFS layout. The port maps these virtual sections from the user-supplied ROM:

- `.text` at `0x100000`
- `.ro` at `0x191000`
- `.rw` at `0x19E000`

The `Game` descriptor is at `0x191120`. Its factory points to `0x13EBD4`.

## Stage descriptors

Four descriptors begin at `0x191128`. Their static counts are **10, 4, 5, 3**, with 48-byte floor records.

A floor record contains position, grid columns/rows, spacing, type, motion offset, period, and flags. Crucially, the file image does **not** contain all final positions: these are C++ globals completed by a startup constructor.

### Global constructor

Routine `0x16B424..0x16B7E8` writes the runtime stage coordinates. The browser translates those stores and reads the float values from the ROM's literal pool. This is why the port does not hardcode an invented course.

Recovered highlights:

- Stage 1 climbs through ten single tiles to a type-3 goal at `(8, 15, -16)`.
- Stage 2 contains a 3×2 floor grid centered at `(18, 4, 0)`.
- Stage 3 has a fifth, low rescue floor at `(-9, -3, -27.5)`.
- Stage 4 has a type-4 moving floor based at `(8, 0, -16)`, motion vector `(-8, 0, 8)`, period `720`.

## Stage 3 rescue counter

The game constructor initializes the counter at object offset `+0xDD8` to **2**.

The fail/reset branch decrements it when:
- current stage index is 2 (human Stage 3), and
- the current floor index is the fifth record.

The stage-construction routine checks that counter. Once it reaches zero, it subtracts one from Stage 3's record count, so the fifth rescue floor is no longer built.

## Floor builder

Routine `0x13C034`:
- chooses the alternate floor model for type 3;
- centers multi-tile grids with `0.5 * (1-count) * spacing + index * spacing`;
- scales floor model X/Z from spacing;
- stores runtime collision width as `columns * spacing`;
- stores collision half-height `0.4`;
- stores depth as `rows * spacing`.

## Core pogo physics

Recovered constants used by the translated fixed 60 Hz simulation:

- gravity: `0.012` per frame
- special gravity: `0.006`
- landing bounce: `0.42`
- airborne input scale: `0.15`
- grounded input scale: `0.25`
- airborne velocity lerp: `0.03`
- movement-vector scale: `0.2`
- spawn clearance: `7.35`
- fail Y: `-25`

Landing sets vertical velocity to **platform vertical velocity + 0.42**.

## Moving floor

The ordinary path in `0x13DD58..0x13DF18` increments a per-floor timer, wraps it at the record period, and computes a sine phase. The desired center is:

`basePosition + motionOffset * sin(2π * timer / period)`

The runtime stores a velocity toward that desired position and applies the previous velocity on the next original frame, which the JavaScript runtime preserves.

## Current fidelity boundary

The web port now has real stage/code behavior, but it does not yet decode BCMDL vertex/index data or execute the original graphics/collision engine. Those are the next major fidelity targets.
