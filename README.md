# 3D Hopper — Web Port / ARM source translation

**Play:** https://minuteandone.github.io/3d-hopper/

This project ports Nintendo's unreleased June 2010 **Tech Demo: 3D Hopper** to the browser. You provide your own dumped `3D_Hopper.app`; the ROM stays local in the browser.

This started as a clean-room approximation. It now verifies the supported executable build, translates identified ARM game routines/data, and decodes the prototype's original BCMDL model geometry/skeletons directly from the user-supplied ROM.

## What is actually translated from the executable

The browser verifies known ARM routine signatures, maps the prototype ExeFS sections, and lifts the original `Game` descriptor.

Implemented source translations include:

- **Stage global constructor `0x16B424..0x16B7E8`** — reconstructs runtime C++ stage arrays that are only partially initialized in the file image.
- **Floor builder `0x13C034`** — centered grid placement, per-floor extents, model choice/scaling, and runtime floor fields.
- **Stage construction `0x13F550`** — all four original stage descriptors and the Stage 3 rescue-platform counter branch.
- **Gameplay routine `0x13C81C` and related branches** — fixed 60 Hz update, gravity, landing bounce, horizontal input scales, air steering, and fail height.
- **Moving-floor update `0x13DD58`** — original timer wrap and sinusoidal motion, including the 720-frame diagonal platform.
- **Player reset `0x1517DC`** — spawn on the type-2 start floor at the original 7.35-unit clearance.

For this build, that recovers **4 original stages with record counts 10 / 4 / 5 / 3**. The translated physics include `gravity = 0.012/frame`, `bounce = 0.42/frame`, airborne input `0.15`, grounded input `0.25`, and air steering lerp `0.03`.

## Original ROM models and assets

No original Nintendo assets are committed. At runtime the site reads your ROM and decodes:

- early prototype NCCH / ExeFS / ROFS
- CGFX / BCMDL textures, including ETC1 / ETC1A4
- **BCMDL vertex/index streams and skeletons**
- the original **`neko_hopping_model`** cat/pogo mesh, including its **24-bone skeleton**
- original **`hopper_floor01_model`** and **`hopper_floor02_model`** geometry
- BCSTM DSP-ADPCM audio
- original title, effects, goal, congratulations, and thank-you textures
- original looping and congratulations audio streams

The model parser is checked against this build's real buffers: the cat's three shapes contain **494 / 211 / 21 vertices**, while each floor model has **52 vertices**. Index validation ensures every decoded face points inside the corresponding real vertex buffer.

## What is still reimplemented

This is **not full decompilation or ARM emulation**. The browser supplies the host engine around the recovered game logic.

Remaining fidelity gaps include:

- the original PICA200 material/shader combiner is approximated with Three.js materials;
- the 48-frame `neko_hopping_jump` CANM clip is present in the ROM, but this unusually early 2010 CANM transform layout is not yet translated, so the real skeleton is currently shown in its bind pose;
- effect/goal CMDLs in this prototype are emitter containers with no static triangle stream; their original ROM textures are used as billboards until that emitter format is translated;
- collision is a browser translation of the recovered floor extents rather than the complete original engine collision subsystem;
- camera/stereoscopic presentation is browser-side.

So the current split is: **original executable data/rules + original model geometry/skeletons/textures/audio, running through a browser implementation of the surrounding engine.**

## Controls

- **Move:** WASD, arrow keys, touch D-pad, or gamepad stick
- **Bounce:** automatic, as in the original pogo mechanic
- **Depth:** browser camera/depth slider
- **Audio:** ROM audio toggle

## Tests

With your own ROM locally:

```sh
npm run test:rom -- /path/to/3D_Hopper.app
npm run test:code -- /path/to/3D_Hopper.app
npm run test:runtime -- /path/to/3D_Hopper.app
```

The tests validate the ROM filesystem/assets, original BCMDL mesh/index/skeleton data, executable signatures, exact recovered stage positions/types, moving-platform vector/period, rescue-floor behavior, and gameplay constants.

## Legal

This is an unofficial preservation/reimplementation project and is not affiliated with Nintendo. No ROM, extracted asset files, original executable bytes, or raw disassembly are committed.
