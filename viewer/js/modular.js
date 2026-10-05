import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/*
 * Модульные персонажи Quaternius (CC0), подготовленные tools/build_quaternius.py и tools/build_women.py:
 *  - «Мужчина» / «Женщина»: Universal Base Characters + наряды Fantasy (крестьянин, рейнджер) + причёски,
 *    анимации — Universal Animation Library 1 + 2 (86 шт.), общий скелет UE-стиля (pelvis, spine_01…);
 *  - «Героини»: Ultimate Modular Women — 10 нарядов × (голова, торс, ноги, обувь), 24 своих анимации.
 * Интерфейс как у look.js: { schema, pal, defaults, random(), apply(cfg), cfg, update(t), loadClips() }.
 */

const Q = './models/q/';
const loader = new GLTFLoader();
const cache = {};
const load = (url, v) => (cache[url] ??= loader.loadAsync(url + (v ? '?t=' + v : '')));
const pick = (a) => a[(Math.random() * a.length) | 0];
const chance = (p) => Math.random() < p;
const rnd = (a, b) => +(a + Math.random() * (b - a)).toFixed(2);

export const CLIP_RU = {
  // Universal Animation Library 1
  A_TPose: 'T-поза', Crouch_Fwd_Loop: 'Крадётся', Crouch_Idle_Loop: 'Присел', Dance_Loop: 'Танец', Death01: 'Падает',
  Driving_Loop: 'Ведёт', Fixing_Kneeling: 'Чинит на коленях', Hit_Chest: 'Удар в грудь', Hit_Head: 'Удар в голову',
  Idle_Loop: 'Стоит', Idle_Talking_Loop: 'Разговаривает', Idle_Torch_Loop: 'Стоит с факелом', Interact: 'Взаимодействие',
  Jog_Fwd_Loop: 'Трусцой', Jump_Land: 'Приземление', Jump_Loop: 'В прыжке', Jump_Start: 'Прыжок', PickUp_Table: 'Берёт со стола',
  Pistol_Aim_Down: 'Пистолет: целится вниз', Pistol_Aim_Neutral: 'Пистолет: целится', Pistol_Aim_Up: 'Пистолет: целится вверх',
  Pistol_Idle_Loop: 'Пистолет: стойка', Pistol_Reload: 'Пистолет: перезарядка', Pistol_Shoot: 'Пистолет: выстрел',
  Punch_Cross: 'Кросс', Punch_Jab: 'Джеб', Push_Loop: 'Толкает', Roll: 'Кувырок', Sitting_Enter: 'Садится', Sitting_Exit: 'Встаёт',
  Sitting_Idle_Loop: 'Сидит', Sitting_Talking_Loop: 'Сидит и говорит', Spell_Simple_Enter: 'Заклинание: начало',
  Spell_Simple_Exit: 'Заклинание: конец', Spell_Simple_Idle_Loop: 'Заклинание: держит', Spell_Simple_Shoot: 'Заклинание: удар',
  Sprint_Loop: 'Бег', Swim_Fwd_Loop: 'Плывёт', Swim_Idle_Loop: 'На воде', Sword_Attack: 'Меч: удар', Sword_Idle: 'Меч: стойка',
  Walk_Formal_Loop: 'Идёт важно', Walk_Loop: 'Ходьба',
  // Universal Animation Library 2
  Chest_Open: 'Открывает сундук', ClimbUp_1m: 'Залезает', Consume: 'Пьёт зелье', Farm_Harvest: 'Собирает урожай',
  Farm_PlantSeed: 'Сажает', Farm_Watering: 'Поливает', Hit_Knockback: 'Отброшен ударом', Idle_FoldArms_Loop: 'Руки скрестил',
  Idle_Lantern_Loop: 'С фонарём', Idle_No_Loop: 'Нет-нет', Idle_Rail_Call: 'Зовёт с перил', Idle_Rail_Loop: 'Облокотился на перила',
  Idle_Shield_Break: 'Щит пробит', Idle_Shield_Loop: 'Щит: стойка', Idle_TalkingPhone_Loop: 'Говорит по телефону',
  LayToIdle: 'Встаёт с земли', Melee_Hook: 'Хук', Melee_Hook_Rec: 'Хук (возврат)', NinjaJump_Idle_Loop: 'Ниндзя-прыжок: полёт',
  NinjaJump_Land: 'Ниндзя-прыжок: приземление', NinjaJump_Start: 'Ниндзя-прыжок', OverhandThrow: 'Бросок', Shield_Dash: 'Рывок со щитом',
  Shield_OneShot: 'Удар щитом', Slide_Exit: 'Подкат: конец', Slide_Loop: 'Подкат', Slide_Start: 'Подкат: начало',
  Sword_Block: 'Меч: блок', Sword_Dash: 'Меч: выпад', Sword_Heavy_Combo: 'Меч: тяжёлое комбо', Sword_Regular_A: 'Меч: удар A',
  Sword_Regular_A_Rec: 'Меч: возврат A', Sword_Regular_B: 'Меч: удар B', Sword_Regular_B_Rec: 'Меч: возврат B',
  Sword_Regular_C: 'Меч: удар C', Sword_Regular_Combo: 'Меч: комбо', TreeChopping_Loop: 'Рубит дерево', Walk_Carry_Loop: 'Несёт груз',
  Yes: 'Да-да', Zombie_Idle_Loop: 'Зомби: стоит', Zombie_Scratch: 'Зомби: царапает', Zombie_Walk_Fwd_Loop: 'Зомби: идёт',
  // Ultimate Modular Women
  Death: 'Падает', Gun_Shoot: 'Выстрел', HitRecieve: 'Получает удар', HitRecieve_2: 'Получает удар 2', Idle: 'Стоит',
  Idle_Gun: 'С пистолетом', Idle_Gun_Pointing: 'Целится', Idle_Gun_Shoot: 'Стреляет', Idle_Neutral: 'Стоит спокойно',
  Idle_Sword: 'С мечом', Kick_Left: 'Пинок левой', Kick_Right: 'Пинок правой', Punch_Left: 'Удар левой', Punch_Right: 'Удар правой',
  Run: 'Бег', Run_Back: 'Бег назад', Run_Left: 'Бег влево', Run_Right: 'Бег вправо', Run_Shoot: 'Бег со стрельбой',
  Sword_Slash: 'Удар мечом', Walk: 'Ходьба', Wave: 'Машет',
};
export const ONCE = /^(death|death01|hit_|jump_start|jump_land|sitting_enter|sitting_exit|laytoidle|chest_open|climbup|consume|pickup|ninjajump_start|ninjajump_land|slide_start|slide_exit|idle_shield_break)/i;

