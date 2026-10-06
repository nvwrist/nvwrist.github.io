import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { BUILTINS, buildBuiltin, PRIMITIVES } from './items.js';
import { applySpec } from './matlib.js';
import { db } from './db.js';

/*
 * Снаряжение: гнёзда на костях + предметы в гнёздах (как sockets в Unreal).
 *   гнездо  — Object3D на кости (кисть, голова, спина…), рассчитывается из скелета/вершин в позе покоя;
 *   предмет — контейнер в гнезде: смещение (двигается гизмо) → unit (перевод единиц) → содержимое.
 * Стандарт предметов: начало = хват/центр, +Y — к острию, +Z — вперёд; единицы: 'm' (метры, рост ≈ 1.75 м) или 'hu' (высота головы).
 * Всё, что пользователь подвинул, хранится в localStorage `ps1.equip.<персонаж>`; свои предметы — в IndexedDB `items`.
 */

export const SOCKETS = {
  hand_r: 'Правая кисть', hand_l: 'Левая кисть', head: 'Голова', back: 'Спина', cloak: 'Плащ (у шеи)',
  hips: 'Пояс', hip_l: 'Бедро левое', hip_r: 'Бедро правое', body: 'Тело (одежда)',
};
export const CATS = {
  weapon: 'Оружие', shield: 'Щиты', bow: 'Луки', tool: 'В руку', head: 'Головные уборы', hair: 'Причёски',
  cloak: 'Плащи', back: 'За спиной', belt: 'На поясе', clothing: 'Одежда', other: 'Разное',
};
const MIRROR = { hand_r: 'hand_l', hand_l: 'hand_r', hip_l: 'hip_r', hip_r: 'hip_l' };

const gltfLoader = new GLTFLoader();
const V = () => new THREE.Vector3();
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } };
const uidGen = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- каталог: встроенные + CC0-пак + свои ---------- */
let qList = null;
export async function catalog() {
  const list = Object.entries(BUILTINS).map(([id, d]) => ({ ref: 'b:' + id, name: d.name, cat: d.cat, socket: d.socket, src: 'встроенный' }));
  try {
    qList ??= await (await fetch('./models/items/items.json')).json();
    qList.forEach((it) => list.push({ ref: 'q:' + it.id, name: it.name, cat: it.cat, socket: it.socket, src: 'Quaternius CC0' }));
  } catch { /* нет сети */ }
  try { (await db.all('items')).forEach((r) => list.push({ ref: 'u:' + r.id, name: r.name, cat: r.cat || 'other', socket: r.socket || 'hand_r', src: 'мой', user: true })); } catch { /* */ }
  return list;
}

// служебные пометки не должны попадать в glb (см. exportClean в main.js)
const RUNTIME = ['orig', 'psMat', 'ps1src', 'ps1', 'edHelper'];
async function exportGroup(group) {
  // если меш сейчас показывается PS1-копией материала — экспортируем исходный
  const swaps = [];
  const std = (m) => { // Lambert (PS1-материалы встроенных предметов) → Standard: glTF понимает его без потерь
    if (!m?.isMeshLambertMaterial) return m;
    const s = new THREE.MeshStandardMaterial({ name: m.name, color: m.color, map: m.map, emissive: m.emissive, emissiveMap: m.emissiveMap, side: m.side,
      transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, vertexColors: m.vertexColors, roughness: 1, metalness: 0 });
    s.userData = { ...m.userData };
    return s;
  };
  group.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.userData.orig || o.material;
    const out = Array.isArray(src) ? src.map(std) : std(src);
    if (out !== o.material) { swaps.push([o, o.material]); o.material = out; }
  });
  const stash = [];
  group.traverse((o) => {
    for (const t of [o, ...[].concat(o.material || [])]) {
      const saved = {};
      RUNTIME.forEach((k) => { if (k in t.userData) { saved[k] = t.userData[k]; delete t.userData[k]; } });
      stash.push([t, saved]);
    }
  });
  try { return await new GLTFExporter().parseAsync(group, { binary: true }); }
  finally {
    swaps.forEach(([o, m]) => { o.material = m; });
    stash.forEach(([t, saved]) => Object.assign(t.userData, saved));
  }
}

