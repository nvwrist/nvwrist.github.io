# Модели

| Файл | Откуда | Лицензия |
|---|---|---|
| `human.glb` («Странник») | [Animated Human Low Poly — Quaternius](https://opengameart.org/content/animated-human-low-poly), перекрашен и перезапечён `tools/make_human.py` | CC0 |
| `q/anims_ual1.glb`, `q/anims_ual2.glb` | [Universal Animation Library 1](https://quaternius.com/packs/universalanimationlibrary.html) и [2](https://quaternius.com/packs/universalanimationlibrary2.html) — Quaternius, версия Standard (86 анимаций, без манекена) | CC0 |
| `q/male/*`, `q/female/*`, `q/hair/*` | [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) + [Modular Character Outfits – Fantasy](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html) — Quaternius, Standard; текстуры ужаты, геометрия упрощена `tools/build_quaternius.py` | CC0 |
| `q/women.glb` | [Ultimate Modular Women](https://quaternius.com/packs/ultimatemodularwomen.html) — Quaternius (10 нарядов, 24 анимации), `tools/build_women.py` | CC0 |

## Встроенные программы (`viewer/vendor/`)
| Папка | Что | Лицензия |
|---|---|---|
| `three/` | [three.js](https://threejs.org) r170 | MIT |
| `threejs-editor/` | [three.js Editor](https://threejs.org/editor/) r170 (+ мост `editor/ps1-bridge.js`), [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) 0.0.23, [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) 0.7.4 | MIT |
| `sculptgl/` | [SculptGL](https://github.com/stephaneginier/sculptgl) — Stéphane Ginier (сборка с stephaneginier.com/sculptgl, + мост в `index.html`) | MIT |
