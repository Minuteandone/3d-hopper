# 3D Hopper — Web Port / ARM source translation

**Play:** https://minuteandone.github.io/3d-hopper/

This project ports Nintendo's unreleased June 2010 **Tech Demo: 3D Hopper** to the browser. You provide your own dumped `3D_Hopper.app`; the ROM stays local in the browser.

This started as a clean-room approximation, but the gameplay layer now reads and translates identified code/data from the original ARM executable rather than inventing its own stages and constants.

## What is actually translated from the executable

The browser verifies the supported build by checking known ARM routine signatures, maps its prototype ExeFS sections, and lifts the original `Game` descriptor.

Implemented source translations include:

- **Stage global constructor `0x16B424..0x16B7E8`** — reconstructs the runtime C++ stage arrays that are only partially initialized in the file image.
- **Floor builder `0x13C034`** — centered grid placement, per-floor extents, floor type/model selection, and runtime floor fields.
- **Stage construction `0x13F550`** — all four original stage descriptors and the Stage 3 rescue-platform counter branch.
- **Gameplay constants from `0x13C81C` and related branches** — fixed 60 Hz update, gravity, landing bounce, horizontal input scales, air steering, fail height.
- **Moving-floor update `0x13DD58`** — original timer wrap and sinusoidal motion, including the 720-frame diagonal platform.
- **Player reset `0x1517DC`** — spawn on the type-2 start floor at the original 7.35-unit clearance.

For this build, that recovers **4 original stages with record counts 10 / 4 / 5 / 3**. The translated physics include `gravity = 0.012/frame`, `bounce = 0.42/frame`, and `air steering lerp = 0.03`. A useful sanity check is that `0.42² / (2×0.012) ≈ 7.35`, matching the original spawn clearance.

## ROM-driven assets

No original Nintendo assets are committed. At runtime the site reads your ROM and decodes:

- early prototype NCCH / ROFS
- CGFX / BCMDL textures, including ETC1 / ETC1A4
- BCSTM DSP-ADPCM audio
- original title, floor, character/effect, goal, congratulations, and thank-you textures
- original looping and congratulations audio streams

## What is still reimplemented

This is **not a full decompilation and not ARM emulation**. The current Three.js renderer still uses replacement primitive geometry for the cat/floors instead of decoding the original BCMDL vertex/index streams, and browser collision is an AABB translation of the recovered floor extents rather than the original engine's complete collision subsystem. Camera presentation is also browser-side.

So the important distinction is: **stage data, several game routines, motion rules, and physics constants are translated from the original executable; rendering/engine plumbing is still a web implementation.**

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

The code-lift tests verify exact stage positions/types, the moving platform vector/period, ARM signatures, and recovered gameplay constants.

## Legal

This is an unofficial preservation/reimplementation project and is not affiliated with Nintendo. No ROM, extracted asset files, or original executable/disassembly are committed.
