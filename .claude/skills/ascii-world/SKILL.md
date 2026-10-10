---
name: ascii-world
description: Work on ASCII World (/ascii) — the Three.js game rendered as ASCII glyphs on the GPU. Use for any change to its visuals, characters, weather, dungeon, spells, controls or performance, and to take verification screenshots.
---

# ASCII World (`ascii/`)

Files: `ascii/index.html` (HUD, buttons, CSS; loads `./game.js?v=N` — **bump N on every change** so phones/raw.githack/Pages do not serve a stale script), `ascii/game.js` (everything else, ES module), `ascii/vendor/three.module.min.js` (Three.js r160, vendored).

## Render pipeline — world-space ASCII (like the reference)

Glyphs are printed **on the surfaces in the 3D world**, not on a screen grid: near objects get big letters, far ones small, slanted with the surface; between glyphs is the dark background `uBg`.

1. Every surface fragment shader (`STD_FS`, ground) calls `cellGrid(p, n, k, cen)` (in `GLYPHF`, fragment-only because it uses `dFdx`): a triplanar world grid (cell `.085 × .15 m` × `k` × `uCellK`; ground cells 1.5× taller), returns grid coords and the **cell centre**. Pattern + lighting are evaluated at the centre, so each glyph has one flat colour.
2. `asciiOut(c, w, set)` picks the glyph by brightness and prints it with `textureGrad` on the atlas (mipmaps make far text soft): set 0 = density ramp `WRAMP` (sorted by real ink coverage of the font, per-cell random jitter for letter variety), 1 = foliage `. : o O 0 Q @ 8`, 2 = water `. - ~ =`, 3 = ground (only bright things like cobbles print).
3. Per-material glyph size: `stdMat({cell})` — scenery 1, tree leaves .72, characters .48, items .4. `plain: true` skips glyphs (editor rings).
4. Grass = thin real blades (no glyphs), tile shifted ahead of the camera (`uGOff`). Rain = thin streaks. Snow and particles = additive glyph billboards (`*`, `o`, fire `@$&%#*`, runes) — `emit()` assigns `o.g` (atlas index).
5. Scene → `sceneRT` (full res, 8-bit, MSAA from quality preset) → `brightMat` + `blurMat` bloom → `finalMat` (calm grade, vignette; tone-mapped raw in «ASCII: выкл» mode). `U.uAscii` switches glyphs off everywhere.
6. Scenery dissolves within 5.5 m of the camera and in a window around the hero when it is in front of them (`uPN`), so the third-person camera is never blocked.

Camera: third person behind the hero (`pitch .6`, dist ≈10.5 on phones, fov 58/46); the editor lerps to a higher top-down view (`edPitch`). Detail button = world glyph scale `CELLK` (крупно 1.45 … ультра .55).

## Materials / lighting

- All meshes use `stdMat({color, emis, rim, pat, sway, fill, mode})` (custom GLSL, flat normals via `dFdx/dFdy`). `pat`: 1 bricks, 2 floor slabs, 3 leafy noise. `emis > 1` blooms.
- Lighting = `uAmb` + moon (`uMoonDir/uMoonCol`) + up to `MAXL = 8` point lights. Each frame call `L(x,y,z,radius,r,g,b)`; `pushLights()` keeps the 8 nearest the player.
- Glyph brightness curve lives in `cellMat` (`v*1.7`, `pow(…,1.1)` per sub-zone; edge threshold `.22`; ramp kept unless an edge glyph fits better than `ramp cost × 1.15`) and colour normalisation (`.22 + m*1.5`). Tune there for a globally brighter/denser look; tune per-object colour for local changes.

## World

- Forest: `pathZ(x)` path (same formula in JS and GLSL), trees/rocks instanced, collision via `circles` (spatial hash) + `boxes`. Ruins door at `DOOR`, campfire at `CAMP`.
- Grass: 70k instanced blades wrapped around `uFocus` in a `GRASS_TILE` square; wind = travelling noise gusts + flutter, pushed away from `uPlayer`. Excluded on the path, ruins box and campfire.
- Weather presets `WX` (keys 1–5): rain/snow instanced streaks wrapped around the camera, lightning `flash`, fog. Values are lerped into `Wc`.
- Dungeon: 48×48 tile map (`TS = 2` m), instanced floor/walls, braziers, monsters with glowing eyes, exit ring `D.exit`.
- Characters: `makeCharacter()` builds the low-poly mage (robe, mantle, cloak, beard, hat with bent tip, sleeves, hands, boots, staff + crystal `orbM`). `animChar()` animates walk, cast (right arm), cloak and hat tip. Player and NPCs share it; colours via options.

