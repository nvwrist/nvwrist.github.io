import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { lambert } from './ps1.js';

/*
 * Библиотека CC0-моделей (models/lib, собирается tools/build_library.mjs):
 *   libCatalog() — каталог { cats, packs, items[{id, n (рус. имя), en, c (категория), p (пак), f (файл), t, s (размер, м), r (скелет), a (анимации)}] }
 *   loadMaster(id) — загружает модель один раз (PS1-материалы, NEAREST), spawn(id) — копия для сцены (геометрия и материалы общие).
 *   thumbCSS(item, size) — иконка из листов models/lib/thumbs/<n>.png (64px, 16×16 на лист).
 */

export const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const BASE = new URL('../models/lib/', import.meta.url).href; // не зависит от страницы, с которой подключён модуль
const SHEET = 16, CELL = 64;

let catP = null;
export function libCatalog() {
  catP ??= fetch(BASE + 'catalog.json?t=' + Date.now()).then((r) => r.json()).then((c) => {
    c.items.forEach((it, i) => { it.i = i; it.v = c.build; });
    c.byId = new Map(c.items.map((it) => [it.id, it]));
    return c;
  }).catch((e) => { catP = null; throw e; });
  return catP;
}

export function thumbCSS(it, size = 48) {
  const sheet = Math.floor(it.i / (SHEET * SHEET)), k = it.i % (SHEET * SHEET), x = k % SHEET, y = Math.floor(k / SHEET);
  const sc = size / CELL;
  return `background:url(${BASE}thumbs/${sheet}.png?v=${it.v || ''}) ${-x * size}px ${-y * size}px/${SHEET * CELL * sc}px ${SHEET * CELL * sc}px no-repeat;image-rendering:pixelated`;
}

// PS1-материалы: исходный материал → Lambert с вершинным «дрожанием»; одна копия на исходный материал
const PSM = new WeakMap();
function ps1Mat(m, mesh) {
  if (PSM.has(m)) return PSM.get(m);
  if (m.map) { m.map.magFilter = m.map.minFilter = THREE.NearestFilter; m.map.generateMipmaps = false; m.map.needsUpdate = true; }
  const n = lambert({
    name: m.name, color: m.color ? m.color.clone() : 0xffffff, map: m.map || null, side: THREE.DoubleSide,
    transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest || (m.transparent ? 0.3 : 0),
    vertexColors: !!mesh.geometry.attributes.color, flatShading: true,
    emissive: m.emissive ? m.emissive.clone() : 0x000000, emissiveMap: m.emissiveMap || null,
  });
  n.userData.ps1src = true; n.userData.libMat = true;
  PSM.set(m, n);
  return n;
}
export function ps1ify(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => ps1Mat(m, o)) : ps1Mat(o.material, o);
    o.userData.noConvert = true; // main.convertMaterials их не трогает — уже PS1
    o.castShadow = false;
    if (o.isSkinnedMesh) o.frustumCulled = false;
  });
  return root;
}

export const libHooks = { onMaster: null }; // main: наложить правки Мастерской (ключ asset:<id>) на загруженный «мастер»
const masters = new Map();
export function loadMaster(id) {
  if (!masters.has(id)) {
    masters.set(id, (async () => {
      const c = await libCatalog();
      const it = c.byId.get(id);
      if (!it) throw new Error('нет в библиотеке: ' + id);
      const g = await gltfLoader.loadAsync(BASE + it.f + (c.build ? '?v=' + c.build : ''));
      ps1ify(g.scene);
      g.scene.updateMatrixWorld(true);
      try { libHooks.onMaster?.(g.scene, id); } catch (e) { console.warn('правки модели', id, e); }
      return { scene: g.scene, animations: g.animations || [], item: it };
    })().catch((e) => { masters.delete(id); throw e; }));
  }
  return masters.get(id);
}

/** Копия модели для сцены. Скелетные — через SkeletonUtils (свои кости), остальные — общая геометрия. */
export async function spawn(id) {
  const m = await loadMaster(id);
  const o = m.item.r || m.animations.length ? SkeletonUtils.clone(m.scene) : m.scene.clone(true);
  o.name = m.item.n;
  o.userData.asset = id;
  o.animations = m.animations;
  return o;
}

export { SkeletonUtils };
