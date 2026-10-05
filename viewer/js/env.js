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


/* ---------- тёмное фэнтези: балкон над средневековым городом ---------- */
function stoneTex() {
  return canvasTex(32, 32, (g, w, h) => {
    noiseFill(g, w, h, '#4a4640', ['#3a3630', '#5a564e', '#2e2a26', '#625c52'], 1.2, 31);
    for (let y = 0; y < h; y += 8) {
      px(g, '#24201c', 0, y, w, 1);
      const o = (y / 8) % 2 ? 0 : 8;
      for (let x = o; x < w; x += 16) px(g, '#24201c', x, y, 1, 8);
    }
  }, { repeat: true });
}
function plankTex() {
  return canvasTex(32, 32, (g, w, h) => {
    noiseFill(g, w, h, '#5a4430', ['#4a3624', '#6a523a', '#3a2a1c', '#725a40'], 1.4, 41);
    for (let x = 0; x < w; x += 8) px(g, '#1e150e', x, 0, 1, h);
    const r = rng(9);
    for (let i = 0; i < 6; i++) px(g, '#2a1e14', (r() * w) | 0, (r() * h) | 0, 1, 3 + ((r() * 4) | 0));
  }, { repeat: true });
}
function warmWindows() {
  return canvasTex(32, 64, (g, w, h) => {
    const r = rng(15);
    noiseFill(g, w, h, '#24221f', ['#1a1816', '#2e2b27'], 0.8, 16);
    for (let y = 3; y < h - 4; y += 10) for (let x = 3; x < w - 3; x += 8) {
      if (r() < 0.22) { px(g, r() < 0.5 ? '#ffb850' : '#ffd890', x, y, 3, 5); px(g, '#5a3a18', x + 1, y, 1, 5); }
      else px(g, '#121110', x, y, 3, 5);
    }
  }, { repeat: true });
}