const PAL = {
  skin: ['#ffe3cc', '#f0c8a6', '#d9a57e', '#b88160', '#8c5a3e', '#5e3a26'],
  hair: ['#17120f', '#2e2018', '#5a3a22', '#8a5a2c', '#c08a48', '#e0c080', '#9a9690', '#ece8e0', '#8a2a18', '#3a3a5a'],
  tint: ['#ffffff', '#e8d8c0', '#c8b898', '#a8c0a0', '#a8b8d0', '#d0a8a0', '#b0a0c0', '#909090'],
};

/* ---------- общее ---------- */
function setColor(m, hex) {
  m.color?.set(hex);
  m.userData.psMat?.color.set(hex); // PS1-копия материала (см. convertMaterials в main.js)
}
function setMap(m, tex) {
  m.map = tex; m.needsUpdate = true;
  if (m.userData.psMat) { m.userData.psMat.map = tex; m.userData.psMat.needsUpdate = true; }
}
function proportions(bones, headKey = 'head') {
  let base = null;
  return (root, cfg) => {
    if (!base) base = root.scale.clone();
    root.scale.copy(base).multiplyScalar(cfg.height ?? 1);
    const b = cfg.build ?? 1;
    if (bones.spine) bones.spine.scale.set(b, 1, b);
    bones.kids.forEach((k) => k.scale.set(1 / b, 1, 1 / b));
    if (headKey) bones.head?.scale.setScalar(cfg[headKey] ?? 1);
  };
}
const bodyItems = [
  { k: 'height', label: 'Рост', type: 'range', min: 0.88, max: 1.12, step: 0.01 },
  { k: 'build', label: 'Телосложение', type: 'range', min: 0.82, max: 1.25, step: 0.01 },
  { k: 'head', label: 'Голова', type: 'range', min: 0.85, max: 1.2, step: 0.01 },
];

