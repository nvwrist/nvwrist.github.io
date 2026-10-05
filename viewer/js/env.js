import * as THREE from 'three';
import { lambert, basic } from './ps1.js';
import { canvasTex, noiseFill, px, rng } from './textures.js';

const R = rng(77);
const pick = (a) => a[(R() * a.length) | 0];

function windowTex() {
  return canvasTex(32, 64, (g, w, h) => {
    const r = rng(5);
    px(g, '#0a0a14', 0, 0, w, h);
    for (let y = 1; y < h; y += 4) for (let x = 1; x < w; x += 4) {
      const v = r();
      if (v < 0.38) px(g, v < 0.04 ? '#ff4fd8' : v < 0.1 ? '#7ad8ff' : v < 0.2 ? '#ffe9b0' : '#ffd27a', x, y, 3, 3);
      else px(g, '#14142a', x, y, 3, 3);
    }
  }, { repeat: true });
}

function signTex(text, color, bg = '#0b0614', w = 64, h = 32, font = 'bold 22px sans-serif') {
  return canvasTex(w, h, (g) => {
    px(g, bg, 0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 2; g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}

function tiledBox(w, h, d, scale = 1.6) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const f = (i / 4) | 0; // px nx py ny pz nz
    const hor = f < 2 ? d : w;
    uv.setXY(i, uv.getX(i) * (f === 2 || f === 3 ? 0.1 : hor / scale), uv.getY(i) * (f === 2 || f === 3 ? 0.1 : h / scale));
  }
  return g;
}

function skyTex(top, mid, bot) {
  return canvasTex(2, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bot);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

function rain(count, box, speed = 11) {
  const pos = new Float32Array(count * 6);
  const seeds = [];
  for (let i = 0; i < count; i++) seeds.push([(R() - 0.5) * box.x, R() * box.y, (R() - 0.5) * box.z]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.55 }));
  lines.frustumCulled = false;
  const upd = (t) => {
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      const y = box.y - ((t * speed + s[1]) % box.y);
      pos.set([s[0], y, s[2], s[0] - 0.02, y + 0.35, s[2]], i * 6);
    }
    geo.attributes.position.needsUpdate = true;
  };
  upd(0);
  return { obj: lines, upd };
}

function city(group, { count, rMin, rMax, base, hMin, hMax, tints }) {
  const wt = windowTex();
  for (let i = 0; i < count; i++) {
    const a = R() * Math.PI * 2, r = rMin + R() * (rMax - rMin);
    const w = 2 + R() * 4, d = 2 + R() * 4, h = hMin + R() * (hMax - hMin) * (0.4 + r / rMax);
    const m = new THREE.Mesh(tiledBox(w, h, d), basic({ map: wt, color: pick(tints) }));
    m.position.set(Math.cos(a) * r, base + h / 2, Math.sin(a) * r);
    m.rotation.y = R() * 0.5;
    group.add(m);
  }
}