function medieval(env, group, updaters) {
  env.bg = 0x1c2027; env.fog = 0x2b3038; env.fogDensity = 0.05;
  env.lights = { amb: 0x8a92a4, ambI: 1.7, dir: 0xa8b8d0, dirI: 1.0, p1: 0xff9a3a, p2: 0x50ff8a };
  env.maxDist = 6;
  env.lightPos = { p1: [-1.15, 2.35, 0.9], p2: [0.9, 0.95, -1.4] };

  const stone = lambert({ map: stoneTex() });
  const planks = lambert({ map: plankTex() });
  const wood = lambert({ map: plankTex(), color: 0x9a8a78 });
  const iron = lambert({ color: 0x2a2826 });

  // пол балкона
  const floor = new THREE.Mesh(tiledBox(3.4, 0.16, 6, 0.9), planks);
  floor.position.set(-0.2, -0.08, 0); group.add(floor);
  // каменная стена башни справа
  const wall = new THREE.Mesh(tiledBox(1.2, 10, 7, 1.2), stone);
  wall.position.set(2.1, 3.5, 0); group.add(wall);
  // вымпел/гобелен на стене
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), basic({
    map: canvasTex(16, 32, (g, w, h) => {
      noiseFill(g, w, h, '#3a1a18', ['#2a1210', '#4a2220'], 1, 5);
      g.strokeStyle = '#8a6a3a'; g.strokeRect(1.5, 1.5, w - 3, h - 3);
      px(g, '#8a6a3a', 7, 8, 2, 14); px(g, '#8a6a3a', 4, 12, 8, 2); px(g, '#b08a4a', 6, 22, 4, 2);
    }), color: 0x9a9a9a }));
  banner.position.set(1.49, 2.3, -1.6); banner.rotation.y = -Math.PI / 2; group.add(banner);

  // перила по левой стороне и по торцам
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / 0.55));
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = new THREE.Mesh(tiledBox(0.08, 0.95, 0.08, 0.5), wood);
      p.position.set(x0 + (x1 - x0) * t, 0.47, z0 + (z1 - z0) * t); group.add(p);
    }
    const top = new THREE.Mesh(tiledBox(Math.abs(x1 - x0) + 0.12, 0.08, Math.abs(z1 - z0) + 0.12, 0.6), wood);
    top.position.set((x0 + x1) / 2, 0.95, (z0 + z1) / 2); group.add(top);
    const mid = top.clone(); mid.position.y = 0.5; group.add(mid);
  };
  rail(-1.85, -2.9, -1.85, 2.9);
  rail(-1.85, 2.9, 1.5, 2.9);
  rail(-1.85, -2.9, 1.5, -2.9);

  // висячий фонарь на балке
  const beam = new THREE.Mesh(tiledBox(2.9, 0.14, 0.14, 0.6), wood);
  beam.position.set(0.15, 2.9, 0.9); group.add(beam);
  const brace = new THREE.Mesh(tiledBox(0.1, 0.9, 0.1, 0.5), wood);
  brace.position.set(1.2, 2.55, 0.9); brace.rotation.z = -0.75; group.add(brace);
  const chain = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.02), iron);
  chain.position.set(-1.15, 2.68, 0.9); group.add(chain);
  const lantern = new THREE.Group();
  lantern.position.set(-1.15, 2.35, 0.9); group.add(lantern);
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.32, 6, 1, true), lambert({ color: 0x1a1816, wireframe: true }));
  const capTop = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.14, 6), iron); capTop.position.y = 0.22;
  const capBot = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 6), iron); capBot.position.y = -0.24; capBot.rotation.x = Math.PI;
  const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), basic({ color: 0xffc060 }));
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.075, 0.3, 6), basic({ color: 0xff9a3a, transparent: true, opacity: 0.35 }));
  lantern.add(cage, capTop, capBot, flame, glass);
  updaters.push((t) => {
    lantern.rotation.z = Math.sin(t * 0.9) * 0.05;
    flame.scale.setScalar(0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.07);
    if (env.light1) env.light1.intensity = 9 + Math.sin(t * 11) * 0.8 + Math.sin(t * 5.7) * 0.6;
  });

  // стол, книга, зелье
  const table = new THREE.Mesh(tiledBox(0.7, 0.06, 1.2, 0.6), wood);
  table.position.set(0.95, 0.72, -1.4); group.add(table);
  [[0.7, -0.9], [1.2, -0.9], [0.7, -1.9], [1.2, -1.9]].forEach(([x, z]) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.07), wood); l.position.set(x, 0.35, z); group.add(l);
  });
  const pageTex = canvasTex(32, 16, (g, w, h) => {
    noiseFill(g, w, h, '#b8a888', ['#a89878', '#c8b898'], 0.6, 3);
    for (let y = 3; y < h - 2; y += 2) { px(g, '#5a4a3a', 3, y, 11, 1); px(g, '#5a4a3a', 18, y, 11, 1); }
    px(g, '#6a5a48', 15, 0, 2, h);
  });
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.3), [iron, iron, lambert({ map: pageTex }), iron, iron, iron]);
  book.position.set(0.9, 0.765, -1.1); book.rotation.y = 0.3; group.add(book);
  const potion = new THREE.Group(); potion.position.set(0.95, 0.75, -1.55); group.add(potion);
  const flask = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 6), basic({ color: 0x50ff8a }));
  flask.position.y = 0.1;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 6), basic({ color: 0x8adfa0 })); neck.position.y = 0.24;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.04, 6), wood); cork.position.y = 0.3;
  potion.add(flask, neck, cork);
  updaters.push((t) => { flask.material.color.setHSL(0.38, 1, 0.55 + Math.sin(t * 2) * 0.08); });

  // полка с бутылками у стены
  const shelf = new THREE.Mesh(tiledBox(0.35, 0.05, 1.4, 0.6), wood); shelf.position.set(1.33, 1.5, 1.6); group.add(shelf);
  const shelf2 = shelf.clone(); shelf2.position.y = 1.05; group.add(shelf2);
  const glassCols = [0x3a6a4a, 0x6a5a3a, 0x3a4a6a, 0x5a7a5a, 0x4a3a2a];
  for (let i = 0; i < 9; i++) {
    const h = 0.14 + R() * 0.14;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035 + R() * 0.02, 0.05, h, 6), lambert({ color: pick(glassCols) }));
    b.position.set(1.3 + (R() - 0.5) * 0.12, (i % 2 ? 1.08 : 1.53) + h / 2, 1.0 + (i / 9) * 1.25); group.add(b);
  }
  const crate = new THREE.Mesh(tiledBox(0.6, 0.6, 0.6, 0.6), wood); crate.position.set(1.15, 0.3, 2.3); crate.rotation.y = 0.2; group.add(crate);
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.42, 6), lambert({ color: 0x6a5a48 })); jug.position.set(-1.45, 0.21, 2.4); group.add(jug);

  // город внизу: дома с крышами, шпили, башни
  const winT = warmWindows();
  const roofMat = lambert({ color: 0x2a2624 });
  for (let i = 0; i < 70; i++) {
    const a = Math.PI * 0.35 + R() * Math.PI * 1.3, r = 9 + R() * 34;
    const w = 2 + R() * 3, d = 2 + R() * 3, h = 6 + R() * 10;
    const base = -14 + R() * 3;
    const house = new THREE.Mesh(tiledBox(w, h, d, 2.5), basic({ map: winT, color: 0xa8a8a8 }));
    house.position.set(Math.cos(a) * r, base + h / 2, Math.sin(a) * r); house.rotation.y = R() * Math.PI;
    group.add(house);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 1.5 + R() * 2.5, 4), roofMat);
    roof.position.set(house.position.x, base + h + 1, house.position.z); roof.rotation.y = house.rotation.y + Math.PI / 4;
    group.add(roof);
  }
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 0.4 + R() * Math.PI * 1.2, r = 12 + R() * 26;
    const tr = 1 + R() * 1.2, th = 14 + R() * 18, base = -14;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr * 1.08, th, 8), basic({ map: winT, color: 0x9a9a9a }));
    tower.position.set(Math.cos(a) * r, base + th / 2, Math.sin(a) * r); group.add(tower);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(tr * 1.3, 3 + R() * 5, 8), roofMat);
    spire.position.set(tower.position.x, base + th + 2.5, tower.position.z); group.add(spire);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), iron);
    cross.position.set(spire.position.x, spire.position.y + 2.8, spire.position.z); group.add(cross);
  }
  // рваные облака
  const cloudTex = canvasTex(64, 32, (g, w, h) => {
    const r = rng(21);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(${90 + (r() * 40) | 0},${95 + (r() * 40) | 0},${110 + (r() * 30) | 0},${(0.15 + r() * 0.25).toFixed(2)})`;
      const x = r() * w, y = h / 2 + (r() - 0.5) * h * 0.6;
      g.fillRect(x | 0, y | 0, 4 + ((r() * 10) | 0), 2 + ((r() * 4) | 0));
    }
  });
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false }));
    const a = R() * Math.PI * 2;
    c.position.set(Math.cos(a) * 60, 14 + R() * 10, Math.sin(a) * 60); c.lookAt(0, c.position.y, 0);
    group.add(c);
    updaters.push((t) => { c.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.0004); c.lookAt(0, c.position.y, 0); });
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

  if (kind === 'medieval') {
    sky('#101318', '#2c323c', '#4a4e54');
    medieval(env, group, updaters);
  } else if (kind === 'roof') {
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
