import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PRESETS, applySpec, normalize, pixelate } from './matlib.js';
import { createEquipPanel } from './editor-equip.js';

/*
 * «Мастерская» — ручной редактор модели в духе Blender.
 *   Объект   — выбор детали (клик / список), скрыть/показать, двигать/вращать/масштабировать деталь целиком.
 *   Правка   — вершины: клик, рамка, «связанное», пропорциональное редактирование, гизмо G/R/S,
 *              сгладить, удалить грани, вернуть выделенное к исходному.
 *   Скульпт  — кисти: захват, надуть, вытянуть/вдавить, сгладить, сплющить; симметрия по X.
 *   Покраска — пиксельная кисть по текстуре (отдельный слой поверх исходной), ластик, пипетка; цвет материала.
 *   Снаряжение — предметы в гнёздах на костях (equip.js): выбрать, подвинуть гизмо/числами, сменить гнездо,
 *                отзеркалить, сделать одеждой, библиотека/импорт/свои предметы из примитивов (editor-equip.js).
 *   Материал любой детали — пресеты matlib.js (ткань, кожа, металл…), 2 цвета, размер пикселей, повтор, своя картинка.
 * Правки работают в любой позе: смещение в мире переводится в координаты меша через матрицу скиннинга вершины.
 * Всё хранится в localStorage по типу персонажа и заново применяется при загрузке (afterLook).
 */

const V3 = () => new THREE.Vector3();
const lsGet = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

const MODES = { object: 'Объект', edit: 'Правка', sculpt: 'Скульпт', paint: 'Покраска', equip: 'Снаряжение' };
const TOOLS = {
  object: [['select', '⬚', 'Выбор'], ['translate', '✥', 'Сдвиг (G)'], ['rotate', '⟳', 'Поворот (R)'], ['scale', '⤢', 'Масштаб (S)']],
  edit: [['select', '⬚', 'Выбор/рамка'], ['translate', '✥', 'Сдвиг (G)'], ['rotate', '⟳', 'Поворот (R)'], ['scale', '⤢', 'Масштаб (S)']],
  sculpt: [['grab', '✊', 'Захват'], ['inflate', '◉', 'Надуть'], ['draw', '▲', 'Вытянуть'], ['dent', '▼', 'Вдавить'], ['smooth', '≈', 'Сгладить'], ['flatten', '▬', 'Сплющить']],
  paint: [['brush', '✎', 'Кисть'], ['erase', '⌫', 'Ластик'], ['pick', '⊙', 'Пипетка']],
  equip: [['select', '⬚', 'Выбор'], ['translate', '✥', 'Сдвиг (G)'], ['rotate', '⟳', 'Поворот (R)'], ['scale', '⤢', 'Масштаб (S)'], ['space', '⊕', 'Оси (L)']],
};
const PAINT_PAL = ['#000000', '#ffffff', '#2a1e18', '#5a3a22', '#8a5a2c', '#c99a7a', '#a83228', '#d8b048', '#3a5a2a', '#2a3a5a', '#5a2a5a', '#7a7a7a'];

