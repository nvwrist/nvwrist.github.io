import * as THREE from 'three';

export function rng(seed = 1) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Низкоразмерная «пиксельная» текстура без фильтрации. */
export function canvasTex(w, h, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Заливка + шум из пикселей. */
export function noiseFill(g, w, h, base, speck = ['#00000022', '#ffffff14'], n = 0.5, seed = 3) {
  const r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * n; i++) {
    g.fillStyle = speck[(r() * speck.length) | 0];
    g.fillRect((r() * w) | 0, (r() * h) | 0, 1, 1);
  }
}

export const px = (g, c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
