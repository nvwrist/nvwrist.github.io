import * as THREE from 'three';
import { lambert, basic } from './ps1.js';
import { applySpec } from './matlib.js';

/*
 * Встроенные (процедурные) предметы. Единицы — «единицы головы» (hu ≈ высота головы персонажа),
 * оси гнезда: X — влево, Y — вверх (у предметов в руке — к острию), Z — вперёд; начало — центр головы/точка хвата.
 * build(o) получает цвета {hair, hat, cloak, leather, metal} и возвращает THREE.Group.
 * Всё, что здесь построено, потом двигается/правится в Мастерской (режим «Снаряжение»).
 */

const M = (spec) => { const m = lambert({ color: 0xffffff, side: THREE.DoubleSide }); applySpec(m, spec); return m; };
const G = (spec) => basic({ color: new THREE.Color(spec), side: THREE.DoubleSide });
function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  return m;
}
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

/* ---------- волосы по форме головы: оболочка-эллипсоид + «юбка» прядей с рваным краем ---------- */
function hairShell({ color, length = 1.1, flare = 0.12, front = 0.95, seed = 3 }) {
  const RX = 0.47, RY = 0.56, RZ = 0.53; // чуть больше головы
  const segU = 18, rowsCap = 7, rowsSkirt = 6, thetaMax = Math.PI * 0.6;
  const pos = [], uv = [], idx = [];
  let r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const faceGap = (phi) => Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))) < front * 0.62; // лицо смотрит в +Z (phi=0)
  const ringCols = [];
  // шапка
  for (let j = 0; j <= rowsCap; j++) {
    const th = (j / rowsCap) * thetaMax, row = [];
    for (let i = 0; i <= segU; i++) {
      const ph = (i / segU) * Math.PI * 2;
      // спереди линия волос выше (открываем лоб)
      const lift = faceGap(ph) ? Math.max(0, th - Math.PI * 0.3) : 0;
      const t = th - lift;
      pos.push(RX * Math.sin(t) * Math.sin(ph), RY * Math.cos(t) + 0.04, RZ * Math.sin(t) * Math.cos(ph));
      uv.push(i / segU * 3, 1 - j / (rowsCap + rowsSkirt));
      row.push(pos.length / 3 - 1);
    }
    ringCols.push(row);
  }
  // юбка прядей сзади и по бокам
  const base = ringCols[rowsCap];
  for (let k = 1; k <= rowsSkirt; k++) {
    const row = [];
    for (let i = 0; i <= segU; i++) {
      const ph = (i / segU) * Math.PI * 2;
      const b = base[i] * 3;
      const t = k / rowsSkirt;
      const tip = k === rowsSkirt ? (rnd() * 0.18 + (i % 2) * 0.1) : 0;
      const gap = faceGap(ph) ? 0.25 : 1; // спереди пряди короче (обрамляют лицо)
      const y = pos[b + 1] - (length * gap + tip) * t;
      const sc = 1 + flare * t;
      pos.push(pos[b] * sc, y, pos[b + 2] * sc - 0.03 * t);
      uv.push(i / segU * 3, 1 - (rowsCap + k) / (rowsCap + rowsSkirt));
      row.push(pos.length / 3 - 1);
    }
    ringCols.push(row);
  }
  for (let j = 0; j < ringCols.length - 1; j++) for (let i = 0; i < segU; i++) {
    const ph = ((i + 0.5) / segU) * Math.PI * 2;
    if (j >= rowsCap && Math.abs(Math.atan2(Math.sin(ph), Math.cos(ph))) < 0.5) continue; // прямо перед лицом прядей нет
    const a = ringCols[j][i], b = ringCols[j][i + 1], c = ringCols[j + 1][i], d = ringCols[j + 1][i + 1];
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, M({ preset: 'hair', c1: color, c2: shade(color, 0.55), res: 32, rep: 1 }));
}
function taperTube(points, r0, r1, seg = 6, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, 10, 1, seg, false);
  const p = g.attributes.position, n = g.attributes.normal;
  // TubeGeometry строится с радиусом 1 → масштабируем по длине (конус)
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (seg + 1)), t = ring / 10;
    const c = curve.getPoint(t), rr = r0 + (r1 - r0) * t;
    p.setXYZ(i, c.x + n.getX(i) * rr, c.y + n.getY(i) * rr, c.z + n.getZ(i) * rr);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/* ---------- каталог ---------- */
