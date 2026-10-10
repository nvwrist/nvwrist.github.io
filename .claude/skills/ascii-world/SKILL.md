---
name: ascii-world
description: Work on ASCII World (/ascii) — the Three.js game rendered as ASCII glyphs on the GPU. Use for any change to its visuals, characters, weather, dungeon, spells, controls or performance, and to take verification screenshots.
---

# ASCII World (`ascii/`)

Files: `ascii/index.html` (HUD, buttons, CSS; loads `./game.js?v=N` — **bump N on every change** so phones/raw.githack/Pages do not serve a stale script), `ascii/game.js` (everything else, ES module), `ascii/vendor/three.module.min.js` (Three.js r160, vendored).

## Render pipeline (per frame, `render()`)

1. **Scene → `sceneRT`** at `cols*SX × rows*SY` texels (SX=3, SY=6 → each cell = 3×3 sub-zones of 1×2 texels; half-float when supported). Every material writes **alpha as a glyph-set code**:
   - `a ≈ 1` → hybrid glyph choice: flat cells use the density ramp `RAMP`; cells with contrast inside (max−min of the 3×3 sub-zone luminance > 0.22) are matched by **shape** against `EDGE` glyphs (`_ - / \ | ( ) < > [ ] ' , ^ L J 7 T …`) using 3×3 coverage descriptors (`desc` DataTexture, computed from the atlas at startup). This is what makes silhouettes and edges detailed;
   - `0.1…0.9` → directional stroke `- / | \`, angle = screen-space direction (grass blades, rain);
   - `0.935…0.95` (`.945`) → water `. - ~ =`;
   - `0.905…0.935` (`mode: .92`) → foliage: round glyphs `. : o O 0 Q @ 8` by light (trees: 4 species in `TREES` — oak, poplar, young, old — trunk + branches + crown blobs, chosen by `treeKind(p)` = `p.v` or id-based, selectable in the inspector; canopies cut into see-through leaf clumps by 3D noise `vnoise3` in `STD_FS`);
   - `< 0.09` (`RUNEM = .05`) → random rune glyphs (spell particles, portal motes).
2. **`cellMat` → `cellRT`** (one texel per cell): reads the SX×SY block with `texelFetch`, builds the 3×3 sub-luminances, averages colour, takes the brightest texel's code, stores colour + glyph index (`a = index/255`). Glyph indices refer to `GLYPHS` = all printable ASCII (`SHAPES`, index = charCode−32) + 4 custom strokes (`DIRG`).
3. **Bloom**: `brightMat` (threshold 1.0 on half-float — only emissive > 1 glows) → 2× separable `blurMat`.
3b. **`auxMat` → `auxRT`** (one texel per cell): r = glyph rotation (strokes: exact screen angle of the blade/rain; other glyphs: small lean along the luminance gradient), g = stroke flag.
4. **`finalMat` → screen**: for each pixel looks at the 3×3 neighbouring cells, draws each glyph rotated, with a tiny per-cell jitter, strokes stretched 1.75× so they overlap (soft grass); combined with `max`. Then a calm palette (desaturate 26 %, soft highlight roll-off), dim vignette background and bloom.
   Old description: glyph atlas (`atlas`, built on a 2D canvas, mipmapped, sampled with `textureGrad`) × cell colour + bloom.
   - `asciiOn = false` (button «ASCII», key **V**) skips 1–2: scene goes to full-res `rawRT` (MSAA 4) and `finalMat` (`uRaw=1`) tone-maps it. Useful to inspect models.
   - Detail level (button «детали», key **Z**): `DETAIL.big/small` = cell width in CSS px (крупно/средне/мелко/ультра: 9/6/5/4 desktop, 8/5/4/3 phone; default средне). Saved in `localStorage['ascii-view']`.

Camera aspect is `cols*cellW / rows*cellH` (the grid overhangs the screen by < 1 cell). Screen→world (`screenToWorld`) and name tags (`placeTag`) use the same mapping — keep them in sync if you change it.

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
