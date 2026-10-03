# 3D Hopper — Web Port

A browser reimplementation of Nintendo's unreleased E3 2010 **Tech Demo: 3D Hopper**.

**Play:** https://minuteandone.github.io/3d-hopper/

## Asset policy

This repository intentionally contains **no original Nintendo game assets**. The web port asks you to select your own dumped `3D_Hopper.app`/CXI locally. The file never leaves your browser: the site parses the early NCCH/ROFS container and decodes the original CGFX textures and BCSTM audio in memory.

## Current status

- Early prototype NCCH/ROFS parser
- Original CGFX/BCMDL texture decoder, including ETC1 / ETC1A4
- Original BCSTM DSP-ADPCM audio decoder
- ROM-driven title, floor, character/effect textures, thank-you art, looping stream, and congratulations music
- Playable Three.js pogo-platforming reimplementation
- Keyboard, touch, and gamepad controls
- Adjustable depth/camera effect inspired by the 3DS demo's depth-gauging gimmick
- Static GitHub Pages deployment workflow
- ROM validation harness: `npm run test:rom -- /path/to/3D_Hopper.app`

The original BCMDL **mesh geometry/animation is not being executed as original game code** yet; the current playable scene uses new Three.js geometry while sampling the graphics from the supplied ROM. Likewise, this is a reimplementation rather than ARM emulation.

## Controls

- **Move:** WASD, arrow keys, touch D-pad, or gamepad stick
- **Bounce:** automatic
- **Depth:** slider below the viewport
- **Audio:** ROM audio toggle

## Legal

The original prototype is a June 7, 2010 Nintendo 3DS tech demo. This project is an unofficial preservation/reimplementation project and is not affiliated with Nintendo. No ROM or extracted asset files are committed.
