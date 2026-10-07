/*
 * Библиотека CC0-моделей для редактора карт и персонажей → viewer/models/lib/
 *
 *   python3 viewer/tools/fetch_itch.py …        # паки itch.io (Quaternius, KayKit) → /tmp/cc0
 *   (Kenney качается curl'ом, см. CLAUDE.md)     # → /tmp/cc0/kenney/<kit>
 *   python3 viewer/tools/convert_blends.py      # старые .blend-паки → /tmp/cc0_conv
 *   cp viewer/tools/{build_library,ru_names}.mjs /tmp/gt/ && LIB_OUT=$PWD/viewer/models/lib node /tmp/gt/build_library.mjs [пак…]
 *     (в /tmp/gt: npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp)
 *
 * Каждая модель: масштаб в метры (персонаж ≈ 1.8 м, дверь ≈ 2.1 м), только цветовая текстура ≤128px (PS1, без normal/ORM),
 * упрощение тяжёлых мешей, квантование и сжатие meshopt (во вьюере — MeshoptDecoder).
 * catalog.json: паки (автор, ссылка, лицензия) и модели (рус. имя, категория, размер, треугольники, анимации).
 */
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, meshopt, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { ruName, catOf } from './ru_names.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.LIB_OUT || path.join(HERE, '..', 'models', 'lib');
const SRC = process.env.CC0_CACHE || '/tmp/cc0', CONV = process.env.CC0_CONV || '/tmp/cc0_conv';
const ONLY = process.argv.slice(2);

