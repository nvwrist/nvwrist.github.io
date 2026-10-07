import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { spawn, libCatalog, loadMaster } from '../library.js';
import { createBrowser } from '../ui/browser.js';
import { createTerrain, terrainFromData, createWater, TILES, tileIcon } from './terrain.js';
import { db } from '../db.js';

/*
 * Редактор карт. Карта = рельеф (высоты + плитки) + вода + объекты из библиотеки CC0 + атмосфера + точка появления.
 * Объекты: { id, a (id модели), p, q, s, solid, role, txt, name, speed, light, anim } — роли готовят карту к игре
 * (NPC с репликой, враг, подбираемое, переход, надпись, источник света). Хранится в IndexedDB 'maps', автосохранение.
 */

export const ATMOS = {
  night: { name: 'Ночь', bg: '#0b0d14', fog: '#0f1018', fogD: 0.035, amb: '#5a6a8c', ambI: 0.55, sun: '#8a9ac8', sunI: 0.5, sky: ['#05060c', '#1a1c2a'] },
  dusk: { name: 'Сумерки', bg: '#2a2030', fog: '#3a2c34', fogD: 0.028, amb: '#8a6a7a', ambI: 0.7, sun: '#ffb070', sunI: 0.9, sky: ['#1a1428', '#7a4a3a'] },
  fog: { name: 'Туман', bg: '#6a6e70', fog: '#7a7e80', fogD: 0.05, amb: '#a8aab0', ambI: 0.9, sun: '#e0e0d8', sunI: 0.4, sky: ['#5a5e62', '#8a8e90'] },
  overcast: { name: 'Пасмурно', bg: '#5a646e', fog: '#6a747c', fogD: 0.014, amb: '#b0b4b8', ambI: 0.85, sun: '#f0ece0', sunI: 0.9, sky: ['#3e4852', '#8a949a'] },
  day: { name: 'День', bg: '#7a9ab8', fog: '#9ab0c0', fogD: 0.008, amb: '#c8c8c0', ambI: 0.9, sun: '#fff2d8', sunI: 1.6, sky: ['#4a78a8', '#b8ccd8'] },
  dungeon: { name: 'Подземелье', bg: '#050404', fog: '#080606', fogD: 0.06, amb: '#4a3a30', ambI: 0.45, sun: '#6a5a4a', sunI: 0.2, sky: ['#030202', '#0a0806'] },
  blood: { name: 'Кровавая луна', bg: '#1a0808', fog: '#2a0c0c', fogD: 0.03, amb: '#7a3a3a', ambI: 0.6, sun: '#ff6a5a', sunI: 0.7, sky: ['#0a0202', '#4a1010'] },
};
export const ROLES = { '': 'Декор', npc: 'NPC (говорит)', enemy: 'Враг', pickup: 'Подбираемое', portal: 'Переход', sign: 'Надпись-триггер', light: 'Источник света' };
const NON_SOLID = /grass|flower|plant|mushroom|fern|clover|petal|bush|cobweb|web|banner|flag|rug|carpet|coin|leaf|leaves|lily|reed|wheat|corn|crop|vine|ivy|moss|decal|pebble/i;
const LIGHT_RE = /torch|candle|lantern|lamp|lightpost|campfire|woodfire|brazier|firebasket|fire_?basket|chandelier|fire/i;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function createMapEditor(ctx) {
  const { scene, camera, controls, canvas, toast, L } = ctx;
  const st = { active: false, tool: 'select', snap: 0, angle: 15, scatter: false, cam: false, brushR: 4, brushS: 0.5, sculpt: 'raise', tile: 0,
    placing: null, sel: null, yaw: 0, sideTab: 'lib' };
  const root = new THREE.Group(); root.name = 'Карта';
  const objGroup = new THREE.Group(); objGroup.name = 'Объекты';
  const helpers = new THREE.Group(); helpers.name = 'helpers';
  root.add(objGroup, helpers);
  let map = null, terrain = null, water = null, sky = null;
  const entries = new Map(); // id → { d, o, mixer }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  /* ---------- оверлеи: гизмо, кисть, точка появления, рамка выбора ---------- */
  const tc = new TransformControls(camera, canvas);
  const tcHelper = tc.getHelper(); tcHelper.userData.edHelper = true;
  tc.setSize(0.9);
  tc.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb040, depthTest: false, transparent: true, opacity: 0.85 }));
  ring.renderOrder = 999; ring.visible = false; helpers.add(ring);
  const spawnMark = new THREE.Group();
  {
    const m = new THREE.MeshBasicMaterial({ color: 0x40ff90, depthTest: false, transparent: true, opacity: 0.85 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 6), m); pole.position.y = 1;
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 3).rotateZ(-Math.PI / 2), m); flag.position.set(0, 1.7, 0.45); flag.rotation.y = Math.PI / 2;
    const base = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 24).rotateX(-Math.PI / 2), m);
    spawnMark.add(pole, flag, base); spawnMark.traverse((o) => { o.renderOrder = 998; });
    helpers.add(spawnMark);
  }
  const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffb040); selBox.visible = false; selBox.material.depthTest = false; selBox.renderOrder = 997; helpers.add(selBox);
  let ghost = null;

  /* ---------- атмосфера ---------- */
  const lightPool = Array.from({ length: 6 }, () => { const l = new THREE.PointLight(0xffa040, 0, 9, 1.6); root.add(l); return l; });
  function applyEnv() {
    const e = { ...ATMOS[map.env.preset] || ATMOS.night, ...map.env.custom };
    scene.background = new THREE.Color(e.bg);
    scene.fog = new THREE.FogExp2(e.fog, e.fogD * (map.env.fogK ?? 1));
    L.amb.color.set(e.amb); L.amb.intensity = e.ambI;
    L.dir.color.set(e.sun); L.dir.intensity = e.sunI; L.dir.position.set(30, 50, 20);
    L.p1.intensity = 0; L.p2.intensity = 0;
    if (sky) { root.remove(sky); sky.geometry.dispose(); }
    const g = new THREE.SphereGeometry(400, 16, 10), c = [], top = new THREE.Color(e.sky[0]), hor = new THREE.Color(e.sky[1]);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = Math.max(0, p.getY(i) / 400); const k = new THREE.Color().copy(hor).lerp(top, Math.pow(t, 0.6)); c.push(k.r, k.g, k.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; sky.userData.edHelper = true; sky.name = 'Небо';
    root.add(sky);
  }

  /* ---------- данные карты ---------- */
  function blankMap(name = 'Новая карта', size = 48) {
    return { id: uid(), name, v: 1, created: Date.now(), terrain: null, size, water: { on: false, level: -0.6 }, env: { preset: 'night', fogK: 1 },
      spawn: { p: [0, 0, 0], yaw: 0 }, objects: [] };
  }
  function clearScene() {
    for (const e of entries.values()) objGroup.remove(e.o);
    entries.clear();
    if (terrain) { root.remove(terrain.mesh); terrain.dispose(); terrain = null; }
    if (water) { root.remove(water); water = null; }
    select(null);
  }
  async function load(m) {
    clearScene();
    map = m;
    terrain = m.terrain ? terrainFromData(m.terrain) : createTerrain({ size: m.size || 48, cell: 2 });
    root.add(terrain.mesh);
    setWater();
    applyEnv();
    spawnMark.position.fromArray(m.spawn.p); spawnMark.rotation.y = m.spawn.yaw || 0;
    undo.length = redo.length = 0;
    await Promise.all(m.objects.map((d) => addObject(d, false)));
    ctx.onMapChanged?.(map);
    refreshAll();
    lsSet('ps1.map.last', m.id);
  }
  function setWater() {
    if (water) { root.remove(water); water = null; }
    if (!map.water?.on) return;
    water = createWater(terrain.size * terrain.cell + 40);
    water.position.y = map.water.level;
    root.add(water);
  }
  function serialize() {
    map.terrain = terrain.serialize();
    map.objects = [...entries.values()].map((e) => e.d);
    map.updated = Date.now();
    return map;
  }
  let saveT = 0;
  function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(save, 900); status('…'); }
  async function save() {
    if (!map) return;
    try { await db.put('maps', JSON.parse(JSON.stringify(serialize()))); status('✓ сохранено'); }
    catch (e) { status('⚠ не сохранилось'); console.warn(e); }
  }

  /* ---------- объекты ---------- */
  async function addObject(d, record = true) {
    let o;
    try { o = await spawn(d.a); } catch (e) { console.warn('объект не загрузился', d.a, e); return null; }
    const it = (await libCatalog()).byId.get(d.a);
    o.position.fromArray(d.p); o.quaternion.fromArray(d.q || [0, 0, 0, 1]); o.scale.fromArray(d.s || [1, 1, 1]);
    o.userData.mapId = d.id;
    if (d.solid === undefined) d.solid = !NON_SOLID.test(it?.en || '') && Math.max(...(it?.s || [1, 1, 1])) > 0.35;
    if (d.light === undefined && LIGHT_RE.test(it?.en || '')) d.light = { color: '#ffa04a', i: 2.2, r: 8 };
    const e = { d, o, it, mixer: null };
    playAnim(e);
    objGroup.add(o);
    entries.set(d.id, e);
    if (record) push({ undo: () => removeObject(d.id, false), redo: () => addObject(d, false) });
    return e;
  }
  function playAnim(e) {
    e.mixer?.stopAllAction();
    const clips = e.o.animations || [];
    if (!clips.length) { e.mixer = null; return; }
    const want = e.d.anim ? clips.find((c) => c.name === e.d.anim) : clips.find((c) => /idle/i.test(c.name)) || clips[0];
    if (!want) return;
    e.mixer = e.mixer || new THREE.AnimationMixer(e.o);
    e.mixer.clipAction(want).reset().play();
  }
  function removeObject(id, record = true) {
    const e = entries.get(id); if (!e) return;
    if (st.sel === e) select(null);
    objGroup.remove(e.o); entries.delete(id);
    if (record) push({ undo: () => addObject(e.d, false), redo: () => removeObject(id, false) });
    scheduleSave(); refreshSide();
  }
  function commitTransform(e) {
    e.d.p = e.o.position.toArray().map((v) => +v.toFixed(3));
    e.d.q = e.o.quaternion.toArray().map((v) => +v.toFixed(5));
    e.d.s = e.o.scale.toArray().map((v) => +v.toFixed(3));
    scheduleSave();
  }
  const entryOf = (obj) => { for (let p = obj; p; p = p.parent) if (p.userData.mapId) return entries.get(p.userData.mapId); return null; };

  /* ---------- история ---------- */
  const undo = [], redo = [];
  function push(op) { undo.push(op); if (undo.length > 80) undo.shift(); redo.length = 0; scheduleSave(); }
  function doUndo() { const op = undo.pop(); if (!op) return; op.undo(); redo.push(op); scheduleSave(); refreshSide(); updateSel(); }
  function doRedo() { const op = redo.pop(); if (!op) return; op.redo(); undo.push(op); scheduleSave(); refreshSide(); updateSel(); }

  /* ---------- выбор и гизмо ---------- */
  function select(e) {
    st.sel = e;
    updateSel();
    refreshSide();
  }
  function updateSel() {
    const e = st.sel && entries.get(st.sel.d.id) === st.sel ? st.sel : null;
    if (!e) { st.sel = null; tc.detach(); tcHelper.visible = false; selBox.visible = false; return; }
    selBox.box.setFromObject(e.o, true); selBox.visible = true;
    if (['translate', 'rotate', 'scale'].includes(st.tool)) { tc.setMode(st.tool); tc.attach(e.o); tcHelper.visible = true; }
    else { tc.detach(); tcHelper.visible = false; }
  }
  let tcBefore = null;
  tc.addEventListener('mouseDown', () => { const e = st.sel; if (e) tcBefore = { p: e.o.position.clone(), q: e.o.quaternion.clone(), s: e.o.scale.clone() }; });
  tc.addEventListener('objectChange', () => { if (st.sel) { if (st.snap && st.tool === 'translate') snapXZ(st.sel.o.position, st.sel); selBox.box.setFromObject(st.sel.o, true); syncNums(); } });
  tc.addEventListener('mouseUp', () => {
    const e = st.sel; if (!e || !tcBefore) return;
    const before = tcBefore, after = { p: e.o.position.clone(), q: e.o.quaternion.clone(), s: e.o.scale.clone() };
    tcBefore = null;
    commitTransform(e);
    const set = (v) => { e.o.position.copy(v.p); e.o.quaternion.copy(v.q); e.o.scale.copy(v.s); commitTransform(e); };
    push({ undo: () => set(before), redo: () => set(after) });
  });

  /* ---------- привязка к сетке ---------- */
  function gridStep(it) {
    if (st.snap === 'auto') { const s = it?.s || [1, 1, 1]; return Math.max(0.25, Math.round(Math.max(s[0], s[2]) * 100) / 100); }
    return st.snap;
  }
  function snapXZ(p, e) {
    const step = gridStep(e?.it || st.placing);
    if (!step) return p;
    p.x = Math.round(p.x / step) * step; p.z = Math.round(p.z / step) * step;
    return p;
  }

  /* ---------- указатель ---------- */
  function setNDC(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function hitWorld(ev, { objects = true, exclude = null } = {}) {
    setNDC(ev);
    const list = [terrain.mesh];
    if (objects) for (const e of entries.values()) if (e.o !== exclude) list.push(e.o);
    return ray.intersectObjects(list, true).find((h) => !h.object.userData.edHelper && (!exclude || !isChild(h.object, exclude)));
  }
  const isChild = (o, p) => { for (let x = o; x; x = x.parent) if (x === p) return true; return false; };
  let ptr = null, stroke = null;
  function onDown(ev) {
    if (!st.active || ev.button > 0 || (tc.axis && tc.enabled && tcHelper.visible) || tc.dragging) return;
    ptr = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, moved: false };
    if ((st.tool === 'sculpt' || st.tool === 'paint') && !st.cam) {
      const h = hitWorld(ev, { objects: false });
      if (!h) { ptr = null; return; }
      controls.enabled = false;
      stroke = { before: terrain.snapshot(), target: h.point.y, last: 0 };
      brushAt(h.point);
    }
  }
  function onMove(ev) {
    if (!st.active) return;
    if (st.tool === 'place' && ghost) {
      const h = hitWorld(ev, { exclude: ghost });
      if (h) { ghost.position.copy(h.point); snapXZ(ghost.position); if (gridStep(st.placing)) ghost.position.y = terrain.heightAt(ghost.position.x, ghost.position.z) > h.point.y - 0.05 ? terrain.heightAt(ghost.position.x, ghost.position.z) : h.point.y; ghost.visible = true; }
    }
    if (st.tool === 'sculpt' || st.tool === 'paint') {
      const h = hitWorld(ev, { objects: false });
      ring.visible = !!h;
      if (h) { ring.position.copy(h.point).y += 0.05; ring.scale.setScalar(st.brushR); }
      if (stroke && h && ptr && ev.pointerId === ptr.id) { const now = performance.now(); if (now - stroke.last > 30) { stroke.last = now; brushAt(h.point); } }
    }
    if (ptr && ev.pointerId === ptr.id && Math.hypot(ev.clientX - ptr.x, ev.clientY - ptr.y) > 6) ptr.moved = true;
  }
  function onUp(ev) {
    if (!ptr || ev.pointerId !== ptr.id) return;
    const p = ptr; ptr = null;
    if (stroke) {
      controls.enabled = true;
      const before = stroke.before, after = terrain.snapshot(); stroke = null;
      push({ undo: () => terrain.restore(before), redo: () => terrain.restore(after) });
      afterTerrain();
      return;
    }
    if (p.moved || st.cam) return;
    if (st.tool === 'place' && ghost?.visible) return placeGhost();
    if (st.tool === 'spawn') {
      const h = hitWorld(ev); if (!h) return;
      const before = { ...map.spawn };
      map.spawn = { p: h.point.toArray().map((v) => +v.toFixed(2)), yaw: map.spawn.yaw || 0 };
      spawnMark.position.fromArray(map.spawn.p);
      push({ undo: () => { map.spawn = before; spawnMark.position.fromArray(before.p); }, redo: () => {} });
      toast('Точка появления игрока поставлена');
      return;
    }
    if (['select', 'translate', 'rotate', 'scale'].includes(st.tool)) {
      const h = hitWorld(ev);
      const e = h ? entryOf(h.object) : null;
      select(e);
      if (e && st.tool === 'select') setTool('translate');
    }
  }
  canvas.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  canvas.addEventListener('contextmenu', (e) => { if (st.active) e.preventDefault(); });

  function brushAt(p) {
    if (st.tool === 'sculpt') terrain.sculpt(p.x, p.z, st.brushR, st.brushS, st.sculpt, stroke?.target ?? p.y);
    else terrain.paint(p.x, p.z, st.brushR, st.tile);
  }
  function afterTerrain() { // объекты «стоят» на рельефе — подровнять их не можем угадать, но точку появления опускаем на землю
    const sp = map.spawn.p; sp[1] = +terrain.heightAt(sp[0], sp[2]).toFixed(2); spawnMark.position.fromArray(sp);
    scheduleSave();
  }

  /* ---------- расстановка ---------- */
  async function startPlacing(it) {
    cancelPlacing(false);
    st.placing = it; setTool('place');
    status('Загрузка: ' + it.n);
    try {
      ghost = await spawn(it.id);
      if (st.placing !== it) return;
      const see = (m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.55; c.depthWrite = false; return c; };
      ghost.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(see) : see(o.material); });
      ghost.userData.edHelper = true; ghost.visible = false;
      ghost.rotation.y = st.yaw;
      helpers.add(ghost);
      updateStatus();
    } catch (e) { toast('Не загрузилось: ' + e.message); }
  }
  function cancelPlacing(resetTool = true) {
    if (ghost) { helpers.remove(ghost); ghost = null; }
    st.placing = null;
    browser?.clearSelection();
    if (resetTool && st.tool === 'place') setTool('select');
  }
  async function placeGhost() {
    const it = st.placing; if (!it || !ghost) return;
    const q = ghost.quaternion.clone();
    let s = ghost.scale.x;
    if (st.scatter) { // разброс: случайный поворот и размер (для деревьев, камней, травы)
      ghost.rotation.y = Math.random() * Math.PI * 2;
      s = 0.85 + Math.random() * 0.3;
    }
    const d = { id: uid(), a: it.id, p: ghost.position.toArray().map((v) => +v.toFixed(3)), q: q.toArray().map((v) => +v.toFixed(5)), s: [s, s, s] };
    await addObject(d);
    if (st.scatter) ghost.scale.setScalar(1);
    refreshSide();
  }
  function rotateYaw(deg) {
    const r = THREE.MathUtils.degToRad(deg);
    if (st.tool === 'place' && ghost) { st.yaw += r; ghost.rotation.y = st.yaw; return; }
    const e = st.sel; if (!e) return;
    const before = e.o.quaternion.clone();
    e.o.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), r);
    const after = e.o.quaternion.clone();
    commitTransform(e); updateSel(); syncNums();
    push({ undo: () => { e.o.quaternion.copy(before); commitTransform(e); }, redo: () => { e.o.quaternion.copy(after); commitTransform(e); } });
  }
  async function duplicate() {
    const e = st.sel; if (!e) return;
    const step = gridStep(e.it) || Math.max(1, e.it?.s?.[0] || 1);
    const d = JSON.parse(JSON.stringify(e.d)); d.id = uid(); d.p[0] += step;
    const ne = await addObject(d);
    if (ne) select(ne);
    toast('Копия поставлена рядом — двигай её');
  }
  function dropToGround() {
    const e = st.sel; if (!e) return;
    const b = new THREE.Box3().setFromObject(e.o, true);
    const before = e.o.position.clone();
    e.o.position.y += terrain.heightAt(e.o.position.x, e.o.position.z) - b.min.y;
    const after = e.o.position.clone();
    commitTransform(e); updateSel(); syncNums();
    push({ undo: () => { e.o.position.copy(before); commitTransform(e); }, redo: () => { e.o.position.copy(after); commitTransform(e); } });
  }

  /* ---------- UI ---------- */
  const TOOLS = [['select', '⬚', 'Выбор (V)'], ['translate', '✥', 'Сдвиг (G)'], ['rotate', '⟳', 'Поворот (R)'], ['scale', '⤢', 'Размер (T)'],
    ['sculpt', '⛰', 'Рельеф (B)'], ['paint', '🖌', 'Покраска (P)'], ['spawn', '⚑', 'Старт игрока'], ['cam', '🎥', 'Камера']];
  const ui = buildUI();
  let browser = null;
  function buildUI() {
    const top = document.createElement('div'); top.id = 'mp-top'; top.className = 'ed-bar';
    top.innerHTML = `
      <button class="ed-b" data-a="maps" title="Список карт">🗺 <span class="mp-name"></span></button>
      <button class="ed-b" data-a="undo" title="Отменить (Ctrl+Z)">↶</button><button class="ed-b" data-a="redo" title="Повторить (Ctrl+Y)">↷</button>
      <label class="ed-b mp-sel" title="Привязка к сетке">Сетка <select data-f="snap"><option value="0">выкл</option><option value="auto">по модели</option><option value="0.5">0.5 м</option><option value="1">1 м</option><option value="2">2 м</option><option value="4">4 м</option></select></label>
      <label class="ed-b mp-sel" title="Шаг поворота (Q/E)">Угол <select data-f="angle"><option>15</option><option>45</option><option>90</option></select>°</label>
      <button class="ed-b" data-a="scatter" title="Разброс: случайный поворот и размер при расстановке (лес, камни)">🎲 Разброс</button>
      <button class="ed-b primary" data-a="play" title="Пройтись по карте персонажем">▶ Играть</button>
      <span class="ed-saved"></span>`;
    const tools = document.createElement('div'); tools.id = 'mp-tools'; tools.className = 'ed-toolcol';
    tools.innerHTML = TOOLS.map(([k, ic, l]) => `<button data-tool="${k}" title="${l}"><b>${ic}</b><span>${l.replace(/ \(.\)/, '')}</span></button>`).join('');
    const side = document.createElement('div'); side.id = 'mp-side'; side.className = 'ed-sidepanel';
    side.innerHTML = `<button class="ed-b ed-sidetoggle" data-a="side">⚙ Панель</button>
      <div class="mp-tabs">${[['lib', 'Объекты'], ['obj', 'Выбранное'], ['terrain', 'Рельеф'], ['world', 'Мир'], ['maps', 'Карты']].map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="mp-pane" data-pane="lib"></div><div class="mp-pane" data-pane="obj"></div><div class="mp-pane" data-pane="terrain"></div><div class="mp-pane" data-pane="world"></div><div class="mp-pane" data-pane="maps"></div>`;
    const stat = document.createElement('div'); stat.id = 'mp-status'; stat.className = 'ed-statusbar';
    [top, tools, side, stat].forEach((el) => { el.hidden = true; document.body.appendChild(el); });
    top.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'undo') doUndo(); else if (a === 'redo') doRedo();
      else if (a === 'scatter') { st.scatter = !st.scatter; e.target.closest('button').classList.toggle('on', st.scatter); toast(st.scatter ? 'Разброс: каждый новый объект — со случайным поворотом и размером' : 'Разброс выключен'); }
      else if (a === 'play') play();
      else if (a === 'maps') showTab('maps');
    });
    top.addEventListener('change', (e) => {
      const f = e.target.dataset.f;
      if (f === 'snap') st.snap = e.target.value === 'auto' ? 'auto' : +e.target.value;
      if (f === 'angle') st.angle = +e.target.value;
    });
    tools.addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (!b) return; if (b.dataset.tool === 'cam') { st.cam = !st.cam; applyCam(); b.classList.toggle('on', st.cam); return; } setTool(b.dataset.tool); });
    side.addEventListener('click', (e) => {
      if (e.target.closest('[data-a=side]')) return side.classList.toggle('open');
      const t = e.target.closest('[data-tab]'); if (t) showTab(t.dataset.tab);
    });
    return { top, tools, side, stat, saved: top.querySelector('.ed-saved') };
  }
  function status(s) { ui.saved.textContent = s; }
  function showTab(t) {
    st.sideTab = t;
    ui.side.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    ui.side.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t; });
    if (t === 'terrain' && st.tool !== 'sculpt' && st.tool !== 'paint') setTool('sculpt');
    refreshSide();
  }
  function setTool(t) {
    if (t !== 'place') { if (ghost) { helpers.remove(ghost); ghost = null; } st.placing = null; browser?.clearSelection(); }
    st.tool = t;
    ui.tools.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t || (b.dataset.tool === 'cam' && st.cam)));
    ring.visible = false;
    applyCam(); updateSel(); updateStatus();
    if ((t === 'sculpt' || t === 'paint') && st.sideTab !== 'terrain') showTab('terrain');
  }
  function applyCam() {
    const brush = (st.tool === 'sculpt' || st.tool === 'paint' || st.tool === 'place' || st.tool === 'spawn') && !st.cam;
    controls.mouseButtons = { LEFT: brush ? null : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: brush ? null : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  function updateStatus() {
    const hint = {
      select: 'Клик — выбрать объект · тяни — вращать камеру · правая кнопка — сдвиг камеры · WASD — лететь',
      translate: 'Тяни стрелки гизмо · Q/E — поворот · Ctrl+D — копия · Delete — удалить · F — показать',
      rotate: 'Тяни кольца гизмо · Q/E — поворот на шаг', scale: 'Тяни кубики гизмо (центр — равномерно)',
      place: 'Клик — поставить «' + (st.placing?.n || '') + '» · Q/E — повернуть · Esc — закончить · правая кнопка/2 пальца — камера',
      sculpt: 'Води по земле: ' + { raise: 'поднять', lower: 'опустить', smooth: 'сгладить', flatten: 'выровнять', noise: 'неровности' }[st.sculpt] + ' · [ ] — радиус',
      paint: 'Води по земле — красить плиткой «' + TILES[st.tile][0] + '» · [ ] — радиус', spawn: 'Клик по земле — где появится игрок',
    }[st.tool] || '';
    ui.stat.textContent = `${map?.name || ''} · объектов: ${entries.size} — ${hint}`;
  }
  function refreshAll() { ui.top.querySelector('.mp-name').textContent = map?.name || ''; refreshSide(); updateStatus(); }

  /* ---------- боковая панель ---------- */
  function refreshSide() {
    if (!st.active) return;
    const pane = ui.side.querySelector(`[data-pane="${st.sideTab}"]`);
    if (st.sideTab === 'lib') {
      if (!browser) browser = createBrowser(pane, { onPick: (it) => { startPlacing(it); if (innerWidth < 700) ui.side.classList.remove('open'); } });
    } else if (st.sideTab === 'obj') renderInspector(pane);
    else if (st.sideTab === 'terrain') renderTerrain(pane);
    else if (st.sideTab === 'world') renderWorld(pane);
    else if (st.sideTab === 'maps') renderMaps(pane);
    ui.side.querySelector('[data-tab=obj]').textContent = st.sel ? 'Выбранное •' : 'Выбранное';
    updateStatus();
  }
  let numsEl = null;
  function syncNums() {
    if (!numsEl || !st.sel) return;
    const o = st.sel.o, eu = new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ'), D = 180 / Math.PI;
    const v = { px: o.position.x, py: o.position.y, pz: o.position.z, ry: eu.y * D, rx: eu.x * D, rz: eu.z * D, s: o.scale.x * 100 };
    numsEl.querySelectorAll('[data-n]').forEach((i) => { if (document.activeElement !== i) i.value = +v[i.dataset.n].toFixed(i.dataset.n[0] === 'p' ? 2 : 1); });
  }
  function renderInspector(el) {
    const e = st.sel;
    if (!e) { el.innerHTML = '<p class="hint">Ничего не выбрано. Инструмент «Выбор» (V) → клик по объекту на карте.</p>' + objList(); bindObjList(el); numsEl = null; return; }
    const d = e.d, clips = e.o.animations || [];
    const num = (n, l, step) => `<label>${l}<input type="number" data-n="${n}" step="${step}"></label>`;
    el.innerHTML = `<h3>${esc(d.name || e.it?.n || d.a)}</h3>
      <p class="hint small">${esc(e.it?.en || '')} · ${e.it ? (ctx.packName?.(e.it.p) || e.it.p) : ''}</p>
      <div class="eq-nums">
        <div><span>Место, м</span>${num('px', 'X', 0.1)}${num('py', 'Y', 0.1)}${num('pz', 'Z', 0.1)}</div>
        <div><span>Поворот, °</span>${num('ry', '↻', 15)}${num('rx', 'X', 15)}${num('rz', 'Z', 15)}</div>
        <div><span>Размер, %</span>${num('s', '', 10)}</div>
      </div>
      <div class="row"><button class="btn" data-op="ground">На землю</button><button class="btn" data-op="dup">Копия (Ctrl+D)</button><button class="btn" data-op="del">Удалить</button></div>
      <label class="check"><input type="checkbox" data-f="solid" ${d.solid ? 'checked' : ''}> Твёрдый (сквозь не пройти)</label>
      <label class="field">Название <input type="text" data-f="name" value="${esc(d.name || '')}" placeholder="${esc(e.it?.n || '')}"></label>
      ${clips.length ? `<label class="field">Анимация <select data-f="anim"><option value="">— по умолчанию —</option>${clips.map((c) => `<option${c.name === d.anim ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      <h3>Роль в игре</h3>
      <label class="field"><select data-f="role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}"${(d.role || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${roleFields(d)}
      ${d.light || d.role === 'light' ? `<h3>Свет</h3><div class="row"><label class="field">Цвет <input type="color" data-f="lcolor" value="${d.light?.color || '#ffa04a'}"></label>
        <label class="field">Сила <input type="number" data-f="li" step="0.5" value="${d.light?.i ?? 2}"></label><label class="field">Радиус, м <input type="number" data-f="lr" step="1" value="${d.light?.r ?? 8}"></label></div>
        <button class="btn" data-op="nolight">Без света</button>` : `<button class="btn" data-op="addlight">＋ Светится (огонь/лампа)</button>`}
      ${objList()}`;
    numsEl = el.querySelector('.eq-nums'); syncNums();
    bindObjList(el);
  }
  function roleFields(d) {
    if (d.role === 'npc') return `<label class="field">Имя <input type="text" data-f="who" value="${esc(d.who || '')}" placeholder="Старик"></label><label class="field">Реплика (Enter — новая строка) <textarea data-f="txt" rows="3">${esc(d.txt || '')}</textarea></label>`;
    if (d.role === 'sign') return `<label class="field">Текст, который появится рядом <textarea data-f="txt" rows="3">${esc(d.txt || '')}</textarea></label>`;
    if (d.role === 'enemy') return `<div class="row"><label class="field">Скорость, м/с <input type="number" data-f="speed" step="0.5" value="${d.speed ?? 2.5}"></label><label class="field">Замечает с, м <input type="number" data-f="sight" step="1" value="${d.sight ?? 8}"></label></div><p class="hint small">Бродит возле места, замечает игрока и догоняет. Поймал — игрок возвращается на старт.</p>`;
    if (d.role === 'pickup') return `<label class="field">Что это (для счётчика) <input type="text" data-f="txt" value="${esc(d.txt || '')}" placeholder="монеты"></label><p class="hint small">Крутится на месте, исчезает при касании, счётчик в углу экрана.</p>`;
    if (d.role === 'portal') return `<label class="field">Куда: карта <select data-f="target"><option value="">— эта же карта, на старт —</option>${(mapsCache || []).map((m) => `<option value="${m.id}"${d.target === m.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label><p class="hint small">Подойти и нажать E (на телефоне — кнопку «Действие»).</p>`;
    return '';
  }
  function objList() {
    const list = [...entries.values()];
    if (!list.length) return '';
    return `<h3>Все объекты (${list.length})</h3><div class="ed-outliner mp-list">${list.slice(-200).reverse().map((x) => `<div class="ed-row${x === st.sel ? ' on' : ''}" data-oid="${x.d.id}"><span>${x.d.role ? '★ ' : ''}${esc(x.d.name || x.it?.n || x.d.a)}</span></div>`).join('')}</div>`;
  }
  function bindObjList(el) {
    el.onclick = (ev) => {
      const r = ev.target.closest('[data-oid]'); if (r) { const e = entries.get(r.dataset.oid); select(e); if (st.tool === 'select' || st.tool === 'place') setTool('translate'); focus(e.o); return; }
      const op = ev.target.closest('[data-op]')?.dataset.op; if (!op) return;
      if (op === 'ground') dropToGround(); else if (op === 'dup') duplicate(); else if (op === 'del') removeObject(st.sel.d.id);
      else if (op === 'addlight') { st.sel.d.light = { color: '#ffa04a', i: 2.2, r: 8 }; scheduleSave(); refreshSide(); }
      else if (op === 'nolight') { delete st.sel.d.light; if (st.sel.d.role === 'light') st.sel.d.role = ''; scheduleSave(); refreshSide(); }
    };
    el.onchange = (ev) => {
      const e = st.sel; if (!e) return;
      const t = ev.target, f = t.dataset.f, n = t.dataset.n;
      if (n) {
        const g = (k) => +el.querySelector(`[data-n=${k}]`).value || 0, D = Math.PI / 180;
        const before = { p: e.o.position.clone(), q: e.o.quaternion.clone(), s: e.o.scale.clone() };
        e.o.position.set(g('px'), g('py'), g('pz'));
        e.o.quaternion.setFromEuler(new THREE.Euler(g('rx') * D, g('ry') * D, g('rz') * D, 'YXZ'));
        e.o.scale.setScalar(Math.max(1, g('s')) / 100);
        const after = { p: e.o.position.clone(), q: e.o.quaternion.clone(), s: e.o.scale.clone() };
        const set = (v) => { e.o.position.copy(v.p); e.o.quaternion.copy(v.q); e.o.scale.copy(v.s); commitTransform(e); updateSel(); };
        commitTransform(e); updateSel();
        push({ undo: () => set(before), redo: () => set(after) });
        return;
      }
      const d = e.d;
      if (f === 'solid') d.solid = t.checked;
      else if (f === 'name') d.name = t.value.trim() || undefined;
      else if (f === 'anim') { d.anim = t.value || undefined; playAnim(e); }
      else if (f === 'role') { d.role = t.value || undefined; if (d.role === 'light' && !d.light) d.light = { color: '#ffa04a', i: 2.2, r: 8 }; refreshSide(); }
      else if (f === 'txt' || f === 'who') d[f] = t.value;
      else if (f === 'speed' || f === 'sight') d[f] = +t.value;
      else if (f === 'target') d.target = t.value || undefined;
      else if (f === 'lcolor') d.light.color = t.value; else if (f === 'li') d.light.i = +t.value; else if (f === 'lr') d.light.r = +t.value;
      scheduleSave();
    };
  }
  function renderTerrain(el) {
    const modes = { raise: 'Поднять', lower: 'Опустить', smooth: 'Сгладить', flatten: 'Выровнять', noise: 'Неровности' };
    el.innerHTML = `<h3>Рельеф</h3>
      <div class="mp-chips">${Object.entries(modes).map(([k, l]) => `<button data-sculpt="${k}" class="${st.tool === 'sculpt' && st.sculpt === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <h3>Покраска земли</h3>
      <div class="mp-tiles">${TILES.map(([n], i) => `<button data-tile="${i}" class="${st.tool === 'paint' && st.tile === i ? 'on' : ''}" title="${n}"><img src="${tileIcon(i)}" alt=""><span>${n}</span></button>`).join('')}</div>
      <label class="field">Радиус кисти <b>${st.brushR} м</b><input type="range" data-f="brushR" min="1" max="20" step="0.5" value="${st.brushR}"></label>
      <label class="field">Сила <b>${Math.round(st.brushS * 100)}%</b><input type="range" data-f="brushS" min="0.05" max="1" step="0.05" value="${st.brushS}"></label>
      <div class="row"><button class="btn" data-op="fill">Залить всю карту плиткой</button></div>
      <h3>Вода</h3>
      <label class="check"><input type="checkbox" data-f="water" ${map.water?.on ? 'checked' : ''}> Вода (озёра там, где земля ниже уровня)</label>
      <label class="field">Уровень воды <b>${(map.water?.level ?? -0.6).toFixed(1)} м</b><input type="range" data-f="wlevel" min="-6" max="4" step="0.1" value="${map.water?.level ?? -0.6}"></label>
      <p class="hint small">Опусти землю «Опустить», включи воду — получится озеро или ров.</p>`;
    el.onclick = (ev) => {
      const s = ev.target.closest('[data-sculpt]'); if (s) { st.sculpt = s.dataset.sculpt; setTool('sculpt'); return refreshSide(); }
      const t = ev.target.closest('[data-tile]'); if (t) { st.tile = +t.dataset.tile; setTool('paint'); return refreshSide(); }
      if (ev.target.closest('[data-op=fill]')) {
        const before = terrain.snapshot(); terrain.fill(st.tile); const after = terrain.snapshot();
        push({ undo: () => terrain.restore(before), redo: () => terrain.restore(after) });
      }
    };
    el.oninput = (ev) => {
      const f = ev.target.dataset.f, v = +ev.target.value;
      if (f === 'brushR') { st.brushR = v; ev.target.previousElementSibling.textContent = v + ' м'; ring.scale.setScalar(v); }
      else if (f === 'brushS') { st.brushS = v; ev.target.previousElementSibling.textContent = Math.round(v * 100) + '%'; }
      else if (f === 'wlevel') { map.water.level = v; ev.target.previousElementSibling.textContent = v.toFixed(1) + ' м'; if (water) water.position.y = v; scheduleSave(); }
    };
    el.onchange = (ev) => { if (ev.target.dataset.f === 'water') { map.water = { ...(map.water || {}), on: ev.target.checked, level: map.water?.level ?? -0.6 }; setWater(); scheduleSave(); } };
  }
  function renderWorld(el) {
    el.innerHTML = `<h3>Атмосфера</h3>
      <div class="mp-chips">${Object.entries(ATMOS).map(([k, a]) => `<button data-env="${k}" class="${map.env.preset === k ? 'on' : ''}" style="border-left:6px solid ${a.sky[1]}">${a.name}</button>`).join('')}</div>
      <label class="field">Густота тумана <b>${Math.round((map.env.fogK ?? 1) * 100)}%</b><input type="range" data-f="fogK" min="0" max="3" step="0.05" value="${map.env.fogK ?? 1}"></label>
      <h3>Игрок</h3>
      <button class="btn" data-op="spawn">⚑ Поставить точку появления</button>
      <label class="field">Смотрит в сторону, ° <input type="number" data-f="yaw" step="15" value="${Math.round((map.spawn.yaw || 0) * 180 / Math.PI)}"></label>
      <p class="hint small">Играть будешь персонажем, выбранным во вкладке «Персонаж» (со снаряжением и анимациями).</p>`;
    el.onclick = (ev) => {
      const b = ev.target.closest('[data-env]'); if (b) { map.env.preset = b.dataset.env; applyEnv(); scheduleSave(); return refreshSide(); }
      if (ev.target.closest('[data-op=spawn]')) setTool('spawn');
    };
    el.oninput = (ev) => { if (ev.target.dataset.f === 'fogK') { map.env.fogK = +ev.target.value; ev.target.previousElementSibling.textContent = Math.round(map.env.fogK * 100) + '%'; applyEnv(); scheduleSave(); } };
    el.onchange = (ev) => { if (ev.target.dataset.f === 'yaw') { map.spawn.yaw = +ev.target.value * Math.PI / 180; spawnMark.rotation.y = map.spawn.yaw; scheduleSave(); } };
  }
  let mapsCache = null;
  async function renderMaps(el) {
    mapsCache = (await db.all('maps').catch(() => [])).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    el.innerHTML = `<h3>Карты</h3>
      <div class="ed-outliner">${mapsCache.map((m) => `<div class="ed-row${m.id === map?.id ? ' on' : ''}" data-mid="${m.id}"><span>${esc(m.name)} <i>· ${(m.objects || []).length} объектов</i></span></div>`).join('') || '<p class="hint small">Пока нет сохранённых карт</p>'}</div>
      <div class="row"><button class="btn" data-op="new">＋ Новая</button><button class="btn" data-op="rename">Переименовать</button><button class="btn" data-op="delete">Удалить</button></div>
      <label class="field">Размер новой карты <select data-f="size"><option value="32">64 × 64 м</option><option value="48" selected>96 × 96 м</option><option value="64">128 × 128 м</option><option value="96">192 × 192 м</option></select></label>
      <div class="row"><button class="btn" data-op="export">Скачать .json</button><label class="btn ed-file">Открыть .json<input type="file" data-f="import" accept=".json" hidden></label></div>
      <div class="row"><button class="btn" data-op="demo">Загрузить пример «Деревня у кладбища»</button></div>
      <p class="hint small">Карты сохраняются в этом браузере автоматически. Чтобы перенести на другое устройство — «Скачать .json».</p>`;
    el.onclick = async (ev) => {
      const r = ev.target.closest('[data-mid]');
      if (r) { await save(); const m = mapsCache.find((x) => x.id === r.dataset.mid); if (m) { await load(m); toast('Открыта карта «' + m.name + '»'); } return; }
      const op = ev.target.closest('[data-op]')?.dataset.op; if (!op) return;
      if (op === 'new') { await save(); const size = +el.querySelector('[data-f=size]').value; const m = blankMap(prompt('Название карты', 'Новая карта') || 'Новая карта', size); await load(m); await save(); refreshSide(); }
      else if (op === 'rename') { const n = prompt('Название карты', map.name); if (n) { map.name = n; await save(); refreshAll(); } }
      else if (op === 'delete') { if (confirm('Удалить карту «' + map.name + '»?')) { await db.del('maps', map.id); const rest = (await db.all('maps')).sort((a, b) => (b.updated || 0) - (a.updated || 0)); await load(rest[0] || blankMap()); refreshSide(); } }
      else if (op === 'export') { const blob = new Blob([JSON.stringify(serialize())], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = map.name + '.json'; a.click(); }
      else if (op === 'demo') { await save(); try { const m = await (await fetch('./models/maps/demo.json?t=' + Date.now())).json(); m.id = uid(); await load(m); await save(); toast('Пример загружен — это копия, её можно менять'); } catch { toast('Пример не найден'); } }
    };
    el.onchange = async (ev) => {
      if (ev.target.dataset.f === 'import' && ev.target.files[0]) {
        try { const m = JSON.parse(await ev.target.files[0].text()); m.id = uid(); await load(m); await save(); toast('Карта открыта'); } catch (e) { toast('Не получилось прочитать: ' + e.message); }
      }
    };
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

  function focus(o) {
    const b = new THREE.Box3().setFromObject(o, true), c = b.getCenter(new THREE.Vector3());
    const off = new THREE.Vector3().subVectors(camera.position, controls.target).setLength(Math.max(4, b.getSize(new THREE.Vector3()).length() * 1.6));
    controls.target.copy(c); camera.position.copy(c).add(off); controls.update();
  }

  /* ---------- клавиатура ---------- */
  const keys = new Set();
  addEventListener('keydown', (e) => {
    if (!st.active || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    keys.add(e.code);
    if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
    if (mod && k === 'y') { e.preventDefault(); return doRedo(); }
    if (mod && k === 'd') { e.preventDefault(); return duplicate(); }
    if (mod && k === 's') { e.preventDefault(); return save(); }
    if (k === 'escape') { if (st.placing) cancelPlacing(); else select(null); }
    else if (k === 'delete' || k === 'backspace' || k === 'x') { if (st.sel) removeObject(st.sel.d.id); }
    else if (k === 'q') rotateYaw(st.angle); else if (k === 'e') rotateYaw(-st.angle);
    else if (k === 'v') setTool('select'); else if (k === 'g') setTool('translate'); else if (k === 'r') setTool('rotate');
    else if (k === 'b') setTool('sculpt'); else if (k === 'p') setTool('paint');
    else if (k === 'f') { if (st.sel) focus(st.sel.o); }
    else if (k === '[') { st.brushR = Math.max(1, st.brushR - 1); ring.scale.setScalar(st.brushR); }
    else if (k === ']') { st.brushR = Math.min(20, st.brushR + 1); ring.scale.setScalar(st.brushR); }
    else if (k === 't') setTool('scale');
    else if (/^key[wasd]$/.test(e.code.toLowerCase())) return; // WASD — полёт камеры (в update)
    else return;
    e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  /* ---------- кадр ---------- */
  const lights = [];
  let lightT = 0;
  function update(dt, t) {
    if (!map) return;
    for (const e of entries.values()) e.mixer?.update(dt);
    if (water) water.userData.tick(t);
    if (st.active) { // WASD — полёт камеры по карте
      const v = new THREE.Vector3((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), 0, (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0));
      if (v.lengthSq()) {
        const yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
        v.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(dt * Math.max(6, camera.position.distanceTo(controls.target)));
        camera.position.add(v); controls.target.add(v);
      }
    }
    if (t - lightT > 0.25) { lightT = t; assignLights(ctx.focusPoint?.() || controls.target); }
  }
  // 6 ближайших «светящихся» объектов получают настоящий свет (число источников постоянное — без перекомпиляции шейдеров)
  function assignLights(center) {
    lights.length = 0;
    for (const e of entries.values()) if (e.d.light && e.o.visible !== false) lights.push(e);
    lights.sort((a, b) => a.o.position.distanceToSquared(center) - b.o.position.distanceToSquared(center));
    lightPool.forEach((l, i) => {
      const e = lights[i];
      if (!e) { l.intensity = 0; return; }
      const b = new THREE.Box3().setFromObject(e.o);
      l.position.set((b.min.x + b.max.x) / 2, b.min.y + (b.max.y - b.min.y) * 0.8, (b.min.z + b.max.z) / 2);
      l.color.set(e.d.light.color); l.intensity = e.d.light.i * (0.9 + Math.random() * 0.15); l.distance = e.d.light.r;
    });
  }

  /* ---------- вход/выход ---------- */
  async function enter() {
    st.active = true;
    scene.add(root); helpers.visible = true;
    scene.add(tcHelper);
    [ui.top, ui.tools, ui.side, ui.stat].forEach((el) => { el.hidden = false; });
    document.body.classList.add('mapping');
    controls.maxDistance = 260; controls.minDistance = 1; controls.maxPolarAngle = Math.PI * 0.495; controls.enablePan = true; controls.screenSpacePanning = false;
    controls.autoRotate = false;
    if (!map) {
      const last = lsGet('ps1.map.last');
      const all = await db.all('maps').catch(() => []);
      const m = all.find((x) => x.id === last) || all.sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
      if (m) await load(m);
      else { // первая встреча — открываем пример, если есть
        try { const d = await (await fetch('./models/maps/demo.json?t=' + Date.now())).json(); d.id = uid(); await load(d); await save(); }
        catch { await load(blankMap()); }
      }
      camera.position.set(22, 20, 26); controls.target.set(0, 0, 0); controls.update();
    } else { applyEnv(); }
    tc.enabled = true;
    showTab(st.sideTab);
    setTool(st.tool === 'place' ? 'select' : st.tool);
    refreshAll();
  }
  function exit() {
    st.active = false;
    save();
    cancelPlacing(false);
    tc.detach(); tc.enabled = false; scene.remove(tcHelper);
    [ui.top, ui.tools, ui.side, ui.stat].forEach((el) => { el.hidden = true; });
    document.body.classList.remove('mapping');
    ring.visible = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  function detachScene() { scene.remove(root); }
  async function play() {
    await save();
    ctx.onPlay?.(map);
  }

  return {
    enter, exit, update, detachScene, save, load, serialize, blankMap,
    get active() { return st.active; }, get map() { return map; }, get terrain() { return terrain; }, get root() { return root; },
    get entries() { return entries; }, objGroup, helpers, spawnMark, applyEnv, addObject, assignLights, setTool, startPlacing, select, uid,
  };
}
