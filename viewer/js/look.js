import * as THREE from 'three';
import { lambert, basic } from './ps1.js';

/*
 * Редактор внешности «Странника».
 * Текстура перерисовывается в браузере из карт, запечённых tools/make_human.py:
 *   region.png — id региона (кожа/глаза/волосы/рубаха/штаны/обувь), pos.png — координаты точки на теле,
 *   shade.png — грязь/шум/AO. Цвет = цвет_региона(+узор) × shade.
 * Шапки, причёски, плащи, предметы — low-poly меши, прикреплённые к костям.
 */

const BASE = './models/human/';
const R_SKIN = 1, R_EYES = 2, R_HAIR = 3, R_SHIRT = 4, R_PANTS = 5, R_BOOTS = 6;

export const PAL = {
  skin: ['#f1cdb0', '#dcae88', '#be8e6e', '#a07052', '#7c5238', '#563826'],
  hair: ['#17120f', '#261e18', '#4a3322', '#7a5530', '#b08648', '#d8bf86', '#8c8a86', '#e6e2da', '#6e2618'],
  cloth: ['#968a70', '#d6ccb2', '#5e2e2a', '#7e3a22', '#2e3a2a', '#4c5a38', '#2a3448', '#3e4a5e', '#4e4436', '#3a2a40', '#1e1c1a', '#6a5a3a'],
  leather: ['#34261c', '#4a3424', '#6a4a2c', '#1c1a18', '#5a3a2a', '#7a5a3a'],
};

export const SCHEMA = [
  { group: 'Внешность', items: [
    { k: 'skin', label: 'Кожа', type: 'color', pal: 'skin' },
    { k: 'hair', label: 'Цвет волос', type: 'color', pal: 'hair' },
    { k: 'hairStyle', label: 'Причёска', type: 'select', options: { short: 'Короткая', long: 'Длинная', ponytail: 'Хвост', bun: 'Пучок', bald: 'Лысый' } },
    { k: 'beard', label: 'Борода', type: 'select', options: { none: 'Нет', stubble: 'Щетина', goatee: 'Бородка', full: 'Густая' } },
    { k: 'height', label: 'Рост', type: 'range', min: 0.88, max: 1.12, step: 0.01 },
    { k: 'build', label: 'Телосложение', type: 'range', min: 0.82, max: 1.25, step: 0.01 },
    { k: 'head', label: 'Голова', type: 'range', min: 0.85, max: 1.2, step: 0.01 },
  ] },
  { group: 'Одежда', items: [
    { k: 'shirtStyle', label: 'Верх', type: 'select', options: { plain: 'Рубаха', stripes: 'В полоску', plaid: 'В клетку', vest: 'Рубаха + жилет', tunic: 'Туника', robe: 'Мантия' } },
    { k: 'shirt', label: 'Цвет верха', type: 'color', pal: 'cloth' },
    { k: 'shirt2', label: 'Второй цвет', type: 'color', pal: 'cloth' },
    { k: 'sleeves', label: 'Рукава', type: 'select', options: { short: 'Короткие', long: 'Длинные' } },
    { k: 'pantsStyle', label: 'Низ', type: 'select', options: { plain: 'Штаны', patched: 'С заплатками', shorts: 'Шорты' } },
    { k: 'pants', label: 'Цвет низа', type: 'color', pal: 'cloth' },
    { k: 'bootStyle', label: 'Обувь', type: 'select', options: { boots: 'Сапоги', tall: 'Высокие сапоги', barefoot: 'Босиком' } },
    { k: 'boots', label: 'Цвет обуви', type: 'color', pal: 'leather' },
    { k: 'belt', label: 'Пояс', type: 'select', options: { none: 'Нет', belt: 'Ремень', sash: 'Кушак' } },
    { k: 'gloves', label: 'Перчатки', type: 'select', options: { none: 'Нет', gloves: 'Есть' } },
    { k: 'leather', label: 'Цвет кожи/ремней', type: 'color', pal: 'leather' },
  ] },
  { group: 'Аксессуары', items: [
    { k: 'hat', label: 'Голова', type: 'select', options: { none: 'Ничего', hood: 'Капюшон', hat: 'Шляпа', helmet: 'Шлем', wizard: 'Колпак мага', bandana: 'Повязка', circlet: 'Обруч' } },
    { k: 'hatColor', label: 'Цвет шляпы', type: 'color', pal: 'cloth' },
    { k: 'cloak', label: 'Плащ', type: 'select', options: { none: 'Нет', short: 'Короткий', long: 'Длинный' } },
    { k: 'cloakColor', label: 'Цвет плаща/капюшона', type: 'color', pal: 'cloth' },
    { k: 'hand', label: 'В руке', type: 'select', options: { none: 'Ничего', sword: 'Меч', torch: 'Факел', staff: 'Посох', lantern: 'Фонарь', axe: 'Топор' } },
    { k: 'back', label: 'За спиной', type: 'select', options: { none: 'Ничего', bag: 'Сумка', shield: 'Щит', quiver: 'Колчан' } },
  ] },
];

