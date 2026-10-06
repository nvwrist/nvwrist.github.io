import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ps1, lambert, basic } from './ps1.js';
import { canvasTex, px } from './textures.js';
import { createEnv } from './env.js';
import { createLook, SCHEMA, PAL, DEFAULT, randomLook } from './look.js';
import { createAnimator } from './animator.js';
import { createEditor } from './editor.js';
import { createUniversal, createWomen, CLIP_RU as CLIP_RU_Q, ONCE as ONCE_Q } from './modular.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');

/* ---------- настройки ---------- */
const RES = [120, 160, 200, 240, 360, 480];
const S = { ps1: true, convert: true, res: 3, snap: 1, affine: 1, dither: 0.8, bits: 5, flat: true, wire: false, fog: 1, rotate: true, env: 'medieval', speed: 1 };

/* ---------- three ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 220);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxPolarAngle = Math.PI * 0.52;
controls.autoRotateSpeed = 1.6;
const HOME = { pos: new THREE.Vector3(1.7, 1.35, 3.6), target: new THREE.Vector3(0, 0.95, 0) };
function resetCamera() { camera.position.copy(HOME.pos); controls.target.copy(HOME.target); controls.update(); }
resetCamera();

const L = {
  amb: new THREE.AmbientLight(0xffffff, 1),
  dir: new THREE.DirectionalLight(0xffffff, 1),
  p1: new THREE.PointLight(0xff3fb8, 12, 0, 2),
  p2: new THREE.PointLight(0x27d9ff, 12, 0, 2),
};
L.dir.position.set(2, 4, 3);
L.p1.position.set(-2.4, 2.2, 1.8);
L.p2.position.set(2.6, 1.4, -2.2);
Object.values(L).forEach((l) => scene.add(l));

/* ---------- пост-обработка: низкое разрешение + дизеринг + глубина цвета ---------- */
let rt = null;
const post = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, uRes: ps1.uRes, uBits: { value: 5 }, uDither: { value: 0.8 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uBits; uniform float uDither;
    varying vec2 vUv;
    const float B[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
    void main(){
      vec3 c = pow(clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 1.0), vec3(1.0/2.2));
      ivec2 p = ivec2(vUv * uRes);
      float b = mix(0.5, (B[(p.y & 3) * 4 + (p.x & 3)] + 0.5) / 16.0, uDither);
      float lv = exp2(uBits) - 1.0;
      c = floor(c * lv + b) / lv;
      gl_FragColor = vec4(c, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const postScene = new THREE.Scene();
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const short = RES[S.res], a = w / h;
  const rw = a >= 1 ? Math.round(short * a) : short;
  const rh = a >= 1 ? short : Math.round(short / a);
  ps1.uRes.value.set(rw, rh);
  if (rt) rt.dispose();
  rt = new THREE.WebGLRenderTarget(rw, rh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  post.uniforms.tDiffuse.value = rt.texture;
}

function render() {
  if (S.ps1) {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  } else renderer.render(scene, camera);
}

/* ---------- окружение ---------- */
let env = null;
function disposeTree(o) {
  o.traverse((c) => {
    c.geometry?.dispose?.();
    [].concat(c.material || []).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
  });
}
function setEnv(kind) {
  if (env) { scene.remove(env.group); disposeTree(env.group); }
  S.env = kind;
  env = createEnv(kind);
  env.camera = camera;
  scene.add(env.group);
  scene.background = new THREE.Color(env.bg);
  const l = env.lights;
  L.amb.color.setHex(l.amb); L.amb.intensity = l.ambI;
  L.dir.color.setHex(l.dir); L.dir.intensity = l.dirI;
  L.p1.color.setHex(l.p1); L.p2.color.setHex(l.p2);
  const lp = env.lightPos || { p1: [-2.4, 2.2, 1.8], p2: [2.6, 1.4, -2.2] };
  L.p1.position.set(...lp.p1); L.p2.position.set(...lp.p2);
  L.p1.intensity = 12; L.p2.intensity = kind === 'medieval' ? 1.2 : 12;
  env.light1 = L.p1;
  controls.maxDistance = env.maxDist;
  applyFog();
}
function applyFog() {
  scene.fog = env.fogDensity * S.fog > 0 ? new THREE.FogExp2(env.fog, env.fogDensity * S.fog) : null;
}

/* ---------- модели ---------- */
const modelRoot = new THREE.Group();
scene.add(modelRoot);
// блоб-тень под моделью (как в играх PS1)
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), basic({
  map: canvasTex(16, 16, (g, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 7.5;
      if (d < 1) px(g, `rgba(0,0,0,${(0.55 * (1 - d)).toFixed(2)})`, x, y);
    }
  }), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.005;
scene.add(shadow);

let current = { obj: new THREE.Group(), kind: 'loaded', keep: true, name: '…', clips: [] };

/* ---------- персонажи: Странник (свой редактор) и модульные Quaternius ---------- */
const HERO_TYPES = { strannik: 'Странник', man: 'Мужчина', woman: 'Женщина', women: 'Героини (10 нарядов)' };
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* нет доступа */ } };
const lookKey = (type) => (type === 'strannik' ? 'ps1.look.v1' : 'ps1.look.' + type);
let heroType = HERO_TYPES[lsGet('ps1.hero')] ? lsGet('ps1.hero') : 'strannik';
const heroes = {};
let hero = null, look = null, animator = null;

function snapshotBones(root) {
  const m = new Map();
  root.traverse((o) => { if (o.isBone) m.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]); });
  return m;
}
function restoreBones(m) { m.forEach(([p, q, sc], o) => { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); }); }