## Map data, terrain, editor, items, events

- **Map = data** `MAP = {v, nextId, props, items, ter, events?}` in `localStorage['ascii-map-v1']`. `defaultMap()` builds the forest, the mountain (`MOUNT`), the stream (`RIVER` polyline), a hamlet and two event zones.
- **Terrain**: 257×257 heightmap + water mask, 1 m grid over ±128 m (`TER.h`, `TER.w`), uploaded as an RG32F texture `tTer`; GLSL `terS(xz)` (bilinear `texelFetch`) is in `COMMON`, JS `terH/terW`. Ground mesh is a 200×200 grid displaced in the vertex shader; slopes turn rocky, water (`w > .45`) is drawn with glyph code `.945` → `~ - =`. Grass, props, items, NPCs, hero, camera focus and `screenToWorld` (iterates onto the heightmap) all follow the terrain. Water slows the hero. Saved packed (`terPack`: Int16 cm + Uint8, base64).
- **Props**: `{id, t, x, z, y (offset above ground), r (yaw), rx, rz (tilt), s, tag}`; `PROP` registry (tree, bush, rock, house, wall, fence, crate, torch, area 🎯), `PPARTS` = local part matrices, world = `propBase(p) × local`. Collision: circles + oriented boxes (`propBoxes`, yaw only; props raised > 2 m do not collide). The selected prop is excluded from the instanced meshes and drawn in `selG`, so dragging/rotating is cheap; `rebuildProps(ED.sel)` rebuilds the rest.
- **Editor** (`ED`, «редактор», key **B**): tabs Объекты / Рельеф / События. Select tool → inspector `#insp` (yaw slider + ±5°/15° buttons, tilt X/Z, height, scale/radius, tag, copy, delete, «на землю»), drag the selected object to move, «▦ сетка» snaps 0.5 m / 15°. New objects are auto-selected. Terrain brushes: raise, lower, smooth, flatten, water, dry (+size/strength). Two fingers = pan + pinch zoom, wheel = zoom, right-drag = pan, WASD pans, R rotates, Del deletes, Ctrl+Z undo (props, items, terrain snapshots).
- **Events & quests**: see `EVENTS.md` next to this file (JSON triggers/conditions/actions, `ascii/events.json`, in-game editor, dialog box `#dlg`, quest tracker `#quests`).
- **Items** (`ITEMS` registry), world items `worldItems`, inventory `inv` (20 slots). **All item state changes go through `act({type: 'pickup'|'drop'|'move'|'use', …})`** — future network messages. Save: `localStorage['ascii-save-v1']` (`inv`, world items, hp, quest state). Interact prompt `#pick` (key **E**): item pickup or 💬 talk to the nearest NPC.
- Font: `ascii/vendor/jetbrains-mono-latin-500-normal.woff2` (OFL) loaded with `FontFace` (top-level await) before the glyph atlas is built.

## Performance / quality

- `QUAL` presets (низкое / среднее / высокое): pixel ratio, grass share, prop draw radius (`view`), glyph overlap in `finalMat` (`uNb` 0 = single cell), bloom passes, particle cap, rain share. Button «⚙» cycles авто → низкое → среднее → высокое (`localStorage['ascii-quality']`). Auto: first guess from `deviceMemory`/`hardwareConcurrency`/screen pixels, then steps down when frames > 34 ms and up (max twice) when < 19 ms.
- Props are instanced only within `Q().view` of the camera (`buildPropMeshes`, rebuilt when the camera moves > 30 % of the radius); collision still covers the whole map. Crown blobs are icosahedron detail 1 — leaf detail comes from the noise cut-out.
- Grass shading: meadow patches, clumps, wind sheen on bent tips (`vGust`), moon back-light at the tips, contact shadow under the hero (also on the ground).

## Checklist for changes

- Keep alpha codes intact in any new shader (opaque materials only; blending would corrupt the code).
- New light sources → `L(...)` in `update()`; new emissive particles → `emit({...})` (`mode: RUNEM` for runes).
- Mobile: every new action needs a button in `.btns` too.
- Run `node .claude/skills/ascii-world/screenshot.mjs <out-dir>` (server on :8765 first) and look at: forest ASCII, character close-up, fine detail, raw mode, storm, dungeon. Check the console output for shader errors (`PAGEERR`/`CONSOLE error`).
