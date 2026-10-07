// Демо-карта «Деревня у кладбища» → models/maps/demo.json (через API редактора карт в браузере).
//   python3 -m http.server 8123 (в viewer/) && node viewer/tools/make_demo_map.mjs
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models', 'maps', 'demo.json');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:8123/index.html');
await p.waitForTimeout(5000);
await p.evaluate(() => window.__ps1.setMode('map'));
await p.waitForTimeout(3000);
const json = await p.evaluate(async () => {
  const ed = window.__ps1.mapEd;
  await ed.load(ed.blankMap('Деревня у кладбища', 48));
  const T = ed.terrain;
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const R = (a, b) => a + rnd() * (b - a);
  // рельеф: холм на западе, ложбина-пруд на востоке, неровности
  T.fill(1);
  for (let i = 0; i < 40; i++) T.sculpt(R(-44, 44), R(-44, 44), R(4, 10), 0.4, 'noise');
  for (let i = 0; i < 26; i++) T.sculpt(-30 + R(-3, 3), 10 + R(-3, 3), 12, 0.5, 'raise');
  for (let i = 0; i < 12; i++) T.sculpt(28, 14, 7, 0.6, 'lower');
  for (let i = 0; i < 6; i++) T.sculpt(0, 0, 40, 0.15, 'smooth');
  for (let i = 0; i < 8; i++) T.sculpt(0, -6, 11, 0.6, 'flatten', 0);
  // дорога от старта (юг) к площади и на кладбище (север-восток)
  const path = [[0, 44], [0, 30], [-2, 18], [0, 6], [4, -4], [10, -14], [16, -22], [20, -28]];
  for (let k = 0; k < path.length - 1; k++) {
    const [x0, z0] = path[k], [x1, z1] = path[k + 1], n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 1.5);
    for (let s = 0; s <= n; s++) { const t = s / n; const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; T.paint(x, z, 2.2, 4); T.sculpt(x, z, 3, 0.35, 'smooth'); }
  }
  T.paint(0, -6, 7, 5); // булыжная площадь
  for (let i = 0; i < 30; i++) T.paint(R(12, 30), R(-38, -22), R(1.5, 3), rnd() < 0.5 ? 3 : 10); // кладбище: грязь и листва
  for (let i = 0; i < 18; i++) T.paint(R(-44, 44), R(-44, 44), R(2, 4), 2);
  ed.map.water = { on: true, level: -0.9 };
  ed.map.env = { preset: 'night', fogK: 1 };
  ed.map.spawn = { p: [0, T.heightAt(0, 40), 40], yaw: Math.PI };
  const put = async (a, x, z, yaw = 0, s = 1, extra = {}) => {
    const y = T.heightAt(x, z);
    const q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    return ed.addObject({ id: ed.uid(), a, p: [x, y, z], q, s: [s, s, s], ...extra }, false);
  };
  // деревня у площади
  await put('kk-builder/well', 0, -6, 0, 0.6);
  await put('q-farm/barn', -16, -8, Math.PI / 2);
  await put('q-farm/smallbarn', 14, 2, -Math.PI / 2);
  await put('kk-builder/house', -12, 8, 0.4);
  await put('kk-builder/mill', 12, -10, -0.6);
  await put('q-farm/windmill', -24, -24, 0.8);
  await put('kk-builder/lumbermill', -26, 22, 1.2);
  // фонари вдоль дороги
  for (const [x, z] of [[2.5, 34], [-4, 22], [2.5, 10], [6.5, -1], [13, -17]]) await put('k-town/lantern', x, z, 0, 0.75);
  // костёр и NPC
  await put('k-nature/campfire_stones', -5, 28, 0, 1.2, { light: { color: '#ff9040', i: 3, r: 10 } });
  await put('kk-adventurers/knight', -6.5, 29.5, 2.2, 1, { role: 'npc', who: 'Рыцарь у костра', txt: 'Ночь опасна, путник.\nНа кладбище за деревней снова шевелятся мертвецы.\nСобери монеты, что растеряли жители, — и не попадись скелетам.' });
  await put('k-graveyard/character_keeper', 10, -18, -0.8, 1, { role: 'npc', who: 'Смотритель', txt: 'Дальше — кладбище. Скелеты бродят у склепа.\nОни заметят тебя шагов за восемь. Беги, если что.' });
  await put('k-survival/signpost', 2, 37, 0, 1, { role: 'sign', txt: 'Деревня Чёрный Ручей\n↑ площадь · ↗ кладбище' }).catch(() => {});
  // кладбище
  await put('k-graveyard/crypt_large', 24, -34, Math.PI, 1);
  const gs = ['k-graveyard/gravestone_cross', 'k-graveyard/gravestone_round', 'k-graveyard/gravestone_roof', 'k-graveyard/gravestone_broken', 'k-graveyard/gravestone_bevel', 'kk-halloween/grave_a', 'k-graveyard/gravestone_decorative'];
  for (let i = 0; i < 22; i++) await put(gs[i % gs.length], 13 + (i % 6) * 3 + R(-0.4, 0.4), -24 - Math.floor(i / 6) * 3.4 + R(-0.4, 0.4), Math.PI + R(-0.25, 0.25));
  for (let i = 0; i < 7; i++) await put('k-graveyard/iron_fence', 11 + i * 3.4, -21, 0, 1.3).catch(() => {});
  for (const [x, z] of [[18, -31], [26, -26], [30, -32]]) await put('kk-skeletons/skeleton_minion', x, z, R(0, 6), 1, { role: 'enemy', speed: 2.6, sight: 8 });
  await put('k-graveyard/lantern_candle', 21, -31, 0, 1.2, { light: { color: '#9adfff', i: 2.5, r: 9 } });
  // монеты
  for (const [x, z] of [[-14, 14], [16, 8], [-20, -14], [6, -30], [30, -16], [-30, 12], [24, -40], [0, -14]]) await put('kk-dungeon/coin_stack_small', x, z, 0, 0.8, { role: 'pickup', txt: 'монеты' });
  // лес по краю и сухие деревья
  const trees = ['q-nature-low/birchtree_dead_1', 'q-nature-low/birchtree_dead_3', 'k-nature/tree_pinetalld', 'k-nature/tree_pinetallb', 'q-trees/deadbirch_4', 'k-nature/tree_pinetallc'];
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2, r = R(36, 46), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 6 && z > 30) continue;
    await put(trees[i % trees.length], Math.max(-46, Math.min(46, x)), Math.max(-46, Math.min(46, z)), R(0, 6), R(0.8, 1.2));
  }
  for (let i = 0; i < 14; i++) { const x = R(8, 34), z = R(-44, -20); await put(trees[i % 2], x, z, R(0, 6), R(0.8, 1.1)); }
  // камни, кусты, трава
  const deco = ['k-nature/rock_largea', 'k-nature/rock_smallc', 'k-nature/plant_bush', 'k-nature/grass_large', 'k-nature/grass', 'k-nature/mushroom_red', 'k-nature/stump_old'];
  for (let i = 0; i < 70; i++) { const x = R(-42, 42), z = R(-42, 42); if (Math.hypot(x, z + 6) < 8) continue; await put(deco[i % deco.length], x, z, R(0, 6), R(0.8, 1.3)).catch(() => {}); }
  return JSON.stringify(ed.serialize());
});
fs.writeFileSync(OUT, json);
console.log('demo.json', (json.length / 1024).toFixed(0), 'КБ,', JSON.parse(json).objects.length, 'объектов');
await b.close();
