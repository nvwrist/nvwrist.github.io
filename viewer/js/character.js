import * as THREE from 'three';
import { lambert, basic } from './ps1.js';
import { canvasTex, noiseFill, px, rng } from './textures.js';

/* ---------- геометрия ---------- */

/** Усечённый параллелепипед; верх в y=0, низ в y=-h (для рук/ног). */
function taper(wT, dT, wB, dB, h) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = 0.5 - p.getY(i); // 0 сверху → 1 снизу
    p.setXYZ(i, p.getX(i) * (wT + (wB - wT) * t), -t * h, p.getZ(i) * (dT + (dB - dT) * t));
  }
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/* ---------- текстуры ---------- */

function makeTextures() {
  const T = {};
  const SKIN = '#c98f6b';
  T.skin = canvasTex(16, 16, (g, w, h) => noiseFill(g, w, h, SKIN, ['#b57d5c', '#d9a07b', '#a86f50'], 0.6, 5));

  T.hair = canvasTex(32, 32, (g, w, h) => {
    const r = rng(11);
    px(g, '#14111b', 0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const c = r() < 0.2 ? '#3b2a5e' : r() < 0.15 ? '#7a3f9c' : '#0b0910';
      px(g, c, x, 0, 1, h);
      for (let y = 0; y < h; y += 4 + ((r() * 6) | 0)) px(g, '#2a2040', x, y, 1, 2);
    }
  });

  T.face = canvasTex(32, 32, (g, w, h) => {
    noiseFill(g, w, h, SKIN, ['#b57d5c', '#d9a07b'], 0.4, 8);
    // чёлка
    px(g, '#14111b', 0, 0, 32, 5);
    px(g, '#14111b', 0, 5, 5, 8); px(g, '#14111b', 27, 5, 5, 8);
    px(g, '#3b2a5e', 9, 0, 2, 4); px(g, '#7a3f9c', 21, 1, 2, 3);
    px(g, '#14111b', 12, 5, 6, 2); px(g, '#14111b', 20, 5, 4, 1);
    // брови
    px(g, '#241a1c', 6, 10, 7, 1); px(g, '#241a1c', 19, 10, 7, 1);
    // нос и тени
    px(g, '#a8694c', 15, 17, 2, 5); px(g, '#8f5740', 14, 22, 4, 1);
    // губы
    px(g, '#8c4a4a', 12, 25, 8, 2); px(g, '#6a3434', 12, 27, 8, 1);
    // щетина
    const r = rng(2);
    for (let i = 0; i < 70; i++) px(g, '#3a2a28aa', 5 + ((r() * 22) | 0), 22 + ((r() * 10) | 0));
    px(g, '#00000030', 0, 29, 32, 3);
  });

  T.glasses = canvasTex(32, 8, (g, w, h) => {
    px(g, '#07060c', 0, 0, w, h);
    px(g, '#0f0d1c', 1, 1, 14, 6); px(g, '#0f0d1c', 17, 1, 14, 6);
    for (let i = 0; i < 5; i++) { px(g, '#7d6bff', 3 + i, 5 - i); px(g, '#ff4fd8', 19 + i, 5 - i); }
    px(g, '#1d1a30', 15, 2, 2, 2);
  });

  const fabric = (seed, base = '#26262f') =>
    canvasTex(16, 16, (g, w, h) => noiseFill(g, w, h, base, ['#00000030', '#ffffff10', '#2a2a36'], 0.7, seed));
  T.fabric = fabric(21);
  T.pants = canvasTex(16, 16, (g, w, h) => {
    noiseFill(g, w, h, '#454560', ['#34344a', '#58587a', '#00000030'], 0.8, 23);
    px(g, '#1a1a22', 0, 0, 1, h); px(g, '#1a1a22', 15, 0, 1, h);
  });
  T.boots = canvasTex(16, 16, (g, w, h) => {
    noiseFill(g, w, h, '#5a463c', ['#3a2a22', '#7a5e50', '#00000030'], 0.8, 31);
    px(g, '#1a1210', 0, 12, 16, 4); px(g, '#c9a24a', 0, 8, 16, 1);
  });

  const tank = (front) => canvasTex(32, 32, (g, w, h) => {
    noiseFill(g, w, h, '#24242e', ['#00000040', '#ffffff10', '#383848'], 0.7, front ? 41 : 42);
    // вырез и проймы — кожа
    px(g, SKIN, 0, 0, 4, 32 * 0.45); px(g, SKIN, 28, 0, 4, 32 * 0.45);
    px(g, SKIN, 7, 0, 18, 3); px(g, SKIN, 9, 3, 14, 2); px(g, SKIN, 12, 5, 8, 1);
    if (front) { // красная эмблема
      const c = '#d8222e', d = '#7a0f18';
      px(g, c, 13, 11, 6, 2); px(g, c, 11, 13, 10, 2); px(g, c, 9, 15, 4, 2); px(g, c, 19, 15, 4, 2);
      px(g, c, 14, 15, 4, 5); px(g, c, 15, 20, 2, 3); px(g, d, 6, 13, 3, 2); px(g, d, 23, 13, 3, 2);
      px(g, d, 4, 15, 2, 2); px(g, d, 26, 15, 2, 2);
    } else {
      px(g, '#d8222e', 10, 14, 12, 1); px(g, '#d8222e', 12, 15, 8, 1); px(g, '#d8222e', 14, 16, 4, 1);
    }
  });
  T.tankF = tank(true);
  T.tankB = tank(false);

  T.cyber = canvasTex(16, 16, (g, w, h) => {
    px(g, '#d9dde8', 0, 0, w, h);
    px(g, '#aab0c4', 0, 5, w, 1); px(g, '#aab0c4', 0, 11, w, 1);
    px(g, '#aab0c4', 7, 0, 1, 5);
    px(g, '#27d9ff', 3, 2, 1, 3); px(g, '#27d9ff', 3, 7, 10, 1);
    px(g, '#ffffff', 1, 1, 3, 1);
    px(g, '#8890a8', 0, 15, w, 1);
  });
  T.metal = canvasTex(8, 8, (g, w, h) => noiseFill(g, w, h, '#30323c', ['#444656', '#202228'], 0.8, 51));
  T.glove = canvasTex(8, 8, (g, w, h) => { noiseFill(g, w, h, '#e6e8f2', ['#c4c8d8', '#fff'], 0.5, 52); px(g, '#8890a8', 0, 0, 8, 1); });
  return T;
}