/* ---------- служебные пометки в userData не должны попадать в .glb ---------- */
const RUNTIME_KEYS = ['orig', 'psMat', 'ps1src', 'ps1'];
function sanitize(root) { // чистим то, что могло приехать из старых экспортов
  const junk = [];
  root.traverse((o) => { if (o.userData.edHelper) junk.push(o); });
  junk.forEach((o) => o.parent?.remove(o));
  root.traverse((o) => {
    RUNTIME_KEYS.forEach((k) => delete o.userData[k]);
    for (const m of [].concat(o.material || [])) RUNTIME_KEYS.forEach((k) => delete m.userData[k]);
  });
}
function exportClean(root, opts) {
  const stash = [];
  root.traverse((o) => {
    if (o.userData.edHelper && o.visible) { stash.push([o, null]); o.visible = false; } // оверлеи Мастерской не экспортируем
    for (const t of [o, ...[].concat(o.material || [])]) {
      const saved = {};
      let any = false;
      RUNTIME_KEYS.forEach((k) => { if (k in t.userData) { saved[k] = t.userData[k]; delete t.userData[k]; any = true; } });
      if (any) stash.push([t, saved]);
    }
  });
  const restore = () => stash.forEach(([t, saved]) => { if (saved) Object.assign(t.userData, saved); else t.visible = true; });
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, (r) => { restore(); resolve(r); }, (e) => { restore(); reject(e); }, opts);
  });
}