export function createEditor({ scene, camera, renderer, controls, canvas, toast, onEnter, onExit, getKey, onGlb, getEquip = () => null, onModelChanged = () => {}, modelOptions = () => [], onPickModel = null }) {
  const st = {
    active: false, mode: 'object', tool: 'select', mesh: null, sel: new Set(), cam: false, xray: false,
    prop: false, propR: 0.12, brushR: 0.08, brushS: 0.5, sym: true,
    color: '#a83228', px: 2, alpha: 1, ps1Preview: false, pose: 'rest', playing: false, local: true,
  };
  let root = null, key = 'x';
  const ui = buildUI();
  const eqPanel = createEquipPanel({
    getEquip, toast, push: (op) => push(op),
    changed: () => { onModelChanged(); refreshOutliner(); },
    editPart: (m) => { setMode('edit'); selectMesh(m); },
    matUI: (mats) => matUI(mats), bindMat: (el, mats, owner) => bindMat(el, mats, owner),
    target: (o) => { if (o && st.tool === 'select') setTool('translate'); else updateGizmo(); }, frame: (o) => frameObj(o),
    refresh: () => { refreshProps(); updateGizmo(); updateStatus(); },
  });
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /* ======================= данные мешей ======================= */
  const MD = new WeakMap(); // mesh -> {groups, members, adj}
  const ORIG = new WeakMap(); // атрибут позиции -> исходные координаты (у BufferAttribute нет userData)
  const APPLIED = new WeakSet(); // атрибуты, к которым уже применены сохранённые правки
  const edited = new Set(); // attributes (position) с правками

  function meshesOf(r = root, all = false) {
    const out = [];
    r?.traverse((o) => {
      if (!o.isMesh || o.userData.edHelper) return;
      if (!all && !isShown(o)) return;
      out.push(o);
    });
    return out;
  }
  function isShown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
  const attrKey = (m) => (m.userData.editKey || (/^Body_/.test(m.name) ? 'Body' : m.name || 'mesh')) + '#' + m.geometry.attributes.position.count;
  const meshKey = (m) => (m.name || 'mesh') + '#' + m.geometry.attributes.position.count;

  // все геометрии (во всём корне), использующие тот же атрибут позиции
  function sharers(attr) {
    const out = [];
    root.traverse((o) => { if (o.isMesh && o.geometry.attributes.position === attr) out.push(o); });
    return out;
  }
  function floatify(geo, name) {
    const a = geo.attributes[name];
    if (!a || (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute)) return;
    const f = new THREE.Float32BufferAttribute(a.count * a.itemSize, a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f.setComponent(i, c, a.getComponent(i, c));
    for (const m of sharers(geo.attributes.position)) if (m.geometry.attributes[name] === a) m.geometry.setAttribute(name, f);
    if (geo.attributes[name] === a) geo.setAttribute(name, f);
  }
  function prepare(mesh) {
    if (MD.has(mesh)) return MD.get(mesh);
    const geo = mesh.geometry;
    floatify(geo, 'normal');
    floatify(geo, 'position');
    const pos = geo.attributes.position;
    if (!ORIG.has(pos)) ORIG.set(pos, pos.array.slice());
    if (geo.index) geo.userData.origIndex ??= geo.index.array.slice();
    // сварка совпадающих вершин (швы UV/нормалей), чтобы правка не рвала поверхность
    geo.computeBoundingBox();
    const eps = geo.boundingBox.getSize(V3()).length() * 1e-5 + 1e-9;
    const map = new Map(), groups = new Int32Array(pos.count), members = [];
    for (let i = 0; i < pos.count; i++) {
      const k = Math.round(pos.getX(i) / eps) + ',' + Math.round(pos.getY(i) / eps) + ',' + Math.round(pos.getZ(i) / eps);
      let g = map.get(k);
      if (g === undefined) { g = members.length; map.set(k, g); members.push([]); }
      groups[i] = g; members[g].push(i);
    }
    const md = { mesh, geo, pos, groups, members, adj: null };
    MD.set(mesh, md);
    return md;
  }
  function adjacency(md) {
    if (md.adj) return md.adj;
    const adj = md.members.map(() => new Set());
    const idx = md.geo.userData.origIndex || md.geo.index?.array;
    const n = idx ? idx.length : md.pos.count;
    for (let t = 0; t < n; t += 3) {
      const a = md.groups[idx ? idx[t] : t], b = md.groups[idx ? idx[t + 1] : t + 1], c = md.groups[idx ? idx[t + 2] : t + 2];
      adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b);
    }
    return (md.adj = adj);
  }

  // мировая позиция вершины (с учётом скиннинга текущей позы)
  const _v = V3();
  function worldPos(mesh, i, out = V3()) { mesh.getVertexPosition(i, out); return out.applyMatrix4(mesh.matrixWorld); }
  // линейная часть отображения «локальная позиция вершины → мир» (для перевода сдвигов обратно)
  const _m4 = new THREE.Matrix4(), _acc = new THREE.Matrix4(), _sw = new THREE.Vector4(), _si = new THREE.Vector4();
  function invLinear(mesh, i) {
    if (mesh.isSkinnedMesh) {
      const sk = mesh.skeleton, g = mesh.geometry;
      _si.fromBufferAttribute(g.attributes.skinIndex, i); _sw.fromBufferAttribute(g.attributes.skinWeight, i);
      const e = _acc.elements; e.fill(0);
      for (let j = 0; j < 4; j++) {
        const w = _sw.getComponent(j);
        if (!w) continue;
        const b = _si.getComponent(j);
        _m4.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]);
        for (let k = 0; k < 16; k++) e[k] += w * _m4.elements[k];
      }
      _m4.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse).multiply(_acc).multiply(mesh.bindMatrix);
    } else _m4.copy(mesh.matrixWorld);
    return new THREE.Matrix3().setFromMatrix4(_m4).invert();
  }
  function moveGroup(md, g, dWorld, invCache) {
    for (const i of md.members[g]) {
      let inv = invCache.get(i);
      if (!inv) { inv = invLinear(md.mesh, i); invCache.set(i, inv); }
      _v.copy(dWorld).applyMatrix3(inv);
      md.pos.setXYZ(i, md.pos.getX(i) + _v.x, md.pos.getY(i) + _v.y, md.pos.getZ(i) + _v.z);
    }
  }
  function finishGeometry(md) {
    md.pos.needsUpdate = true;
    // нормали пересчитываем на геометрии с полным индексом (у «зон» тела атрибуты общие)
    const all = sharers(md.pos);
    const full = all.reduce((a, m) => ((m.geometry.index?.count || 0) > (a.geometry.index?.count || 0) ? m : a), all[0] || md.mesh);
    full.geometry.computeVertexNormals();
    all.forEach((m) => {
      m.geometry.boundingSphere = null; m.geometry.boundingBox = null;
      if (m.isSkinnedMesh) { m.boundingSphere = null; m.boundingBox = null; } // у обычного Mesh этих полей нет (иначе рендер ищет computeBoundingSphere)
    });
    edited.add(md.pos);
    if (md.mesh?.userData.libItem && !applying) getEquip()?.commit(md.mesh);
  }
  let applying = false;
  const isLib = (m) => !!m.userData.libItem;

  /* ======================= история ======================= */
  const undo = [], redo = [];
  function push(op) { undo.push(op); if (undo.length > 60) undo.shift(); redo.length = 0; updateStatus(); }
  function applyOp(op, dir) {
    if (op.type === 'verts') { op.attr.array.set(dir === 'undo' ? op.before : op.after); finishGeometry({ pos: op.attr, mesh: op.mesh }); }
    else if (op.type === 'index') { op.geo.setIndex(Array.from(dir === 'undo' ? op.before : op.after)); }
    else if (op.type === 'paint') { op.L.layer.getContext('2d').putImageData(dir === 'undo' ? op.before : op.after, 0, 0); composite(op.L); }
    else if (op.type === 'color') { setMatColor(op.mat, dir === 'undo' ? op.before : op.after); }
    else if (op.type === 'hide') { op.mesh.visible = dir === 'undo' ? op.before : !op.before; }
    else if (op.type === 'fn' || op.type === 'mat') (dir === 'undo' ? op.undo : op.redo)();
    refreshOverlay(); scheduleSave();
    if (op.type === 'fn' || op.type === 'mat') refreshProps();
  }
  function doUndo() { const op = undo.pop(); if (op) { applyOp(op, 'undo'); redo.push(op); } updateStatus(); }
  function doRedo() { const op = redo.pop(); if (op) { applyOp(op, 'redo'); undo.push(op); } updateStatus(); }

  /* ======================= сохранение ======================= */
  let saveT = 0;
  function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(save, 600); ui.saved.textContent = '…'; }
  function save() {
    if (!root) return;
    const verts = {}, tris = {};
    for (const m of meshesOf(root, true)) {
      if (isLib(m)) continue; // свой предмет хранит форму сам
      const a = m.geometry.attributes.position;
      if (ORIG.has(a) && !verts[attrKey(m)]) {
        const o = ORIG.get(a), cur = a.array, ii = [], d = [];
        for (let i = 0; i < a.count; i++) {
          const dx = cur[i * 3] - o[i * 3], dy = cur[i * 3 + 1] - o[i * 3 + 1], dz = cur[i * 3 + 2] - o[i * 3 + 2];
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-7) { ii.push(i); d.push(+dx.toFixed(5), +dy.toFixed(5), +dz.toFixed(5)); }
        }
        if (ii.length) verts[attrKey(m)] = { i: ii, d };
      }
      const oi = m.geometry.userData.origIndex;
      if (oi && m.geometry.index && m.geometry.index.count !== oi.length) {
        const keep = new Set();
        const ci = m.geometry.index.array;
        for (let t = 0; t < ci.length; t += 3) keep.add(ci[t] + ',' + ci[t + 1] + ',' + ci[t + 2]);
        const del = [];
        for (let t = 0; t < oi.length; t += 3) if (!keep.has(oi[t] + ',' + oi[t + 1] + ',' + oi[t + 2])) del.push(t / 3);
        tris[meshKey(m)] = del;
      }
    }
    const hidden = meshesOf(root, true).filter((m) => m.userData.edHidden).map(meshKey);
    const paint = {};
    for (const [, L] of layers) if (L.dirty) paint[L.key] = L.layer.toDataURL('image/png');
    const colors = {}, mats = {};
    for (const [mat, c] of matColors) colors[mat.name || 'mat'] = c;
    for (const [mat, sp] of matSpecs) mats[mat.name || 'mat'] = sp;
    const ok = lsSet('ps1.edits.' + key, { verts, tris, hidden, colors, mats }) && lsSet('ps1.paint.' + key, paint);
    ui.saved.textContent = ok ? '✓ сохранено' : '⚠ мало места';
  }

  // повторное применение сохранённого (после загрузки персонажа и каждого изменения внешности)
  function afterLook(r, k) {
    root = r; key = k || getKey?.() || 'x';
    const ed = lsGet('ps1.edits.' + key, {});
    applying = true;
    for (const m of meshesOf(r, true)) {
      const a = m.geometry.attributes.position;
      const v = isLib(m) ? null : ed.verts?.[attrKey(m)];
      if (v && !APPLIED.has(a)) {
        const md = prepare(m);
        const o = ORIG.get(md.pos);
        md.pos.array.set(o);
        v.i.forEach((i, n) => { md.pos.setXYZ(i, o[i * 3] + v.d[n * 3], o[i * 3 + 1] + v.d[n * 3 + 1], o[i * 3 + 2] + v.d[n * 3 + 2]); });
        APPLIED.add(md.pos);
        finishGeometry(md);
      }
      const del = isLib(m) ? null : ed.tris?.[meshKey(m)];
      if (del && !m.geometry.userData.trisApplied) {
        prepare(m);
        const oi = m.geometry.userData.origIndex, ds = new Set(del), ni = [];
        for (let t = 0; t < oi.length; t += 3) if (!ds.has(t / 3)) ni.push(oi[t], oi[t + 1], oi[t + 2]);
        m.geometry.setIndex(ni);
        m.geometry.userData.trisApplied = true;
      }
      if (ed.hidden?.includes(meshKey(m))) { m.userData.edHidden = true; m.visible = false; }
      for (const mat of [].concat(m.material, m.userData.orig || [])) {
        if (!mat || mat.userData.ps1src) continue;
        const sp = ed.mats?.[mat.name];
        if (sp && JSON.stringify(mat.userData.matSpec) !== JSON.stringify(normalize(sp))) setMatSpec(mat, sp);
        const c = ed.colors?.[mat.name];
        if (c) { setMatColor(mat, c, false); matColors.set(mat, c); }
      }
    }
    applying = false;
    // слои покраски: если внешний код перерисовал текстуру (look.js), заново накладываем слой
    const paint = lsGet('ps1.paint.' + key, {});
    for (const m of meshesOf(r, true)) for (const mat of [].concat(m.material)) {
      const tex = mat?.map;
      if (!tex) continue;
      const L = layers.get(tex);
      if (L) { if (tex.image !== L.final) { rebase(L); composite(L); } }
      else if (paint[layerKey(mat)]) {
        const NL = ensureLayer(tex, mat);
        const im = new Image();
        im.onload = () => { NL.layer.getContext('2d').drawImage(im, 0, 0); NL.dirty = true; composite(NL); };
        im.src = paint[layerKey(mat)];
      }
    }
    if (st.active) { refreshOutliner(); refreshOverlay(); }
  }

  // правки модели библиотеки (ключ asset:<id>) — накладываются на общий «мастер» при загрузке, не трогая текущий корень Мастерской
  function applyEdits(r, k) {
    const pr = root, pk = key;
    afterLook(r, k);
    if (pr && st.active) { root = pr; key = pk; } else if (pr) { root = pr; key = pk; }
  }

  /* ======================= покраска ======================= */
  const layers = new Map(); // texture -> {key, final, base, layer, tex, dirty}
  const layerKey = (mat) => mat.name || 'mat';
  function toCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width || img.videoWidth || 256; c.height = img.height || img.videoHeight || 256;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  }
  function ensureLayer(tex, mat) {
    let L = layers.get(tex);
    if (L) return L;
    const base = toCanvas(tex.image);
    const layer = document.createElement('canvas'); layer.width = base.width; layer.height = base.height;
    const final = document.createElement('canvas'); final.width = base.width; final.height = base.height;
    L = { key: layerKey(mat), tex, base, layer, final, dirty: false };
    layers.set(tex, L);
    composite(L);
    return L;
  }
  function rebase(L) { L.base.getContext('2d').clearRect(0, 0, L.base.width, L.base.height); L.base.getContext('2d').drawImage(L.tex.image, 0, 0, L.base.width, L.base.height); }
  function composite(L) {
    const g = L.final.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, L.final.width, L.final.height);
    g.drawImage(L.base, 0, 0); g.drawImage(L.layer, 0, 0);
    L.tex.image = L.final; L.tex.needsUpdate = true;
  }
  function texel(L, uv) {
    const t = L.tex;
    let u = uv.x, v = uv.y;
    u = u - Math.floor(u); v = v - Math.floor(v);
    return [Math.floor(u * L.final.width), Math.floor((t.flipY ? 1 - v : v) * L.final.height)];
  }
  function stamp(L, x, y) {
    const g = L.layer.getContext('2d');
    const s = st.px, o = Math.floor(s / 2);
    if (st.tool === 'erase') g.clearRect(x - o, y - o, s, s);
    else { g.globalAlpha = st.alpha; g.fillStyle = st.color; g.fillRect(x - o, y - o, s, s); g.globalAlpha = 1; }
  }
  function matColorHex(mat) { return mat.color ? '#' + mat.color.getHexString() : '#ffffff'; }
  const matColors = new Map();
  function setMatColor(mat, hex, remember = true) {
    mat.color?.set(hex); mat.userData.psMat?.color.set(hex);
    if (remember) matColors.set(mat, hex);
  }
  // пресеты материалов (matlib.js): исходный вид запоминаем, чтобы можно было вернуть
  const ORIGMAT = new WeakMap(), matSpecs = new Map();
  function setMatSpec(mat, spec) {
    if (!ORIGMAT.has(mat)) ORIGMAT.set(mat, { map: mat.map, color: mat.color?.getHex(), emissive: mat.emissive?.getHex(), emissiveMap: mat.emissiveMap });
    if (!spec) {
      const o = ORIGMAT.get(mat);
      for (const m of [mat, mat.userData.psMat].filter(Boolean)) {
        m.map = o.map; if (o.color !== undefined) m.color.setHex(o.color);
        if (m.emissive && o.emissive !== undefined) { m.emissive.setHex(o.emissive); m.emissiveMap = o.emissiveMap; }
        m.needsUpdate = true;
      }
      delete mat.userData.matSpec; matSpecs.delete(mat); matColors.delete(mat);
      return;
    }
    applySpec(mat, spec);
    matSpecs.set(mat, mat.userData.matSpec); matColors.delete(mat);
  }
  const specOf = (mat) => (matSpecs.has(mat) ? { ...matSpecs.get(mat) } : null);
  function matUI(mats) {
    if (!mats.length) return '';
    const presets = Object.entries(PRESETS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    return `<h3>Материал</h3>${mats.map((m, i) => {
      const sp = specOf(m), hex = sp ? sp.c1 : matColorHex(m);
      return `<div class="ed-mat" data-mi="${i}">
        <div class="ed-mat-h"><span>${(m.name || 'материал ' + (i + 1)).replace(/</g, '')}</span></div>
        <div class="ed-mat-r"><select data-mf="preset" title="Пресет текстуры"><option value="">Исходный вид</option>${presets}</select>
          <input type="color" data-mf="c1" value="${hex}" title="${sp ? 'Основной цвет' : 'Оттенок'}">
          <input type="color" data-mf="c2" value="${sp ? sp.c2 : '#000000'}" title="Второй цвет" ${sp ? '' : 'disabled'}></div>
        <div class="ed-mat-r"><select data-mf="res" title="Размер текстуры (меньше — крупнее пиксели)" ${sp ? '' : 'disabled'}>${[16, 32, 64, 128].map((r) => `<option value="${r}"${sp?.res === r ? ' selected' : ''}>${r}px</option>`).join('')}</select>
          <label title="Повтор узора">×<input type="number" data-mf="rep" min="1" max="16" step="1" value="${sp?.rep || 1}" ${sp ? '' : 'disabled'}></label>
          <button class="ed-b" data-mf="seed" title="Другой вариант узора" ${sp ? '' : 'disabled'}>🎲</button>
          <label class="ed-b ed-file" title="Своя картинка (будет пикселизирована)">🖼<input type="file" accept="image/*" data-mf="img" hidden></label></div>
      </div>`;
    }).join('')}<p class="hint small">Пресет даёт пиксельную PS1-текстуру из двух цветов. «Исходный вид» — вернуть как было.</p>`;
  }
  function bindMat(el, mats, owner = null) {
    el.querySelectorAll('.ed-mat').forEach((box) => { const sp = specOf(mats[+box.dataset.mi]); box.querySelector('[data-mf=preset]').value = sp ? sp.preset : ''; });
    const touched = () => {
      scheduleSave();
      const c = owner || (st.mesh && getEquip()?.findContainer(st.mesh));
      if (c?.userData.equip?.libItem) getEquip().markDirty(c.userData.equip.libItem, c);
    };
    const change = (mat, next) => {
      const before = specOf(mat), beforeCol = matColorHex(mat);
      setMatSpec(mat, next);
      push({ type: 'mat', undo: () => { setMatSpec(mat, before); if (!before) setMatColor(mat, beforeCol); }, redo: () => setMatSpec(mat, next) });
      touched();
    };
    const handler = async (e) => {
      const f = e.target.dataset.mf; if (!f) return;
      const box = e.target.closest('.ed-mat'), mat = mats[+box.dataset.mi]; if (!mat) return;
      const sp = specOf(mat), v = e.target.value;
      if (e.type === 'input' && f !== 'c1' && f !== 'c2') return; // списки/числа/файлы — только по change
      if (f === 'preset') { change(mat, v ? { ...(sp || {}), preset: v, c1: undefined, c2: undefined, img: null } : null); refreshProps(); }
      else if (f === 'c1' && !sp) {
        if (e.type === 'input') { setMatColor(mat, v); return; }
        const before = box.dataset.before || matColorHex(mat);
        push({ type: 'color', mat, before, after: v }); touched();
      } else if (f === 'c1' || f === 'c2') { if (e.type === 'change') change(mat, { ...sp, [f]: v }); else applySpec(mat, { ...sp, [f]: v }); }
      else if ((f === 'res' || f === 'rep') && e.type === 'change') change(mat, { ...sp, [f]: +v });
      else if (f === 'img' && e.target.files[0]) {
        const img = await pixelate(e.target.files[0], sp?.res || 64);
        change(mat, { ...(sp || { preset: 'none' }), preset: sp?.preset === 'glow' ? 'glow' : 'none', img }); refreshProps();
      }
    };
    el.querySelectorAll('.ed-mat').forEach((box) => {
      box.addEventListener('input', handler); box.addEventListener('change', handler);
      box.querySelector('[data-mf=c1]').addEventListener('focus', (e) => { box.dataset.before = e.target.value; });
      box.addEventListener('click', (e) => { if (e.target.dataset.mf === 'seed') { const mat = mats[+box.dataset.mi], sp = specOf(mat); if (sp) change(mat, { ...sp, seed: (sp.seed || 7) + 1 + Math.floor(Math.random() * 97) }); } });
    });
  }

  /* ======================= оверлеи ======================= */
  const pivot = new THREE.Object3D(); pivot.userData.edHelper = true; scene.add(pivot);
  const tc = new TransformControls(camera, canvas);
  const tcHelper = tc.getHelper(); tcHelper.userData.edHelper = true;
  scene.add(tcHelper);
  tc.setSize(0.9);
  tc.enabled = false; tcHelper.visible = false;
  tc.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });
  const ptsGeo = new THREE.BufferGeometry();
  const ptsMat = new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true });
  const points = new THREE.Points(ptsGeo, ptsMat);
  points.renderOrder = 997; points.frustumCulled = false; points.userData.edHelper = true; points.visible = false;
  scene.add(points);
  let wire = null;
  const box = document.createElement('div'); box.className = 'ed-box'; document.body.appendChild(box);
  const cursor = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 32), new THREE.MeshBasicMaterial({ color: 0xffb040, depthTest: false, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  cursor.renderOrder = 999; cursor.visible = false; cursor.userData.edHelper = true; scene.add(cursor);

  function setWire(mesh) {
    if (wire) { wire.parent?.remove(wire); wire = null; }
    if (!mesh || !st.active) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb040, wireframe: true, transparent: true, opacity: st.mode === 'edit' ? 0.35 : 0.18, depthTest: st.mode !== 'edit' });
    wire = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, mat) : new THREE.Mesh(mesh.geometry, mat);
    wire.userData.edHelper = true; wire.frustumCulled = false; wire.renderOrder = 996;
    wire.position.copy(mesh.position); wire.quaternion.copy(mesh.quaternion); wire.scale.copy(mesh.scale);
    mesh.parent.add(wire);
    if (mesh.isSkinnedMesh) wire.bind(mesh.skeleton, mesh.bindMatrix);
  }
  // точки вершин (по одной на «сваренную» группу) в мировых координатах
  let gWorld = null;
  function refreshOverlay() {
    const showPts = st.active && st.mode === 'edit' && st.mesh;
    points.visible = !!showPts;
    if (st.mesh && st.active && st.mode !== 'equip') setWire(st.mesh); else setWire(null);
    if (!showPts) { updateGizmo(); return; }
    st.mesh.updateMatrixWorld(true);
    const md = prepare(st.mesh), n = md.members.length;
    const p = new Float32Array(n * 3), c = new Float32Array(n * 3);
    gWorld = p;
    for (let g = 0; g < n; g++) {
      worldPos(st.mesh, md.members[g][0], _v);
      p[g * 3] = _v.x; p[g * 3 + 1] = _v.y; p[g * 3 + 2] = _v.z;
      const s = st.sel.has(g);
      c[g * 3] = s ? 1 : 0.1; c[g * 3 + 1] = s ? 0.6 : 0.1; c[g * 3 + 2] = s ? 0.1 : 0.12;
    }
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    ptsGeo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    ptsGeo.computeBoundingSphere();
    updateGizmo();
  }
  function selCenter() {
    if (!st.mesh) return null;
    const md = prepare(st.mesh), c = V3();
    let n = 0;
    const gs = st.mode === 'object' ? md.members.keys() : st.sel;
    for (const g of gs) { c.add(worldPos(st.mesh, md.members[g][0], _v)); n++; }
    return n ? c.multiplyScalar(1 / n) : null;
  }
  function updateGizmo() {
    if (st.active && st.mode === 'equip') {
      const t = eqPanel?.sel?.obj;
      if (!t || !['translate', 'rotate', 'scale'].includes(st.tool)) { tc.detach(); tc.enabled = false; tcHelper.visible = false; return; }
      tc.setMode(st.tool); tc.setSpace(st.local ? 'local' : 'world'); tc.attach(t); tc.enabled = true; tcHelper.visible = true;
      return;
    }
    const want = st.active && st.mesh && ['translate', 'rotate', 'scale'].includes(st.tool) && (st.mode === 'object' || st.sel.size);
    if (!want) { tc.detach(); tc.enabled = false; tcHelper.visible = false; return; }
    const c = selCenter();
    if (!c) return;
    pivot.position.copy(c); pivot.quaternion.identity(); pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld();
    tc.setMode(st.tool); tc.attach(pivot); tc.enabled = true; tcHelper.visible = true;
  }

  // гизмо: тянем выделение (или всю деталь в режиме «Объект»), с пропорциональным спадом
  let drag = null, eqDrag = null;
  tc.addEventListener('mouseDown', () => {
    if (st.mode === 'equip') { const o = tc.object; if (o) { o.updateMatrix(); eqDrag = { obj: o, before: o.matrix.clone() }; } return; }
    if (!st.mesh) return;
    const md = prepare(st.mesh);
    const w = new Map();
    if (st.mode === 'object') md.members.forEach((_, g) => w.set(g, 1));
    else {
      st.sel.forEach((g) => w.set(g, 1));
      if (st.prop) {
        const sp = [...st.sel].map((g) => worldPos(st.mesh, md.members[g][0]));
        md.members.forEach((m, g) => {
          if (w.has(g)) return;
          const p = worldPos(st.mesh, m[0]);
          let d = Infinity;
          for (const q of sp) d = Math.min(d, p.distanceTo(q));
          if (d < st.propR) { const t = 1 - d / st.propR; w.set(g, t * t * (3 - 2 * t)); }
        });
      }
    }
    const orig = new Map();
    w.forEach((_, g) => orig.set(g, worldPos(st.mesh, md.members[g][0])));
    drag = { md, w, orig, P0inv: pivot.matrixWorld.clone().invert(), before: md.pos.array.slice(), base: md.pos.array.slice(), inv: new Map() };
  });
  tc.addEventListener('objectChange', () => {
    if (eqDrag) { eqPanel.syncNums(); return; }
    if (!drag) return;
    const { md, w, orig, P0inv, base, inv } = drag;
    md.pos.array.set(base);
    const D = new THREE.Matrix4().multiplyMatrices(pivot.matrixWorld, P0inv);
    const t = V3(), d = V3();
    w.forEach((wt, g) => {
      const o = orig.get(g);
      t.copy(o).applyMatrix4(D);
      d.subVectors(t, o).multiplyScalar(wt);
      moveGroup(md, g, d, inv);
    });
    md.pos.needsUpdate = true;
  });
  tc.addEventListener('mouseUp', () => {
    if (eqDrag) { const { obj, before } = eqDrag; eqDrag = null; eqPanel.committed(obj, before); scheduleSave(); return; }
    if (!drag) return;
    const { md, before } = drag;
    drag = null;
    finishGeometry(md);
    push({ type: 'verts', attr: md.pos, mesh: md.mesh, before, after: md.pos.array.slice() });
    refreshOverlay(); scheduleSave();
  });

  /* ======================= указатель ======================= */
  function setNDC(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function hitMeshes(e, only) {
    setNDC(e);
    const list = only ? [only] : meshesOf();
    list.forEach((m) => { if (m.isSkinnedMesh) { m.computeBoundingSphere(); m.computeBoundingBox(); } });
    return ray.intersectObjects(list, false).filter((h) => !h.object.userData.edHelper);
  }
  const project = (p) => { const q = p.clone().project(camera); const r = canvas.getBoundingClientRect(); return [(q.x + 1) / 2 * r.width + r.left, (1 - q.y) / 2 * r.height + r.top, q.z]; };

  let ptr = null;
  function onDown(e) {
    if (!st.active || e.button > 0 || tc.dragging || (tc.axis && tc.enabled)) return;
    if (st.cam || e.altKey) return; // камера
    ptr = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: false, shift: e.shiftKey || e.ctrlKey || e.metaKey };
    if (st.mode === 'sculpt') startSculpt(e);
    else if (st.mode === 'paint') startPaint(e);
  }
  function onMove(e) {
    if (st.active && (st.mode === 'sculpt' || st.mode === 'paint') && !ptr) hover(e);
    if (!ptr || e.pointerId !== ptr.id) return;
    if (Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) > 5) ptr.moved = true;
    if (st.mode === 'sculpt') moveSculpt(e);
    else if (st.mode === 'paint') movePaint(e);
    else if (st.mode === 'edit' && st.tool === 'select' && ptr.moved && st.mesh) {
      const l = Math.min(ptr.x, e.clientX), t = Math.min(ptr.y, e.clientY);
      Object.assign(box.style, { display: 'block', left: l + 'px', top: t + 'px', width: Math.abs(e.clientX - ptr.x) + 'px', height: Math.abs(e.clientY - ptr.y) + 'px' });
    }
  }
  function onUp(e) {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = ptr; ptr = null;
    box.style.display = 'none';
    if (st.mode === 'sculpt') return endSculpt();
    if (st.mode === 'paint') return endPaint();
    if (st.mode === 'equip' && !p.moved) {
      setNDC(e);
      const marks = [];
      root?.traverse((o) => { if (o.isMesh && o.userData.socketMarker) marks.push(o); });
      const hm = ray.intersectObjects(marks, false)[0];
      const h = hm || hitMeshes(e)[0];
      if (eqPanel.pick(h ? h.object : null) && st.tool === 'select') setTool('translate');
    } else if (st.mode === 'object' && !p.moved) {
      const h = hitMeshes(e)[0];
      selectMesh(h ? h.object : null);
    } else if (st.mode === 'edit' && st.mesh) {
      if (p.moved && st.tool === 'select') boxSelect(p, e);
      else if (!p.moved) clickSelect(e, p.shift);
    }
  }
  canvas.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  canvas.addEventListener('contextmenu', (e) => { if (st.active) e.preventDefault(); });

  function visibleGroup(md, g) {
    if (st.xray) return true;
    const i = md.members[g][0], n = md.geo.attributes.normal;
    if (!n) return true;
    const inv = invLinear(md.mesh, i); // нормаль переносится транспонированной обратной
    _v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(inv.transpose()).normalize();
    const p = V3().fromArray(gWorld, g * 3);
    return _v.dot(V3().subVectors(camera.position, p)) > 0;
  }
  function clickSelect(e, add) {
    const md = prepare(st.mesh);
    let best = -1, bd = 14 * 14;
    for (let g = 0; g < md.members.length; g++) {
      const [x, y, z] = project(V3().fromArray(gWorld, g * 3));
      if (z > 1) continue;
      const d = (x - e.clientX) ** 2 + (y - e.clientY) ** 2;
      if (d < bd && visibleGroup(md, g)) { bd = d; best = g; }
    }
    if (!add) st.sel.clear();
    if (best >= 0) { if (add && st.sel.has(best)) st.sel.delete(best); else st.sel.add(best); }
    refreshOverlay(); updateStatus();
  }
  function boxSelect(p, e) {
    const md = prepare(st.mesh);
    const x0 = Math.min(p.x, e.clientX), x1 = Math.max(p.x, e.clientX), y0 = Math.min(p.y, e.clientY), y1 = Math.max(p.y, e.clientY);
    if (!p.shift) st.sel.clear();
    for (let g = 0; g < md.members.length; g++) {
      const [x, y, z] = project(V3().fromArray(gWorld, g * 3));
      if (z <= 1 && x >= x0 && x <= x1 && y >= y0 && y <= y1 && visibleGroup(md, g)) st.sel.add(g);
    }
    refreshOverlay(); updateStatus();
  }

  /* ======================= скульпт ======================= */
  let stroke = null;
  function rootMirror(p) { // зеркало относительно плоскости X=0 корня персонажа
    const inv = root.matrixWorld.clone().invert();
    const q = p.clone().applyMatrix4(inv); q.x = -q.x;
    return q.applyMatrix4(root.matrixWorld);
  }
  function mirrorVec(d) {
    const m3 = new THREE.Matrix3().setFromMatrix4(root.matrixWorld), inv = m3.clone().invert();
    const q = d.clone().applyMatrix3(inv); q.x = -q.x;
    return q.applyMatrix3(m3);
  }
  function startSculpt(e) {
    const h = hitMeshes(e)[0];
    if (!h) { ptr = null; return; }
    controls.enabled = false;
    const mesh = h.object, md = prepare(mesh);
    mesh.updateMatrixWorld(true);
    const W = new Float32Array(md.members.length * 3);
    for (let g = 0; g < md.members.length; g++) { worldPos(mesh, md.members[g][0], _v); _v.toArray(W, g * 3); }
    stroke = { md, mesh, W, before: md.pos.array.slice(), inv: new Map(), last: h.point.clone(), grab: null };
    if (st.tool === 'grab') {
      const sets = [h.point, ...(st.sym ? [rootMirror(h.point)] : [])].map((c, k) => {
        const w = new Map();
        for (let g = 0; g < md.members.length; g++) {
          const d = V3().fromArray(W, g * 3).distanceTo(c);
          if (d < st.brushR) w.set(g, falloff(d / st.brushR));
        }
        return { w, mirror: k === 1 };
      });
      const dist = h.point.distanceTo(camera.position);
      stroke.grab = { sets, start: new Map(), planeDist: dist, x: e.clientX, y: e.clientY };
      sets.forEach((s) => s.w.forEach((_, g) => stroke.grab.start.set(g, V3().fromArray(W, g * 3))));
    } else sculptAt(h);
  }
  const falloff = (t) => { const u = 1 - t * t; return u * u; };
  function moveSculpt(e) {
    if (!stroke) return;
    if (st.tool === 'grab') {
      const G = stroke.grab, r = canvas.getBoundingClientRect();
      const toWorld = (cx, cy) => {
        const v = new THREE.Vector3(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5).unproject(camera);
        return v.sub(camera.position).normalize().multiplyScalar(G.planeDist).add(camera.position);
      };
      const delta = toWorld(e.clientX, e.clientY).sub(toWorld(G.x, G.y));
      const { md, W, inv } = stroke;
      for (const s of G.sets) {
        const dv = s.mirror ? mirrorVec(delta) : delta;
        s.w.forEach((wt, g) => {
          const cur = V3().fromArray(W, g * 3), target = G.start.get(g).clone().addScaledVector(dv, wt * st.brushS * 2);
          const d = target.sub(cur);
          moveGroup(md, g, d, inv); cur.add(d).toArray(W, g * 3);
        });
      }
      md.pos.needsUpdate = true;
      return;
    }
    const h = hitMeshes(e, stroke.mesh)[0];
    if (!h) return;
    if (h.point.distanceTo(stroke.last) < st.brushR * 0.2) return;
    stroke.last.copy(h.point);
    sculptAt(h);
    placeCursor(h);
  }
  function sculptAt(h) {
    const { md, W, inv } = stroke;
    const centers = [h.point, ...(st.sym ? [rootMirror(h.point)] : [])];
    const adj = st.tool === 'smooth' ? adjacency(md) : null;
    for (const c of centers) {
      const hit = [];
      for (let g = 0; g < md.members.length; g++) {
        const d = V3().fromArray(W, g * 3).distanceTo(c);
        if (d < st.brushR) hit.push([g, falloff(d / st.brushR)]);
      }
      if (!hit.length) continue;
      // средняя нормаль под кистью (в мире), по соседству точек
      const n = V3(), avg = V3();
      for (const [g] of hit) avg.add(V3().fromArray(W, g * 3));
      avg.multiplyScalar(1 / hit.length);
      n.subVectors(camera.position, avg).normalize();
      const nm = md.geo.attributes.normal;
      if (nm) {
        const acc = V3();
        for (const [g] of hit) { const i = md.members[g][0]; const iv = inv.get(i) || invLinear(md.mesh, i); acc.add(V3(nm.getX(i), nm.getY(i), nm.getZ(i)).set(nm.getX(i), nm.getY(i), nm.getZ(i)).applyMatrix3(iv.clone().transpose()).normalize()); }
        if (acc.lengthSq() > 1e-8) n.copy(acc.normalize());
      }
      const k = st.brushS * st.brushR * 0.12;
      for (const [g, f] of hit) {
        const p = V3().fromArray(W, g * 3), d = V3();
        if (st.tool === 'draw') d.copy(n).multiplyScalar(k * f);
        else if (st.tool === 'dent') d.copy(n).multiplyScalar(-k * f);
        else if (st.tool === 'inflate') {
          const i = md.members[g][0];
          if (nm) { const iv = inv.get(i) || invLinear(md.mesh, i); d.set(nm.getX(i), nm.getY(i), nm.getZ(i)).applyMatrix3(iv.clone().transpose()).normalize().multiplyScalar(k * f); }
        } else if (st.tool === 'smooth') {
          const nb = adj[g];
          if (!nb.size) continue;
          const m = V3();
          nb.forEach((q) => m.add(V3().fromArray(W, q * 3)));
          m.multiplyScalar(1 / nb.size);
          d.subVectors(m, p).multiplyScalar(Math.min(1, st.brushS * f));
        } else if (st.tool === 'flatten') d.copy(n).multiplyScalar(-V3().subVectors(p, avg).dot(n) * st.brushS * f * 0.6);
        moveGroup(md, g, d, inv);
        p.add(d).toArray(W, g * 3);
      }
    }
    md.pos.needsUpdate = true;
  }
  function endSculpt() {
    controls.enabled = true;
    if (!stroke) return;
    const { md, before } = stroke;
    stroke = null;
    finishGeometry(md);
    push({ type: 'verts', attr: md.pos, mesh: md.mesh, before, after: md.pos.array.slice() });
    refreshOverlay(); scheduleSave();
  }
  function hover(e) {
    const h = hitMeshes(e)[0];
    if (!h) { cursor.visible = false; return; }
    placeCursor(h);
  }
  function placeCursor(h) {
    cursor.visible = true;
    cursor.position.copy(h.point);
    cursor.lookAt(camera.position);
    if (st.mode === 'sculpt') cursor.scale.setScalar(st.brushR);
    else cursor.scale.setScalar(h.point.distanceTo(camera.position) * 0.012);
  }

  /* ======================= покраска (ввод) ======================= */
  let pstroke = null;
  function paintHit(e) {
    const h = hitMeshes(e)[0];
    if (!h || !h.uv) return null;
    const mats = [].concat(h.object.material);
    const mat = mats[h.face?.materialIndex ?? 0] || mats[0];
    if (!mat?.map?.image) return { h, mat, L: null };
    return { h, mat, L: ensureLayer(mat.map, mat) };
  }
  function startPaint(e) {
    const r = paintHit(e);
    if (!r) { ptr = null; return; }
    controls.enabled = false;
    if (!r.L) { toast('У этой детали нет текстуры — меняй её цвет в панели «Материал»'); selectMesh(r.h.object); ptr = null; controls.enabled = true; return; }
    if (st.tool === 'pick') {
      const [x, y] = texel(r.L, r.h.uv);
      const d = r.L.final.getContext('2d').getImageData(x, y, 1, 1).data;
      st.color = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      ui.color.value = st.color; toast('Цвет: ' + st.color);
      ptr = null; controls.enabled = true; return;
    }
    const g = r.L.layer.getContext('2d', { willReadFrequently: true });
    pstroke = { L: r.L, before: g.getImageData(0, 0, r.L.layer.width, r.L.layer.height), last: texel(r.L, r.h.uv), mesh: r.h.object };
    stamp(r.L, ...pstroke.last); composite(r.L);
  }
  function movePaint(e) {
    if (!pstroke) return;
    const r = paintHit(e);
    if (!r || r.L !== pstroke.L) return;
    placeCursor(r.h);
    const [x, y] = texel(r.L, r.h.uv), [lx, ly] = pstroke.last;
    const n = Math.max(Math.abs(x - lx), Math.abs(y - ly));
    if (n > r.L.final.width / 4) { stamp(r.L, x, y); } // прыжок через шов UV — без линии
    else for (let i = 1; i <= n; i++) stamp(r.L, Math.round(lx + ((x - lx) * i) / n), Math.round(ly + ((y - ly) * i) / n));
    pstroke.last = [x, y];
    composite(r.L);
  }
  function endPaint() {
    controls.enabled = true;
    if (!pstroke) return;
    const { L, before } = pstroke;
    pstroke = null;
    L.dirty = true;
    push({ type: 'paint', L, before, after: L.layer.getContext('2d').getImageData(0, 0, L.layer.width, L.layer.height) });
    scheduleSave();
  }

  /* ======================= операции ======================= */
  function selectMesh(m) {
    st.mesh = m; st.sel.clear();
    refreshOutliner(); refreshOverlay(); refreshProps(); updateStatus();
  }
  function selectAll(on = true) { if (!st.mesh) return; const md = prepare(st.mesh); st.sel = on ? new Set(md.members.keys()) : new Set(); refreshOverlay(); updateStatus(); }
  function invertSel() { if (!st.mesh) return; const md = prepare(st.mesh); st.sel = new Set([...md.members.keys()].filter((g) => !st.sel.has(g))); refreshOverlay(); updateStatus(); }
  function selectLinked() {
    if (!st.mesh || !st.sel.size) return toast('Сначала выдели хотя бы одну вершину');
    const adj = adjacency(prepare(st.mesh)), q = [...st.sel];
    while (q.length) { const g = q.pop(); adj[g].forEach((n) => { if (!st.sel.has(n)) { st.sel.add(n); q.push(n); } }); }
    refreshOverlay(); updateStatus();
  }
  function vertsOp(fn) {
    if (!st.mesh) return;
    const md = prepare(st.mesh), before = md.pos.array.slice();
    fn(md);
    finishGeometry(md);
    push({ type: 'verts', attr: md.pos, mesh: md.mesh, before, after: md.pos.array.slice() });
    refreshOverlay(); scheduleSave();
  }
  function smoothSel(iter = 3) {
    if (!st.sel.size) return toast('Выдели вершины');
    vertsOp((md) => {
      const adj = adjacency(md), inv = new Map();
      for (let it = 0; it < iter; it++) {
        const W = new Map();
        const need = new Set(st.sel); st.sel.forEach((g) => adj[g].forEach((n) => need.add(n)));
        need.forEach((g) => W.set(g, worldPos(md.mesh, md.members[g][0])));
        st.sel.forEach((g) => {
          const nb = adj[g]; if (!nb.size) return;
          const m = V3(); nb.forEach((q) => m.add(W.get(q))); m.multiplyScalar(1 / nb.size);
          moveGroup(md, g, m.sub(W.get(g)).multiplyScalar(0.5), inv);
        });
      }
    });
  }
  function revertSel(all = false) {
    vertsOp((md) => {
      const o = ORIG.get(md.pos);
      const gs = all ? md.members.keys() : st.sel;
      for (const g of gs) for (const i of md.members[g]) md.pos.setXYZ(i, o[i * 3], o[i * 3 + 1], o[i * 3 + 2]);
    });
  }
  function deleteFaces() {
    if (!st.mesh || !st.sel.size) return toast('Выдели вершины граней, которые нужно удалить');
    const md = prepare(st.mesh), geo = md.geo;
    if (!geo.index) return toast('Эту деталь нельзя резать');
    const before = geo.index.array.slice(), ni = [];
    const a = geo.index.array;
    for (let t = 0; t < a.length; t += 3) if (!(st.sel.has(md.groups[a[t]]) && st.sel.has(md.groups[a[t + 1]]) && st.sel.has(md.groups[a[t + 2]]))) ni.push(a[t], a[t + 1], a[t + 2]);
    if (ni.length === a.length) return toast('Нет граней, у которых выделены все 3 вершины');
    geo.setIndex(ni);
    push({ type: 'index', geo, before, after: Uint32Array.from(ni) });
    toast(`Удалено граней: ${(a.length - ni.length) / 3}`);
    refreshOverlay(); scheduleSave();
  }
  function hideMesh(m, hide = true) {
    if (!m) return;
    push({ type: 'hide', mesh: m, before: m.visible });
    m.userData.edHidden = hide; m.visible = !hide;
    if (hide && st.mesh === m) selectMesh(null);
    refreshOutliner(); scheduleSave();
  }
  function showAll() {
    meshesOf(root, true).forEach((m) => { if (m.userData.edHidden) { m.userData.edHidden = false; m.visible = true; } });
    refreshOutliner(); scheduleSave();
  }
  function resetAll() {
    if (!confirm('Сбросить ВСЕ ручные правки этого персонажа (форма, покраска, цвета, скрытые детали)?')) return;
    for (const m of meshesOf(root, true)) {
      const a = m.geometry.attributes.position;
      if (ORIG.has(a)) { a.array.set(ORIG.get(a)); finishGeometry({ pos: a, mesh: m }); }
      if (m.geometry.userData.origIndex) m.geometry.setIndex(Array.from(m.geometry.userData.origIndex));
      if (m.userData.edHidden) { m.userData.edHidden = false; m.visible = true; }
    }
    layers.forEach((L) => { L.layer.getContext('2d').clearRect(0, 0, L.layer.width, L.layer.height); L.dirty = false; composite(L); });
    matColors.clear();
    undo.length = redo.length = 0;
    try { localStorage.removeItem('ps1.edits.' + key); localStorage.removeItem('ps1.paint.' + key); } catch { /* */ }
    toast('Правки сброшены (цвета материалов вернутся после перезагрузки)');
    refreshOverlay(); refreshOutliner(); updateStatus();
  }
  function frameObj(o) {
    const b = new THREE.Box3().setFromObject(o), c = b.isEmpty() ? o.getWorldPosition(V3()) : b.getCenter(V3());
    const off = V3().subVectors(camera.position, controls.target);
    controls.target.copy(c); camera.position.copy(c).add(off.setLength(Math.min(off.length(), 1.3)));
    controls.update();
  }
  function frameSel() {
    const c = selCenter() || (st.mesh ? new THREE.Box3().setFromObject(st.mesh).getCenter(V3()) : null);
    if (!c) return;
    const off = V3().subVectors(camera.position, controls.target);
    controls.target.copy(c); camera.position.copy(c).add(off.setLength(Math.min(off.length(), 1.6)));
    controls.update();
  }

  /* ======================= внешние редакторы ======================= */
  // Обмен через window.opener.__ps1Bridge: { kind, data: Promise, receive(msg) } — та же вкладка-источник, тот же домен.
  const sculptPending = new Map();
  function bridge(kind, data) {
    window.__ps1Bridge = {
      kind, data,
      receive: (msg) => {
        if (msg.kind === 'sculpt') importSculpt({ kind: 'sculpt', key: String(msg.key), positions: Float32Array.from(msg.positions) });
        // данные приходят из другой вкладки — копируем в «свою» память (иначе instanceof ArrayBuffer не сработает)
        else if (msg.kind === 'glb') onGlb?.({ kind: 'glb', name: String(msg.name), buffer: new Uint8Array(msg.buffer).slice().buffer });
      },
    };
  }
  function openSculpt() {
    if (!st.mesh) return toast('Сначала выбери деталь (режим «Объект» или список деталей)');
    const w = window.open('./vendor/sculptgl/index.html', '_blank');
    if (!w) return toast('Браузер заблокировал новую вкладку — разреши всплывающие окна');
    const mesh = st.mesh, md = prepare(mesh);
    mesh.updateMatrixWorld(true);
    const n = md.members.length, W0 = new Float32Array(n * 3);
    let text = '# PS1 Viewer → SculptGL: ' + (mesh.name || 'mesh') + '\n';
    for (let g = 0; g < n; g++) { worldPos(mesh, md.members[g][0], _v); _v.toArray(W0, g * 3); text += `v ${_v.x.toFixed(6)} ${_v.y.toFixed(6)} ${_v.z.toFixed(6)}\n`; }
    const idx = md.geo.index ? md.geo.index.array : null, tn = idx ? idx.length : md.pos.count;
    for (let t = 0; t < tn; t += 3) {
      const a = md.groups[idx ? idx[t] : t], b = md.groups[idx ? idx[t + 1] : t + 1], c = md.groups[idx ? idx[t + 2] : t + 2];
      if (a !== b && b !== c && a !== c) text += `f ${a + 1} ${b + 1} ${c + 1}\n`;
    }
    const key = meshKey(mesh);
    sculptPending.set(key, { mesh, W0 });
    bridge('obj', Promise.resolve({ text, count: n, key, name: mesh.name || 'деталь' }));
    toast('Деталь открыта в SculptGL. Когда закончишь — нажми там «↩ Вернуть в PS1 Viewer»');
  }
  function importSculpt(msg) {
    const pend = sculptPending.get(msg.key);
    if (!pend) return toast('Не нашёл деталь, которую отправлял в SculptGL');
    const { mesh, W0 } = pend, md = prepare(mesh);
    if (msg.positions.length !== W0.length) return toast('Число вершин не совпадает — форму не перенести');
    const before = md.pos.array.slice(), inv = new Map(), d = V3();
    for (let g = 0; g < md.members.length; g++) {
      d.set(msg.positions[g * 3] - W0[g * 3], msg.positions[g * 3 + 1] - W0[g * 3 + 1], msg.positions[g * 3 + 2] - W0[g * 3 + 2]);
      if (d.lengthSq() > 1e-14) moveGroup(md, g, d, inv);
    }
    finishGeometry(md);
    push({ type: 'verts', attr: md.pos, mesh, before, after: md.pos.array.slice() });
    // следующий заход в SculptGL начнётся с новой формы
    for (let g = 0; g < md.members.length; g++) W0.set(msg.positions.slice(g * 3, g * 3 + 3), g * 3);
    if (st.active) { st.mesh = mesh; refreshOverlay(); refreshOutliner(); }
    scheduleSave();
    toast('Форма из SculptGL применена ✓ (Ctrl+Z — отменить)');
    window.focus();
  }

  /* ======================= UI ======================= */
  function buildUI() {
    const top = document.createElement('div'); top.id = 'ed-top';
    top.innerHTML = `
      <label class="ed-b ed-model" title="Какую модель править">Модель <select data-a="model"></select></label>
      <div class="ed-seg">${Object.entries(MODES).map(([k, l]) => `<button data-mode="${k}">${l}</button>`).join('')}</div>
      <button class="ed-b" data-a="undo" title="Отменить (Ctrl+Z)">↶</button>
      <button class="ed-b" data-a="redo" title="Повторить (Ctrl+Shift+Z)">↷</button>
      <button class="ed-b" data-a="cam" title="Вращать камеру одним пальцем/левой кнопкой">🎥</button>
      <button class="ed-b" data-a="pose" title="Поза для правки">Т-поза</button>
      <button class="ed-b" data-a="ps1" title="Показывать в стиле PS1">PS1</button>
      <button class="ed-b" data-a="play" title="Проиграть анимацию — проверить, как сидит снаряжение">▶ Анимация</button>
      <button class="ed-b" data-a="help" title="Как пользоваться">?</button>
      <span class="ed-saved"></span>`;
    const tools = document.createElement('div'); tools.id = 'ed-tools';
    const side = document.createElement('div'); side.id = 'ed-side';
    side.innerHTML = `
      <button class="ed-b ed-sidetoggle" data-a="side">⚙ Панель</button>
      <section class="ed-parts"><h3>Детали</h3><div class="ed-outliner"></div></section>
      <section class="ed-props"></section>`;
    const status = document.createElement('div'); status.id = 'ed-status';
    [top, tools, side, status].forEach((el) => { el.hidden = true; document.body.appendChild(el); });
    top.addEventListener('change', (e) => { if (e.target.dataset.a === 'model') onPickModel?.(e.target.value); });
    top.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.mode) return setMode(b.dataset.mode);
      const a = b.dataset.a;
      if (a === 'exit') exit();
      else if (a === 'undo') doUndo();
      else if (a === 'redo') doRedo();
      else if (a === 'cam') { st.cam = !st.cam; applyCamMode(); }
      else if (a === 'pose') { st.pose = st.pose === 'rest' ? 'frame' : 'rest'; onEnter?.({ pose: st.pose }); setTimeout(refreshOverlay, 50); syncTop(); }
      else if (a === 'sculptgl') openSculpt();
      else if (a === 'ps1') { st.ps1Preview = !st.ps1Preview; onEnter?.({ ps1: st.ps1Preview }); syncTop(); }
      else if (a === 'help') showHelp(true);
      else if (a === 'play') { st.playing = !st.playing; syncTop(); if (!st.playing) setTimeout(refreshOverlay, 30); }
    });
    tools.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b?.dataset.tool) return;
      if (b.dataset.tool === 'space') { st.local = !st.local; syncSpace(); updateGizmo(); toast('Оси гизмо: ' + (st.local ? 'предмета (локальные)' : 'мира')); return; }
      setTool(b.dataset.tool);
    });
    side.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a === 'side') side.classList.toggle('open');
    });
    const saved = top.querySelector('.ed-saved');
    return { top, tools, side, status, saved, color: null };
  }
  // памятка: показывается при первом входе и по кнопке «?»
  function showHelp(force) {
    let h = document.getElementById('ed-help');
    if (h) { h.remove(); if (force) return; }
    try { if (!force && localStorage.getItem('ps1.edhelp')) return; localStorage.setItem('ps1.edhelp', '1'); } catch { /* */ }
    h = document.createElement('div'); h.id = 'ed-help';
    h.innerHTML = `<b>Мастерская — как править</b>
      <ol><li><b>Модель</b> (слева вверху) — выбери, что править: персонажа или любую из 2500+ моделей библиотеки.</li>
      <li><b>Объект</b> — нажми на деталь модели (или выбери в списке справа): скрыть, двигать, цвет и материал.</li>
      <li><b>Правка</b> — точки-вершины: нажми/обведи рамкой и тяни стрелки. «Связанное» выделит всю деталь.</li>
      <li><b>Скульпт</b> — води по модели кистями: надуть, вытянуть, вдавить, сгладить (симметрия включена).</li>
      <li><b>Покраска</b> — рисуй пикселями прямо по текстуре; ластик возвращает исходный цвет.</li>
      <li><b>Снаряжение</b> — оружие, шапки, волосы, плащи: двигать, менять хват, делать одеждой.</li></ol>
      <p>Камера: правая кнопка мыши / два пальца или кнопка 🎥. Отмена — ↶. Всё сохраняется само.</p>
      <button class="btn primary">Понятно</button>`;
    h.querySelector('button').onclick = () => h.remove();
    document.body.appendChild(h);
  }
  function syncTop() {
    ui.top.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
    ui.top.querySelector('[data-a=cam]').classList.toggle('on', st.cam);
    ui.top.querySelector('[data-a=pose]').textContent = st.pose === 'rest' ? 'Т-поза' : 'Кадр';
    ui.top.querySelector('[data-a=ps1]').classList.toggle('on', st.ps1Preview);
    const pl = ui.top.querySelector('[data-a=play]');
    pl.hidden = st.mode !== 'equip'; pl.classList.toggle('on', st.playing); pl.textContent = st.playing ? '❚❚ Пауза' : '▶ Анимация';
    ui.top.querySelector('[data-a=pose]').hidden = st.mode === 'equip';
    const on = ui.top.querySelector('[data-mode].on'); // на телефоне шапка прокручивается — показываем активный режим
    if (on && st.active) { const r = on.getBoundingClientRect(); if (r.right > innerWidth || r.left < 0) ui.top.scrollLeft += r.left - 60; }
  }
  function setMode(m) {
    if (st.mode === 'equip' && m !== 'equip') { eqPanel.leave(); st.playing = false; }
    if (m === 'equip') {
      if (st.pose === 'rest') { st.pose = 'frame'; onEnter?.({ pose: 'frame' }); } // снаряжение удобнее подгонять в позе анимации
      eqPanel.enter();
    }
    st.mode = m;
    st.tool = TOOLS[m][0][0];
    ui.side.querySelector('.ed-parts').hidden = m === 'equip';
    ui.tools.innerHTML = TOOLS[m].map(([k, ic, l]) => `<button data-tool="${k}" title="${l}"><b>${ic}</b><span>${l.replace(/ \(.\)/, '')}</span></button>`).join('');
    if (m !== 'edit') st.sel.clear();
    cursor.visible = false;
    syncTop(); setTool(st.tool); refreshProps(); refreshOverlay(); applyCamMode(); updateStatus();
  }
  function syncSpace() { const b = ui.tools.querySelector('[data-tool=space]'); if (b) { b.classList.toggle('on', !st.local); b.querySelector('span').textContent = st.local ? 'Оси: свои' : 'Оси: мир'; } }
  function setTool(t) {
    st.tool = t;
    ui.tools.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    syncSpace();
    updateGizmo(); updateStatus();
  }
  function applyCamMode() {
    const free = st.cam || st.mode === 'object' || st.mode === 'equip';
    controls.mouseButtons = { LEFT: free ? THREE.MOUSE.ROTATE : null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: free ? THREE.TOUCH.ROTATE : null, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  function label(m) {
    const eq = getEquip(), c = eq?.findContainer(m) || (m.userData.clothingOf && eq?.containers().find((x) => x.userData.equip.uid === m.userData.clothingOf));
    if (!c) return m.name || 'деталь';
    return '⚔ ' + c.userData.equip.name + (m.userData.partName ? ' · ' + m.userData.partName : '') + (m.userData.clothingOf ? ' (на теле)' : '');
  }
  function refreshOutliner() {
    const el = ui.side.querySelector('.ed-outliner');
    const ms = meshesOf(root, true).filter((m) => isShown(m) || m.userData.edHidden);
    el.innerHTML = ms.map((m, i) => `<div class="ed-row${m === st.mesh ? ' on' : ''}" data-i="${i}">
      <button data-eye="${i}" title="Скрыть/показать (H)">${m.visible ? '👁' : '—'}</button><span>${label(m).replace(/</g, '')}</span></div>`).join('') || '<p class="hint small">Нет деталей</p>';
    el.onclick = (e) => {
      const eye = e.target.closest('[data-eye]');
      if (eye) { const m = ms[+eye.dataset.eye]; hideMesh(m, m.visible); return; }
      const row = e.target.closest('.ed-row'); if (row) selectMesh(ms[+row.dataset.i]);
    };
  }
  function refreshProps() {
    const el = ui.side.querySelector('.ed-props');
    const rng = (k, label, min, max, step, fmt = (v) => v) => `<label class="field">${label} <b data-v="${k}">${fmt(st[k])}</b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${st[k]}"></label>`;
    const chk = (k, label) => `<label class="check"><input type="checkbox" data-k="${k}" ${st[k] ? 'checked' : ''}> ${label}</label>`;
    const btn = (a, l) => `<button class="btn" data-op="${a}">${l}</button>`;
    let h = '';
    if (st.mode === 'equip') {
      el.oninput = null; el.onclick = (e) => eqPanel.onClick(e, el); el.onchange = (e) => eqPanel.onInput(e, el);
      eqPanel.render(el);
      return;
    }
    el.onchange = null;
    const mats = st.mesh ? [...new Set([].concat(st.mesh.userData.orig || st.mesh.material))].filter((m) => m?.color) : [];
    const matHTML = matUI(mats);
    if (st.mode === 'object') {
      h = `<h3>Объект</h3><p class="hint small">${st.mesh ? 'Выбрано: <b>' + (st.mesh.name || 'деталь') + '</b>' : 'Нажми на деталь модели или выбери в списке.'}</p>
        <div class="row">${btn('hide', 'Скрыть (H)')}${btn('showall', 'Показать всё')}</div>
        <div class="row">${btn('revertmesh', 'Вернуть форму детали')}${btn('frame', 'Показать (F)')}</div>${matHTML}`;
    } else if (st.mode === 'edit') {
      h = `<h3>Правка вершин</h3><p class="hint small">${st.mesh ? '' : 'Сначала выбери деталь в режиме «Объект» или в списке.'}</p>
        <div class="row">${btn('all', 'Все (A)')}${btn('none', 'Снять')}${btn('inv', 'Инверсия')}</div>
        <div class="row">${btn('linked', 'Связанное (L)')}${btn('frame', 'Показать (F)')}</div>
        ${chk('xray', 'Сквозное выделение (Alt+Z)')}
        ${chk('prop', 'Пропорциональное (O)')}${rng('propR', 'Радиус влияния', 0.02, 0.6, 0.01, (v) => Math.round(v * 100) + ' см')}
        <div class="row">${btn('smooth', 'Сгладить')}${btn('revert', 'Вернуть')}</div>
        <div class="row">${btn('delete', 'Удалить грани (X)')}</div>${matHTML}`;
    } else if (st.mode === 'sculpt') {
      h = `<h3>Кисть</h3>${rng('brushR', 'Радиус ([ ])', 0.01, 0.4, 0.005, (v) => Math.round(v * 100) + ' см')}${rng('brushS', 'Сила', 0.05, 1, 0.05)}
        ${chk('sym', 'Симметрия по X')}<p class="hint small">Кисть работает по детали, на которой начат мазок. Камера — правой кнопкой, двумя пальцами или кнопкой 🎥.</p>
        <button class="btn" data-op="sculptgl">Лепить деталь во внешнем SculptGL ↗ (англ.)</button>`;
    } else {
      h = `<h3>Краска</h3><div class="swatches">${PAINT_PAL.map((c) => `<button style="background:${c}" data-c="${c}"></button>`).join('')}<input type="color" data-k="color" value="${st.color}"></div>
        ${rng('px', 'Размер кисти, пикс.', 1, 16, 1)}${rng('alpha', 'Непрозрачность', 0.1, 1, 0.05)}
        <p class="hint small">Рисуешь на отдельном слое поверх текстуры: ластик возвращает исходный пиксель.</p>${matHTML}`;
    }
    h += `<h3>Правки</h3><div class="row">${btn('resetall', 'Сбросить все правки')}</div>`;
    el.innerHTML = h;
    bindMat(el, mats);
    ui.color = el.querySelector('[data-k=color]') || { value: '' };
    el.oninput = (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      st[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'color' ? e.target.value : +e.target.value;
      const b = el.querySelector(`[data-v="${k}"]`);
      if (b) b.textContent = /R$/.test(k) ? Math.round(st[k] * 100) + ' см' : st[k];
      if (k === 'xray' || k === 'prop') refreshOverlay();
    };
    el.onclick = (e) => {
      const c = e.target.dataset?.c;
      if (c) { st.color = c; ui.color.value = c; return; }
      const op = e.target.closest('[data-op]')?.dataset.op;
      const ops = {
        hide: () => hideMesh(st.mesh), showall: showAll, revertmesh: () => revertSel(true), frame: frameSel,
        all: () => selectAll(true), none: () => selectAll(false), inv: invertSel, linked: selectLinked,
        smooth: () => smoothSel(), revert: () => revertSel(false), delete: deleteFaces, resetall: resetAll, sculptgl: openSculpt,
      };
      ops[op]?.();
    };
  }
  function updateStatus() {
    const hints = {
      object: 'Клик — выбрать деталь · H — скрыть · Alt+H — показать всё · G/R/S — гизмо · Tab — правка вершин',
      edit: 'Клик — вершина · Shift+клик — добавить · тяни — рамка · A — все · L — связанное · O — пропорц. · X — удалить грани · G/R/S',
      sculpt: 'Води по модели · [ ] — радиус · правая кнопка/2 пальца — камера',
      paint: 'Рисуй по модели · пипетка берёт цвет · правая кнопка/2 пальца — камера',
      equip: 'Клик — выбрать предмет (ещё клик — деталь своего предмета) · G/R/S — гизмо · числа в панели · ▶ — проверить в движении',
    };
    const md = st.mesh && MD.get(st.mesh);
    if (st.mode === 'equip') { const s = eqPanel.sel; ui.status.textContent = `${MODES.equip} · ${s ? (s.kind === 'socket' ? 'гнездо' : s.kind === 'part' ? 'деталь' : s.obj.userData.equip.name) : 'ничего не выбрано'} · отмен: ${undo.length} — ${hints.equip}`; return; }
    ui.status.textContent = `${MODES[st.mode]} · ${st.mesh ? (st.mesh.name || 'деталь') + (md ? ` · вершин ${md.members.length}` : '') : 'деталь не выбрана'}${st.mode === 'edit' ? ' · выделено ' + st.sel.size : ''} · отмен: ${undo.length} — ${hints[st.mode]}`;
  }

  /* ======================= горячие клавиши ======================= */
  addEventListener('keydown', (e) => {
    if (!st.active || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
    if (mod && k === 'y') { e.preventDefault(); return doRedo(); }
    if (k === 'tab') { e.preventDefault(); return setMode(st.mode === 'edit' ? 'object' : 'edit'); }
    if (k === 'g') setTool('translate');
    else if (k === 'r') setTool('rotate');
    else if (k === 's' && !mod) setTool(st.mode === 'sculpt' ? 'smooth' : 'scale');
    else if (k === 'a' && e.altKey) selectAll(false);
    else if (k === 'a') selectAll(true);
    else if (k === 'i' && mod) invertSel();
    else if (k === 'l' && st.mode !== 'equip') selectLinked();
    else if (k === 'o') { st.prop = !st.prop; refreshProps(); toast('Пропорциональное: ' + (st.prop ? 'вкл' : 'выкл')); }
    else if (k === 'z' && e.altKey) { st.xray = !st.xray; refreshProps(); refreshOverlay(); }
    else if ((k === 'x' || k === 'delete') && st.mode === 'edit') deleteFaces();
    else if (k === 'l' && st.mode === 'equip') { st.local = !st.local; syncSpace(); updateGizmo(); toast('Оси гизмо: ' + (st.local ? 'предмета' : 'мира')); }
    else if (k === 'h' && e.altKey) showAll();
    else if (k === 'h' && st.mode !== 'equip') hideMesh(st.mesh);
    else if (k === 'f') { if (st.mode === 'equip') { if (eqPanel.sel) frameObj(eqPanel.sel.obj); } else frameSel(); }
    else if (k === '[') { st.brushR = Math.max(0.01, st.brushR / 1.2); refreshProps(); }
    else if (k === ']') { st.brushR = Math.min(0.4, st.brushR * 1.2); refreshProps(); }
    else if (k === '1') setMode('object'); else if (k === '2') setMode('edit'); else if (k === '3') setMode('sculpt'); else if (k === '4') setMode('paint'); else if (k === '5') setMode('equip');
    else if (k === 'escape') { if (st.mode === 'equip' && eqPanel.sel) eqPanel.select(null); else if (st.sel.size) selectAll(false); else setTool(TOOLS[st.mode][0][0]); }
    else return;
    e.preventDefault();
  });

  /* ======================= вход/выход ======================= */
  let savedControls = null;
  function enter(r, k, opts = {}) {
    root = r; key = k;
    if (opts.mode && MODES[opts.mode]) st.mode = opts.mode;
    const ms = ui.top.querySelector('[data-a=model]');
    ms.innerHTML = modelOptions().map(([v, l, on]) => `<option value="${v}"${on ? ' selected' : ''}>${l}</option>`).join('');
    if (st.mode === 'equip' && st.pose === 'rest') st.pose = 'frame';
    eqPanel.reset();
    st.active = true;
    document.body.classList.add('editing');
    [ui.top, ui.tools, ui.side, ui.status].forEach((el) => { el.hidden = false; });
    savedControls = { mb: { ...controls.mouseButtons }, t: { ...controls.touches }, auto: controls.autoRotate };
    controls.autoRotate = false;
    onEnter?.({ pose: st.pose, ps1: st.ps1Preview, start: true });
    afterLook(r, k);
    setTimeout(() => {
      if (!st.mesh || !isShown(st.mesh) || !meshesOf().includes(st.mesh)) { // по умолчанию — самая крупная видимая деталь
        st.mesh = meshesOf().reduce((a, m) => (!a || m.geometry.attributes.position.count > a.geometry.attributes.position.count ? m : a), null);
        st.sel.clear();
      }
      setMode(st.mode); refreshOutliner(); refreshProps();
      showHelp(false);
    }, 30);
  }
  function exit() {
    st.active = false; st.playing = false;
    document.getElementById('ed-help')?.remove();
    eqPanel.leave();
    save();
    document.body.classList.remove('editing');
    [ui.top, ui.tools, ui.side, ui.status].forEach((el) => { el.hidden = true; });
    tc.detach(); tcHelper.visible = false; points.visible = false; cursor.visible = false; setWire(null);
    if (savedControls) { controls.mouseButtons = savedControls.mb; controls.touches = savedControls.t; controls.autoRotate = savedControls.auto; }
    controls.enabled = true;
    onExit?.();
  }
  function update() { if (st.active && st.mode === 'edit' && st.mesh && !drag && !ptr && st.pose === 'frame') { /* поза статична — ничего */ } }

  return { enter, exit, afterLook, applyEdits, update, get active() { return st.active; }, get playing() { return st.active && st.playing; }, refreshOverlay, isApplied: (a) => APPLIED.has(a) };
}
