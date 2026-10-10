---
name: ascii-world
description: Work on ASCII World (/ascii) — the Three.js game rendered as ASCII glyphs on the GPU. Use for any change to its visuals, characters, weather, dungeon, spells, controls or performance, and to take verification screenshots.
---

# ASCII World (`ascii/`)

Files: `ascii/index.html` (HUD, buttons, CSS; loads `./game.js?v=N` — **bump N on every change** so phones/raw.githack/Pages do not serve a stale script), `ascii/game.js` (everything else, ES module), `ascii/vendor/three.module.min.js` (Three.js r160, vendored).

## Render pipeline — screen-space ASCII + real-geometry overlay (matches the reference)

Glyphs sit in **horizontal rows on a screen grid** (cell `cellW × cellW*1.75` CSS px, `DETAIL.small/big` per «детали» level, default 5 px on phones ≈ 80 columns); only **solid** things are turned into glyphs. Grass, rain, snow, sparks and editor rings are drawn as **real thin geometry on top** — that is what makes the reference look soft.

1. **Scene pass** (`camera.layers = 0`) → `sceneRT` at `W×H × Q().ss` (1–1.5), half-float, `DepthTexture`. Materials write alpha as a glyph-set code: `1` solid (density ramp `WRAMP` sorted by real ink coverage + 3×3 shape match against `EDGE` for contrasty cells), `.92` foliage (`. : o O 0 Q @ 8`), `.945` water (`. - ~ =`).
2. **Overlay pass** (`layers = 1`: grass mesh, rain, snow, particles `pMesh`, cursor/selRing, area rings) → `ovRT` at full drawing-buffer size with MSAA, cleared to transparent. Overlay fragment shaders include `OVF.behindScene()`: they compare their linear depth with `sceneRT.depthTexture` and discard when hidden behind a solid object (trees hide grass etc.). Opaque overlay (grass, rain) writes alpha 1; additive glyph billboards use `ADD_KEEP_ALPHA` (colour adds, alpha untouched).
3. **`cellMat` → `cellRT`** (one texel per cell): 3×6 samples of `sceneRT` per cell → avg colour, brightest texel's code, 3×3 zone luminance → glyph index (`a = index/255`) + normalised colour.
4. **Bloom** from scene + overlay (`brightMat`, threshold .82) → separable blur.
5. **`finalMat`**: glyph atlas sampled per screen cell over the navy background `uBg`, calm grade, then `ascii*(1-ov.a) + ov.rgb`, + bloom, vignette. «ASCII: выкл» renders both layers into `rawRT` (MSAA) and tone-maps it.

Camera: high and centred on the hero like the reference — forest pitch .98 rad (~56°), dungeon 1.22, distance 18 (portrait) / 16, fov 42 / 34; editor lerps to pitch 1.15, distance 22 × zoom. Follow uses the real frame time (`fdt`), so it never lags on slow phones. Generated forests have clearings (`keepTree` noise; old maps migrated once via `MAP.groves`).

## Materials / lighting

- All meshes use `stdMat({color, emis, rim, pat, sway, fill, mode})` (custom GLSL, flat normals via `dFdx/dFdy`). `pat`: 1 bricks, 2 floor slabs, 3 leafy noise. `emis > 1` blooms.
- Lighting = `uAmb` + moon (`uMoonDir/uMoonCol`) + up to `MAXL = 8` point lights. Each frame call `L(x,y,z,radius,r,g,b)`; `pushLights()` keeps the 8 nearest the player.
- Glyph choice/brightness lives in `cellMat` (zone luminance `*1.7`, `pow 1.1`, ramp jitter `(hv-.5)*2.6`, edge threshold `.34`, foliage `*2.9`; colour normalisation `.24 + m*1.55`). Tune there for a globally brighter/denser look; tune per-object colour for local changes. `stdMat({cell})` now only marks scenery (`cell > .6`) for the camera/hero cut-outs.

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
