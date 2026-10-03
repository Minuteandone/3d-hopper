# 3D Hopper — Web Port

A browser reimplementation of Nintendo's unreleased E3 2010 **Tech Demo: 3D Hopper**.

## Play

The GitHub Pages build is designed to run at `https://minuteandone.github.io/3d-hopper/`. Choose your own dumped `3D_Hopper.app` in the page to start.

## Asset policy

This repository intentionally contains **no original Nintendo game assets**. The web port asks you to select your own dumped `.app`/CXI locally. The file never leaves your browser: the site parses the early NCCH/ROFS container and decodes the original CGFX textures in memory.

## What is implemented

- Early prototype NCCH/ROFS parser
- Prototype CGFX/BCMDL texture parser
- 3DS texture decoding, including ETC1 / ETC1A4
- 24 original textures loaded from the ROM at runtime
- ROM-driven title, floor, goal/effect, congratulations, and thank-you artwork
- A clean-room playable pogo-platforming implementation with keyboard, touch, and gamepad controls
- Two browser stages and a depth/camera slider
- GitHub Pages deployment workflow

## Fidelity note

The original executable is **not emulated**. The current port uses the original decoded texture assets, but the player/platform geometry, physics, and level layouts are clean-room replacements. The BCMDL mesh geometry and BCSTM audio streams are present in the ROM and are good future targets for a more exact port.

The original prototype is a June 7, 2010 Nintendo 3DS tech demo. This project is an unofficial preservation/reimplementation project and is not affiliated with Nintendo.