// h — подгон по высоте (м) для отдельных моделей; scale — общий множитель пака
const PACKS = [
  // ---- Kenney (kenney.nl) ----
  { id: 'k-castle', name: 'Castle Kit', author: 'Kenney', url: 'https://kenney.nl/assets/castle-kit', dir: 'kenney/castle-kit', match: /GLB format\/.*\.glb$/, scale: 3.6, cat: 'build', pal: true },
  { id: 'k-graveyard', name: 'Graveyard Kit', author: 'Kenney', url: 'https://kenney.nl/assets/graveyard-kit', dir: 'kenney/graveyard-kit', match: /GLB format\/.*\.glb$/, scale: 2.3, cat: 'grave', pal: true,
    kind: { 'character-': 'monster' } },
  { id: 'k-retro', name: 'Retro Fantasy Kit', author: 'Kenney', url: 'https://kenney.nl/assets/retro-fantasy-kit', dir: 'kenney/retro-fantasy-kit', match: /GLB format\/.*\.glb$/, scale: 3.3, cat: 'build', pal: true },
  { id: 'k-town', name: 'Fantasy Town Kit', author: 'Kenney', url: 'https://kenney.nl/assets/fantasy-town-kit', dir: 'kenney/fantasy-town-kit', match: /GLB format\/.*\.glb$/, scale: 2.6, cat: 'build', pal: true },
  { id: 'k-survival', name: 'Survival Kit', author: 'Kenney', url: 'https://kenney.nl/assets/survival-kit', dir: 'kenney/survival-kit', match: /GLB format\/.*\.glb$/, scale: 2.9, cat: 'prop', pal: true },
  { id: 'k-nature', name: 'Nature Kit', author: 'Kenney', url: 'https://kenney.nl/assets/nature-kit', dir: 'kenney/nature-kit', match: /GLTF format\/.*\.glb$/, scale: 3.0, cat: 'nature', pal: true },
  { id: 'k-minidungeon', name: 'Mini Dungeon', author: 'Kenney', url: 'https://kenney.nl/assets/mini-dungeon', dir: 'kenney/mini-dungeon', match: /GLB format\/.*\.glb$/, scale: 2.4, cat: 'dungeon', pal: true,
    kind: { 'character-': 'char' } },
  { id: 'k-dungeon', name: 'Modular Dungeon Kit', author: 'Kenney', url: 'https://kenney.nl/assets/modular-dungeon-kit', dir: 'kenney/modular-dungeon-kit', match: /GLB format\/.*\.glb$/, scale: 0.75, cat: 'dungeon', pal: true },
  // ---- Quaternius (quaternius.com) ----
  { id: 'q-village', name: 'Medieval Village MegaKit', author: 'Quaternius', url: 'https://quaternius.com/packs/medievalvillagemegakit.html', dir: 'quaternius/medieval-village-megakit', match: /glTF\/.*\.gltf$/, scale: 1, cat: 'build', budget: 2000 },
  { id: 'q-props', name: 'Fantasy Props MegaKit', author: 'Quaternius', url: 'https://quaternius.com/packs/fantasypropsmegakit.html', dir: 'quaternius/fantasy-props-megakit', match: /glTF\/.*\.gltf$/, scale: 1, cat: 'prop', budget: 900 },
  { id: 'q-nature', name: 'Stylized Nature MegaKit', author: 'Quaternius', url: 'https://quaternius.com/packs/stylizednaturemegakit.html', dir: 'quaternius/stylized-nature-megakit', match: /glTF\/.*\.gltf$/, scale: 0.8, cat: 'nature', budget: 1500 },
  { id: 'q-nature-low', name: 'Ultimate Nature Pack', author: 'Quaternius', url: 'https://quaternius.com/packs/ultimatenature.html', conv: 'q-nature-low', scale: 2.4, cat: 'nature' },
  { id: 'q-trees', name: 'Textured Stylized Trees', author: 'Quaternius', url: 'https://quaternius.itch.io/textured-lowpoly-trees', conv: 'q-trees', scale: 1, cat: 'nature', fitH: { tree: 6, bush: 1.2, rock: 1, grass: 0.5, plant: 0.8, flower: 0.4 } },
  { id: 'q-dungeon', name: 'Modular Dungeon', author: 'Quaternius', url: 'https://quaternius.itch.io/lowpoly-modular-dungeon-pack', conv: 'q-dungeon-old', scale: 1, cat: 'dungeon' },
  { id: 'q-farm', name: 'Farm Buildings', author: 'Quaternius', url: 'https://quaternius.itch.io/lowpoly-farm-buildings', conv: 'q-farm', scale: 1, cat: 'build' },
  { id: 'q-knight', name: 'Animated Knight', author: 'Quaternius', url: 'https://quaternius.itch.io/lowpoly-animated-knight', conv: 'q-knight', scale: 0.32, cat: 'weapon', kind: { knightcharacter: 'char' } },
  { id: 'q-monsters', name: 'Animated Monsters', author: 'Quaternius', url: 'https://quaternius.itch.io/lowpoly-animated-monsters', conv: 'q-monsters', cat: 'monster', kindAll: 'monster',
    fit: { bat: 0.7, dragon: 4, skeleton: 1.8, slime: 0.7 } },
  { id: 'q-enemies', name: 'Easy Enemies', author: 'Quaternius', url: 'https://quaternius.itch.io/animated-easy-enemies', conv: 'q-enemies', cat: 'monster', kindAll: 'monster',
    fit: { frog: 0.5, rat: 0.45, snake: 0.6, snake_angry: 0.6, spider: 1.1, wasp: 0.6 } },
  { id: 'q-animals', name: 'Farm Animals', author: 'Quaternius', url: 'https://quaternius.itch.io/lowpoly-animated-animals', conv: 'q-animals', cat: 'animal', kindAll: 'animal',
    fit: { cow: 1.5, horse: 1.8, llama: 1.8, pig: 0.9, pug: 0.4, sheep: 1.0, zebra: 1.6 } },
  { id: 'q-bestiary', name: 'Bestiary – Dungeon Monsters', author: 'Quaternius', url: 'https://quaternius.com/packs/bestiarydungeonmonsters.html', dir: 'quaternius/bestiary-dungeon-monsters-kit', match: /GLB \(Godot-Unreal\)\/.*\.glb$/, scale: 1, cat: 'monster', kindAll: 'monster' },
  // ---- KayKit (Kay Lousberg) ----
  { id: 'kk-dungeon', name: 'KayKit Dungeon Remastered', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/kaykit-dungeon-remastered', dir: 'kaylousberg/kaykit-dungeon-pack', match: /Assets\/gltf\/.*\.gltf$/, scale: 0.72, cat: 'dungeon', pal: true },
  { id: 'kk-forest', name: 'KayKit Forest Nature', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/kaykit-forest', dir: 'kaylousberg/kaykit-forest', match: /Assets\/gltf\/.*\.gltf$/, scale: 1.4, cat: 'nature', pal: true },
  { id: 'kk-halloween', name: 'KayKit Halloween Bits', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/halloween-bits', dir: 'kaylousberg/halloween-bits', match: /Assets\/gltf\/.*\.gltf$/, scale: 0.6, cat: 'grave', pal: true },
  { id: 'kk-weapons', name: 'KayKit Fantasy Weapons Bits', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/fantasy-weapons-bits', dir: 'kaylousberg/fantasy-weapons-bits', match: /Assets\/gltf\/.*\.gltf$/, scale: 0.72, cat: 'weapon', pal: true },
  { id: 'kk-tools', name: 'KayKit RPG Tools Bits', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/rpg-tools-bits', dir: 'kaylousberg/rpg-tools-bits', match: /Assets\/gltf\/.*\.gltf$/, scale: 0.72, cat: 'prop', pal: true },
  { id: 'kk-resources', name: 'KayKit Resource Bits', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/resource-bits', dir: 'kaylousberg/resource-bits', match: /Assets\/gltf\/.*\.gltf$/, scale: 0.5, cat: 'prop', pal: true },
  { id: 'kk-builder', name: 'KayKit Medieval Builder', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/kaykit-medieval-builder-pack', dir: 'kaylousberg/kaykit-medieval-builder-pack', match: /Models\/.*gltf\/.*\.glb$/, scale: 4, cat: 'build', pal: true },
  { id: 'kk-hex', name: 'KayKit Medieval Hexagon', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/kaykit-medieval-hexagon', dir: 'kaylousberg/kaykit-medieval-hexagon', match: /Assets\/gltf\/.*\.gltf$/, scale: 3, cat: 'hex', catFixed: true, pal: true },
  { id: 'kk-adventurers', name: 'KayKit Adventurers', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/kaykit-adventurers', dir: 'kaylousberg/kaykit-adventurers', match: /(Characters\/gltf\/.*\.glb|Assets\/gltf\/.*\.gltf)$/, scale: 0.71, cat: 'weapon', pal: true,
    kind: { 'characters/': 'char' }, rig: 'kaykit' },
  { id: 'kk-skeletons', name: 'KayKit Skeletons', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/kaykit-skeletons', dir: 'kaylousberg/kaykit-skeletons', match: /(characters\/gltf\/.*\.glb|assets\/gltf\/.*\.gltf)$/, scale: 0.71, cat: 'weapon', pal: true,
    kind: { 'characters/': 'monster' }, rig: 'kaykit' },
  { id: 'kk-mannequin', name: 'KayKit Character Animations', author: 'Kay Lousberg', url: 'https://kaylousberg.itch.io/kaykit-character-animations', dir: 'kaylousberg/kaykit-character-animations', match: /characters\/Mannequin_Medium\.glb$/, scale: 0.71, cat: 'char', pal: true,
    kindAll: 'char', rig: 'kaykit' },
];
const CATS = { build: 'Строения', dungeon: 'Подземелье', nature: 'Природа', prop: 'Быт и предметы', light: 'Свет и огонь', grave: 'Кладбище и мрак',
  weapon: 'Оружие и снаряжение', hex: 'Гекс-плитки', char: 'Персонажи', monster: 'Монстры', animal: 'Животные' };

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;

const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const slug = (s) => s.replace(/\.gltf\.glb$|\.gltf$|\.glb$/i, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
const tri = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } return Math.round(t); };

async function shrinkTextures(doc, pal, max = 128) {
  for (const m of doc.getRoot().listMaterials()) {
    m.setNormalTexture(null); m.setOcclusionTexture(null); m.setMetallicRoughnessTexture(null); m.setEmissiveTexture(null);
    m.setMetallicFactor(0); m.setRoughnessFactor(1);
  }
  prune()(doc);
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage(); if (!img) continue;
    const meta = await sharp(img).metadata();
    const k = Math.min(1, max / Math.max(meta.width, meta.height));
    const w = Math.max(4, Math.round(meta.width * k)), h = Math.max(4, Math.round(meta.height * k));
    const out = await sharp(img).resize(w, h, { kernel: pal ? 'nearest' : 'lanczos3' }).png({ palette: true, colors: 128, effort: 7 }).toBuffer();
    t.setImage(new Uint8Array(out)).setMimeType('image/png').setURI(`${t.getName() || 'tex'}.png`);
  }
}

function scaleScene(doc, s) {
  const root = doc.getRoot(), scene = root.getDefaultScene() || root.listScenes()[0];
  const wrap = doc.createNode('root').setScale([s, s, s]);
  for (const n of scene.listChildren()) { scene.removeChild(n); wrap.addChild(n); }
  scene.addChild(wrap);
  return scene;
}

// GLB с внешними общими текстурами: картинки кладём один раз в <пак>/tex/<хэш>.png, в glb — ссылка (GLTFLoader грузит её относительно файла)
async function packGLB(doc, packDir) {
  const { json, resources } = await io.writeJSON(doc, { format: 'glb' });
  for (const im of json.images || []) {
    const bytes = resources[im.uri];
    const h = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12);
    const rel = `tex/${h}.png`, abs = path.join(packDir, rel);
    if (!fs.existsSync(abs)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, bytes); }
    im.uri = rel; delete im.name;
  }
  const bin = json.buffers?.[0]?.uri ? resources[json.buffers[0].uri] : new Uint8Array(0);
  if (json.buffers?.[0]) delete json.buffers[0].uri;
  const pad = (n) => (4 - (n % 4)) % 4;
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc(pad(js.length), 0x20)]);
  const bb = Buffer.concat([Buffer.from(bin), Buffer.alloc(pad(bin.length), 0)]);
  const total = 12 + 8 + js.length + (bb.length ? 8 + bb.length : 0);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const ch = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c; };
  return Buffer.concat([head, ch(js.length, 0x4E4F534A), js, ...(bb.length ? [ch(bb.length, 0x004E4942), bb] : [])]);
}

const catalog = { v: 1, build: Date.now().toString(36), cats: CATS, packs: {}, items: [] };
const prev = fs.existsSync(path.join(OUT, 'catalog.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'catalog.json'), 'utf8')) : null;
let total = 0;
for (const P of PACKS) {
  if (ONLY.length && !ONLY.includes(P.id)) { // пересобираем только указанные паки — остальное берём из прежнего каталога
    if (prev?.packs[P.id]) { catalog.packs[P.id] = prev.packs[P.id]; catalog.items.push(...prev.items.filter((it) => it.p === P.id)); }
    continue;
  }
  const files = P.conv ? walk(path.join(CONV, P.conv)).filter((f) => f.endsWith('.glb')) : walk(path.join(SRC, P.dir)).filter((f) => P.match.test(f));
  files.sort();
  fs.rmSync(path.join(OUT, P.id), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, P.id), { recursive: true });
  catalog.packs[P.id] = { name: P.name, author: P.author, url: P.url, license: 'CC0' };
  let bytes = 0, n = 0;
  const texBytes = () => walk(path.join(OUT, P.id, 'tex')).reduce((a, f) => a + fs.statSync(f).size, 0);
  for (const f of files) {
    const base = path.basename(f), sl = slug(base), low = f.toLowerCase();
    try {
      const doc = await io.read(f);
      const rootD = doc.getRoot();
      const anims = rootD.listAnimations().map((a) => a.getName()).filter((a) => !/^t-?pose$/i.test(a));
      const rigged = rootD.listSkins().length > 0;
      // масштаб: общий у пака или подгон по высоте
      let s = P.scale ?? 1;
      const fitKey = Object.keys(P.fit || {}).find((k) => sl === k) || Object.keys(P.fitH || {}).find((k) => sl.includes(k));
      if (fitKey) {
        const b = getBounds(rootD.listScenes()[0]);
        const target = (P.fit || {})[fitKey] ?? P.fitH[fitKey];
        const size = P.fit ? Math.max(b.max[1] - b.min[1], (b.max[0] - b.min[0]) * 0.5, (b.max[2] - b.min[2]) * 0.5) : b.max[1] - b.min[1];
        s = target / Math.max(size, 1e-6);
      }
      const scene = scaleScene(doc, s);
      await shrinkTextures(doc, !!P.pal);
      let t0 = tri(doc);
      const budget = P.budget || 1500; // PS1: предмет ≈ сотни треугольников, здание — до пары тысяч
      if (!rigged && t0 > budget) {
        await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: budget / t0, error: 0.02 }));
      }
      await doc.transform(dedup(), prune(), ...(anims.length ? [resample({ tolerance: 1e-3 })] : []), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      const b = getBounds(scene);
      const kind = P.kindAll || Object.entries(P.kind || {}).find(([k]) => low.includes(k))?.[1] || null;
      const cat = kind || (P.catFixed ? P.cat : catOf(base, P.cat));
      const file = `${P.id}/${sl}.glb`;
      const buf = await packGLB(doc, path.join(OUT, P.id));
      fs.writeFileSync(path.join(OUT, file), buf);
      bytes += buf.length; n++;
      const it = { id: `${P.id}/${sl}`, n: ruName(base), en: base.replace(/\.gltf\.glb$|\.gltf$|\.glb$/i, ''), c: cat, p: P.id, f: file,
        t: tri(doc), s: b.max.map((v, k) => +(v - b.min[k]).toFixed(2)), y: +b.min[1].toFixed(2) };
      if (rigged) it.r = P.rig || P.id;
      if (anims.length) it.a = anims;
      catalog.items.push(it);
    } catch (e) { console.warn('  ! ', base, e.message.slice(0, 120)); }
  }
  bytes += texBytes(); total += bytes;
  console.log(`${P.id.padEnd(16)} ${String(n).padStart(4)} моделей  ${(bytes / 1024 / 1024).toFixed(2)} МБ`);
}
catalog.items.sort((a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n, 'ru'));
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog));
console.log(`итого ${catalog.items.length} моделей, ${(total / 1024 / 1024).toFixed(1)} МБ (пересобранные паки)`);