export const BUILTINS = {
  /* шапки (гнездо «Голова») */
  hood: { name: 'Капюшон', cat: 'head', socket: 'head', build: (o) => {
    const g = new THREE.Group(), m = M({ preset: 'wool', c1: o.cloak, c2: shade(o.cloak, 0.6) }), w = 1.25;
    g.add(mesh(new THREE.SphereGeometry(0.62, 12, 8, Math.PI / 2 + w / 2, Math.PI * 2 - w, 0, Math.PI * 0.72), m, 0, 0.02, -0.04));
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.95, 0.75, 12, 1, true), m, 0, -0.62, -0.12));
    g.add(mesh(new THREE.ConeGeometry(0.28, 0.5, 6), m, 0, 0.12, -0.62, -1.2));
    return g; } },
  hat: { name: 'Широкополая шляпа', cat: 'head', socket: 'head', build: (o) => {
    const g = new THREE.Group(), m = M({ preset: 'wool', c1: o.hat, c2: shade(o.hat, 0.7) });
    g.add(mesh(new THREE.CylinderGeometry(0.98, 1.0, 0.05, 14), m, 0, 0.36, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.48, 10), m, 0, 0.6, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.505, 0.505, 0.09, 10), M({ preset: 'leather', c1: o.leather }), 0, 0.42, 0));
    return g; } },
  helmet: { name: 'Шлем', cat: 'head', socket: 'head', build: () => {
    const g = new THREE.Group(), m = M({ preset: 'metal', c1: '#6a6c72', c2: '#a8acb4' }), d = M({ preset: 'rust', c1: '#4a4a4e', c2: '#6a3a1e' });
    g.add(mesh(new THREE.SphereGeometry(0.58, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0.08, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 12, 1, true), d, 0, 0.1, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.42, 0.06), m, 0, -0.06, 0.6));
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), d, 0, 0.62, 0));
    return g; } },
  wizard: { name: 'Колпак мага', cat: 'head', socket: 'head', build: (o) => {
    const g = new THREE.Group(), m = M({ preset: 'wool', c1: o.hat, c2: shade(o.hat, 0.6) });
    g.add(mesh(new THREE.CylinderGeometry(0.9, 0.92, 0.04, 12), m, 0, 0.34, 0));
    g.add(mesh(new THREE.ConeGeometry(0.5, 1.5, 8), m, 0, 1.05, -0.12, -0.18));
    g.add(mesh(new THREE.CylinderGeometry(0.505, 0.505, 0.1, 8), M({ preset: 'gold' }), 0, 0.4, 0));
    return g; } },
  bandana: { name: 'Повязка', cat: 'head', socket: 'head', build: (o) => {
    const g = new THREE.Group(), m = M({ preset: 'fabric', c1: o.hat, c2: shade(o.hat, 0.7) });
    g.add(mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.14, 12, 1, true), m, 0, 0.22, -0.02));
    g.add(mesh(new THREE.BoxGeometry(0.14, 0.34, 0.04), m, 0.08, 0.05, -0.52, 0.3, 0, 0.3));
    g.add(mesh(new THREE.BoxGeometry(0.14, 0.3, 0.04), m, -0.06, 0.07, -0.52, 0.3, 0, -0.4));
    return g; } },
  circlet: { name: 'Обруч', cat: 'head', socket: 'head', build: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 12, 1, true), M({ preset: 'gold' }), 0, 0.2, -0.02));
    g.add(mesh(new THREE.OctahedronGeometry(0.07), G('#6ad0ff'), 0, 0.22, 0.46));
    return g; } },
  /* причёски (гнездо «Голова») */
  hair_long: { name: 'Длинные волосы', cat: 'hair', socket: 'head', build: (o) => { const g = new THREE.Group(); g.add(hairShell({ color: o.hair, length: 1.15 })); return g; } },
  hair_mid: { name: 'Волосы до плеч', cat: 'hair', socket: 'head', build: (o) => { const g = new THREE.Group(); g.add(hairShell({ color: o.hair, length: 0.55, flare: 0.06 })); return g; } },
  ponytail: { name: 'Хвост', cat: 'hair', socket: 'head', build: (o) => {
    const g = new THREE.Group(), m = M({ preset: 'hair', c1: o.hair, c2: shade(o.hair, 0.55), res: 32 });
    g.add(mesh(new THREE.TorusGeometry(0.1, 0.04, 4, 8), M({ preset: 'leather', c1: o.leather }), 0, 0.1, -0.52));
    g.add(taperTube([[0, 0.12, -0.5], [0, 0.0, -0.66], [0, -0.4, -0.68], [0, -0.85, -0.58]], 0.11, 0.03, 6, m));
    return g; } },
  bun: { name: 'Пучок', cat: 'hair', socket: 'head', build: (o) => {
    const g = new THREE.Group(), m = M({ preset: 'hair', c1: o.hair, c2: shade(o.hair, 0.55), res: 32 });
    g.add(mesh(new THREE.SphereGeometry(0.2, 8, 6), m, 0, 0.42, -0.4));
    g.add(mesh(new THREE.TorusGeometry(0.12, 0.03, 4, 8), M({ preset: 'leather', c1: o.leather }), 0, 0.3, -0.35, -0.6));
    return g; } },
  braids: { name: 'Две косы', cat: 'hair', socket: 'head', build: (o) => {
    const g = new THREE.Group(), m = M({ preset: 'hair', c1: o.hair, c2: shade(o.hair, 0.55), res: 32 });
    for (const s of [-1, 1]) g.add(taperTube([[s * 0.4, 0.0, -0.1], [s * 0.46, -0.3, -0.05], [s * 0.42, -0.75, 0.05], [s * 0.38, -1.1, 0.08]], 0.09, 0.04, 6, m));
    return g; } },
  /* плащи */
  cloak_short: { name: 'Короткий плащ', cat: 'cloak', socket: 'cloak', build: (o) => cloak(o, 2.1) },
  cloak_long: { name: 'Длинный плащ', cat: 'cloak', socket: 'cloak', build: (o) => cloak(o, 4.0) },
  /* в руке */
  sword: { name: 'Простой меч', cat: 'weapon', socket: 'hand_r', build: (o) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.035, 2.1, 0.1), M({ preset: 'metal' }), 0, 1.3, 0));
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.55), M({ preset: 'gold' }), 0, 0.24, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 6), M({ preset: 'leather', c1: o.leather }), 0, 0, 0));
    g.add(mesh(new THREE.OctahedronGeometry(0.08), M({ preset: 'gold' }), 0, -0.25, 0));
    return g; } },
  axe: { name: 'Простой топор', cat: 'weapon', socket: 'hand_r', build: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), M({ preset: 'wood' }), 0, 0.55, 0));
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.36, 0.5), M({ preset: 'rust' }), 0, 1.2, 0.22));
    return g; } },
  torch: { name: 'Факел', cat: 'tool', socket: 'hand_r', tilt: 55, build: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.7, 6), M({ preset: 'wood' }), 0, 0.35, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.26, 6), M({ preset: 'fabric', c1: '#3a2a1e', c2: '#1a120c' }), 0, 1.25, 0));
    const f = mesh(new THREE.OctahedronGeometry(0.22), G('#ffa83a'), 0, 1.55, 0); f.userData.flame = true; g.add(f);
    const f2 = mesh(new THREE.OctahedronGeometry(0.12), G('#fff0a0'), 0, 1.5, 0); f2.userData.flame = true; g.add(f2);
    return g; } },
  staff: { name: 'Посох', cat: 'tool', socket: 'hand_r', tilt: 78, build: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.6, 6), M({ preset: 'wood' }), 0, 0.7, 0));
    g.add(mesh(new THREE.OctahedronGeometry(0.17), G('#7ad8ff'), 0, 2.5, 0));
    g.add(mesh(new THREE.TorusGeometry(0.17, 0.04, 4, 8), M({ preset: 'wood' }), 0, 2.5, 0));
    return g; } },
  lantern: { name: 'Фонарь', cat: 'tool', socket: 'hand_r', tilt: 90, build: () => {
    const g = new THREE.Group(), d = M({ preset: 'rust', c1: '#2a2826', c2: '#5a3018' });
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.4, 0.03), d, 0, -0.2, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.36, 6), basic({ color: 0xffa040, transparent: true, opacity: 0.85 }), 0, -0.6, 0));
    g.add(mesh(new THREE.ConeGeometry(0.2, 0.16, 6), d, 0, -0.36, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 6), d, 0, -0.8, 0));
    return g; } },
  potion: { name: 'Зелье', cat: 'tool', socket: 'hand_r', tilt: 80, build: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), G('#50ff8a'), 0, 0.05, 0.05));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6), M({ preset: 'glow', c1: '#8adfa0' }), 0, 0.25, 0.05));
    g.add(mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.06, 6), M({ preset: 'wood' }), 0, 0.35, 0.05));
    return g; } },
  /* спина */
  bag: { name: 'Заплечная сумка', cat: 'back', socket: 'back', build: (o) => {
    const g = new THREE.Group(), L = M({ preset: 'leather', c1: o.leather, c2: shade(o.leather, 0.5) }), D = M({ preset: 'leather', c1: shade(o.leather, 0.7) });
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.9, 0.4), L));
    g.add(mesh(new THREE.BoxGeometry(0.82, 0.35, 0.42), D, 0, 0.3, 0.02));
    g.add(mesh(new THREE.BoxGeometry(0.1, 1.3, 0.06), D, 0.28, 0.3, 0.22));
    g.add(mesh(new THREE.BoxGeometry(0.1, 1.3, 0.06), D, -0.28, 0.3, 0.22));
    return g; } },
  back_shield: { name: 'Щит за спиной', cat: 'back', socket: 'back', build: (o) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 12), M({ preset: 'planks', c1: shade(o.cloak, 1.2) }), 0, 0, 0, Math.PI / 2));
    g.add(mesh(new THREE.TorusGeometry(0.85, 0.06, 4, 12), M({ preset: 'rust' }), 0, 0, 0));
    g.add(mesh(new THREE.SphereGeometry(0.16, 6, 4), M({ preset: 'metal' }), 0, 0, -0.08));
    return g; } },
  quiver: { name: 'Колчан', cat: 'back', socket: 'back', build: (o) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.17, 0.14, 1.5, 7), M({ preset: 'leather', c1: o.leather }), 0, 0.1, 0, 0, 0, 0.5));
    for (let i = 0; i < 5; i++) g.add(mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), M({ preset: 'bone', c1: '#d8d0c0' }), -0.38 + i * 0.05, 0.98 + (i % 2) * 0.05, -0.04 + (i % 3) * 0.04, 0, 0, 0.5));
    return g; } },
  /* пояс */
  pouch: { name: 'Поясной кошель', cat: 'belt', socket: 'hip_r', build: (o) => {
    const g = new THREE.Group(), L = M({ preset: 'leather', c1: o.leather });
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.3, 0.26), L));
    g.add(mesh(new THREE.BoxGeometry(0.17, 0.12, 0.27), M({ preset: 'leather', c1: shade(o.leather, 0.7) }), 0, 0.1, 0));
    return g; } },
  scabbard: { name: 'Ножны', cat: 'belt', socket: 'hip_l', build: (o) => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.08, 1.9, 0.16), M({ preset: 'leather', c1: o.leather }), 0, -0.85, 0.15, 0.35));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.14, 0.2), M({ preset: 'gold' }), 0, 0.05, -0.18, 0.35));
    return g; } },
};