export const DEFAULT = {
  skin: '#be8e6e', hair: '#261e18', hairStyle: 'short', beard: 'none', height: 1, build: 1, head: 1,
  shirtStyle: 'plain', shirt: '#968a70', shirt2: '#4e4436', sleeves: 'short',
  pantsStyle: 'plain', pants: '#4e3e2e', bootStyle: 'boots', boots: '#34261c', belt: 'none', gloves: 'none', leather: '#4a3424',
  hat: 'none', hatColor: '#3a2a40', cloak: 'none', cloakColor: '#2e3a2a', hand: 'none', back: 'none',
};

/* ---------- случайный персонаж ---------- */
const pick = (a) => a[(Math.random() * a.length) | 0];
const wpick = (o) => { // {value: weight}
  let s = Object.values(o).reduce((a, b) => a + b, 0), r = Math.random() * s;
  for (const [k, w] of Object.entries(o)) if ((r -= w) <= 0) return k;
  return Object.keys(o)[0];
};
const rnd = (a, b) => +(a + Math.random() * (b - a)).toFixed(2);
export function randomLook() {
  const c = {
    skin: pick(PAL.skin), hair: pick(PAL.hair),
    hairStyle: wpick({ short: 4, long: 3, ponytail: 2, bun: 1, bald: 1 }),
    beard: wpick({ none: 4, stubble: 3, goatee: 1, full: 2 }),
    height: rnd(0.92, 1.08), build: rnd(0.88, 1.18), head: rnd(0.94, 1.08),
    shirtStyle: wpick({ plain: 3, stripes: 1, plaid: 1, vest: 2, tunic: 2, robe: 1 }),
    shirt: pick(PAL.cloth), shirt2: pick(PAL.cloth), sleeves: wpick({ short: 1, long: 2 }),
    pantsStyle: wpick({ plain: 4, patched: 2, shorts: 1 }), pants: pick(PAL.cloth),
    bootStyle: wpick({ boots: 4, tall: 2, barefoot: 1 }), boots: pick(PAL.leather),
    belt: wpick({ none: 1, belt: 3, sash: 1 }), gloves: wpick({ none: 3, gloves: 1 }), leather: pick(PAL.leather),
    hat: wpick({ none: 4, hood: 3, hat: 2, helmet: 1, wizard: 1, bandana: 1, circlet: 1 }), hatColor: pick(PAL.cloth),
    cloak: wpick({ none: 3, short: 2, long: 2 }), cloakColor: pick(PAL.cloth),
    hand: wpick({ none: 3, sword: 2, torch: 2, staff: 1, lantern: 1, axe: 1 }),
    back: wpick({ none: 3, bag: 2, shield: 1, quiver: 1 }),
  };
  if (c.shirt2 === c.shirt) c.shirt2 = pick(PAL.cloth);
  if (c.shirtStyle === 'robe') { c.pantsStyle = 'plain'; if (Math.random() < 0.5) c.hat = 'wizard'; }
  if (c.hat === 'wizard' && Math.random() < 0.6) c.hand = 'staff';
  return c;
}

/* ---------- утилиты ---------- */
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const hash = (i) => { const v = Math.sin(i * 12.9898) * 43758.5453; return v - Math.floor(v); };

async function pixels(url) {
  const im = new Image();
  im.src = url;
  await im.decode();
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  return g.getImageData(0, 0, c.width, c.height).data;
}

