import * as THREE from 'three';

/*
 * Библиотека материалов в PS1-духе: процедурные пиксельные текстуры (2 цвета + шум), без фильтрации.
 * spec = { preset, c1, c2, res, rep, img? } — сериализуемое описание; makeTexture(spec) → CanvasTexture.
 * Используется встроенными предметами (items.js) и панелью «Материал» в Мастерской (editor.js).
 */

export const PRESETS = {
  none: 'Без текстуры', fabric: 'Ткань', wool: 'Шерсть', leather: 'Кожа', metal: 'Металл', rust: 'Ржавый металл',
  gold: 'Золото', wood: 'Дерево', planks: 'Доски', stone: 'Камень', brick: 'Кирпич', chain: 'Кольчуга',
  scales: 'Чешуя', fur: 'Мех', hair: 'Волосы', plaid: 'Клетка', marble: 'Мрамор', moss: 'Мох', bone: 'Кость', glow: 'Свечение',
};
// цвета по умолчанию для пресета (основной, второй)
export const PRESET_COLORS = {
  fabric: ['#8a7d64', '#5e5444'], wool: ['#6a5a48', '#4a3e32'], leather: ['#5a3c26', '#2e1e14'], metal: ['#8c9096', '#c8ccd2'],
  rust: ['#6e6a66', '#8a4a22'], gold: ['#b08a2e', '#f0d070'], wood: ['#6a4a2c', '#3e2a18'], planks: ['#6a4e32', '#2a1c12'],
  stone: ['#6a6660', '#3e3a36'], brick: ['#7a3e2e', '#4a4440'], chain: ['#7a7e86', '#2a2c30'], scales: ['#3e5a3a', '#1e2e1c'],
  fur: ['#6a5440', '#3a2c20'], hair: ['#3a2a1e', '#1a120c'], plaid: ['#6a2a24', '#2a3428'], marble: ['#d8d4cc', '#7a7672'],
  moss: ['#3e5a2a', '#24341a'], bone: ['#d8ceb4', '#8a8270'], glow: ['#60ffa0', '#e0fff0'], none: ['#a0a0a0', '#606060'],
};

