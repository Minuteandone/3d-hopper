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

## Gameplay constants — verified values, semantics still under audit

The following literal floating-point values are verified at the noted gameplay/setup code locations: `0.012`, `0.006`, `0.5`, `24`, `47`, `0.15`, `0.25`, `0.03`, `0.2`, `-25`, and `7.35`. A `0.42` literal is also used in a landing-related branch.

Earlier revisions of this document over-labeled these values as a complete fixed-60-Hz physics model. That was not justified. The executable clearly uses them in motion/state code, but exact units and responsibilities must come from translating the surrounding instructions, not from the values alone.

Likewise, routine `0x1517DC` was previously called "player reset." That was incorrect. It is a much larger state-dependent setup/update routine that is called from reset/progression paths.

## Moving floor

The ordinary path in `0x13DD58..0x13DF18` increments a per-floor timer, wraps it at the record period, and computes a sine phase. The desired center is:

`basePosition + motionOffset * sin(2π * timer / period)`

The runtime stores a velocity toward that desired position and applies the previous velocity on the next original frame, which the JavaScript runtime preserves.

## BCMDL model decoding

The browser now also decodes the prototype's original static/skinned model data rather than replacing the cat and floors with primitive meshes.

Validated model facts from this build:

- `neko_hopping_model`: three shapes with **494 / 211 / 21 vertices**.
- The cat skeleton contains **24 bones**; bone palettes, indices, and weights are recovered from the shape primitive sets.
- `hopper_floor01_model` and `hopper_floor02_model`: **52 vertices each**, with approximately 10×10-unit authored floor bounds.
- The floor builder's original X/Z scale is `spacing * 0.1`; its Y model scale is `0.4`.
- Material TXOB references recover the original `hopping`, `nekopper`, and floor textures.
- Every decoded index stream is bounds-checked against its corresponding real vertex buffer.

The cat file also contains `neko_hopping_jump`, a 48-frame CANM skeletal animation. The parser decodes its transform-member flags plus 59 Hermite128 curves across 18 bone tracks. The live port does **not** currently trigger the clip, because the original controller timing/activation path has not yet been proven.

The effect resource contains **16 `PEMT` emitter objects**. Their exact binary boundaries are now parsed by emitter kind: kind 8 = `0xDC` bytes, kind 1 = `0xF0`, kind 4 = `0xF8`. This matters because dictionary order is not physical order (for example, `goal05` lives much earlier in the file).

The ARM constructor's 16-slot registry is also translated:

- slot 0 opening
- slot 1 stamp (3 instances)
- slots 2-3 star01/star02
- slot 4 headpat (3 instances)
- slots 5-9 starshower00..04
- slots 10-14 goal01..05
- slot 15 floor effect

The resource-slot table is useful for tracing references, but earlier revisions promoted several call-site interpretations into named activation rules too early. The live port no longer triggers PEMT effects until those controller paths are proven end-to-end.

## Current fidelity boundary

The web port now combines **translated original game routines/data** with **original BCMDL geometry, skeletons, textures, and BCSTM audio**. It still does not execute Nintendo's original graphics engine or ARM CPU directly. Three.js supplies the host renderer, PICA200 material behavior is approximated, collision is a browser translation of the recovered floor extents, PEMT particle integration, CANM controller timing, the complete movement/collision state machine, and the original camera/stereo path remain to be decoded.
