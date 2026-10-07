import * as THREE from 'three';
import { lambert } from '../ps1.js';
import { makeTexture } from '../matlib.js';

/*
 * Рельеф карты в духе PS1: сетка N×N клеток (cell метров), высоты в узлах, у каждой клетки — своя плитка-текстура
 * из атласа (как в играх PS1: квадраты с повёрнутыми плитками). Геометрия без индекса: 6 вершин на клетку,
 * поэтому у каждой клетки свои UV. Освещение — flatShading (нормали не нужны).
 */

export const TILES = [
  ['Трава', 'grass'], ['Тёмная трава', 'grass', '#33441e', '#1c2612'], ['Земля', 'dirt'], ['Грязь', 'mud'],
  ['Тропа (гравий)', 'gravel'], ['Булыжник', 'cobble'], ['Каменные плиты', 'flagstone'], ['Песок', 'sand'],
  ['Снег', 'snow'], ['Мох', 'moss'], ['Опавшие листья', 'leaves'], ['Пепел', 'ash'],
  ['Скала', 'stone'], ['Доски', 'planks'], ['Кирпич', 'brick'], ['Мрамор', 'marble'],
];
const TILE_PX = 32, ATLAS_N = 4; // атлас 4×4 плитки по 32px = 128px

let atlasTex = null;
export function tileAtlas() {
  if (atlasTex) return atlasTex;
  const c = document.createElement('canvas');
  c.width = c.height = TILE_PX * ATLAS_N;
  const g = c.getContext('2d');
  TILES.forEach(([, preset, c1, c2], i) => {
    const t = makeTexture({ preset, c1, c2, res: TILE_PX, seed: 11 + i });
    g.drawImage(t.image, (i % ATLAS_N) * TILE_PX, Math.floor(i / ATLAS_N) * TILE_PX, TILE_PX, TILE_PX);
  });
  atlasTex = new THREE.CanvasTexture(c);
  atlasTex.magFilter = atlasTex.minFilter = THREE.NearestFilter;
  atlasTex.generateMipmaps = false;
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  return atlasTex;
}
export function tileIcon(i, size = 32) { // картинка плитки для палитры
  const a = tileAtlas().image, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(a, (i % ATLAS_N) * TILE_PX, Math.floor(i / ATLAS_N) * TILE_PX, TILE_PX, TILE_PX, 0, 0, size, size);
  return c.toDataURL();
}

