# 3D Hopper — Web Port

A browser reimplementation of Nintendo's unreleased E3 2010 **Tech Demo: 3D Hopper**.

## Asset policy

This repository intentionally contains **no original Nintendo game assets**. The web port asks you to select your own dumped `3D_Hopper.app`/CXI locally. The file never leaves your browser: the site parses the early NCCH/ROFS container and decodes the original CGFX textures in memory.

## Current status

- Early prototype NCCH/ROFS parser
- Original CGFX/BCMDL texture decoder (including ETC1 / ETC1A4)
- ROM-driven title, floor, character/effect textures
- Playable browser reimplementation
- Static GitHub Pages deployment workflow

The original prototype is a June 7, 2010 Nintendo 3DS tech demo. This project is an unofficial preservation/reimplementation project and is not affiliated with Nintendo.