/* ---------- свои модели (вернулись из three.js Editor) — хранятся в IndexedDB ---------- */
const idb = (() => {
  let p = null;
  const open = () => (p ??= new Promise((res, rej) => {
    const r = indexedDB.open('ps1-viewer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('models', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('models', mode); const q = fn(t.objectStore('models')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
  return { all: () => tx('readonly', (st) => st.getAll()), put: (r) => tx('readwrite', (st) => st.put(r)), del: (id) => tx('readwrite', (st) => st.delete(id)) };
})();
const customModels = {};
const CUSTOM_LOOK = { schema: [], pal: {}, defaults: {}, random: () => ({}), apply: async () => ({}), cfg: {}, update() {} };
function refreshHeroSelect() {
  $('heroType').innerHTML = Object.entries(HERO_TYPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  $('heroType').value = heroType;
}
async function loadCustomList() {
  try {
    for (const r of await idb.all()) { customModels[r.id] = r; HERO_TYPES['custom:' + r.id] = '✎ ' + r.name; }
  } catch (e) { console.warn('IndexedDB недоступна', e); }
  refreshHeroSelect();
}
async function saveCustomModel(buffer, name) {
  const id = Date.now().toString(36);
  const rec = { id, name: name.replace(/ \(правка\)$/, '') + ' (правка)', buffer, date: Date.now() };
  try { await idb.put(rec); } catch (e) { toast('Не удалось сохранить в браузере: ' + e.message); }
  customModels[id] = rec; HERO_TYPES['custom:' + id] = '✎ ' + rec.name;
  if (editor.active) editor.exit();
  await showHero('custom:' + id);
  refreshHeroSelect();
  toast('Модель из three.js Editor сохранена: «' + rec.name + '» (список «Персонаж»)');
}
async function deleteCustom(type) {
  const id = type.slice(7);
  if (!confirm('Удалить «' + customModels[id]?.name + '» из браузера?')) return;
  try { await idb.del(id); } catch { /* */ }
  delete customModels[id]; delete HERO_TYPES[type]; delete heroes[type];
  await showHero('strannik'); refreshHeroSelect();
}

async function makeHero(type) {
  const v = window.__v || Date.now();
  if (type.startsWith('custom:')) {
    const rec = customModels[type.slice(7)];
    const gltf = await new GLTFLoader().parseAsync(rec.buffer.slice(0), '');
    sanitize(gltf.scene);
    const holder = new THREE.Group();
    holder.add(gltf.scene);
    fitModel(holder);
    return { obj: holder, kind: 'loaded', keep: true, name: rec.name, type, rig: type, rest: snapshotBones(holder), idle: /idle|стоит/i,
      baseClips: gltf.animations, clips: gltf.animations, look: CUSTOM_LOOK };
  }
  if (type === 'strannik') {
    const gltf = await new GLTFLoader().loadAsync('./models/human.glb?t=' + v);
    const holder = new THREE.Group();
    holder.add(gltf.scene);
    fitModel(holder);
    const rest = snapshotBones(holder);
    const lk = await createLook(holder, { version: v, clips: gltf.animations });
    return {
      obj: holder, kind: 'loaded', keep: true, name: 'Странник', type, rig: '', rest, idle: /idle/i,
      baseClips: gltf.animations, clips: gltf.animations,
      look: { schema: SCHEMA, pal: PAL, defaults: DEFAULT, random: randomLook, apply: (c) => lk.apply(c), get cfg() { return lk.cfg; }, update: (t) => lk.update(t) },
    };
  }
  const m = type === 'women' ? await createWomen({ version: v }) : await createUniversal(type === 'man' ? 'male' : 'female', { version: v });
  await m.apply(lsGet(lookKey(type)) || m.defaults);
  fitModel(m.root);
  const entry = { obj: m.root, kind: 'loaded', keep: true, name: m.name, type, rig: m.rig, rest: snapshotBones(m.root), idle: m.idle, baseClips: [], clips: [], look: m };
  toast('Загрузка анимаций…');
  m.loadClips().then((clips) => {
    entry.baseClips = clips;
    entry.clips = [...clips, ...(entry === hero && animator ? animator.savedClips() : [])];
    if (current === entry && !animator?.active) fillPoseSelect();
    toast(`Анимаций: ${clips.length}`);
  }).catch((e) => toast('Анимации не загрузились: ' + (e.message || e)));
  return entry;
}

async function showHero(type = heroType) {
  heroType = type;
  lsSet('ps1.hero', type);
  $('heroType').value = type;
  if (!heroes[type]) {
    toast('Загрузка: ' + HERO_TYPES[type] + '…');
    try { heroes[type] = await makeHero(type); } catch (e) {
      console.warn(e);
      toast('Не удалось загрузить персонажа: ' + (e.message || e));
      return;
    }
  }
  if (heroType !== type) return; // пока грузилось, выбрали другого
  animator?.destroy();
  mixer?.stopAllAction();
  hero = heroes[type];
  look = hero.look;
  restoreBones(hero.rest); // аниматор запоминает «покой» — даём ему исходную позу
  await look.apply(lsGet(lookKey(type)) || look.defaults);
  editor.afterLook(hero.obj, heroType);
  setupAnimator(hero);
  showModel(hero);
  buildLookUI();
  refreshModelStyle();
}

function setupAnimator(h) {
  animator = createAnimator({
    root: h.obj, scene, camera, canvas, el: $('animator'), toast, rig: h.rig,
    onEnter: () => { mixer?.stopAllAction(); action = null; animator.prevRotate = controls.autoRotate; controls.autoRotate = false; $('pose').disabled = true; },
    onExit: () => { controls.autoRotate = animator.prevRotate ?? S.rotate; if (current === h) fillPoseSelect(); },
    onClipsChanged: (clips, play) => {
      h.clips = [...h.baseClips, ...clips];
      if (current !== h) return;
      fillPoseSelect();
      const i = play ? h.clips.findIndex((c) => c.name === play) : -1;
      if (i >= 0) { $('pose').value = String(i + 1); playClip(i); }
    },
  });
  h.clips = [...h.baseClips, ...animator.savedClips()];
}

function buildLookUI() {
  const root = $('editor');
  root.innerHTML = '';
  if (!look.schema.length) {
    root.innerHTML = `<p class="hint">Это твоя модель, сохранённая из three.js Editor. Её форму и цвета меняй в 🛠 Мастерской или снова в three.js Editor.</p>
      <button class="btn" id="btnDelCustom">Удалить эту модель</button>`;
    $('btnDelCustom').onclick = () => deleteCustom(heroType);
    return;
  }
  const set = async (k, v) => {
    const c = { ...look.cfg, [k]: v };
    lsSet(lookKey(heroType), c);
    await look.apply(c);
    editor.afterLook(hero.obj, heroType);
    refreshModelStyle();
  };
  for (const grp of look.schema) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h3>${grp.group}</h3>`;
    for (const it of grp.items) {
      const w = document.createElement('div');
      w.className = 'field';
      w.dataset.k = it.k;
      if (it.type === 'select') {
        w.innerHTML = `<span>${it.label}</span><select>${Object.entries(it.options).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
        w.querySelector('select').onchange = (e) => set(it.k, e.target.value);
      } else if (it.type === 'range') {
        w.innerHTML = `<span>${it.label}</span><b></b><input type="range" min="${it.min}" max="${it.max}" step="${it.step}">`;
        w.querySelector('input').oninput = (e) => { w.querySelector('b').textContent = Math.round(e.target.value * 100) + '%'; set(it.k, +e.target.value); };
      } else {
        w.innerHTML = `<span>${it.label}</span><div class="swatches">${look.pal[it.pal].map((c) => `<button style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}<input type="color"></div>`;
        w.querySelector('.swatches').onclick = async (e) => { const c = e.target.dataset?.c; if (c) { await set(it.k, c); syncLookUI(); } };
        w.querySelector('input').oninput = async (e) => { await set(it.k, e.target.value); syncLookUI(); };
      }
      sec.appendChild(w);
    }
    root.appendChild(sec);
  }
  syncLookUI();
}
function syncLookUI() {
  const c = look.cfg;
  document.querySelectorAll('#editor .field').forEach((w) => {
    const v = c[w.dataset.k];
    const sel = w.querySelector('select'), rng = w.querySelector('input[type=range]'), col = w.querySelector('input[type=color]');
    if (sel) sel.value = v;
    if (rng) { rng.value = v; w.querySelector('b').textContent = Math.round(v * 100) + '%'; }
    if (col) { col.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'; w.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === v)); }
  });
}
async function randomize() {
  if (!look) return;
  const c = look.random();
  lsSet(lookKey(heroType), c);
  await look.apply(c);
  editor.afterLook(hero.obj, heroType);
  syncLookUI(); refreshModelStyle();
}

const CLIP_RU = { ...CLIP_RU_Q, Idle: 'Стоит', Walk: 'Ходьба', Run: 'Бег', Jump: 'Прыжок', Punch: 'Удар', Working: 'Работает', Death: 'Падает',
  HandsUp: 'Руки вверх', Lean: 'Прислонился', Aim: 'Целится' };
const ONCE = ONCE_Q;
let mixer = null, action = null;

function eachMat(fn) {
  current.obj.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach(fn); });
}
function setNearest(tex, on) {
  if (!tex) return;
  tex.userData ??= {};
  tex.userData.o ??= { mag: tex.magFilter, min: tex.minFilter, gen: tex.generateMipmaps };
  tex.magFilter = on ? THREE.NearestFilter : tex.userData.o.mag;
  tex.minFilter = on ? THREE.NearestFilter : tex.userData.o.min;
  tex.generateMipmaps = on ? false : tex.userData.o.gen;
  tex.needsUpdate = true;
}
function convertMaterials(obj, on) {
  obj.traverse((o) => {
    if (!o.isMesh || o.userData.noConvert) return;
    o.userData.orig ??= o.material;
    const conv = (m) => {
      if (m.userData.ps1src) return m;
      if (!m.userData.psMat) {
        const n = lambert({
          color: m.color ? m.color.clone() : 0xcccccc, map: m.map || null, side: m.side,
          transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest,
          vertexColors: !!o.geometry.attributes.color,
          emissive: m.emissive ? m.emissive.clone() : 0x000000, emissiveMap: m.emissiveMap || null,
        });
        n.userData.ps1src = true;
        m.userData.psMat = n;
      }
      return m.userData.psMat;
    };
    const src = o.userData.orig;
    o.material = on ? (Array.isArray(src) ? src.map(conv) : conv(src)) : src;
    [].concat(src).forEach((m) => { setNearest(m.map, on); setNearest(m.emissiveMap, on); });
  });
}
function applyMaterialFlags() {
  eachMat((m) => {
    if ('flatShading' in m) m.flatShading = S.flat;
    m.wireframe = S.wire;
    m.needsUpdate = true;
  });
}
function refreshModelStyle() {
  if (current.kind === 'loaded') convertMaterials(current.obj, S.ps1 && S.convert);
  applyMaterialFlags();
}

function stats() {
  let tri = 0, vert = 0;
  current.obj.traverse((o) => {
    if (!o.isMesh || !o.visible || (o.parent && !o.parent.visible)) return;
    const g = o.geometry;
    vert += g.attributes.position.count;
    tri += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return { tri: Math.round(tri), vert };
}

function fitModel(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const size = b.getSize(new THREE.Vector3());
  const s = 1.9 / Math.max(size.x, size.y, size.z, 1e-6);
  obj.scale.multiplyScalar(s);
  obj.updateMatrixWorld(true);
  b.setFromObject(obj);
  const c = b.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b.min.y;
  const sz = b.getSize(new THREE.Vector3());
  obj.userData.shadow = Math.min(Math.max(sz.x, sz.z), sz.y * 0.5) * 1.4 / 0.9;
  obj.userData.targetY = sz.y * 0.52;
}

function fillPoseSelect() {
  const sel = $('pose');
  sel.innerHTML = '';
  const names = ['— без анимации —', ...current.clips.map((c, i) => c.userData?.custom ? '✎ ' + c.name : CLIP_RU[c.name] || `${i + 1}. ${c.name || 'clip'}`)];
  names.forEach((n, i) => sel.add(new Option(n, i)));
  sel.disabled = names.length < 2;
  if (current.kind === 'loaded' && current.clips.length) {
    const re = current.idle || /idle/i;
    const idle = Math.max(0, current.clips.findIndex((c) => re.test(c.name)), 0);
    sel.value = String(idle + 1); playClip(idle);
  }
}
function playClip(i) {
  const prev = action;
  action = i >= 0 && mixer ? mixer.clipAction(current.clips[i]) : null;
  if (action) {
    const once = ONCE.test(current.clips[i].name);
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.reset().play(); if (prev && prev !== action) action.crossFadeFrom(prev, 0.35, false); }
  else prev?.stop();
}

function showModel(entry) {
  modelRoot.clear();
  if (current.kind === 'loaded' && !current.keep && current !== entry) disposeTree(current.obj);
  current = entry;
  modelRoot.add(entry.obj);
  mixer = entry.kind === 'loaded' ? new THREE.AnimationMixer(entry.obj) : null;
  action = null;
  HOME.pos.set(1.7, 1.35, 3.6);
  HOME.target.set(0, entry.obj.userData.targetY ?? 0.95, 0);
  shadow.scale.setScalar(entry.obj.userData.shadow ?? 1);
  $('modelName').textContent = entry.name;
  fillPoseSelect();
  refreshModelStyle();
  resetCamera();
  const st = stats();
  toast(`${entry.name}: ${st.tri} треуг., ${st.vert} вершин`);
}

/* ---------- загрузка файлов ---------- */
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 2800);
}
const ext = (n) => n.split('.').pop().toLowerCase();

async function loadFiles(fileList) {
  const files = [...fileList];
  const main = files.find((f) => ext(f.name) === 'glb') || files.find((f) => ext(f.name) === 'gltf')
    || files.find((f) => ext(f.name) === 'obj') || files.find((f) => ext(f.name) === 'stl');
  if (!main) { toast('Нужен .glb, .gltf, .obj или .stl'); return; }
  const urls = {};
  files.forEach((f) => { urls[f.name] = URL.createObjectURL(f); });
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => urls[decodeURIComponent(u.split('/').pop().split('?')[0])] || u);
  const e = ext(main.name);
  try {
    toast('Загрузка…');
    let obj, clips = [];
    if (e === 'glb' || e === 'gltf') {
      const gltf = await new GLTFLoader(manager).loadAsync(urls[main.name]);
      obj = gltf.scene; clips = gltf.animations || [];
    } else if (e === 'obj') {
      obj = await new OBJLoader(manager).loadAsync(urls[main.name]);
    } else {
      const geo = await new STLLoader(manager).loadAsync(urls[main.name]);
      geo.computeVertexNormals();
      obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb9b3d6, roughness: 0.8 }));
    }
    sanitize(obj);
    obj.traverse((o) => { if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); });
    const holder = new THREE.Group();
    holder.add(obj);
    fitModel(holder);
    showModel({ obj: holder, kind: 'loaded', name: main.name, clips });
  } catch (err) {
    console.error(err);
    toast('Не удалось загрузить: ' + (err.message || err));
  }
}

/* ---------- UI ---------- */
function bind(id, key, fmt, cb) {
  const el = $(id);
  const read = () => {
    S[key] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
    const v = $('v' + id[0].toUpperCase() + id.slice(1));
    if (v) v.textContent = fmt ? fmt(S[key]) : S[key];
    cb?.();
  };
  el.addEventListener('input', read);
  read();
}
const applyStyle = () => {
  ps1.uSnap.value = S.ps1 ? S.snap : 0;
  ps1.uAffine.value = S.ps1 ? S.affine : 0;
  post.uniforms.uBits.value = S.bits;
  post.uniforms.uDither.value = S.dither;
  controls.autoRotate = S.rotate;
};
bind('ps1', 'ps1', null, () => { applyStyle(); refreshModelStyle(); });
bind('convert', 'convert', null, refreshModelStyle);
bind('res', 'res', (v) => RES[v], () => { if (rt) resize(); });
bind('snap', 'snap', (v) => (v ? v : 'выкл'), applyStyle);
bind('affine', 'affine', null, applyStyle);
bind('dither', 'dither', null, applyStyle);
bind('bits', 'bits', null, applyStyle);
bind('flat', 'flat', null, applyMaterialFlags);
bind('wire', 'wire', null, applyMaterialFlags);
bind('fog', 'fog', null, () => env && applyFog());
bind('rotate', 'rotate', null, applyStyle);
bind('animSpeed', 'speed');
$('env').addEventListener('change', (e) => setEnv(e.target.value));
$('btnRandom').onclick = randomize;
$('btnRandom2').onclick = randomize;
$('btnEditor').onclick = () => openEditor();
$('btnEditor2').onclick = () => openEditor();
$('btnLookReset').onclick = async () => { if (!look) return; lsSet(lookKey(heroType), look.defaults); await look.apply(look.defaults); editor.afterLook(hero.obj, heroType); syncLookUI(); refreshModelStyle(); };
document.querySelector('.tabs').onclick = (e) => {
  const t = e.target.dataset.tab;
  if (!t) return;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((d) => { d.hidden = d.dataset.tab !== t; });
  $('panel').classList.remove('closed');
};
$('pose').addEventListener('change', (e) => {
  playClip(+e.target.value - 1);
});
$('btnChar').onclick = () => { if (current !== hero) showHero(); else resetCamera(); };
refreshHeroSelect();
$('heroType').onchange = (e) => showHero(e.target.value);
$('file').addEventListener('change', (e) => { loadFiles(e.target.files); e.target.value = ''; });
$('btnReset').onclick = resetCamera;
$('toggle').onclick = () => $('panel').classList.toggle('closed');
if (window.innerWidth < 700) $('panel').classList.add('closed');

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$('btnShot').onclick = () => {
  render();
  canvas.toBlob((b) => b && download(b, 'ps1-shot.png'), 'image/png');
};
$('btnExport').onclick = () => {
  exportClean(current.obj, { binary: true, animations: current.clips || [] }).then((res) => {
    download(new Blob([res], { type: 'model/gltf-binary' }), (current === hero ? heroType.replace(':', '-') : 'model') + '.glb');
    toast('Экспортировано .glb');
  }, (e) => toast('Ошибка экспорта: ' + e.message));
};

// drag & drop
const drop = $('drop');
let dragN = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragN++; drop.classList.add('on'); });
addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; drop.classList.remove('on'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; drop.classList.remove('on'); if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });

/* ---------- Мастерская (ручной редактор модели) ---------- */
const editKey = () => (current === hero ? heroType : 'file:' + current.name);
let edState = null;
const editor = createEditor({
  scene, camera, renderer, controls, canvas, toast, getKey: editKey,
  exportGlb: () => exportClean(current.obj, { binary: true, animations: current.clips || [] }).then((buffer) => ({ buffer, name: current.name || 'Модель' })),
  onGlb: (msg) => saveCustomModel(msg.buffer, msg.name),
  onEnter: ({ pose, ps1: preview, start }) => {
    if (start) {
      animator?.active && animator.exit();
      edState = { ps1: S.ps1, rotate: controls.autoRotate, frame: snapshotBones(current.obj) };
    }
    if (pose === 'rest' && current.rest) restoreBones(current.rest);
    else if (pose === 'frame' && edState) restoreBones(edState.frame);
    if (preview !== undefined) { S.ps1 = preview; applyStyle(); refreshModelStyle(); }
  },
  onExit: () => {
    if (edState) { S.ps1 = edState.ps1; $('ps1').checked = S.ps1; applyStyle(); refreshModelStyle(); controls.autoRotate = S.rotate; }
    $('panel').classList.remove('closed');
  },
});
function openEditor() {
  if (!current?.obj) return;
  $('panel').classList.add('closed');
  editor.enter(current.obj, editKey());
}

/* ---------- запуск ---------- */
addEventListener('resize', resize);
setEnv(S.env);
resize();
applyStyle();
loadCustomList().finally(() => showHero(HERO_TYPES[lsGet('ps1.hero')] ? lsGet('ps1.hero') : heroType));

const clock = new THREE.Clock();
let fpsN = 0, fps = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1) * S.speed;
  const t = clock.elapsedTime;
  if (editor.active) { /* анимация на паузе, пока правим модель */ }
  else if (animator?.active && current === hero) animator.update(dt);
  else mixer?.update(dt);
  if (look && current === hero) look.update(t);
  env.update(t, dt);
  controls.update();
  render();
  fpsN++;
  const now = performance.now();
  if (now - (frame.last || now) > 500) {
    fps = Math.round((fpsN * 1000) / (now - frame.last));
    fpsN = 0; frame.last = now;
    const st = stats();
    $('stats').textContent = `${fps} fps · ${st.tri} tri · ${ps1.uRes.value.x}×${ps1.uRes.value.y}`;
  }
  frame.last ??= now;
  requestAnimationFrame(frame);
}
frame();
window.__ps1 = { S, scene, camera, renderer, controls, setEnv, get look() { return look; }, get animator() { return animator; }, randomize, editor };