/* ---------- шум ---------- */
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function valueNoise(w, h, cell, r) { // плавный шум с периодом w×h (тайлится)
  const gw = Math.max(1, Math.round(w / cell)), gh = Math.max(1, Math.round(h / cell));
  const g = Array.from({ length: gw * gh }, r);
  return (x, y) => {
    const fx = (x / w) * gw, fy = (y / h) * gh;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const v = (i, j) => g[((j % gh) + gh) % gh * gw + (((i % gw) + gw) % gw)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  };
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/* ---------- узоры: (x, y) → { v: 0..1 (смесь c1→c2), k: множитель яркости } ---------- */
function pattern(preset, N, r) {
  const n1 = valueNoise(N, N, N / 4, r), n2 = valueNoise(N, N, N / 12, r), n3 = valueNoise(N, N, 2, r);
  const pts = Array.from({ length: 14 }, () => [r() * N, r() * N]); // ячейки для камня
  const cellD = (x, y) => { let a = 1e9, b = 1e9, id = 0; pts.forEach(([px, py], i) => { for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const d = Math.hypot(x - px - ox, y - py - oy); if (d < a) { b = a; a = d; id = i; } else if (d < b) b = d; } }); return [a, b, id]; };
  const s = N / 64; // масштаб узора относительно 64px
  switch (preset) {
    case 'fabric': return (x, y) => ({ v: ((x + y) % 2) * 0.4 + n2(x, y) * 0.3, k: 0.9 + n3(x, y) * 0.2 - ((x % 2) & (y % 2)) * 0.06 });
    case 'wool': return (x, y) => ({ v: n1(x, y) * 0.6 + n3(x, y) * 0.4, k: 0.85 + n3(x, y) * 0.3 });
    case 'leather': return (x, y) => { const v = n2(x, y); return { v: v * 0.7, k: Math.abs(v - 0.5) < 0.04 ? 0.65 : 0.9 + n3(x, y) * 0.2 }; };
    case 'metal': return (x, y) => { const v = valueNoise(N, N, N / 6, r)(x * 0.15, y) * 0.5 + n3(x, y) * 0.25; return { v, k: (r() < 0.012 ? 1.35 : 1) * (0.88 + n3(x, y) * 0.2) }; };
    case 'rust': return (x, y) => { const b = n1(x, y); return { v: b > 0.55 ? 0.6 + n3(x, y) * 0.4 : n3(x, y) * 0.25, k: 0.82 + n3(x, y) * 0.3 }; };
    case 'gold': return (x, y) => ({ v: Math.pow(n2(x, y), 2) + (r() < 0.02 ? 0.5 : 0), k: 0.85 + n3(x, y) * 0.3 });
    case 'wood': return (x, y) => { const w = Math.sin((x / s) * 0.55 + n1(x, y) * 6) * 0.5 + 0.5; return { v: w * 0.8, k: 0.88 + n3(x, y) * 0.2 }; };
    case 'planks': return (x, y) => { const pw = Math.round(10 * s), row = Math.floor(x / pw); const gap = x % pw === 0 || ((y + row * 17 * s) % Math.round(48 * s)) === 0; const w = Math.sin((x / s) * 0.9 + n1(x, y) * 5 + row) * 0.5 + 0.5; return { v: gap ? 1 : w * 0.45, k: gap ? 0.55 : 0.88 + n3(x, y) * 0.2 }; };
    case 'stone': return (x, y) => { const [a, b, id] = cellD(x, y); const edge = b - a < 1.6 * s; return { v: edge ? 1 : (id % 5) / 10 + n3(x, y) * 0.2, k: edge ? 0.6 : 0.85 + n3(x, y) * 0.3 }; };
    case 'brick': return (x, y) => { const bh = Math.round(8 * s), bw = Math.round(16 * s), row = Math.floor(y / bh); const xo = (x + (row % 2) * bw / 2) % bw; const mortar = y % bh === 0 || xo < 1; return { v: mortar ? 1 : n3(x, y) * 0.25, k: mortar ? 0.8 : 0.85 + n2(x, y) * 0.3 }; };
    case 'chain': return (x, y) => { const c = Math.max(4, Math.round(4 * s)); const ox = x % c, oy = (y + ((Math.floor(x / c) % 2) * c) / 2) % c; const d = Math.hypot(ox - c / 2 + 0.5, oy - c / 2 + 0.5); const ring = Math.abs(d - c * 0.32) < c * 0.17; return { v: ring ? n3(x, y) * 0.3 : 1, k: ring ? 1.05 : 0.6 }; };
    case 'scales': return (x, y) => { const cw = Math.round(8 * s), ch = Math.round(6 * s); const row = Math.floor(y / ch); const lx = (x + (row % 2) * cw / 2) % cw - cw / 2, ly = (y % ch); const d = Math.hypot(lx, ly) / cw; return { v: Math.min(1, d * 1.3), k: d > 0.62 ? 0.6 : 1.05 - d * 0.4 }; };
    case 'fur': case 'hair': return (x, y) => { const col = valueNoise(N, N, 2, r); const st = n3(x, 0) * 0.6 + n2(x, y * 0.25) * 0.4; return { v: st, k: (preset === 'hair' ? 0.8 : 0.85) + col(x, y * 0.1) * 0.35 }; };
    case 'plaid': return (x, y) => { const p = Math.round(16 * s), b = Math.round(4 * s); const a = (x % p) < b, c = (y % p) < b; return { v: a && c ? 1 : a || c ? 0.55 : 0, k: 0.9 + n3(x, y) * 0.15 + (((x + y) % 2) ? 0.04 : 0) }; };
    case 'marble': return (x, y) => { const m = Math.abs(Math.sin((x + y) / (9 * s) + n1(x, y) * 7)); return { v: Math.pow(1 - m, 6), k: 0.95 + n3(x, y) * 0.1 }; };
    case 'moss': return (x, y) => ({ v: n2(x, y) > 0.55 ? 1 : n3(x, y) * 0.3, k: 0.8 + n3(x, y) * 0.35 });
    case 'bone': return (x, y) => { const c = Math.abs(n1(x, y) - 0.5) < 0.02; return { v: c ? 1 : n3(x, y) * 0.3, k: c ? 0.7 : 0.9 + n3(x, y) * 0.15 }; };
    case 'glow': return (x, y) => ({ v: n2(x, y), k: 0.9 + n3(x, y) * 0.25 });
    default: return (x, y) => ({ v: 0, k: 0.92 + n3(x, y) * 0.14 });
  }
}

const cache = new Map();
/** Текстура по описанию (кешируется по ключу спецификации). */
export function makeTexture(spec) {
  const s = normalize(spec);
  const k = JSON.stringify([s.preset, s.c1, s.c2, s.res, s.seed, s.img ? s.img.length : 0]);
  let tex = cache.get(k);
  if (!tex) {
    const N = s.res, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    if (s.img) {
      tex = new THREE.CanvasTexture(c);
      const im = new Image();
      im.onload = () => { g.imageSmoothingEnabled = true; g.drawImage(im, 0, 0, N, N); tex.needsUpdate = true; };
      im.src = s.img;
    } else {
      const r = rng(s.seed), f = pattern(s.preset, N, r), a = hex(s.c1), b = hex(s.c2);
      const img = g.createImageData(N, N), d = img.data;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const { v, k } = f(x, y), o = (y * N + x) * 4, t = Math.max(0, Math.min(1, v));
        for (let i = 0; i < 3; i++) d[o + i] = Math.max(0, Math.min(255, (a[i] + (b[i] - a[i]) * t) * k));
        d[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      tex = new THREE.CanvasTexture(c);
    }
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.userData.matSpec = s;
    cache.set(k, tex);
  }
  const t = tex.clone(); // свой повтор у каждого материала, картинка общая
  t.repeat.set(s.rep, s.rep);
  t.needsUpdate = true;
  t.userData = { matSpec: s };
  return t;
}
export function normalize(spec = {}) {
  const preset = PRESETS[spec.preset] ? spec.preset : 'none';
  const [d1, d2] = PRESET_COLORS[preset] || PRESET_COLORS.none;
  return { preset, c1: spec.c1 || d1, c2: spec.c2 || d2, res: [16, 32, 64, 128].includes(+spec.res) ? +spec.res : 64, rep: Math.max(1, Math.min(16, +spec.rep || 1)), seed: +spec.seed || 7, img: spec.img || null };
}

/** Назначить материалу описание (вместе с PS1-копией материала). */
export function applySpec(mat, spec) {
  const s = normalize(spec);
  const targets = [mat, mat.userData.psMat].filter(Boolean);
  for (const m of targets) {
    if (s.preset === 'none' && !s.img) { m.map = null; m.color?.set(s.c1); }
    else { m.map = makeTexture(s); m.color?.set('#ffffff'); }
    if (m.emissive) {
      if (s.preset === 'glow') { m.emissive.set(s.c1); m.emissiveMap = m.map; m.emissiveIntensity = 1; }
      else { m.emissive.set('#000000'); m.emissiveMap = null; }
    }
    m.needsUpdate = true;
  }
  mat.userData.matSpec = s;
  return s;
}

/** Картинка пользователя → квадрат N×N в dataURL (пикселизация). */
export function pixelate(file, N = 64) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = N;
      const g = c.getContext('2d');
      const s = Math.min(im.width, im.height);
      g.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, N, N);
      res(c.toDataURL('image/png'));
    };
    im.onerror = rej;
    im.src = URL.createObjectURL(file);
  });
}

/** PS1-материал для предметов: Lambert + описание текстуры. */
export function ps1Material(lambertFactory, spec, extra = {}) {
  const m = lambertFactory({ color: 0xffffff, side: THREE.DoubleSide, ...extra });
  applySpec(m, spec);
  return m;
}