/* ---------- Universal: мужчина / женщина ---------- */
const SLOT_RE = [
  ['bracer', /_Arms_Bracer/], ['arms', /_Arms$/], ['belt', /_Body_Belt/], ['torso', /_Body$/],
  ['legs', /_Legs$/], ['feet', /_Feet/], ['hood', /_Head_Hood/], ['pauldron', /_Acc_Pauldron/],
];
const HAIRS = { none: 'Лысый', Hair_Buzzed: 'Ёжик', Hair_SimpleParted: 'С пробором', Hair_BuzzedFemale: 'Короткая', Hair_Long: 'Длинные', Hair_Buns: 'Пучки' };

export async function createUniversal(gender, { version = '' } = {}) {
  const gl = await load(`${Q}${gender}/base.glb`, version);
  const root = new THREE.Group();
  root.add(gl.scene);
  const skinned = [];
  gl.scene.traverse((o) => { if (o.isSkinnedMesh) { skinned.push(o); o.frustumCulled = false; } });
  const body = skinned.reduce((a, b) => (b.geometry.index.count > a.geometry.index.count ? b : a));
  const skel = body.skeleton;
  const B = Object.fromEntries(skel.bones.map((b) => [b.name, b]));

  // тело делим на зоны по доминирующей кости: под одеждой ненужные зоны прячем (меньше «пролезаний»)
  const zoneOf = (n) => {
    n = n.toLowerCase();
    if (/head|neck/.test(n)) return 'head';
    if (/spine|clavicle/.test(n)) return 'torso';
    if (/upperarm|lowerarm/.test(n)) return 'arms';
    if (/hand|index|middle|ring|pinky|thumb/.test(n)) return 'hands';
    if (/foot|ball/.test(n)) return 'feet';
    return 'legs';
  };
  const g = body.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, idx = g.index.array;
  const vz = new Array(g.attributes.position.count);
  for (let v = 0; v < vz.length; v++) {
    let best = 0;
    for (let j = 1; j < 4; j++) if (sw.getComponent(v, j) > sw.getComponent(v, best)) best = j;
    vz[v] = zoneOf(skel.bones[si.getComponent(v, best)].name);
  }
  const tris = {};
  for (let i = 0; i < idx.length; i += 3) {
    const a = vz[idx[i]], b = vz[idx[i + 1]], c = vz[idx[i + 2]];
    const z = a === b || a === c ? a : b === c ? b : a;
    (tris[z] ??= []).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  const zones = {};
  for (const [z, arr] of Object.entries(tris)) {
    const ng = new THREE.BufferGeometry();
    for (const [k, attr] of Object.entries(g.attributes)) ng.setAttribute(k, attr);
    ng.setIndex(arr);
    const m = new THREE.SkinnedMesh(ng, body.material);
    m.name = 'Body_' + z; m.frustumCulled = false;
    m.position.copy(body.position); m.quaternion.copy(body.quaternion); m.scale.copy(body.scale);
    body.parent.add(m);
    m.bind(skel, body.bindMatrix);
    zones[z] = m;
  }
  body.visible = false;

  const adopt = (mesh) => {
    mesh.bind(new THREE.Skeleton(mesh.skeleton.bones.map((b) => B[b.name] || b), mesh.skeleton.boneInverses), mesh.bindMatrix);
    mesh.frustumCulled = false;
    body.parent.add(mesh);
    return mesh;
  };
  const parts = {}; // outfit -> slot -> [mesh]
  async function outfit(name) {
    if (parts[name]) return parts[name];
    const o = await load(`${Q}${gender}/${name}.glb`, version);
    const slots = {};
    const meshes = [];
    o.scene.traverse((m) => { if (m.isSkinnedMesh) meshes.push(m); });
    for (const m of meshes) {
      const slot = SLOT_RE.find(([, re]) => re.test(m.name.replace(/_\d+$/, '').replace(/\.\d+$/, '')))?.[0];
      if (!slot) continue;
      (slots[slot] ??= []).push(adopt(m));
      m.visible = false;
    }
    return (parts[name] = slots);
  }
  const hairs = {};
  async function hair(name) {
    if (hairs[name]) return hairs[name];
    const h = await load(`${Q}hair/${name}.glb`, version);
    const ms = [];
    h.scene.traverse((m) => { if (m.isSkinnedMesh) ms.push(m); });
    ms.forEach(adopt);
    ms.forEach((m) => { m.visible = false; });
    return (hairs[name] = ms);
  }
  // расцветки нарядов
  const tl = new THREE.TextureLoader();
  const texCache = {};
  const variant = (o, n) => (texCache[o + n] ??= tl.loadAsync(`${Q}tex/${o}_${n}.png`).then((t) => {
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
  }));

  const female = gender === 'female';
  const defaults = {
    skin: female ? '#f0c8a6' : '#d9a57e', hairStyle: female ? 'Hair_Long' : 'Hair_SimpleParted', beard: female ? 'none' : 'Hair_Beard',
    hairColor: '#5a3a22', height: 1, build: 1, head: 1,
    torso: 'peasant', arms: 'peasant', legs: 'peasant', feet: 'peasant', hood: 'none', belt: 'none', pauldron: 'none', bracer: 'none',
    peasantVar: '1', rangerVar: '1', tint: '#ffffff',
  };
  const OUT = { none: 'Нет', peasant: 'Крестьянин', ranger: 'Рейнджер' };
  const schema = [
    { group: 'Внешность', items: [
      { k: 'skin', label: 'Кожа', type: 'color', pal: 'skin' },
      { k: 'hairStyle', label: 'Причёска', type: 'select', options: HAIRS },
      ...(female ? [] : [{ k: 'beard', label: 'Борода', type: 'select', options: { none: 'Нет', Hair_Beard: 'Есть' } }]),
      { k: 'hairColor', label: 'Цвет волос', type: 'color', pal: 'hair' },
      ...bodyItems,
    ] },
    { group: 'Одежда', items: [
      { k: 'torso', label: 'Торс', type: 'select', options: OUT },
      { k: 'arms', label: 'Рукава', type: 'select', options: OUT },
      { k: 'legs', label: 'Штаны', type: 'select', options: OUT },
      { k: 'feet', label: 'Обувь', type: 'select', options: OUT },
      { k: 'hood', label: 'Капюшон', type: 'select', options: { none: 'Нет', ranger: 'Рейнджер' } },
      { k: 'pauldron', label: 'Наплечник', type: 'select', options: { none: 'Нет', ranger: 'Рейнджер' } },
      { k: 'bracer', label: 'Наручи', type: 'select', options: { none: 'Нет', ranger: 'Рейнджер' } },
      { k: 'belt', label: 'Ремни', type: 'select', options: { none: 'Нет', ranger: 'Рейнджер' } },
      { k: 'peasantVar', label: 'Расцветка крестьянина', type: 'select', options: { 1: 'Бурая', 2: 'Тёмная' } },
      { k: 'rangerVar', label: 'Расцветка рейнджера', type: 'select', options: { 1: 'Зелёная', 2: 'Кожаная' } },
      { k: 'tint', label: 'Оттенок одежды', type: 'color', pal: 'tint' },
    ] },
  ];
  function random() {
    const style = pick(['peasant', 'ranger', 'mix']);
    const o = () => (style === 'mix' ? pick(['peasant', 'ranger']) : style);
    const ranger = style !== 'peasant';
    return {
      skin: pick(PAL.skin), hairColor: pick(PAL.hair),
      hairStyle: pick(female ? ['Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale', 'Hair_Long'] : ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Long', 'none']),
      beard: female ? 'none' : (chance(0.5) ? 'Hair_Beard' : 'none'),
      height: rnd(0.93, 1.07), build: rnd(0.9, 1.15), head: rnd(0.95, 1.06),
      torso: o(), arms: o(), legs: o(), feet: o(),
      hood: ranger && chance(0.5) ? 'ranger' : 'none', pauldron: ranger && chance(0.5) ? 'ranger' : 'none',
      bracer: ranger && chance(0.5) ? 'ranger' : 'none', belt: ranger && chance(0.6) ? 'ranger' : 'none',
      peasantVar: pick(['1', '2']), rangerVar: pick(['1', '2']), tint: chance(0.6) ? '#ffffff' : pick(PAL.tint),
    };
  }

  const mats = new Set();
  const scale = proportions({ spine: B.spine_03, head: B.Head, kids: ['neck_01', 'clavicle_l', 'clavicle_r'].map((n) => B[n]).filter(Boolean) });
  let cfg = { ...defaults }, token = 0;
  async function apply(c) {
    cfg = { ...defaults, ...c };
    const my = ++token;
    const need = new Set(['torso', 'arms', 'legs', 'feet', 'hood', 'belt', 'pauldron', 'bracer'].map((k) => cfg[k]).filter((v) => v !== 'none'));
    const loaded = Object.fromEntries(await Promise.all([...need].map(async (n) => [n, await outfit(n)])));
    const hairList = [cfg.hairStyle, cfg.beard].filter((h) => h && h !== 'none');
    const hm = Object.fromEntries(await Promise.all([...new Set([...hairList, ...Object.keys(hairs)])].map(async (h) => [h, await hair(h)])));
    const vt = { peasant: await variant('peasant', cfg.peasantVar), ranger: await variant('ranger', cfg.rangerVar) };
    if (my !== token) return cfg; // пока грузилось, пришёл новый выбор
    // одежда
    for (const [name, slots] of Object.entries(parts)) for (const [slot, ms] of Object.entries(slots)) ms.forEach((m) => { m.visible = cfg[slot] === name; });
    void loaded;
    // тело: прячем зоны, закрытые одеждой
    const covered = (s) => cfg[s] !== 'none' && parts[cfg[s]]?.[s];
    zones.torso && (zones.torso.visible = !covered('torso'));
    zones.arms && (zones.arms.visible = !covered('arms'));
    zones.hands && (zones.hands.visible = !(covered('arms') && cfg.arms === 'peasant' && !female));
    zones.legs && (zones.legs.visible = !covered('legs'));
    zones.feet && (zones.feet.visible = !covered('feet'));
    // волосы
    for (const [n, ms] of Object.entries(hm)) ms.forEach((m) => { m.visible = hairList.includes(n) && !(cfg.hood !== 'none' && n !== 'Hair_Beard'); });
    // цвета
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.userData.orig || o.material)) {
        mats.add(m);
        const n = m.name || '';
        if (/Superhero|Regular/.test(n)) setColor(m, cfg.skin);
        else if (/Hair/.test(n)) setColor(m, cfg.hairColor);
        else if (/Peasant/.test(n)) { setMap(m, vt.peasant); setColor(m, cfg.tint); }
        else if (/Ranger/.test(n)) { setMap(m, vt.ranger); setColor(m, cfg.tint); }
      }
    });
    return cfg;
  }

  async function loadClips() {
    const [a, b] = await Promise.all([load(`${Q}anims_ual1.glb`, version), load(`${Q}anims_ual2.glb`, version)]);
    const seen = new Set();
    return [...a.animations, ...b.animations].filter((c) => !seen.has(c.name) && seen.add(c.name));
  }

  return {
    root, name: female ? 'Женщина' : 'Мужчина', rig: 'ue', schema, pal: PAL, defaults, random, apply,
    get cfg() { return cfg; }, update: () => scale(root, cfg), loadClips, idle: /^Idle_Loop$/,
  };
}