export function createEquip({ root, key, toast = () => {}, withRest = (fn) => fn() }) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const RW = (o) => new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
  const P = (o) => V().setFromMatrixPosition(RW(o));

  /* ---------- кости ---------- */
  const bones = [];
  root.traverse((o) => { if (o.isBone && !bones.some((b) => b.name === o.name)) bones.push(o); });
  const find = (re) => bones.find((b) => re.test(b.name));
  const B = {
    hips: find(/^(hips|pelvis)$/i), chest: find(/^(spine2|spine_03|chest)$/i) || find(/spine|torso/i),
    neck: find(/^neck/i), head: find(/^head$/i),
    armL: find(/^(leftarm|upperarm_l|upperarml)$/i), armR: find(/^(rightarm|upperarm_r|upperarmr)$/i),
    handL: find(/^(lefthand|hand_l|wristl)$/i), handR: find(/^(righthand|hand_r|wristr)$/i),
    idxL: find(/^(lefthandindex1|index_01_l|index1l)$/i), idxR: find(/^(righthandindex1|index_01_r|index1r)$/i),
    midL: find(/^(lefthandmiddle1|middle_01_l|middle1l)$/i), midR: find(/^(righthandmiddle1|middle_01_r|middle1r)$/i),
    pinL: find(/^(lefthandpinky1|pinky_01_l|pinky1l)$/i), pinR: find(/^(righthandpinky1|pinky_01_r|pinky1r)$/i),
    thL: find(/^(lefthandthumb1|thumb_01_l|thumb1l)$/i), thR: find(/^(righthandthumb1|thumb_01_r|thumb1r)$/i),
  };
  const ok = B.hips && B.head && B.armL && B.armR;

  /* ---------- оси тела и размеры по вершинам (поза покоя) ---------- */
  const up = ok ? P(B.head).sub(P(B.hips)).normalize() : V().set(0, 1, 0);
  const left = ok ? P(B.armL).sub(P(B.armR)) : V().set(1, 0, 0);
  left.addScaledVector(up, -left.dot(up)).normalize();
  const fwd = V().crossVectors(left, up).normalize();
  up.crossVectors(fwd, left).normalize();
  const basisQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, fwd));
  const desc = (b, anc) => { for (let p = b; p; p = p.parent) if (p === anc) return true; return false; };
  const box = () => ({ min: V().set(1e9, 1e9, 1e9), max: V().set(-1e9, -1e9, -1e9) });
  const grow = (bx, v) => { bx.min.min(v); bx.max.max(v); };
  const all = box(), headB = box(), chestB = box(), hipsB = box();
  let nHead = 0, nChest = 0;
  const v = V(), q = V();
  // меряем только видимые части (у модульных персонажей скрытые наряды лежат в той же модели) и без волос/шапок
  const shownM = (o) => { for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; return true; };
  const HAIRY = /hair|hat|helmet|hood|cap|crown|bun|beard/i;
  const skins = [];
  root.traverse((m) => { if (m.isSkinnedMesh && !m.userData.equip) skins.push(m); });
  const measured = skins.some(shownM) ? skins.filter(shownM) : skins;
  for (const m of measured) {
    const g = m.geometry, n = g.attributes.position.count, step = Math.max(1, Math.floor(n / 6000));
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const mats = [].concat(m.material);
    if (mats.length === 1 && HAIRY.test(mats[0]?.name || '')) continue;
    let skipV = null;
    if (mats.length > 1 && g.index) {
      skipV = new Uint8Array(n);
      for (const gr of g.groups) if (HAIRY.test(mats[gr.materialIndex]?.name || '')) for (let t = gr.start; t < gr.start + gr.count; t++) skipV[g.index.getX(t)] = 1;
    }
    for (let i = 0; i < n; i += step) {
      if (skipV?.[i]) continue;
      let bi = 0;
      for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, bi)) bi = j;
      const bone = m.skeleton.bones[si.getComponent(i, bi)];
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      q.set(v.dot(left), v.dot(up), v.dot(fwd));
      grow(all, q);
      if (B.head && desc(bone, B.head)) { grow(headB, q); nHead++; }
      else if (bone && /spine|chest|torso/i.test(bone.name)) { grow(chestB, q); nChest++; }
      if (B.hips && bone === B.hips) grow(hipsB, q);
    }
  }
  const height = Math.max(1e-6, all.max.y - all.min.y);
  const hu = nHead > 10 ? headB.max.y - headB.min.y : height * 0.13;
  const fromB = (x, y, z) => V().addScaledVector(left, x).addScaledVector(up, y).addScaledVector(fwd, z);
  const ctr = (bx) => fromB((bx.min.x + bx.max.x) / 2, (bx.min.y + bx.max.y) / 2, (bx.min.z + bx.max.z) / 2);
  const headC = nHead > 10 ? ctr(headB) : (B.head ? P(B.head).addScaledVector(up, hu * 0.5) : V());
  const chestC = nChest > 10 ? ctr(chestB) : (B.chest ? P(B.chest) : V());
  const chestDepth = nChest > 10 ? chestB.max.z - chestB.min.z : hu * 0.9;
  const hipHalf = isFinite(hipsB.max.x) && hipsB.max.x > hipsB.min.x ? (hipsB.max.x - hipsB.min.x) / 2 : hu * 0.55;
  const rootScaleW = new THREE.Vector3().setFromMatrixScale(root.matrixWorld).x;
  const huW = hu * rootScaleW; // единица головы в мировых координатах
  const worldPerMeter = (height * rootScaleW) / 1.75;

  /* ---------- гнёзда по умолчанию (матрицы в пространстве корня) ---------- */
  // кисть: Y — от мизинца к указательному (ось кулака, по ней проходит рукоять), Z — к пальцам, X — ладонь (у правой) / тыльная сторона (у левой)
  // первая кость пальца у некоторых скелетов начинается прямо у запястья (пястная) — берём ту, что у костяшки
  const knuckle = (b, from) => { let x = b; for (let k = 0; x && k < 3 && P(x).distanceTo(from) < hu * 0.2; k++) x = x.children.find((c) => c.isBone) || null; return x || b; };
  function handFrame(hand, idx, mid, pin, th, side) {
    const Ph = P(hand);
    if (idx) idx = knuckle(idx, Ph);
    if (mid) mid = knuckle(mid, Ph);
    if (pin) pin = knuckle(pin, Ph);
    const m = mid || idx;
    const F = m ? P(m).sub(Ph) : fwd.clone();
    const flen = F.length() || hu * 0.3; F.normalize();
    let T = idx && pin ? P(idx).sub(P(pin)) : th ? P(th).sub(Ph) : fwd.clone();
    T.addScaledVector(F, -T.dot(F)).normalize();
    const X = V().crossVectors(T, F).normalize(), Z = V().crossVectors(X, T).normalize();
    // центр кулака: почти у костяшек и чуть в сторону ладони
    const o = Ph.addScaledVector(F, flen * 0.8).addScaledVector(X, side * flen * 0.28);
    return { bone: hand, m: new THREE.Matrix4().compose(o, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, T, Z)), V().setScalar(hu)) };
  }
  const frame = (bone, o) => ({ bone, m: new THREE.Matrix4().compose(o, basisQ, V().setScalar(hu)) });
  const defaults = {};
  if (B.head) defaults.head = frame(B.head, headC);
  if (B.handR) defaults.hand_r = handFrame(B.handR, B.idxR, B.midR, B.pinR, B.thR, 1);
  if (B.handL) defaults.hand_l = handFrame(B.handL, B.idxL, B.midL, B.pinL, B.thL, -1);
  if (B.chest) {
    defaults.back = frame(B.chest, chestC.clone().addScaledVector(fwd, -(chestDepth / 2 + hu * 0.12)).addScaledVector(up, hu * 0.1));
    defaults.cloak = frame(B.chest, (B.neck ? P(B.neck) : chestC.clone().addScaledVector(up, hu)).addScaledVector(up, -hu * 0.12).addScaledVector(fwd, -chestDepth * 0.55));
  }
  if (B.hips) {
    const Ph = P(B.hips);
    defaults.hips = frame(B.hips, Ph.clone());
    defaults.hip_l = frame(B.hips, Ph.clone().addScaledVector(left, hipHalf + hu * 0.05).addScaledVector(up, -hu * 0.15));
    defaults.hip_r = frame(B.hips, Ph.clone().addScaledVector(left, -(hipHalf + hu * 0.05)).addScaledVector(up, -hu * 0.15));
  }

  /* ---------- состояние ---------- */
  const KEY = 'ps1.equip.' + key;
  const state = Object.assign({ v: 1, sockets: {}, builtin: {}, items: [] }, lsGet(KEY, {}));
  const save = () => lsSet(KEY, state);

  const sockets = new Map(); // id -> { node, bone, label }
  function placeSocket(id) {
    const s = sockets.get(id), ov = state.sockets[id];
    const bone = (ov?.bone && bones.find((b) => b.name === ov.bone)) || s.bone;
    if (s.node.parent !== bone) bone.add(s.node);
    s.bone = bone;
    const local = ov?.m ? new THREE.Matrix4().fromArray(ov.m) : RW(bone).invert().multiply(defaults[id].m);
    local.decompose(s.node.position, s.node.quaternion, s.node.scale);
  }
  for (const id of Object.keys(defaults)) {
    const node = new THREE.Object3D();
    node.name = 'socket:' + id; node.userData.socket = id;
    sockets.set(id, { node, bone: defaults[id].bone, label: SOCKETS[id] });
    placeSocket(id);
  }
  { // тело: мировая система (для одежды)
    const node = new THREE.Object3D();
    node.name = 'socket:body'; node.userData.socket = 'body';
    root.add(node);
    new THREE.Matrix4().copy(root.matrix).invert().decompose(node.position, node.quaternion, node.scale);
    sockets.set('body', { node, bone: null, label: SOCKETS.body });
  }
  const socketScaleW = (id) => (id === 'body' ? 1 : huW);
  // размеры головы в «единицах головы» (для подгонки причёсок/шапок)
  const fit = nHead > 10 ? { w: (headB.max.x - headB.min.x) / hu, h: 1, d: (headB.max.z - headB.min.z) / hu } : { w: 0.8, h: 1, d: 0.9 };
  // посадка по умолчанию (в осях гнезда), пока пользователь её не менял
  const SX = new THREE.Matrix4().makeScale(-1, 1, 1);
  function defaultPose(cat, sid, tilt = 0) {
    const m = new THREE.Matrix4();
    if (sid !== 'hand_r' && sid !== 'hand_l') return m;
    if (cat === 'shield') m.makeBasis(V().set(0, -1, 0), V().set(0, 0, -1), V().set(1, 0, 0)); // лицо — наружу (тыльная сторона кисти), верх щита — вверх
    else if (tilt) m.makeRotationX(-tilt * Math.PI / 180); // наклон к «вверх» при опущенной руке
    return sid === 'hand_r' && cat === 'shield' ? SX.clone().multiply(m).multiply(SX) : m;
  }
  const unitScale = (unit, sid) => (unit === 'm' ? worldPerMeter : unit === 'hu' ? huW : 1) / socketScaleW(sid);

  /* ---------- контейнеры ---------- */
  const containers = new Set();
  function makeContainer(content, { uid, ref, name, socket, unit, builtinId = null, m = null, libItem = null, cat = null, tilt = 0 }) {
    const sid = sockets.has(socket) ? socket : (sockets.has('hand_r') ? 'hand_r' : 'body');
    const c = new THREE.Group();
    c.name = 'equip:' + (builtinId || uid);
    c.userData.equip = { uid, ref, name, socket: sid, unit, builtinId, libItem };
    const u = new THREE.Group(); u.name = 'unit'; u.userData.unitNode = true;
    u.scale.setScalar(unitScale(unit, sid));
    c.add(u); u.add(content);
    content.name = content.name || 'content';
    let n = 0;
    const tag = builtinId || 'eq:' + uid;
    content.traverse((o) => {
      if (!o.isMesh) return;
      o.name = `${tag}/${n}`;
      for (const mat of [].concat(o.material)) if (!mat.name || !mat.name.startsWith(tag)) mat.name = `${tag}/m${n}`;
      o.userData.noConvert = !!builtinId || o.userData.noConvert; // встроенные уже в PS1-материалах
      if (libItem) o.userData.libItem = libItem;
      o.frustumCulled = false;
      n++;
    });
    sockets.get(sid).node.add(c);
    c.userData.equip.cat = cat; c.userData.equip.tilt = tilt;
    (m ? new THREE.Matrix4().fromArray(m) : defaultPose(cat, sid, tilt)).decompose(c.position, c.quaternion, c.scale);
    containers.add(c);
    return c;
  }
  function dispose(c) {
    c.userData.bound?.forEach((b) => b.parent?.remove(b));
    c.parent?.remove(c);
    containers.delete(c);
  }
  const findContainer = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.equip) return p; return null; };

  /* ---------- загрузка содержимого ---------- */
  async function loadContent(ref) {
    const [kind, id] = [ref.slice(0, 1), ref.slice(2)];
    if (kind === 'b') return { content: buildBuiltin(id, { fit }), unit: 'hu', name: BUILTINS[id]?.name || id, cat: BUILTINS[id]?.cat, tilt: BUILTINS[id]?.tilt };
    if (kind === 'q') {
      qList ??= await (await fetch('./models/items/items.json')).json();
      const it = qList.find((x) => x.id === id);
      const g = await gltfLoader.loadAsync('./models/' + it.file);
      const content = g.scene.clone(true);
      content.traverse((o) => { if (o.isMesh) o.material = [].concat(o.material).map((mm) => mm.clone()).at(0); });
      return { content, unit: it.unit || 'm', name: it.name, cat: it.cat };
    }
    if (kind === 'u') {
      const r = await db.get('items', id);
      if (!r) throw new Error('предмет удалён из «Моих»');
      const g = await gltfLoader.parseAsync(new Uint8Array(r.buffer).slice().buffer, '');
      return { content: g.scene, unit: r.unit || 'm', name: r.name, libItem: id, clothing: r.clothing, cat: r.cat };
    }
    throw new Error('неизвестный предмет ' + ref);
  }

  /* ---------- встроенные предметы внешности (look.js) ---------- */
  const lookBuilt = new Map(); // builtinId -> container
  // list: [{ id: 'look:hood', item: 'hood', colors }] — id хранит правки положения
  function setBuiltins(list) {
    lookBuilt.forEach((c) => { dispose(c); c.traverse((o) => { o.geometry?.dispose(); }); }); lookBuilt.clear();
    for (const it of list) {
      const def = BUILTINS[it.item]; if (!def) continue;
      const ov = state.builtin[it.id] || {};
      const c = makeContainer(buildBuiltin(it.item, { ...it.colors, fit }), { uid: it.id, ref: 'b:' + it.item, name: def.name, socket: ov.socket || def.socket, unit: 'hu', builtinId: it.id, m: ov.m, cat: def.cat, tilt: def.tilt });
      c.visible = !ov.hidden;
      lookBuilt.set(it.id, c);
      if (ov.clothing) bindClothing(c);
    }
  }

  /* ---------- свои надетые предметы ---------- */
  let loading = null;
  async function loadSaved() {
    loading = (async () => {
      for (const c of [...containers]) if (!c.userData.equip.builtinId) dispose(c);
      for (const rec of state.items) {
        try { await spawn(rec); } catch (e) { console.warn('предмет не загрузился', rec, e); }
      }
    })();
    return loading;
  }
  async function spawn(rec) {
    const L = await loadContent(rec.ref);
    const c = makeContainer(L.content, { uid: rec.uid, ref: rec.ref, name: rec.name || L.name, socket: rec.socket, unit: L.unit, m: rec.m, libItem: L.libItem || null, cat: L.cat, tilt: L.tilt });
    c.visible = !rec.hidden;
    if (rec.clothing || L.clothing) bindClothing(c);
    return c;
  }
  async function equip(ref, socket) {
    const cat = (await catalog()).find((x) => x.ref === ref);
    const rec = { uid: uidGen(), ref, socket: socket || cat?.socket || 'hand_r', name: cat?.name };
    if (cat?.cat === 'clothing') rec.socket = 'body';
    state.items.push(rec); save();
    const c = await spawn(rec);
    return c;
  }
  function recOf(c) {
    const e = c.userData.equip;
    if (e.builtinId) return (state.builtin[e.builtinId] ??= {});
    return state.items.find((r) => r.uid === e.uid);
  }
  function remove(c) {
    const e = c.userData.equip;
    if (e.builtinId) { recOf(c).hidden = true; c.visible = false; }
    else { state.items = state.items.filter((r) => r.uid !== e.uid); dispose(c); }
    save();
  }
  function setHidden(c, hidden) { recOf(c).hidden = hidden; c.visible = !hidden; save(); }

  /* ---------- правки ---------- */
  function commit(obj) {
    if (obj?.userData?.socket) {
      const s = sockets.get(obj.userData.socket);
      if (obj.userData.socket !== 'body') {
        obj.updateMatrix();
        state.sockets[obj.userData.socket] = { bone: s.bone.name, m: obj.matrix.toArray() };
      }
    } else if (obj?.userData?.equip) {
      obj.updateMatrix();
      const r = recOf(obj); r.m = obj.matrix.toArray(); r.socket = obj.userData.equip.socket;
      if (obj.userData.bound) rebind(obj);
    } else if (obj?.userData?.clothingOf) { // правка формы одежды на теле: статичный оригинал обновится при сохранении
      const c = [...containers].find((x) => x.userData.equip.uid === obj.userData.clothingOf);
      if (c?.userData.equip.libItem) markDirty(c.userData.equip.libItem, c);
    } else {
      const c = findContainer(obj);
      if (c?.userData.equip.libItem) markDirty(c.userData.equip.libItem, c);
      if (c?.userData.bound) rebind(c);
    }
    save();
  }
  function changeSocket(c, sid) {
    const s = sockets.get(sid); if (!s) return;
    const old = c.userData.equip.socket;
    c.updateMatrixWorld(true); s.node.updateMatrixWorld(true);
    const world = c.matrixWorld.clone();
    s.node.add(c);
    new THREE.Matrix4().copy(s.node.matrixWorld).invert().multiply(world).decompose(c.position, c.quaternion, c.scale);
    const u = c.children.find((o) => o.userData.unitNode);
    const k = unitScale(c.userData.equip.unit, sid) / unitScale(c.userData.equip.unit, old);
    u.scale.multiplyScalar(k); c.scale.multiplyScalar(1 / k);
    c.userData.equip.socket = sid;
    commit(c);
  }
  function setSocketBone(sid, boneName) {
    const s = sockets.get(sid), b = bones.find((x) => x.name === boneName);
    if (!s || !b || sid === 'body') return;
    s.node.updateMatrixWorld(true); b.updateMatrixWorld(true);
    const world = s.node.matrixWorld.clone();
    b.add(s.node); s.bone = b;
    new THREE.Matrix4().copy(b.matrixWorld).invert().multiply(world).decompose(s.node.position, s.node.quaternion, s.node.scale);
    commit(s.node);
  }
  function resetItem(c) {
    const e = c.userData.equip;
    defaultPose(e.cat, e.socket, e.tilt).decompose(c.position, c.quaternion, c.scale);
    commit(c); delete recOf(c).m; save();
  }
  function resetSocket(sid) { delete state.sockets[sid]; save(); placeSocket(sid); }
  async function mirror(c) {
    const e = c.userData.equip, to = MIRROR[e.socket];
    if (!to) return toast('Отзеркалить можно предметы в руке или на бедре');
    c.updateMatrix();
    const S = new THREE.Matrix4().makeScale(-1, 1, 1);
    const m = new THREE.Matrix4().multiplyMatrices(S, c.matrix).multiply(S);
    const rec = { uid: uidGen(), ref: e.ref, socket: to, name: e.name, m: m.toArray() };
    if (e.builtinId) rec.ref = e.ref; // встроенный → обычный предмет из каталога
    state.items.push(rec); save();
    return spawn(rec);
  }

  /* ---------- свои предметы: создание, импорт, сохранение ---------- */
  const dirtyT = new Map();
  function markDirty(itemId, c) {
    clearTimeout(dirtyT.get(itemId));
    dirtyT.set(itemId, setTimeout(() => saveUserItem(itemId, c), 700));
  }
  async function saveUserItem(itemId, c) {
    const r = await db.get('items', itemId);
    if (!r) return;
    if (c.userData.bound) syncStaticFromBound(c);
    r.buffer = await exportGroup(contentOf(c));
    await db.put('items', r);
  }
  const contentOf = (c) => c.children.find((o) => o.userData.unitNode).children[0];
  async function createItem({ name = 'Новый предмет', cat = 'weapon', socket = 'hand_r', prim = 'box' } = {}) {
    const content = new THREE.Group(); content.name = 'content';
    content.add(primitiveMesh(prim));
    const id = uidGen();
    await db.put('items', { id, name, cat, socket, unit: 'm', buffer: await exportGroup(content) });
    const rec = { uid: uidGen(), ref: 'u:' + id, socket, name };
    state.items.push(rec); save();
    return spawn(rec);
  }
  function primitiveMesh(type) {
    const [label, geo] = PRIMITIVES[type] || PRIMITIVES.box;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
    applySpec(m, { preset: 'metal' });
    const mesh = new THREE.Mesh(geo(), m);
    mesh.name = label; mesh.userData.partName = label;
    return mesh;
  }
  function addPrimitive(c, type) {
    const e = c.userData.equip;
    if (!e.libItem) return toast('Добавлять детали можно в свои предметы — сначала «Копия в Мои предметы»');
    const mesh = primitiveMesh(type);
    const content = contentOf(c);
    content.add(mesh);
    let n = 0; content.traverse((o) => { if (o.isMesh) n++; });
    mesh.name = `eq:${e.uid}/${n - 1}`; mesh.material.name = `eq:${e.uid}/m${n - 1}`; mesh.userData.libItem = e.libItem; mesh.frustumCulled = false;
    markDirty(e.libItem, c);
    return mesh;
  }
  async function saveAsUserItem(c, name) {
    const e = c.userData.equip;
    if (c.userData.bound) syncStaticFromBound(c);
    // clone() копирует userData через JSON — материалы берём у оригинала (исходные, не PS1-копии)
    const src = contentOf(c), content = src.clone(true), a = [], bb = [];
    src.traverse((o) => a.push(o)); content.traverse((o) => bb.push(o));
    bb.forEach((o, i) => {
      RUNTIME.forEach((k) => delete o.userData[k]);
      if (o.isMesh) o.material = [].concat(a[i].userData.orig || a[i].material).map((m) => m.clone()).at(0);
    });
    // размер переводим в метры, чтобы предмет подходил всем персонажам
    const k = (e.unit === 'hu' ? huW : e.unit === 'm' ? worldPerMeter : 1) / worldPerMeter;
    const wrap = new THREE.Group(); wrap.name = 'content'; wrap.scale.setScalar(k); wrap.add(content);
    const id = uidGen();
    const cat = (await catalog()).find((x) => x.ref === e.ref)?.cat || (e.socket === 'head' ? 'head' : e.socket === 'body' ? 'clothing' : 'other');
    await db.put('items', { id, name: name || e.name + ' (мой)', cat, socket: e.socket, unit: 'm', clothing: !!c.userData.bound, buffer: await exportGroup(wrap) });
    // заменяем надетый предмет копией на том же месте
    c.updateMatrix();
    const rec = { uid: uidGen(), ref: 'u:' + id, socket: e.socket, name: name || e.name + ' (мой)', m: c.matrix.toArray(), clothing: !!c.userData.bound };
    remove(c);
    state.items.push(rec); save();
    return spawn(rec);
  }
  async function importItem(file, { cat = 'weapon', socket } = {}) {
    const ext = file.name.split('.').pop().toLowerCase();
    let content;
    if (ext === 'obj') content = new OBJLoader().parse(await file.text());
    else content = (await gltfLoader.parseAsync(await file.arrayBuffer(), '')).scene;
    content.traverse((o) => { RUNTIME.forEach((k) => delete o.userData[k]); if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); });
    const sid = cat === 'clothing' ? 'body' : socket || { shield: 'hand_l', bow: 'hand_l', head: 'head', hair: 'head', cloak: 'cloak', back: 'back', belt: 'hip_r' }[cat] || 'hand_r';
    const wrap = new THREE.Group(); wrap.name = 'content'; wrap.add(content);
    if (cat !== 'clothing') { // одежда уже в координатах персонажа; остальное нормируем к типичному размеру
      const bx = new THREE.Box3().setFromObject(content), size = bx.getSize(V()), mx = Math.max(size.x, size.y, size.z) || 1;
      const target = { weapon: 1.0, shield: 0.8, bow: 1.3, tool: 0.6, head: 0.3, hair: 0.35, cloak: 1.1, back: 0.6, belt: 0.3, other: 0.5 }[cat] || 0.5;
      if (mx > target * 3 || mx < target / 3) wrap.scale.setScalar(target / mx);
    }
    const id = uidGen(), name = file.name.replace(/\.[^.]+$/, '');
    await db.put('items', { id, name, cat, socket: sid, unit: cat === 'clothing' ? 'world' : 'm', clothing: cat === 'clothing', buffer: await exportGroup(wrap) });
    const rec = { uid: uidGen(), ref: 'u:' + id, socket: sid, name, clothing: cat === 'clothing' };
    state.items.push(rec); save();
    return spawn(rec);
  }

  /* ---------- одежда: автопривязка к телу (перенос весов с ближайших вершин тела) ---------- */
  function bodyMeshes() {
    const out = [];
    const shown = (o) => { for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; return true; };
    root.traverse((o) => { if (o.isSkinnedMesh && !findContainer(o) && !o.userData.clothingOf && !o.userData.edHelper) out.push(o); });
    const vis = out.filter(shown);
    return vis.length ? vis : out;
  }
  function bindClothing(c) {
    withRest(() => {
      root.updateMatrixWorld(true);
      c.userData.bound?.forEach((b) => b.parent?.remove(b));
      const bodies = bodyMeshes();
      if (!bodies.length) return toast('Нет тела для привязки');
      const b0 = bodies.reduce((a, m) => (m.geometry.attributes.position.count > a.geometry.attributes.position.count ? m : a));
      // точки тела в мире + сетка для поиска ближайшей
      const pts = [], refs = [], cell = huW * 0.12, grid = new Map();
      const keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
      for (const m of bodies) {
        const n = m.geometry.attributes.position.count;
        for (let i = 0; i < n; i++) {
          m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
          const k = pts.length / 3; pts.push(v.x, v.y, v.z); refs.push([m, i]);
          const kk = keyOf(v.x, v.y, v.z); (grid.get(kk) || grid.set(kk, []).get(kk)).push(k);
        }
      }
      const nearest = (p) => {
        const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
        for (let r = 1; r < 12; r++) {
          let best = -1, bd = Infinity;
          for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
            const l = grid.get(`${x},${y},${z}`); if (!l) continue;
            for (const k of l) { const d = (pts[k * 3] - p.x) ** 2 + (pts[k * 3 + 1] - p.y) ** 2 + (pts[k * 3 + 2] - p.z) ** 2; if (d < bd) { bd = d; best = k; } }
          }
          if (best >= 0) return best;
        }
        return 0;
      };
      const sk = b0.skeleton, si4 = new THREE.Vector4(), sw4 = new THREE.Vector4(), acc = new THREE.Matrix4(), tmp = new THREE.Matrix4();
      const bound = [];
      const u = c.children.find((o) => o.userData.unitNode);
      u.visible = true; c.updateMatrixWorld(true);
      contentOf(c).traverse((src) => {
        if (!src.isMesh) return;
        const g = src.geometry, n = g.attributes.position.count;
        const pos = new Float32Array(n * 3), skI = new Uint16Array(n * 4), skW = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          const p = V().fromBufferAttribute(g.attributes.position, i).applyMatrix4(src.matrixWorld);
          const [bm, bi] = refs[nearest(p)];
          si4.fromBufferAttribute(bm.geometry.attributes.skinIndex, bi); sw4.fromBufferAttribute(bm.geometry.attributes.skinWeight, bi);
          const e = acc.elements; e.fill(0);
          let wsum = 0;
          for (let j = 0; j < 4; j++) {
            const w = sw4.getComponent(j); if (!w) continue;
            const bone = bm.skeleton.bones[si4.getComponent(j)];
            const k = sk.bones.indexOf(bone); if (k < 0) continue;
            skI[i * 4 + j] = k; skW[i * 4 + j] = w; wsum += w;
            tmp.multiplyMatrices(bone.matrixWorld, sk.boneInverses[k]);
            for (let t = 0; t < 16; t++) e[t] += w * tmp.elements[t];
          }
          if (wsum > 0) { for (let j = 0; j < 4; j++) skW[i * 4 + j] /= wsum; for (let t = 0; t < 16; t++) e[t] /= wsum; }
          // локальная точка, которую скиннинг b0 переведёт ровно в p (в покое)
          const A = new THREE.Matrix4().multiplyMatrices(b0.matrixWorld, b0.bindMatrixInverse).multiply(acc).multiply(b0.bindMatrix);
          p.applyMatrix4(A.invert()); p.toArray(pos, i * 3);
        }
        const ng = new THREE.BufferGeometry();
        ng.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        if (g.attributes.uv) ng.setAttribute('uv', g.attributes.uv.clone());
        if (g.index) ng.setIndex(g.index.clone());
        ng.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skI, 4));
        ng.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skW, 4));
        ng.computeVertexNormals();
        const sm = new THREE.SkinnedMesh(ng, src.material);
        sm.name = src.name + ':skin'; sm.frustumCulled = false;
        sm.userData.clothingOf = c.userData.equip.uid; sm.userData.libItem = c.userData.equip.libItem; sm.userData.equipPart = true;
        sm.position.copy(b0.position); sm.quaternion.copy(b0.quaternion); sm.scale.copy(b0.scale);
        b0.parent.add(sm);
        sm.bind(sk, b0.bindMatrix);
        sm.userData.src = src;
        bound.push(sm);
      });
      u.visible = false; // статичный оригинал оставляем для экспорта/перепривязки
      c.userData.bound = bound;
      const r = recOf(c); if (r) { r.clothing = true; save(); }
    });
  }
  function rebind(c) { if (c.userData.bound) bindClothing(c); }
  function syncStaticFromBound(c) { // форма из Мастерской (на скиннинговой копии) → статичный оригинал
    withRest(() => {
      root.updateMatrixWorld(true);
      for (const sm of c.userData.bound || []) {
        const src = sm.userData.src; if (!src) continue;
        const ivm = src.matrixWorld.clone().invert(), a = src.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) { sm.getVertexPosition(i, v).applyMatrix4(sm.matrixWorld).applyMatrix4(ivm); a.setXYZ(i, v.x, v.y, v.z); }
        a.needsUpdate = true; src.geometry.computeVertexNormals();
      }
    });
  }
  function makeClothing(c) {
    const e = c.userData.equip;
    if (e.socket !== 'body') withRest(() => { root.updateMatrixWorld(true); changeSocket(c, 'body'); }); // положение берём в позе покоя — в ней и привязываем
    bindClothing(c);
    toast('Предмет привязан к телу: теперь он гнётся вместе с анимацией');
  }
  function unbind(c) {
    c.userData.bound?.forEach((b) => b.parent?.remove(b));
    delete c.userData.bound;
    c.children.find((o) => o.userData.unitNode).visible = true;
    const r = recOf(c); if (r) { delete r.clothing; save(); }
  }

  /* ---------- анимация огня и показ гнёзд ---------- */
  const markers = [];
  function showSockets(on) {
    markers.splice(0).forEach((m) => m.parent?.remove(m));
    if (!on) return;
    for (const [id, s] of sockets) {
      if (id === 'body') continue;
      const ax = new THREE.AxesHelper(0.5);
      ax.material.depthTest = false; ax.renderOrder = 998; ax.userData.edHelper = true; ax.userData.socketMarker = id;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb040, depthTest: false }));
      dot.renderOrder = 999; dot.userData.edHelper = true; dot.userData.socketMarker = id;
      s.node.add(ax); s.node.add(dot);
      markers.push(ax, dot);
    }
  }
  function update(t) {
    for (const c of containers) c.traverse((o) => { if (o.userData.flame) o.scale.setScalar(0.85 + Math.sin(t * 17 + o.id) * 0.12); });
  }

  return {
    sockets, bones, B, hu, huW, worldPerMeter, fit, containers: () => [...containers], findContainer, contentOf,
    metersPerUnit: (sid) => socketScaleW(sid) / worldPerMeter, state,
    setBuiltins, loadSaved, equip, remove, setHidden, commit, changeSocket, setSocketBone, resetItem, resetSocket, mirror,
    createItem, addPrimitive, saveAsUserItem, importItem, makeClothing, unbind, markDirty, showSockets, update,
    get loading() { return loading; }, recOf,
  };
}