function cloak(o, len) {
  const geo = new THREE.PlaneGeometry(1.7, len, 4, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (len / 2 - p.getY(i)) / len;
    const x = p.getX(i) * (0.85 + 0.45 * t);
    const z = -Math.sin(t * Math.PI * 0.5) * 0.35 - Math.cos((x / 1.1) * Math.PI * 0.5) * 0.12 * t;
    p.setXYZ(i, x, -t * len, z);
  }
  geo.computeVertexNormals();
  const m = M({ preset: 'wool', c1: o.cloak, c2: shade(o.cloak, 0.6), rep: 2 });
  const g = new THREE.Group();
  g.add(mesh(geo, m));
  g.add(mesh(new THREE.CylinderGeometry(0.48, 0.62, 0.22, 10, 1, true), m, 0, -0.02, 0.38));
  g.add(mesh(new THREE.OctahedronGeometry(0.07), M({ preset: 'gold' }), 0.3, -0.08, 0.86));
  return g;
}

export const DEFAULT_COLORS = { hair: '#2e2018', hat: '#3a2a40', cloak: '#2e3a2a', leather: '#4a3424' };

/** Построить встроенный предмет: группа в единицах головы, с устойчивыми именами мешей/материалов. */
export function buildBuiltin(id, colors = {}) {
  const def = BUILTINS[id];
  if (!def) return null;
  const g = def.build({ ...DEFAULT_COLORS, ...colors });
  g.name = id;
  return g;
}