const hash = (x, z) => { let h = (x * 374761393 + z * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function createTerrain({ size = 48, cell = 2, heights = null, tiles = null } = {}) {
  const N = size, V = N + 1;
  const H = heights ? Float32Array.from(heights) : new Float32Array(V * V);
  const T = tiles ? Uint8Array.from(tiles) : new Uint8Array(N * N);
  const half = (N * cell) / 2;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * N * 18), uv = new Float32Array(N * N * 12), col = new Float32Array(N * N * 18);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = lambert({ map: tileAtlas(), vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Рельеф';
  mesh.userData.terrain = true;
  mesh.userData.noConvert = true;

  const hAt = (i, j) => H[Math.max(0, Math.min(N, j)) * V + Math.max(0, Math.min(N, i))];
  const X = (i) => i * cell - half;
  // UV плитки с поворотом/отражением по хэшу клетки (меньше видно повтор) и отступом в полпикселя (без «протечек»)
  const e = 0.5 / (TILE_PX * ATLAS_N), s = 1 / ATLAS_N;
  function cellUV(i, j, out) {
    const t = T[j * N + i], u0 = (t % ATLAS_N) * s + e, v0 = 1 - (Math.floor(t / ATLAS_N) + 1) * s + e, u1 = u0 + s - 2 * e, v1 = v0 + s - 2 * e;
    const r = Math.floor(hash(i, j) * 8);
    let c = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]; // углы: (i,j) (i+1,j) (i+1,j+1) (i,j+1)
    for (let k = 0; k < (r & 3); k++) c = [c[1], c[2], c[3], c[0]];
    if (r & 4) c = [c[1], c[0], c[3], c[2]];
    out.length = 0; out.push(...c);
  }
  const cuv = [];
  function writeCell(i, j) {
    const o = (j * N + i) * 18, ou = (j * N + i) * 12;
    const h00 = hAt(i, j), h10 = hAt(i + 1, j), h11 = hAt(i + 1, j + 1), h01 = hAt(i, j + 1);
    const p = [[X(i), h00, X(j)], [X(i + 1), h10, X(j)], [X(i + 1), h11, X(j + 1)], [X(i), h01, X(j + 1)]];
    cellUV(i, j, cuv);
    // диагональ — по более короткой разнице высот (без «складок»)
    const tri = Math.abs(h00 - h11) <= Math.abs(h10 - h01) ? [0, 3, 2, 0, 2, 1] : [0, 3, 1, 1, 3, 2];
    tri.forEach((k, n) => {
      pos.set(p[k], o + n * 3);
      uv.set(cuv[k], ou + n * 2);
      const sh = 0.86 + hash(i + (k & 1), j + (k >> 1)) * 0.16; // лёгкая «грязь» по вершинам
      col[o + n * 3] = col[o + n * 3 + 1] = col[o + n * 3 + 2] = sh;
    });
  }
  function rebuild(i0 = 0, j0 = 0, i1 = N - 1, j1 = N - 1) {
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) writeCell(i, j);
    geo.attributes.position.needsUpdate = geo.attributes.uv.needsUpdate = geo.attributes.color.needsUpdate = true;
    geo.computeBoundingSphere(); geo.computeBoundingBox();
  }
  rebuild();

  /** Высота поверхности в точке (по треугольнику клетки, как видно глазу). */
  function heightAt(x, z) {
    const fx = (x + half) / cell, fz = (z + half) / cell;
    const i = Math.max(0, Math.min(N - 1, Math.floor(fx))), j = Math.max(0, Math.min(N - 1, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - i)), w = Math.max(0, Math.min(1, fz - j));
    const h00 = hAt(i, j), h10 = hAt(i + 1, j), h11 = hAt(i + 1, j + 1), h01 = hAt(i, j + 1);
    if (Math.abs(h00 - h11) <= Math.abs(h10 - h01)) return u > w ? h00 + (h10 - h00) * u + (h11 - h10) * w : h00 + (h11 - h01) * u + (h01 - h00) * w;
    return u + w < 1 ? h00 + (h10 - h00) * u + (h01 - h00) * w : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - w);
  }

  /** Кисть рельефа: mode = raise | lower | smooth | flatten | noise; target — высота для flatten. */
  function sculpt(x, z, radius, strength, mode, target = 0) {
    const ci = (x + half) / cell, cj = (z + half) / cell, rc = radius / cell;
    const i0 = Math.floor(ci - rc), i1 = Math.ceil(ci + rc), j0 = Math.floor(cj - rc), j1 = Math.ceil(cj + rc);
    const old = mode === 'smooth' ? H.slice() : null;
    for (let j = Math.max(0, j0); j <= Math.min(N, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N, i1); i++) {
      const d = Math.hypot(i - ci, j - cj) / rc;
      if (d >= 1) continue;
      const f = (1 - d * d) ** 2 * strength, k = j * V + i;
      if (mode === 'raise') H[k] += f * 0.5;
      else if (mode === 'lower') H[k] -= f * 0.5;
      else if (mode === 'flatten') H[k] += (target - H[k]) * Math.min(1, f);
      else if (mode === 'noise') H[k] += (hash(i * 7 + (Date.now() & 255), j) - 0.5) * f * 0.8;
      else if (mode === 'smooth') {
        let a = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii <= N && jj <= N) { a += old[jj * V + ii]; n++; } }
        H[k] += (a / n - H[k]) * Math.min(1, f * 2);
      }
    }
    rebuild(i0 - 1, j0 - 1, i1, j1);
  }
  /** Покраска плиткой: радиус в метрах. */
  function paint(x, z, radius, tile) {
    const ci = (x + half) / cell - 0.5, cj = (z + half) / cell - 0.5, rc = Math.max(0.5, radius / cell);
    const i0 = Math.floor(ci - rc), i1 = Math.ceil(ci + rc), j0 = Math.floor(cj - rc), j1 = Math.ceil(cj + rc);
    let changed = false;
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) {
      if (Math.hypot(i - ci, j - cj) > rc) continue;
      if (T[j * N + i] !== tile) { T[j * N + i] = tile; changed = true; }
    }
    if (changed) rebuild(i0, j0, i1, j1);
    return changed;
  }
  function fill(tile) { T.fill(tile); rebuild(); }
  function snapshot() { return { H: H.slice(), T: T.slice() }; }
  function restore(s) { H.set(s.H); T.set(s.T); rebuild(); }
  function serialize() {
    // высоты — в сантиметрах (Int16), всё в base64 — компактно для JSON/IndexedDB
    const h16 = new Int16Array(V * V); for (let k = 0; k < H.length; k++) h16[k] = Math.round(H[k] * 100);
    return { size: N, cell, h: b64(new Uint8Array(h16.buffer)), t: b64(T) };
  }
  return { mesh, size: N, cell, half, heightAt, sculpt, paint, fill, snapshot, restore, serialize, H, T, rebuild, dispose: () => { geo.dispose(); mat.dispose(); } };
}

export function terrainFromData(d) {
  if (!d) return createTerrain();
  const V = d.size + 1;
  const h16 = new Int16Array(unb64(d.h).buffer), H = new Float32Array(V * V);
  for (let k = 0; k < H.length; k++) H[k] = h16[k] / 100;
  return createTerrain({ size: d.size, cell: d.cell, heights: H, tiles: unb64(d.t) });
}

function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

/* ---------- вода: прозрачная плоскость с «бегущей» пиксельной текстурой ---------- */
export function createWater(sizeM) {
  const tex = makeTexture({ preset: 'marble', c1: '#2a4a5e', c2: '#6a9ab0', res: 32, rep: Math.max(1, Math.round(sizeM / 4)), seed: 3 });
  const m = lambert({ map: tex, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sizeM, sizeM, 1, 1).rotateX(-Math.PI / 2), m);
  mesh.name = 'Вода'; mesh.userData.water = true; mesh.userData.noConvert = true; mesh.renderOrder = 2;
  mesh.userData.tick = (t) => { tex.offset.set((t * 0.02) % 1, (t * 0.013) % 1); };
  return mesh;
}
