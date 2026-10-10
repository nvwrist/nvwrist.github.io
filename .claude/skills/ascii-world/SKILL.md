---
name: ascii-world
description: Work on ASCII World (/ascii) — the Three.js game rendered as ASCII glyphs on the GPU. Use for any change to its visuals, characters, weather, dungeon, spells, controls or performance, and to take verification screenshots.
---

# ASCII World (`ascii/`)

Files: `ascii/index.html` (HUD, buttons, CSS; loads `./game.js?v=N` — **bump N on every change** so phones/raw.githack/Pages do not serve a stale script), `ascii/game.js` (everything else, ES module), `ascii/vendor/three.module.min.js` (Three.js r160, vendored).

## Render pipeline — everything is ASCII on a screen grid

Glyphs sit in **horizontal rows on a screen grid** (cell `cellW × cellW*1.75` CSS px, `DETAIL.small/big` per «детали» level, default 5 px on phones ≈ 80 columns). Everything in the world becomes glyphs; nothing is drawn as plain 3D.

1. **Scene pass** (`camera.layers = 0`) → `sceneRT` at `W×H × Q().ss`, half-float, `DepthTexture`. Materials write alpha as a glyph-set code: `1` solid (density ramp `WRAMP` sorted by real ink coverage + 3×3 shape match against `EDGE` for contrasty cells), `.945` water (`. - ~ =`), `.905–.935` foliage (`. : o O 0 Q @ 8`), `.1–.9` **stroke** = grass blades and rain, value = screen angle of the blade (`vAng`).
2. **`cellMat` → `cellRT`** (one texel per cell): 3×6 samples per cell → avg colour, brightest texel's code, 3×3 zone luminance → glyph index `a = index/255`. Strokes are stored as `200 + angle*50`.
3. **Overlay pass** (`layers = 1`: snow and particle glyph sprites, editor rings) → `ovRT` (resolution follows the quality preset). Sprites test against the scene depth (`OVF.behindScene()`) and add with `ADD_KEEP_ALPHA`.
4. **Bloom** from scene + overlay.
5. **`finalMat`** at the **full device resolution** (always `min(2, devicePixelRatio)`, so the quality preset never blurs glyphs): for each pixel it looks at the 3×3 neighbouring cells; letters get a tiny floating jitter/lean, strokes (`uDirV` glyph) are rotated to the blade angle and stretched `.82–1.2` so they overlap like grass. Then calm grade over the navy `uBg`, overlay composite, bloom, vignette. «ASCII: выкл» renders both layers into `rawRT` and tone-maps it.

Quality presets (`QUAL`) only change scene resolution (`ss`), grass count, overlay resolution/MSAA, bloom passes and particle caps — never the glyph grid or the final resolution.

Camera: **orthographic axonometry** (Project Zomboid / Sims look): fixed yaw `CAM_YAW` = 45°, elevation .615 rad (true isometric; dungeon .72, editor .95), `CAM_DIST` 70 m along the view ray, visible half-height `hh` 6.4 m (landscape) / 8.5 m (portrait) × editor zoom — set every frame in `update()`. WASD/stick are screen-relative (rotated by `CAM_YAW`). Because the camera is far away, **never use `cameraPosition` distance** for effects: fog and rain use distance from `uFocus` (hero); `linZ` is linear. Follow uses the real frame time (`fdt`). Fog starts 8 m from the hero. Generated forests have clearings (`keepTree` noise; old maps migrated once via `MAP.groves`).

## Materials / lighting

- All meshes use `stdMat({color, emis, rim, pat, sway, fill, mode})` (custom GLSL, flat normals via `dFdx/dFdy`). `pat`: 1 bricks, 2 floor slabs, 3 leafy noise. `emis > 1` blooms.
- Lighting = `uAmb` + moon (`uMoonDir/uMoonCol`) + up to `MAXL = 8` point lights. Each frame call `L(x,y,z,radius,r,g,b)`; `pushLights()` keeps the 8 nearest the player.
- Glyph choice/brightness lives in `cellMat` (zone luminance `*1.7`, `pow 1.1`, ramp jitter `(hv-.5)*2.6`, edge threshold `.34`, foliage `*2.9`; colour normalisation `.24 + m*1.55`). Tune there for a globally brighter/denser look; tune per-object colour for local changes. `stdMat({cell})` now only marks scenery (`cell > .6`) for the camera/hero cut-outs.

## World

- Trees: 4 species in `TREES` (oak, poplar, young, old) — trunk + branches + crown blobs, chosen by `treeKind(p)` (`p.v` or id-based, switchable in the inspector). Crowns are cut into see-through leaf clumps by 3D noise (`vnoise3` in `STD_FS`) and printed with the foliage glyph set.

- Forest: `pathZ(x)` path (same formula in JS and GLSL), trees/rocks instanced, collision via `circles` (spatial hash) + `boxes`. Ruins door at `DOOR`, campfire at `CAMP`.
- Grass: 90k instanced blades (share from the panel × `QUAL.grass`: .35 / .65 / 1). **Defaults of `GR_UI` reproduce the look of PR #8–9** the owner likes: blade .38–.83 m, width .11, per-blade flutter on, continuous stroke angle (50 steps), stroke length 1.12–1.37, no green tint. Wrapped around `uFocus` in a `GRASS_TILE` square, pushed away from `uPlayer`. Excluded on the path, ruins box and campfire. The calmer «soft» variant (few steps, no flutter, fewer blades) is just different slider values.
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
- **Grass panel** (`🌿 трава`, `#gr`): sliders from `GR_UI` in `game.js` (shape, wind, colour/light, stroke look shared with rain), values in `GR` → `applyGrass()` → shared uniforms `U.uGA…uGE`, `uSt`, `uStW`, `uJit`, `uStGain`; saved in `localStorage['ascii-grass-v2']`, «⧉ копировать» puts the JSON on the clipboard. Defaults in `GR_UI` = the shipped look. New knob: add a row to `GR_UI` + use it in `applyGrass()` and the shader.
- Grass shading: meadow patches, clumps, wind sheen on bent tips (`vGust`), moon back-light at the tips, contact shadow under the hero (also on the ground).

## Checklist for changes

- Keep alpha codes intact in any new shader (opaque materials only; blending would corrupt the code).
- New light sources → `L(...)` in `update()`; new emissive particles → `emit({...})` (`mode: RUNEM` for runes).
- Mobile: every new action needs a button in `.btns` too.
- Run `node .claude/skills/ascii-world/screenshot.mjs <out-dir>` (server on :8765 first) and look at: forest ASCII, character close-up, fine detail, raw mode, storm, dungeon. Check the console output for shader errors (`PAGEERR`/`CONSOLE error`).