/* ---------- персонаж ---------- */

export function createCharacter() {
  const T = makeTextures();
  const M = {
    skin: lambert({ map: T.skin }),
    hair: lambert({ map: T.hair }),
    face: lambert({ map: T.face }),
    glasses: lambert({ map: T.glasses }),
    fabric: lambert({ map: T.fabric }),
    tankF: lambert({ map: T.tankF }),
    tankB: lambert({ map: T.tankB }),
    pants: lambert({ map: T.pants }),
    boots: lambert({ map: T.boots }),
    cyber: lambert({ map: T.cyber }),
    metal: lambert({ map: T.metal }),
    glove: lambert({ map: T.glove }),
    gold: lambert({ color: 0xc9a24a }),
    glow: basic({ color: 0x27e6ff }),
    red: basic({ color: 0xff2a3a }),
  };

  const root = new THREE.Group();
  root.name = 'NeonRunner';
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const joint = (parent, x = 0, y = 0, z = 0) => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  };

  // таз
  const hips = joint(root, 0, 0.93, 0);
  add(hips, box(0.33, 0.15, 0.2), M.pants, 0, 0, 0);
  add(hips, box(0.34, 0.035, 0.21), M.fabric, 0, 0.085, 0); // ремень
  add(hips, box(0.05, 0.04, 0.012), M.gold, 0, 0.085, 0.108);
  add(hips, box(0.07, 0.1, 0.06), M.fabric, -0.19, -0.02, 0); // подсумок

  // корпус
  const chest = joint(hips, 0, 0.09, 0);
  const torsoMats = [M.fabric, M.fabric, M.skin, M.fabric, M.tankF, M.tankB];
  const torso = add(chest, taper(0.40, 0.23, 0.29, 0.19, 0.5), torsoMats, 0, 0.5, 0);
  torso.geometry.translate(0, 0, 0);

  // шея и голова
  add(chest, box(0.08, 0.08, 0.08), M.skin, 0, 0.52, 0);
  const head = joint(chest, 0, 0.55, 0);
  const headMats = [M.hair, M.hair, M.hair, M.skin, M.face, M.hair];
  add(head, box(0.22, 0.25, 0.24), headMats, 0, 0.125, 0);
  add(head, box(0.245, 0.07, 0.26), M.hair, 0, 0.255, -0.005);      // объём волос
  add(head, box(0.24, 0.055, 0.025), M.glasses, 0, 0.125, 0.128);   // очки
  add(head, box(0.012, 0.03, 0.2), M.fabric, 0.116, 0.135, 0);
  add(head, box(0.012, 0.03, 0.2), M.fabric, -0.116, 0.135, 0);
  add(head, box(0.02, 0.05, 0.05), M.glow, 0.13, 0.12, -0.02);      // имплант
  add(head, box(0.04, 0.2, 0.12), M.hair, 0.13, 0.08, -0.01);       // боковые пряди
  add(head, box(0.04, 0.2, 0.12), M.hair, -0.13, 0.08, -0.01);
  const hair = joint(head, 0, 0.2, -0.12);
  add(hair, taper(0.27, 0.07, 0.2, 0.09, 0.5), M.hair, 0, 0, -0.01);

  // руки
  const arm = (side) => {
    const s = side; // +1 = левая (киберпротез), -1 = правая
    const cyberArm = s > 0;
    const sh = joint(chest, s * 0.255, 0.44, 0);
    const upper = cyberArm ? M.cyber : M.skin;
    add(sh, box(0.12, 0.07, 0.12), cyberArm ? M.metal : M.skin, 0, 0.005, 0);
    add(sh, taper(0.1, 0.1, 0.085, 0.085, 0.27), upper, 0, 0, 0);
    const el = joint(sh, 0, -0.27, 0);
    add(el, cyberArm ? new THREE.CylinderGeometry(0.05, 0.05, 0.075, 6) : box(0.08, 0.06, 0.08),
      cyberArm ? M.metal : M.skin, 0, 0, 0).rotation.z = cyberArm ? Math.PI / 2 : 0;
    add(el, taper(0.085, 0.085, 0.07, 0.07, 0.25), cyberArm ? M.cyber : M.skin, 0, 0, 0);
    if (cyberArm) { add(el, box(0.012, 0.15, 0.012), M.glow, 0, -0.14, 0.045); add(sh, box(0.012, 0.15, 0.012), M.glow, 0, -0.14, 0.052); }
    const hand = joint(el, 0, -0.25, 0);
    add(hand, box(0.075, 0.09, 0.04), cyberArm ? M.glove : M.skin, 0, -0.045, 0);
    add(hand, box(0.025, 0.06, 0.03), cyberArm ? M.glove : M.skin, s * -0.045, -0.04, 0.012);
    return { sh, el };
  };
  const aL = arm(1), aR = arm(-1);

  // ноги
  const leg = (side) => {
    const s = side;
    const hp = joint(hips, s * 0.09, -0.04, 0);
    add(hp, taper(0.165, 0.17, 0.125, 0.125, 0.42), M.pants, 0, 0, 0);
    const kn = joint(hp, 0, -0.42, 0);
    add(kn, taper(0.125, 0.125, 0.105, 0.105, 0.4), M.pants, 0, 0, 0);
    if (s > 0) add(kn, box(0.09, 0.08, 0.04), M.metal, 0, 0.0, 0.07);
    const ankle = joint(kn, 0, -0.4, 0);
    add(ankle, taper(0.125, 0.125, 0.13, 0.13, 0.14), M.boots, 0, 0.05, 0);
    add(ankle, box(0.125, 0.085, 0.27), M.boots, 0, -0.04, 0.055);
    add(ankle, box(0.13, 0.025, 0.285), M.fabric, 0, -0.095, 0.055);
    return { hp, kn };
  };
  const lL = leg(1), lR = leg(-1);

  // блоб-тень (PS1 всегда так делали)
  const shadowTex = canvasTex(16, 16, (g, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 7.5;
      if (d < 1) px(g, `rgba(0,0,0,${(0.55 * (1 - d)).toFixed(2)})`, x, y);
    }
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
    basic({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.005;
  shadow.name = 'blob-shadow';

  /* ---------- позы и анимация ---------- */
  const J = { hips, chest, head, aL: aL.sh, eL: aL.el, aR: aR.sh, eR: aR.el, lL: lL.hp, kL: lL.kn, lR: lR.hp, kR: lR.kn, hair };
  const keys = Object.keys(J);
  const poses = {
    'Стоит': {
      aL: [0, 0, 0.1], eL: [-0.25, 0, 0], aR: [0, 0, -0.1], eR: [-0.25, 0, 0],
      lL: [0, 0, 0.04], lR: [0, 0, -0.04],
    },
    'Ходьба': 'walk',
    'Руки вверх': {
      aL: [0.2, 0, 2.7], eL: [-0.15, 0, 0], aR: [-0.1, 0, -2.75], eR: [-0.1, 0, 0],
      lL: [0, 0, 0.3], lR: [0, 0, -0.3], kL: [0.12, 0, 0], kR: [0.12, 0, 0], head: [-0.1, 0, 0],
    },
    'Прислонился': {
      hips: [0, 0, 0.08], chest: [0, 0, -0.1], head: [0, 0.35, -0.08],
      aL: [0, 0, 0.55], eL: [-1.9, 0, 0], aR: [0.1, 0, -0.1], eR: [-0.6, 0, 0],
      lL: [0, 0, -0.12], lR: [-0.15, -0.35, -0.2], kR: [0.4, 0, 0],
    },
    'Целится': {
      chest: [0, -0.35, 0], head: [0, 0.35, 0],
      aL: [-1.45, 0, 0.1], eL: [-0.1, 0, 0], aR: [-1.35, 0, -0.35], eR: [-0.9, 0, 0],
      lL: [-0.2, 0, 0.12], lR: [0.25, 0, -0.12], kL: [0.2, 0, 0], kR: [0.3, 0, 0],
    },
  };
  let current = 'Стоит';
  const target = {}, now = {};
  keys.forEach((k) => { target[k] = new THREE.Euler(); now[k] = new THREE.Euler(); });
  const setTargets = (pose) => keys.forEach((k) => {
    const v = (pose && pose[k]) || [0, 0, 0];
    target[k].set(v[0], v[1], v[2]);
  });
  setTargets(poses[current]);

  function setPose(name) { current = name; if (poses[name] !== 'walk') setTargets(poses[name]); }

  function update(t, dt) {
    const pose = poses[current];
    if (pose === 'walk') {
      const w = t * 4.2, s = Math.sin(w), c = Math.cos(w);
      setTargets(null);
      target.lL.x = s * 0.7; target.lR.x = -s * 0.7;
      target.kL.x = Math.max(0, -c) * 0.9 + 0.05; target.kR.x = Math.max(0, c) * 0.9 + 0.05;
      target.aL.x = -s * 0.55; target.aR.x = s * 0.55;
      target.aL.z = 0.08; target.aR.z = -0.08;
      target.eL.x = -0.45 - Math.max(0, s) * 0.3; target.eR.x = -0.45 - Math.max(0, -s) * 0.3;
      target.chest.y = s * 0.12; target.hips.y = -s * 0.1;
      hips.position.y = 0.93 - Math.abs(c) * 0.025;
    } else hips.position.y += (0.93 - hips.position.y) * Math.min(1, dt * 8);

    const k = Math.min(1, dt * 9);
    keys.forEach((n) => {
      now[n].x += (target[n].x - now[n].x) * k;
      now[n].y += (target[n].y - now[n].y) * k;
      now[n].z += (target[n].z - now[n].z) * k;
      J[n].rotation.set(now[n].x, now[n].y, now[n].z);
    });
    // дыхание и лёгкий покачивающийся хаер
    const br = Math.sin(t * 1.8) * 0.012;
    chest.rotation.x += br;
    head.rotation.x += -br * 0.6;
    hair.rotation.x = 0.1 + Math.sin(t * 2.2) * 0.05 + (pose === 'walk' ? Math.abs(Math.sin(t * 4.2)) * 0.12 : 0);
  }

  return { group: root, shadow, poses: Object.keys(poses), setPose, update };
}
