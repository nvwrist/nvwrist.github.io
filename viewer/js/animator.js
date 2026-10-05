import * as THREE from 'three';

/*
 * Ручной аниматор: выбираешь кость (списком или тапом по модели), крутишь X/Y/Z,
 * ставишь ключи на таймлайне, сохраняешь как новую анимацию (AnimationClip).
 * Свои анимации хранятся в localStorage и попадают в экспорт .glb.
 */

// русские подписи костей: Mixamo (Hips, LeftArm…), UE (pelvis, upperarm_l…), Quaternius-women (UpperArm.L…)
const PARTS = [
  [/^(hips|pelvis)$/i, 'Таз'], [/^(spine|spine_01|abdomen)$/i, 'Поясница'], [/^(spine1|spine_02|torso)$/i, 'Живот'],
  [/^(spine2|spine_03|chest)$/i, 'Грудь'], [/neck/i, 'Шея'], [/^head$/i, 'Голова'], [/shoulder|clavicle/i, 'Ключица'],
  [/upperarm|^(left|right)arm$/i, 'Плечо'], [/lowerarm|forearm/i, 'Предплечье'], [/hand$|^hand_|wrist/i, 'Кисть'],
  [/thigh|upleg|upperleg/i, 'Бедро'], [/calf|lowerleg|^(left|right)leg$/i, 'Голень'], [/foot/i, 'Стопа'], [/^ball_|toebase|toe$/i, 'Носок'],
];
function boneLabel(n) {
  if (/leaf|_end$|end$/i.test(n)) return null;
  const p = PARTS.find(([re]) => re.test(n));
  if (!p) return null;
  if (/^(hips|pelvis|spine\w*|abdomen|torso|chest|neck\w*|head)$/i.test(n)) return p[1];
  if (/^left|_l$|L$/.test(n) || /^left/i.test(n)) return p[1] + ' Л';
  if (/^right|_r$|R$/.test(n) || /^right/i.test(n)) return p[1] + ' П';
  return p[1];
}
let STORE = 'ps1.anims.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } };
const save = (a) => { try { localStorage.setItem(STORE, JSON.stringify(a)); } catch { /* приватный режим */ } };
const D = THREE.MathUtils.RAD2DEG, Rr = THREE.MathUtils.DEG2RAD;