/* ---------- Ultimate Modular Women ---------- */
const OUTFITS_W = { Adventurer: 'Искательница', Casual: 'Повседневный', Formal: 'Деловой', Medieval: 'Средневековый', Punk: 'Панк',
  SciFi: 'Sci-Fi', Soldier: 'Солдат', Suit: 'Костюм', Witch: 'Ведьма', Worker: 'Рабочая' };

export async function createWomen({ version = '' } = {}) {
  const gl = await load(`${Q}women.glb`, version);
  const root = new THREE.Group();
  root.add(gl.scene);
  const slots = { head: {}, body: {}, legs: {}, feet: {} };
  const items = {};
  gl.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const n = findNamed(o).name; // имя узла (у меша внутри — имя данных вроде Cube051)
    const m = n.match(/^(\w+?)_(Head|Body|Legs|Feet)/);
    if (m) {
      const outfit = m[1] === 'Formad' ? 'Formal' : m[1];
      (slots[m[2].toLowerCase()][outfit] ??= []).push(o);
    } else if (/Sword|Pistol/.test(n)) (items[/Sword/.test(n) ? 'sword' : 'pistol'] ??= []).push(o);
  });
  function findNamed(o) { let p = o; while (p && !/_(Head|Body|Legs|Feet)|Sword|Pistol/.test(p.name)) p = p.parent; return p || o; }
  let B = {};
  gl.scene.traverse((o) => { if (o.isBone) B[o.name] = o; });
  const scale = proportions({ spine: B.Chest, head: B.Head, kids: ['Neck', 'ShoulderL', 'ShoulderR'].map((n) => B[n]).filter(Boolean) }, null);

  const keys = Object.keys(OUTFITS_W);
  const defaults = { head: 'Medieval', body: 'Medieval', legs: 'Medieval', feet: 'Medieval', item: 'none', skin: '#f0c8a6', hairColor: '', height: 1, build: 1 };
  const schema = [
    { group: 'Наряд', items: [
      { k: 'head', label: 'Голова и причёска', type: 'select', options: OUTFITS_W },
      { k: 'body', label: 'Торс', type: 'select', options: OUTFITS_W },
      { k: 'legs', label: 'Ноги', type: 'select', options: OUTFITS_W },
      { k: 'feet', label: 'Обувь', type: 'select', options: OUTFITS_W },
      { k: 'item', label: 'В руке', type: 'select', options: { none: 'Ничего', sword: 'Меч', pistol: 'Пистолет' } },
    ] },
    { group: 'Внешность', items: [
      { k: 'skin', label: 'Кожа', type: 'color', pal: 'skin' },
      { k: 'hairColor', label: 'Цвет волос (пусто — как в наряде)', type: 'color', pal: 'hair' },
      { k: 'height', label: 'Рост', type: 'range', min: 0.88, max: 1.12, step: 0.01 },
      { k: 'build', label: 'Телосложение', type: 'range', min: 0.82, max: 1.25, step: 0.01 },
    ] },
  ];
  function random() {
    const full = chance(0.4) ? pick(keys) : null;
    const o = () => full || pick(keys);
    return { head: o(), body: o(), legs: o(), feet: o(), item: pick(['none', 'none', 'sword', 'pistol']), skin: pick(PAL.skin),
      hairColor: chance(0.5) ? '' : pick(PAL.hair), height: rnd(0.94, 1.06), build: rnd(0.92, 1.1) };
  }
  const origHair = new Map();
  let cfg = { ...defaults };
  function apply(c) {
    cfg = { ...defaults, ...c };
    for (const s of ['head', 'body', 'legs', 'feet']) for (const [o, ms] of Object.entries(slots[s])) ms.forEach((m) => { m.visible = o === cfg[s]; });
    for (const [k, ms] of Object.entries(items)) ms.forEach((m) => { m.visible = k === cfg.item; });
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.userData.orig || o.material)) {
        if (m.name === 'Skin') setColor(m, cfg.skin);
        else if (/^Hair/.test(m.name)) {
          if (!origHair.has(m)) origHair.set(m, '#' + m.color.getHexString());
          setColor(m, cfg.hairColor || origHair.get(m));
        }
      }
    });
    return cfg;
  }
  return {
    root, name: 'Героиня', rig: 'women', schema, pal: PAL, defaults, random, apply,
    get cfg() { return cfg; }, update: () => scale(root, cfg), loadClips: async () => gl.animations, idle: /^Idle$/,
  };
}