/* ---------- примитивы для «Нового предмета» (в метрах) ---------- */
export const PRIMITIVES = {
  box: ['Куб', () => new THREE.BoxGeometry(0.12, 0.12, 0.12)],
  plate: ['Пластина', () => new THREE.BoxGeometry(0.25, 0.02, 0.35)],
  cylinder: ['Цилиндр', () => new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8)],
  cone: ['Конус', () => new THREE.ConeGeometry(0.06, 0.18, 8)],
  sphere: ['Шар', () => new THREE.SphereGeometry(0.07, 10, 7)],
  torus: ['Кольцо', () => new THREE.TorusGeometry(0.07, 0.015, 5, 12)],
  pyramid: ['Пирамида', () => new THREE.ConeGeometry(0.08, 0.14, 4)],
  capsule: ['Капсула', () => new THREE.CapsuleGeometry(0.04, 0.16, 3, 8)],
  wedge: ['Клин', () => { const g = new THREE.CylinderGeometry(0, 0.08, 0.3, 3); g.rotateY(Math.PI / 6); return g; }],
  blade: ['Клинок', () => { const s = new THREE.Shape(); s.moveTo(-0.025, 0); s.lineTo(0.025, 0); s.lineTo(0.02, 0.6); s.lineTo(0, 0.68); s.lineTo(-0.02, 0.6); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false }); g.translate(0, 0, -0.004); g.rotateY(Math.PI / 2); return g; }],
};