/* ---------- основной объект ---------- */
export async function createLook(root, { version = '', clips = [] } = {}) {
  const q = version ? '?t=' + version : '';
  const [meta, reg, pos, shd] = await Promise.all([
    fetch(BASE + 'meta.json' + q).then((r) => r.json()),
    pixels(BASE + 'region.png' + q), pixels(BASE + 'pos.png' + q), pixels(BASE + 'shade.png' + q),
  ]);
  const N = meta.size;
  const mn = meta.min, mx = meta.max;
  // заранее раскладываем карты в массивы
  const RID = new Uint8Array(N * N), PX = new Float32Array(N * N * 3), SH = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    RID[i] = Math.round(reg[i * 4] / 40);
    for (let a = 0; a < 3; a++) PX[i * 3 + a] = mn[a] + (pos[i * 4 + a] / 255) * (mx[a] - mn[a]);
    SH[i] = shd[i * 4] / 255;
  }

  // текстура меша — перерисовываем её «на месте», чтобы PS1-копии материалов тоже обновлялись
  let tex = null, skinned = null;
  root.traverse((o) => { if (o.isSkinnedMesh && o.material.map && !tex) { tex = o.material.map; skinned = o; } });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const g2 = canvas.getContext('2d');
  const img = g2.createImageData(N, N);

  // кости и «покойная» поза (до начала анимации)
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const bone = (n) => root.getObjectByName(n);
  const restInRoot = (n) => new THREE.Matrix4().multiplyMatrices(inv, bone(n).matrixWorld);
  const restCache = {};
  const rest = (n) => (restCache[n] ??= restInRoot(n)); // матрицы кости в покое (снимаются один раз, до анимации)
  const P = (n) => new THREE.Vector3().setFromMatrixPosition(rest(n));
  const headP = P('Head'), topP = P('HeadTop_End');
  const hu = headP.distanceTo(topP); // «единица головы»
  const up = topP.clone().sub(headP).normalize();
  const fwd = P('LeftToe_End').sub(P('LeftFoot'));
  fwd.sub(up.clone().multiplyScalar(fwd.dot(up))).normalize();
  const left = new THREE.Vector3().crossVectors(up, fwd).normalize();
  up.crossVectors(fwd, left).normalize();
  const basisQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, fwd));
  ['Head', 'Spine2', 'RightHand', 'Neck', 'LeftArm', 'RightArm', 'LeftFoot', 'LeftToe_End', 'HeadTop_End'].forEach(rest);

  // поза кисти в Idle: предметы в руке ориентируем так, чтобы в обычной стойке они смотрели как надо
  const handIdle = (() => {
    const clip = clips.find((c) => /idle/i.test(c.name));
    const saved = [];
    root.traverse((o) => { if (o.isBone) saved.push([o, o.quaternion.clone(), o.position.clone(), o.scale.clone()]); });
    const mx = new THREE.AnimationMixer(root);
    if (clip) { mx.clipAction(clip).play(); mx.update(0.4); }
    root.updateMatrixWorld(true);
    const H = new THREE.Matrix4().multiplyMatrices(inv, bone('RightHand').matrixWorld);
    const fingers = bone('RightHandIndex1') || bone('RightHandMiddle1');
    const W = (o) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const tip = fingers ? W(fingers) : null;
    // оси тела в этой позе: вбок (по плечам), вверх, вперёд
    const iLeft = W(bone('LeftArm')).sub(W(bone('RightArm'))).normalize();
    const iUp = up.clone();
    const iFwd = new THREE.Vector3().crossVectors(iLeft, iUp).normalize();
    mx.stopAllAction(); mx.uncacheRoot(root);
    saved.forEach(([o, q, p, sc]) => { o.quaternion.copy(q); o.position.copy(p); o.scale.copy(sc); });
    root.updateMatrixWorld(true);
    const handPos = new THREE.Vector3().setFromMatrixPosition(H);
    const palm = tip ? handPos.clone().lerp(tip, 0.75) : handPos;
    return { H, palm, fwd: iFwd, up: iUp };
  })();

  // крепление группы (построенной в единицах головы: X — влево, Y — вверх, Z — вперёд) к кости
  const accessories = [];
  function attach(boneName, origin, group) {
    const m = new THREE.Matrix4().compose(origin, basisQ, new THREE.Vector3(hu, hu, hu));
    group.matrixAutoUpdate = false;
    group.matrix.copy(rest(boneName)).invert().multiply(m);
    group.traverse((o) => { o.userData.noConvert = true; });
    bone(boneName).add(group);
    accessories.push(group);
  }
  const at = (p, l = 0, u = 0, f = 0) => p.clone().addScaledVector(left, l * hu).addScaledVector(up, u * hu).addScaledVector(fwd, f * hu);
  const headC = at(headP, 0, 0.47, 0.0);

  const mesh = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    return m;
  };
  const M = (c) => lambert({ color: new THREE.Color(c), side: THREE.DoubleSide });
  const IRON = 0x4a4a4e, WOOD = 0x5a4026, GOLD = 0xc8a040;

  /* ---------- геометрия аксессуаров ---------- */
  function buildHat(c) {
    const g = new THREE.Group(), col = M(c.hatColor);
    switch (c.hat) {
      case 'hood': {
        const m = M(c.cloakColor), w = 1.25;
        g.add(mesh(new THREE.SphereGeometry(0.62, 10, 8, Math.PI / 2 + w / 2, Math.PI * 2 - w, 0, Math.PI * 0.72), m, 0, 0.02, -0.04));
        g.add(mesh(new THREE.CylinderGeometry(0.5, 0.95, 0.75, 10, 1, true), m, 0, -0.62, -0.12));
        g.add(mesh(new THREE.ConeGeometry(0.28, 0.5, 6), m, 0, 0.12, -0.62, -1.2));
        break;
      }
      case 'hat':
        g.add(mesh(new THREE.CylinderGeometry(0.98, 1.0, 0.05, 14), col, 0, 0.36, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.48, 10), col, 0, 0.6, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.505, 0.505, 0.09, 10), M(c.leather), 0, 0.42, 0));
        break;
      case 'helmet':
        g.add(mesh(new THREE.SphereGeometry(0.58, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(IRON), 0, 0.08, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 12, 1, true), M(0x333336), 0, 0.1, 0));
        g.add(mesh(new THREE.BoxGeometry(0.08, 0.42, 0.06), M(IRON), 0, -0.06, 0.6));
        g.add(mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), M(0x333336), 0, 0.62, 0));
        break;
      case 'wizard': {
        g.add(mesh(new THREE.CylinderGeometry(0.9, 0.92, 0.04, 12), col, 0, 0.34, 0));
        const cone = mesh(new THREE.ConeGeometry(0.5, 1.5, 8), col, 0, 1.05, -0.12, -0.18);
        g.add(cone);
        g.add(mesh(new THREE.CylinderGeometry(0.505, 0.505, 0.1, 8), M(GOLD), 0, 0.4, 0));
        break;
      }
      case 'bandana':
        g.add(mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.14, 12, 1, true), col, 0, 0.22, -0.02));
        g.add(mesh(new THREE.BoxGeometry(0.14, 0.34, 0.04), col, 0.08, 0.05, -0.52, 0.3, 0, 0.3));
        g.add(mesh(new THREE.BoxGeometry(0.14, 0.3, 0.04), col, -0.06, 0.07, -0.52, 0.3, 0, -0.4));
        break;
      case 'circlet':
        g.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 12, 1, true), M(GOLD), 0, 0.2, -0.02));
        g.add(mesh(new THREE.OctahedronGeometry(0.07), basic({ color: 0x6ad0ff }), 0, 0.22, 0.46));
        break;
      default: return null;
    }
    return g;
  }
  function buildHair(c) {
    const g = new THREE.Group(), m = M(c.hair);
    if (c.hairStyle === 'long' && c.hat !== 'hood') {
      g.add(mesh(new THREE.BoxGeometry(0.78, 0.9, 0.16), m, 0, -0.32, -0.42, 0.12));
      g.add(mesh(new THREE.BoxGeometry(0.14, 0.7, 0.3), m, 0.4, -0.18, -0.12));
      g.add(mesh(new THREE.BoxGeometry(0.14, 0.7, 0.3), m, -0.4, -0.18, -0.12));
    } else if (c.hairStyle === 'ponytail') {
      g.add(mesh(new THREE.SphereGeometry(0.12, 6, 4), m, 0, 0.12, -0.5));
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.04, 0.7, 6), m, 0, -0.22, -0.58, 0.35));
    } else if (c.hairStyle === 'bun' && c.hat !== 'hood' && c.hat !== 'helmet') {
      g.add(mesh(new THREE.SphereGeometry(0.2, 7, 5), m, 0, 0.42, -0.4));
    } else return null;
    return g;
  }
  function buildCloak(c) {
    if (c.cloak === 'none') return null;
    const len = c.cloak === 'long' ? 4.0 : 2.1;
    const geo = new THREE.PlaneGeometry(1.7, len, 4, 6);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (len / 2 - p.getY(i)) / len; // 0 сверху → 1 снизу
      const x = p.getX(i) * (0.85 + 0.45 * t);
      const z = -Math.sin(t * Math.PI * 0.5) * 0.35 - Math.cos((x / 1.1) * Math.PI * 0.5) * 0.12 * t;
      p.setXYZ(i, x, -t * len, z);
    }
    geo.computeVertexNormals();
    const g = new THREE.Group();
    g.add(mesh(geo, M(c.cloakColor)));
    g.add(mesh(new THREE.CylinderGeometry(0.48, 0.62, 0.22, 10, 1, true), M(c.cloakColor), 0, -0.02, 0.38));
    g.add(mesh(new THREE.OctahedronGeometry(0.07), M(GOLD), 0.3, -0.08, 0.86));
    return g;
  }
  function buildHand(c) {
    const g = new THREE.Group();
    switch (c.hand) {
      case 'sword':
        g.add(mesh(new THREE.BoxGeometry(0.1, 2.1, 0.035), M(0xb8bcc4), 0, 1.3, 0));
        g.add(mesh(new THREE.BoxGeometry(0.55, 0.08, 0.08), M(GOLD), 0, 0.24, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 6), M(c.leather), 0, 0, 0));
        g.add(mesh(new THREE.OctahedronGeometry(0.08), M(GOLD), 0, -0.25, 0));
        break;
      case 'axe':
        g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), M(WOOD), 0, 0.55, 0));
        g.add(mesh(new THREE.BoxGeometry(0.05, 0.36, 0.5), M(0x8a8e96), 0, 1.2, 0.22));
        break;
      case 'torch': {
        g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6), M(WOOD), 0, 0.25, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.16, 6), M(0x2a2018), 0, 0.82, 0));
        const f = mesh(new THREE.OctahedronGeometry(0.16), basic({ color: 0xffa83a }), 0, 1.02, 0);
        f.userData.flame = true; g.add(f);
        const f2 = mesh(new THREE.OctahedronGeometry(0.09), basic({ color: 0xfff0a0 }), 0, 0.98, 0);
        f2.userData.flame = true; g.add(f2);
        break;
      }
      case 'staff':
        g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.6, 6), M(WOOD), 0, 0.7, 0));
        g.add(mesh(new THREE.OctahedronGeometry(0.17), basic({ color: 0x7ad8ff }), 0, 2.5, 0));
        g.add(mesh(new THREE.TorusGeometry(0.17, 0.04, 4, 8), M(WOOD), 0, 2.5, 0));
        break;
      case 'lantern': {
        g.add(mesh(new THREE.BoxGeometry(0.03, 0.4, 0.03), M(0x222222), 0, -0.2, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.36, 6), basic({ color: 0xffa040, transparent: true, opacity: 0.85 }), 0, -0.6, 0));
        g.add(mesh(new THREE.ConeGeometry(0.2, 0.16, 6), M(0x222222), 0, -0.36, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 6), M(0x222222), 0, -0.8, 0));
        break;
      }
      default: return null;
    }
    return g;
  }
  function buildBack(c) {
    const g = new THREE.Group();
    switch (c.back) {
      case 'bag':
        g.add(mesh(new THREE.BoxGeometry(0.8, 0.9, 0.4), M(c.leather), 0, 0, 0));
        g.add(mesh(new THREE.BoxGeometry(0.82, 0.35, 0.42), M(mulHex(c.leather, 0.75)), 0, 0.3, 0.02));
        g.add(mesh(new THREE.BoxGeometry(0.1, 1.3, 0.06), M(mulHex(c.leather, 0.6)), 0.28, 0.3, 0.22));
        g.add(mesh(new THREE.BoxGeometry(0.1, 1.3, 0.06), M(mulHex(c.leather, 0.6)), -0.28, 0.3, 0.22));
        break;
      case 'shield':
        g.add(mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 12), M(c.cloakColor), 0, 0, 0, Math.PI / 2));
        g.add(mesh(new THREE.TorusGeometry(0.85, 0.06, 4, 12), M(IRON), 0, 0, 0));
        g.add(mesh(new THREE.SphereGeometry(0.16, 6, 4), M(IRON), 0, 0, -0.08));
        break;
      case 'quiver':
        g.add(mesh(new THREE.CylinderGeometry(0.17, 0.14, 1.5, 7), M(c.leather), 0, 0.1, 0, 0, 0, 0.5));
        for (let i = 0; i < 5; i++) g.add(mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), M(0xd8d0c0), -0.38 + i * 0.05, 0.98 + (i % 2) * 0.05, -0.04 + (i % 3) * 0.04, 0, 0, 0.5));
        break;
      default: return null;
    }
    return g;
  }
  function mulHex(h, k) { const c = hex(h); return new THREE.Color(c[0] * k / 255, c[1] * k / 255, c[2] * k / 255).convertSRGBToLinear(); }

  function rebuildAccessories(c) {
    accessories.splice(0).forEach((a) => { a.parent?.remove(a); a.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); });
    const hat = buildHat(c); if (hat) attach('Head', headC, hat);
    const hair = buildHair(c); if (hair) attach('Head', headC, hair);
    const cloak = buildCloak(c); if (cloak) attach('Spine2', at(P('Neck'), 0, -0.12, -0.42), cloak);
    const hand = buildHand(c);
    if (hand) {
      // ось предмета +Y: посох/факел — вверх, меч/топор — вперёд
      const F = handIdle.fwd, U = handIdle.up;
      const D = (c.hand === 'sword' || c.hand === 'axe') ? F.clone().addScaledVector(U, 0.3).normalize() : U.clone().addScaledVector(F, 0.12).normalize();
      const ref = Math.abs(D.dot(F)) > 0.9 ? U : F;
      const Z = ref.clone().addScaledVector(D, -D.dot(ref)).normalize();
      const X = new THREE.Vector3().crossVectors(D, Z);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, D, Z));
      const m = new THREE.Matrix4().compose(handIdle.palm, q, new THREE.Vector3(hu, hu, hu));
      hand.matrixAutoUpdate = false;
      hand.matrix.copy(handIdle.H).invert().multiply(m);
      hand.traverse((o) => { o.userData.noConvert = true; });
      bone('RightHand').add(hand);
      accessories.push(hand);
    }
    const back = buildBack(c); if (back) attach('Spine2', at(P('Spine2'), 0, 0.15, -0.62), back);
  }

  /* ---------- текстура ---------- */
  const H = meta.head, waist = meta.waistY;
  function paint(c) {
    const skin = hex(c.skin), hair = hex(c.hair), shirt = hex(c.shirt), shirt2 = hex(c.shirt2), pants = hex(c.pants);
    const boots = hex(c.boots), leather = hex(c.leather), gold = [200, 160, 64];
    const d = img.data;
    for (let i = 0; i < N * N; i++) {
      let id = RID[i];
      const o = i * 4;
      if (!id) { d[o] = d[o + 1] = d[o + 2] = 20; d[o + 3] = 255; continue; }
      const x = PX[i * 3], y = PX[i * 3 + 1], z = PX[i * 3 + 2], az = Math.abs(z);
      const n = hash(i);
      // перераспределение регионов под стиль
      if (id === R_HAIR && c.hairStyle === 'bald') id = R_SKIN;
      if (id === R_SKIN && az > meta.shoulderZ && y > 5) { // руки
        if (az >= meta.wristZ) { if (c.gloves === 'gloves') id = 100; }
        else if (c.sleeves === 'long' && az < meta.wristZ - 0.15) id = R_SHIRT;
      }
      if (id === R_PANTS) {
        if (c.shirtStyle === 'tunic' && y > waist - 1.0) id = R_SHIRT;
        else if (c.shirtStyle === 'robe' && y > meta.ankleY + 0.25) id = R_SHIRT;
        else if (c.pantsStyle === 'shorts' && y < meta.kneeY + 0.2) id = R_SKIN;
        if (id === R_PANTS && c.bootStyle === 'tall' && y < meta.kneeY - 0.05) id = R_BOOTS;
      }
      if (id === R_BOOTS && c.bootStyle === 'barefoot') id = R_SKIN;
      if (c.belt !== 'none' && (id === R_SHIRT || id === R_PANTS) && az < 1 && Math.abs(y - (c.shirtStyle === 'robe' || c.shirtStyle === 'tunic' ? waist + 0.15 : waist)) < (c.belt === 'sash' ? 0.2 : 0.12)) id = 101;

      let col;
      switch (id) {
        case R_SKIN: {
          col = skin;
          const face = y > H.minY - 0.05 && y < H.mouthY + 0.18 && x > H.frontX;
          if (face && c.beard !== 'none') {
            if (c.beard === 'stubble') { if (n > 0.45) col = mixc(skin, mulc(hair, 0.7), 0.45); }
            else if (c.beard === 'goatee') { if (az < 0.22 && (y < H.mouthY - 0.02 || (y < H.mouthY + 0.1 && y > H.mouthY + 0.02))) col = hair; }
            else if (y < H.mouthY + 0.12 || (az > 0.32 && y < H.mouthY + 0.32)) col = mixc(hair, mulc(hair, 0.7), n * 0.5);
          }
          break;
        }
        case R_EYES: col = mixc([24, 20, 18], mulc(hair, 0.6), 0.4); break;
        case R_HAIR: col = mulc(hair, 0.85 + n * 0.3); break;
        case R_SHIRT: {
          col = shirt;
          const torso = az < 0.7;
          if (c.shirtStyle === 'stripes' && Math.floor(y * 4.5) % 2) col = shirt2;
          else if (c.shirtStyle === 'plaid') {
            const a = Math.floor((y + 10) * 2.6) % 2, b = Math.floor((torso ? x : az) * 2.6 + 10) % 2;
            col = a && b ? mulc(shirt2, 0.8) : a || b ? mixc(shirt, shirt2, 0.5) : shirt;
          } else if (c.shirtStyle === 'vest' && torso && !(x > 0.25 && az < 0.12)) col = shirt2;
          else if ((c.shirtStyle === 'tunic' || c.shirtStyle === 'robe') && x > 0.3 && az < 0.06 && y > waist + 0.4) col = shirt2;
          break;
        }
        case R_PANTS: {
          col = pants;
          if (c.pantsStyle === 'patched') {
            const cx = Math.floor((x + 10) * 1.6), cy = Math.floor(y * 1.6), cz = Math.floor((z + 10) * 1.6);
            if (hash(cx * 31 + cy * 7 + cz * 13) > 0.82) col = mixc(pants, shirt2, 0.55);
          }
          break;
        }
        case R_BOOTS: col = c.bootStyle === 'tall' && y > meta.kneeY - 0.25 && y < meta.kneeY - 0.05 ? mulc(boots, 0.7) : boots; break;
        case 100: col = leather; break;
        case 101: col = c.belt === 'belt' && x > 0.3 && az < 0.14 ? gold : c.belt === 'sash' ? shirt2 : leather; break;
        default: col = skin;
      }
      const s = 0.25 + SH[i] * 0.95;
      d[o] = Math.min(255, col[0] * s); d[o + 1] = Math.min(255, col[1] * s); d[o + 2] = Math.min(255, col[2] * s); d[o + 3] = 255;
    }
    g2.putImageData(img, 0, 0);
    tex.image = canvas;
    tex.needsUpdate = true;
  }

  /* ---------- пропорции тела (применяются каждый кадр после анимации) ---------- */
  const B = {
    spine: bone('Spine2'), head: bone('Head'),
    kids: ['Neck', 'LeftShoulder', 'RightShoulder'].map(bone).filter(Boolean),
  };
  let cfg = { ...DEFAULT };
  let baseScale = null;
  function update(t) {
    if (!baseScale) baseScale = root.scale.clone();
    root.scale.copy(baseScale).multiplyScalar(cfg.height);
    const b = cfg.build;
    B.spine.scale.set(b, 1, b);
    B.kids.forEach((k) => k.scale.set(1 / b, 1, 1 / b));
    B.head.scale.setScalar(cfg.head / Math.sqrt(1)); // голова не наследует ширину: шея уже компенсирует
    for (const a of accessories) a.traverse((o) => { if (o.userData.flame) o.scale.setScalar(0.85 + Math.sin(t * 17 + o.id) * 0.12); });
  }

  function apply(c) {
    cfg = { ...DEFAULT, ...c };
    paint(cfg);
    rebuildAccessories(cfg);
    return cfg;
  }

  return { apply, update, get cfg() { return cfg; }, canvas, skinned };
}