export function createAnimator({ root, scene, camera, canvas, el, onClipsChanged, onEnter, onExit, toast, rig = '' }) {
  STORE = 'ps1.anims.v1' + (rig ? '.' + rig : ''); // анимации привязаны к скелету конкретного персонажа
  const seenB = new Set(), bones = [], NAMES = {};
  root.traverse((o) => {
    if (!o.isBone || seenB.has(o.name)) return;
    const l = boneLabel(o.name);
    if (!l) return;
    seenB.add(o.name); bones.push(o); NAMES[o.name] = l;
  });
  const hips = bones.find((b) => /^(hips|pelvis)$/i.test(b.name)) || bones[0];
  const rest = new Map(bones.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  const hipsScale = hips.position.length() || 1; // смещение таза — в долях его высоты

  let active = false, playing = false, t = 0, sel = bones.find((b) => NAMES[b.name] === 'Плечо П') || bones[0];
  let keys = []; // {t, q:{name:[x,y,z,w]}, hy}
  let editingIndex = -1; // индекс сохранённой анимации, которую правим
  const helper = new THREE.SkeletonHelper(root);
  helper.visible = false;
  helper.material.depthTest = false; helper.renderOrder = 998;
  scene.add(helper);
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color: 0xffb040, depthTest: false }));
  marker.renderOrder = 999; marker.visible = false;
  scene.add(marker);

  /* ---------- UI ---------- */
  el.innerHTML = `
    <div class="row"><button class="btn primary" data-a="enter">✎ Новая анимация</button></div>
    <div class="anim-edit" hidden>
      <label class="field">Название <input type="text" data-k="name" value="Моя анимация" maxlength="40"></label>
      <div class="row">
        <label class="field">Длительность, с <input type="number" data-k="dur" value="2" min="0.2" max="20" step="0.1"></label>
        <label class="check" style="align-self:end"><input type="checkbox" data-k="loop" checked> Зациклить</label>
      </div>
      <label class="field">Кость (или тапни по модели) <select data-k="bone"></select></label>
      <label class="field">Поворот X <b data-v="x"></b><input type="range" data-k="x" min="-180" max="180" step="1"></label>
      <label class="field">Поворот Y <b data-v="y"></b><input type="range" data-k="y" min="-180" max="180" step="1"></label>
      <label class="field">Поворот Z <b data-v="z"></b><input type="range" data-k="z" min="-180" max="180" step="1"></label>
      <label class="field">Таз вверх/вниз <b data-v="hy"></b><input type="range" data-k="hy" min="-0.6" max="0.6" step="0.01" value="0"></label>
      <div class="row"><button class="btn" data-a="resetBone">Сбросить кость</button><button class="btn" data-a="resetPose">Сбросить позу</button></div>
      <div class="timeline"><div class="keys"></div><input type="range" data-k="time" min="0" max="2" step="0.02" value="0"></div>
      <div class="hint small" data-v="time"></div>
      <div class="row">
        <button class="btn" data-a="prev">◀</button>
        <button class="btn" data-a="key">+ Ключ</button>
        <button class="btn" data-a="del">− Ключ</button>
        <button class="btn" data-a="next">▶</button>
      </div>
      <div class="row"><button class="btn" data-a="play">▶ Проиграть</button><button class="btn" data-a="mirror">⇆ Отзеркалить</button></div>
      <div class="row"><button class="btn primary" data-a="save">Сохранить</button><button class="btn" data-a="exit">Выйти</button></div>
    </div>
    <h3 style="margin-top:12px">Мои анимации</h3>
    <div class="anim-list"></div>
    <p class="hint small">Ключ запоминает позу всего тела в текущий момент. Между ключами движение сглаживается.</p>`;
  const $ = (s) => el.querySelector(s);
  const K = (k) => el.querySelector(`[data-k="${k}"]`);
  const V = (k) => el.querySelector(`[data-v="${k}"]`);
  bones.forEach((b) => K('bone').add(new Option(NAMES[b.name], b.name)));
  K('bone').value = sel.name;

  function syncSliders() {
    const e = new THREE.Euler().setFromQuaternion(sel.quaternion);
    ['x', 'y', 'z'].forEach((a) => { K(a).value = Math.round(e[a] * D); V(a).textContent = Math.round(e[a] * D) + '°'; });
    const hy = (hips.position.y - rest.get(hips).p.y) / hipsScale;
    K('hy').value = hy.toFixed(2); V('hy').textContent = hy.toFixed(2);
  }
  function drawKeys() {
    const dur = +K('dur').value || 2;
    K('time').max = dur;
    $('.keys').innerHTML = keys.map((k, i) => `<i data-i="${i}" style="left:${(k.t / dur) * 100}%"></i>`).join('');
    V('time').textContent = `t = ${t.toFixed(2)} с · ключей: ${keys.length}` + (keyAt(t) >= 0 ? ' · на ключе' : '');
  }
  const keyAt = (tt) => keys.findIndex((k) => Math.abs(k.t - tt) < 0.011);

  /* ---------- позы ---------- */
  const snap = (tt) => ({
    t: +tt.toFixed(3), hy: (hips.position.y - rest.get(hips).p.y) / hipsScale,
    q: Object.fromEntries(bones.map((b) => [b.name, b.quaternion.toArray().map((v) => +v.toFixed(5))])),
  });
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  function poseAt(tt) {
    if (!keys.length) return;
    let i = keys.findIndex((k) => k.t > tt);
    const a = keys[i < 0 ? keys.length - 1 : Math.max(0, i - 1)], b = i < 0 ? a : keys[i];
    const f = b === a ? 0 : THREE.MathUtils.smoothstep(tt, a.t, b.t);
    bones.forEach((bn) => {
      if (!a.q[bn.name]) return;
      qa.fromArray(a.q[bn.name]); qb.fromArray(b.q[bn.name] || a.q[bn.name]);
      bn.quaternion.slerpQuaternions(qa, qb, f);
    });
    hips.position.y = rest.get(hips).p.y + (a.hy + ((b.hy ?? a.hy) - a.hy) * f) * hipsScale;
  }
  function resetPose() { rest.forEach((r, b) => { b.quaternion.copy(r.q); b.position.copy(r.p); }); }

  function toClip(name, dur, loop, ks) {
    const list = [...ks].sort((a, b) => a.t - b.t);
    if (!list.length) return null;
    if (list.length === 1 || loop) list.push({ ...list[0], t: dur });
    else if (list[list.length - 1].t < dur) list.push({ ...list[list.length - 1], t: dur });
    const times = list.map((k) => k.t);
    const tracks = bones.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times,
      list.flatMap((k) => k.q[b.name] || rest.get(b).q.toArray())));
    const rp = rest.get(hips).p;
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, list.flatMap((k) => [rp.x, rp.y + (k.hy || 0) * hipsScale, rp.z])));
    const clip = new THREE.AnimationClip(name, dur, tracks);
    clip.userData = { custom: true };
    return clip;
  }

  /* ---------- сохранённые ---------- */
  let saved = load();
  function savedClips() { return saved.map((s) => toClip(s.name, s.dur, s.loop, s.keys)).filter(Boolean); }
  function drawList() {
    $('.anim-list').innerHTML = saved.length ? saved.map((s, i) => `
      <div class="anim-item"><span>${s.name.replace(/</g, '&lt;')}</span>
        <button class="btn" data-edit="${i}">✎</button><button class="btn" data-rm="${i}">✕</button></div>`).join('')
      : '<p class="hint small">Пока пусто.</p>';
  }
  drawList();

  /* ---------- режимы ---------- */
  function enter(fromIndex = -1) {
    active = true; playing = false; editingIndex = fromIndex;
    onEnter?.();
    $('.anim-edit').hidden = false;
    $('[data-a="enter"]').hidden = true;
    helper.visible = true; marker.visible = true;
    if (fromIndex >= 0) {
      const s = saved[fromIndex];
      keys = JSON.parse(JSON.stringify(s.keys));
      K('name').value = s.name; K('dur').value = s.dur; K('loop').checked = s.loop;
    } else {
      keys = [];
      K('name').value = 'Моя анимация ' + (saved.length + 1);
    }
    t = 0; K('time').value = 0;
    if (keys.length) poseAt(0);
    syncSliders(); drawKeys();
  }
  function exit() {
    active = false; playing = false;
    $('.anim-edit').hidden = true;
    $('[data-a="enter"]').hidden = false;
    helper.visible = false; marker.visible = false;
    resetPose();
    onExit?.();
  }
  function select(name) { sel = root.getObjectByName(name) || sel; K('bone').value = sel.name; syncSliders(); }

  el.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k || !active) return;
    if (k === 'x' || k === 'y' || k === 'z') {
      sel.quaternion.setFromEuler(new THREE.Euler(+K('x').value * Rr, +K('y').value * Rr, +K('z').value * Rr));
      V(k).textContent = K(k).value + '°';
      const i = keyAt(t); if (i >= 0) keys[i] = snap(t); // правка на ключе сразу обновляет ключ
    } else if (k === 'hy') {
      hips.position.y = rest.get(hips).p.y + +K('hy').value * hipsScale;
      V('hy').textContent = (+K('hy').value).toFixed(2);
      const i = keyAt(t); if (i >= 0) keys[i] = snap(t);
    } else if (k === 'time') { t = +K('time').value; poseAt(t); syncSliders(); drawKeys(); }
    else if (k === 'bone') select(K('bone').value);
    else if (k === 'dur') drawKeys();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button, i');
    if (!b) return;
    if (b.tagName === 'I') { t = keys[+b.dataset.i].t; K('time').value = t; poseAt(t); syncSliders(); drawKeys(); return; }
    if (b.dataset.edit) { enter(+b.dataset.edit); return; }
    if (b.dataset.rm) {
      const i = +b.dataset.rm;
      if (!confirm(`Удалить «${saved[i].name}»?`)) return;
      saved.splice(i, 1); save(saved); drawList(); onClipsChanged(savedClips()); return;
    }
    const a = b.dataset.a;
    if (a === 'enter') enter();
    else if (a === 'exit') exit();
    else if (a === 'key') { const i = keyAt(t); const k = snap(t); if (i >= 0) keys[i] = k; else keys.push(k); keys.sort((x, y) => x.t - y.t); drawKeys(); }
    else if (a === 'del') { const i = keyAt(t); if (i >= 0) keys.splice(i, 1); drawKeys(); }
    else if (a === 'prev' || a === 'next') {
      const k = a === 'prev' ? [...keys].reverse().find((k) => k.t < t - 0.011) : keys.find((k) => k.t > t + 0.011);
      if (k) { t = k.t; K('time').value = t; poseAt(t); syncSliders(); drawKeys(); }
    }
    else if (a === 'play') { playing = !playing; b.textContent = playing ? '■ Стоп' : '▶ Проиграть'; }
    else if (a === 'resetBone') { const r = rest.get(sel); sel.quaternion.copy(r.q); if (sel === hips) sel.position.copy(r.p); syncSliders(); }
    else if (a === 'resetPose') { resetPose(); syncSliders(); }
    else if (a === 'mirror') { mirrorPose(); syncSliders(); const i = keyAt(t); if (i >= 0) keys[i] = snap(t); }
    else if (a === 'save') {
      if (!keys.length) { toast('Поставь хотя бы один ключ'); return; }
      const rec = { name: K('name').value.trim() || 'Анимация', dur: Math.max(0.2, +K('dur').value || 2), loop: K('loop').checked, keys };
      if (editingIndex >= 0) saved[editingIndex] = rec; else saved.push(rec);
      save(saved); drawList();
      const clips = savedClips();
      exit();
      onClipsChanged(clips, rec.name);
      toast('Анимация сохранена: ' + rec.name);
    }
  });

  // зеркало: меняем местами левые/правые кости и отражаем повороты относительно покоя
  function mirrorPose() {
    const cur = new Map(bones.map((b) => [b.name, b.quaternion.clone()]));
    bones.forEach((b) => {
      const other = b.name.startsWith('Left') ? 'Right' + b.name.slice(4) : b.name.startsWith('Right') ? 'Left' + b.name.slice(5) : b.name;
      const src = cur.get(other); if (!src) return;
      const ob = root.getObjectByName(other);
      const delta = rest.get(ob).q.clone().invert().multiply(src); // отклонение от покоя
      delta.y *= -1; delta.z *= -1;
      b.quaternion.copy(rest.get(b).q).multiply(delta);
    });
  }

  // выбор кости тапом по модели
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    if (!active || !down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 400) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(root, true)[0];
    if (!hit) return;
    let best = null, bd = Infinity;
    const wp = new THREE.Vector3();
    bones.forEach((b) => { b.getWorldPosition(wp); const dd = wp.distanceTo(hit.point); if (dd < bd) { bd = dd; best = b; } });
    if (best) select(best.name);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  function destroy() {
    if (active) exit();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    scene.remove(helper); scene.remove(marker);
    el.innerHTML = '';
  }

  function update(dt) {
    if (!active) return;
    if (playing && keys.length) {
      const dur = +K('dur').value || 2;
      t = (t + dt) % dur; K('time').value = t; poseAt(t); drawKeys();
    }
    sel.getWorldPosition(marker.position);
    const s = camera.position.distanceTo(marker.position) * 0.012;
    marker.scale.setScalar(s);
  }

  return { update, get active() { return active; }, savedClips, exit, destroy };
}