/** Возвращает {group, update, bg, fog, fogDensity, maxDist, lights, floorY}. */
export function createEnv(kind) {
  const group = new THREE.Group();
  const updaters = [];
  const env = { group, kind, update: (t, dt) => updaters.forEach((u) => u(t, dt)), maxDist: 14 };

  const sky = (top, mid, bot) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(90, 12, 8),
      new THREE.MeshBasicMaterial({ map: skyTex(top, mid, bot), side: THREE.BackSide, fog: false, depthWrite: false }));
    s.renderOrder = -10;
    group.add(s);
    updaters.push(() => {});
    return s;
  };

  if (kind === 'roof') {
    env.bg = 0x1a0f33; env.fog = 0x2a1448; env.fogDensity = 0.022;
    env.lights = { amb: 0x6a5a9a, ambI: 3.0, dir: 0xd8dcff, dirI: 2.6, p1: 0xff3fb8, p2: 0x27d9ff };
    env.maxDist = 12;
    sky('#0b0720', '#3a1650', '#a8337a');

    const floor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 6, 8, 1, 8), lambert({
      map: canvasTex(16, 16, (g, w, h) => { noiseFill(g, w, h, '#4a4856', ['#3a3846', '#5c5a6a', '#2c2a36'], 0.9, 9); px(g, '#2c2a36', 0, 0, 16, 1); px(g, '#2c2a36', 0, 0, 1, 16); }, { repeat: true }),
    }));
    floor.material.map.repeat.set(6, 6);
    floor.position.y = -0.2;
    group.add(floor);
    const wallMat = lambert({ color: 0x55526a });
    [[0, -3, 6.4, 0.5], [0, 3, 6.4, 0.5]].forEach(([x, z, w]) => {
      const m = new THREE.Mesh(box3(w, 0.55, 0.3), wallMat); m.position.set(x, 0.27, z); group.add(m);
    });
    [[-3, 0], [3, 0]].forEach(([x, z]) => {
      const m = new THREE.Mesh(box3(0.3, 0.55, 6.4), wallMat); m.position.set(x, 0.27, z); group.add(m);
    });
    const ac = new THREE.Mesh(box3(1.2, 0.8, 0.9), lambert({ color: 0x6a6878 })); ac.position.set(-2, 0.4, -2); group.add(ac);
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 6), lambert({ color: 0x4a4858 })); vent.position.set(2.2, 0.25, -1.8); group.add(vent);
    const mast = new THREE.Mesh(box3(0.08, 3.2, 0.08), lambert({ color: 0x2a2a34 })); mast.position.set(2.4, 1.6, 2.2); group.add(mast);
    const blink = new THREE.Mesh(box3(0.16, 0.16, 0.16), basic({ color: 0xff2a3a })); blink.position.set(2.4, 3.25, 2.2); group.add(blink);
    updaters.push((t) => { blink.visible = Math.sin(t * 4) > 0; });

    // лужи
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.4 + R() * 0.6, 7), basic({ color: pick([0x2a2f6a, 0x3a2a6a, 0x1a3a5a]), transparent: true, opacity: 0.85 }));
      p.rotation.x = -Math.PI / 2; p.position.set((R() - 0.5) * 4.5, 0.012 + i * 0.001, (R() - 0.5) * 4.5);
      group.add(p);
    }
    city(group, { count: 90, rMin: 15, rMax: 42, base: -40, hMin: 25, hMax: 70, tints: [0xffffff, 0xc9b6ff, 0xffc0e8, 0xa8d8ff] });
    const signs = [['ЛАПША', '#ff4fd8'], ['НЕОН', '#27e6ff'], ['ネオン', '#ffe14a'], ['MODEM', '#7dff9a'], ['ОТЕЛЬ', '#ff6a3a']];
    signs.forEach(([txt, col], i) => {
      const a = (i / signs.length) * Math.PI * 2 + 0.5, r = 11 + R() * 5;
      const s = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), basic({ map: signTex(txt, col, '#0b0614', 64, 32, 'bold 20px sans-serif') }));
      s.position.set(Math.cos(a) * r, 3 + R() * 7, Math.sin(a) * r);
      s.lookAt(0, s.position.y, 0);
      group.add(s);
      updaters.push((t) => { s.visible = !(i % 2 && Math.sin(t * 9 + i) > 0.96); });
    });
    const rn = rain(260, { x: 16, y: 10, z: 16 });
    group.add(rn.obj); updaters.push(rn.upd);
  } else if (kind === 'alley') {
    env.bg = 0x12061c; env.fog = 0x1a0828; env.fogDensity = 0.05;
    env.lights = { amb: 0x5a4a7a, ambI: 1.8, dir: 0x9a8aff, dirI: 1.2, p1: 0xff2fa8, p2: 0x27e0ff };
    env.maxDist = 4.8;
    const wt = windowTex();
    const wall = (x) => {
      const m = new THREE.Mesh(tiledBox(1, 22, 40, 2.2), basic({ map: wt, color: 0xb8a8d8 }));
      m.position.set(x, 11, -6); group.add(m);
    };
    wall(-5.5); wall(5.5);
    const end = new THREE.Mesh(tiledBox(12, 22, 1, 2.2), basic({ map: wt, color: 0x9888b8 })); end.position.set(0, 11, -14); group.add(end);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 40), lambert({
      map: canvasTex(16, 16, (g, w, h) => noiseFill(g, w, h, '#2a2634', ['#1a1624', '#3a3646', '#00000040'], 0.9, 12), { repeat: true }),
    }));
    floor.material.map.repeat.set(10, 30);
    floor.rotation.x = -Math.PI / 2; floor.position.z = -6; group.add(floor);
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.5 + R() * 0.8, 7), basic({ color: pick([0xff2fa8, 0x27a0e0, 0x4a2a8a]), transparent: true, opacity: 0.35 }));
      p.rotation.x = -Math.PI / 2; p.position.set((R() - 0.5) * 6, 0.01 + i * 0.001, -R() * 10 + 2); group.add(p);
    }
    const sg = [['ЛАПША', '#ff4fd8', -4.95, 3.2, -1, 1], ['MODEM', '#27e6ff', 4.95, 2.6, -3, -1], ['ОТЕЛЬ', '#ffe14a', -4.95, 4.4, -6, 1],
      ['2U', '#ff6a3a', 4.95, 3.8, -7, -1], ['ネオン', '#7dff9a', -4.95, 2.4, -9, 1], ['ТАТУ', '#c58bff', 4.95, 4.8, -10, -1]];
    sg.forEach(([txt, col, x, y, z, d], i) => {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), basic({ map: signTex(txt, col) }));
      s.position.set(x, y, z); s.rotation.y = d * Math.PI / 2; group.add(s);
      updaters.push((t) => { s.visible = !(i % 3 === 1 && Math.sin(t * 11 + i) > 0.95); });
    });
    const rn = rain(160, { x: 9, y: 9, z: 12 });
    group.add(rn.obj); updaters.push(rn.upd);
  } else {
    env.bg = 0x14142a; env.fog = 0x14142a; env.fogDensity = 0.008;
    env.lights = { amb: 0x8888aa, ambI: 1.6, dir: 0xffffff, dirI: 1.4, p1: 0xff3fb8, p2: 0x27d9ff };
    env.maxDist = 20;
    const grid = new THREE.GridHelper(20, 40, 0xff3fb8, 0x3a3a6a);
    grid.position.y = 0.002; group.add(grid);
    const f = new THREE.Mesh(new THREE.CircleGeometry(10, 16), basic({ color: 0x0d0d1e })); f.rotation.x = -Math.PI / 2; f.position.y = -0.004; group.add(f);
  }
  return env;
}

function box3(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
