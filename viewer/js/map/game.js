import * as THREE from 'three';
import { MeshBVH } from 'three/addons/libs/three-mesh-bvh.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Режим «Игра»: ходим выбранным персонажем по карте из редактора карт.
 *   столкновения — капсула против BVH всех твёрдых объектов и рельефа (как в примере three-mesh-bvh «characterMovement»):
 *   лестницы, дверные проёмы, склоны, мосты работают сами;
 *   камера от третьего лица не проходит сквозь стены; клавиатура/мышь и джойстик на телефоне;
 *   роли объектов: NPC (E — поговорить), враг (бродит, замечает, догоняет), подбираемое (счётчик), переход (E), надпись, свет.
 */

const CLIPS = { // поиск клипов у разных скелетов: Странник, Universal (UAL), Героини, KayKit, Quaternius
  idle: [/^idle$/i, /^idle_loop$/i, /^idle_a$/i, /^idle/i, /idle/i],
  walk: [/^walk$/i, /^walk_loop$/i, /^walking_a$/i, /^walking$/i, /^walk(?!.*back)/i, /walk(?!.*back)/i],
  run: [/^run$/i, /^jog_fwd_loop$/i, /^running_a$/i, /^sprint_loop$/i, /^run(?!.*back)/i, /jog|sprint|run/i],
  jump: [/^jump_start$/i, /^jump$/i, /^jump_full_short$/i, /jump/i],
  fall: [/^jump_loop$/i, /^jump_idle$/i, /fall/i],
  attack: [/^punch$/i, /attack|slash|chop|punch|bite/i],
};
export function findClip(clips, kind) {
  for (const re of CLIPS[kind]) { const c = clips.find((x) => re.test(x.name)); if (c) return c; }
  return null;
}

export function createGame(ctx) {
  const { scene, camera, canvas, toast } = ctx;
  const R = 0.3, H = 1.5; // капсула игрока: радиус и высота отрезка (центр нижней сферы → верхней)
  const st = { active: false, yaw: 0, pitch: 0.32, dist: 4.6, vel: new THREE.Vector3(), onGround: false, face: 0, jumping: false, caught: 0 };
  let map = null, hero = null, player = null, collider = null, mixer = null, acts = {}, cur = null, roles = [], counts = {}, totals = {};
  const pos = new THREE.Vector3(); // центр нижней сферы капсулы
  const keys = new Set();
  const hud = buildHUD();

  /* ---------- коллайдер: все твёрдые объекты + рельеф одной BVH-геометрией ---------- */
  function worldGeo(mesh) {
    const src = mesh.geometry, p = src.attributes.position, n = p.count;
    const arr = new Float32Array(n * 3), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.setIndex(src.index ? Array.from(src.index.array) : Array.from({ length: n }, (_, i) => i));
    return g;
  }
  function buildCollider() {
    const geos = [];
    ctx.mapEd.root.updateMatrixWorld(true);
    const t = ctx.mapEd.terrain;
    geos.push(worldGeo(t.mesh));
    for (const e of ctx.mapEd.entries.values()) {
      if (!e.d.solid || e.d.role === 'enemy' || e.d.role === 'pickup') continue;
      e.o.traverse((m) => { if (m.isMesh && !m.isSkinnedMesh && m.visible) geos.push(worldGeo(m)); });
    }
    // невидимые стены по краю карты
    const s = t.half, wall = new THREE.BoxGeometry(1, 60, s * 2 + 2);
    for (const [x, z, ry] of [[s + 0.5, 0, 0], [-s - 0.5, 0, 0], [0, s + 0.5, Math.PI / 2], [0, -s - 0.5, Math.PI / 2]]) {
      const g = wall.clone().rotateY(ry).translate(x, 0, z); g.deleteAttribute('normal'); g.deleteAttribute('uv'); geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    merged.boundsTree = new MeshBVH(merged);
    return merged;
  }

  /* ---------- ввод ---------- */
  addEventListener('keydown', (e) => {
    if (!st.active || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    keys.add(e.code);
    if (e.code === 'Space') { e.preventDefault(); jump(); }
    if (e.code === 'KeyE' || e.code === 'Enter') interact();
    if (e.code === 'Escape') ctx.onExit?.();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  // мышь/палец: левая половина экрана на телефоне — джойстик, остальное — поворот камеры
  const stick = { id: null, x0: 0, y0: 0, x: 0, y: 0 }, look = { id: null, x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    if (!st.active) return;
    const touch = e.pointerType === 'touch';
    if (touch && e.clientX < innerWidth * 0.45 && stick.id === null) { Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 }); hud.stick.style.cssText = `display:block;left:${e.clientX - 50}px;top:${e.clientY - 50}px`; }
    else if (look.id === null) Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
  });
  addEventListener('pointermove', (e) => {
    if (!st.active) return;
    if (e.pointerId === stick.id) {
      let dx = e.clientX - stick.x0, dy = e.clientY - stick.y0; const l = Math.hypot(dx, dy), m = 46;
      if (l > m) { dx *= m / l; dy *= m / l; }
      stick.x = dx / m; stick.y = dy / m;
      hud.knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (e.pointerId === look.id) {
      st.yaw -= (e.clientX - look.x) * 0.006; st.pitch = Math.max(-0.2, Math.min(1.2, st.pitch + (e.clientY - look.y) * 0.004));
      look.x = e.clientX; look.y = e.clientY;
    }
  });
  const up = (e) => {
    if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; hud.stick.style.display = 'none'; hud.knob.style.transform = ''; }
    if (e.pointerId === look.id) look.id = null;
  };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { if (st.active) st.dist = Math.max(1.6, Math.min(12, st.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: true });

  function jump() { if (st.onGround && !dialog) { st.vel.y = 7.2; st.onGround = false; st.jumping = true; play('jump', 0.1, true); } }

  /* ---------- анимации игрока ---------- */
  function play(kind, fade = 0.25, once = false) {
    const a = acts[kind] || (kind === 'fall' ? acts.jump || acts.idle : kind === 'run' ? acts.walk : kind === 'jump' ? null : acts.idle);
    if (!a || a === cur) return;
    a.reset().setEffectiveWeight(1).setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.play();
    if (cur) a.crossFadeFrom(cur, fade, false);
    cur = a;
  }

  /* ---------- роли объектов ---------- */
  function setupRoles() {
    roles = []; counts = {}; totals = {};
    for (const e of ctx.mapEd.entries.values()) {
      const d = e.d; if (!d.role) continue;
      const r = { e, d, home: e.o.position.clone(), homeQ: e.o.quaternion.clone(), t: Math.random() * 5, target: null, mode: 'idle', clipKind: null };
      if (d.role === 'pickup') { const k = d.txt || 'предметы'; totals[k] = (totals[k] || 0) + 1; counts[k] = 0; r.baseY = e.o.position.y; }
      roles.push(r);
    }
  }
  function resetRoles() {
    for (const r of roles) {
      r.e.o.position.copy(r.home); r.e.o.quaternion.copy(r.homeQ); r.e.o.visible = true; r.taken = false; r.mode = 'idle';
    }
    for (const k in counts) counts[k] = 0;
  }
  function enemyClip(r, kind) {
    if (r.clipKind === kind || !r.e.mixer) return;
    const c = findClip(r.e.o.animations || [], kind) || findClip(r.e.o.animations || [], 'idle');
    if (!c) return;
    r.e.mixer.stopAllAction(); r.e.mixer.clipAction(c).reset().play(); r.clipKind = kind;
  }
  let near = null, dialog = null, msgT = 0;
  function updateRoles(dt) {
    const pf = player.position;
    near = null;
    let sign = null;
    for (const r of roles) {
      const o = r.e.o, d = r.d, dist = Math.hypot(o.position.x - pf.x, o.position.z - pf.z);
      if (d.role === 'pickup' && !r.taken) {
        o.rotation.y += dt * 2; o.position.y = r.baseY + 0.15 + Math.sin(performance.now() / 300) * 0.1;
        if (dist < 1 && Math.abs(o.position.y - pf.y) < 2) { r.taken = true; o.visible = false; const k = d.txt || 'предметы'; counts[k]++; showMsg(`+1 ${k} (${counts[k]}/${totals[k]})`); if (Object.keys(totals).every((x) => counts[x] >= totals[x])) setTimeout(() => showMsg('Всё собрано! ✦'), 900); }
      } else if (d.role === 'npc' || d.role === 'portal') {
        if (dist < 2.6 && (!near || dist < near.dist)) near = { r, dist };
        if (d.role === 'npc' && dist < 4) { const want = Math.atan2(pf.x - o.position.x, pf.z - o.position.z); o.rotation.y += angDiff(want, o.rotation.y) * Math.min(1, dt * 4); }
      } else if (d.role === 'sign') { if (dist < 3.2) sign = d.txt; }
      else if (d.role === 'enemy') updateEnemy(r, dist, dt);
    }
    hud.prompt.textContent = dialog ? '' : near ? (near.r.d.role === 'npc' ? `E — поговорить${near.r.d.who ? ' с: ' + near.r.d.who : ''}` : 'E — перейти') : '';
    hud.prompt.hidden = !hud.prompt.textContent;
    if (sign && !dialog) { hud.sign.textContent = sign; hud.sign.hidden = false; } else hud.sign.hidden = true;
    hud.count.textContent = Object.keys(totals).map((k) => `${k}: ${counts[k]}/${totals[k]}`).join('  ·  ');
  }
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  function updateEnemy(r, dist, dt) {
    const o = r.e.o, d = r.d, t = ctx.mapEd.terrain, speed = d.speed ?? 2.5;
    if (st.caught > 0) return;
    let goal = null, sp = 0;
    if (dist < (d.sight ?? 8)) { goal = player.position; sp = speed; r.mode = 'chase'; }
    else {
      r.t -= dt;
      if (!r.target || r.t <= 0) { r.target = r.home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8)); r.t = 3 + Math.random() * 4; }
      if (Math.hypot(r.target.x - o.position.x, r.target.z - o.position.z) > 0.4) { goal = r.target; sp = speed * 0.4; }
      r.mode = 'wander';
    }
    if (goal) {
      const dx = goal.x - o.position.x, dz = goal.z - o.position.z, l = Math.hypot(dx, dz) || 1;
      o.position.x += (dx / l) * sp * dt; o.position.z += (dz / l) * sp * dt;
      o.position.y = t.heightAt(o.position.x, o.position.z);
      o.rotation.y += angDiff(Math.atan2(dx, dz), o.rotation.y) * Math.min(1, dt * 6);
      enemyClip(r, sp > speed * 0.6 ? 'run' : 'walk');
    } else enemyClip(r, 'idle');
    if (dist < 0.9 && Math.abs(o.position.y - player.position.y) < 1.5) {
      st.caught = 1.2; hud.root.classList.add('hit');
      showMsg('Тебя поймали! Обратно на старт…');
      setTimeout(() => { hud.root.classList.remove('hit'); respawn(); resetRoles(); st.caught = 0; }, 1200);
    }
  }
  function interact() {
    if (dialog) { dialog.i++; if (dialog.i >= dialog.lines.length) closeDialog(); else hud.dialogText.textContent = dialog.lines[dialog.i]; return; }
    if (!near) return;
    const d = near.r.d;
    if (d.role === 'npc') {
      const lines = String(d.txt || '…').split(/\n+/).filter(Boolean);
      dialog = { lines, i: 0 };
      hud.dialogWho.textContent = d.who || d.name || 'Незнакомец';
      hud.dialogText.textContent = lines[0];
      hud.dialog.hidden = false;
    } else if (d.role === 'portal') {
      if (d.target && d.target !== map.id) ctx.goMap?.(d.target);
      else { respawn(); showMsg('Переход: обратно на старт'); }
    }
  }
  function closeDialog() { dialog = null; hud.dialog.hidden = true; }
  function showMsg(s) { hud.msg.textContent = s; hud.msg.hidden = false; msgT = 2.6; }

  /* ---------- старт/респаун ---------- */
  function respawn() {
    const sp = map.spawn;
    const y = Math.max(sp.p[1], ctx.mapEd.terrain.heightAt(sp.p[0], sp.p[2]));
    pos.set(sp.p[0], y + R + 0.05, sp.p[2]);
    st.vel.set(0, 0, 0); st.face = sp.yaw || 0; st.yaw = st.face + Math.PI;
    player.position.set(pos.x, pos.y - R, pos.z); player.rotation.y = st.face;
  }
  let saved = null;
  function start(m, h) {
    map = m; hero = h;
    st.active = true;
    collider = buildCollider();
    // персонаж: holder героя кладём в свою «капсулу» (ноги — в начале координат)
    player = new THREE.Group(); player.name = 'Игрок';
    saved = { parent: hero.obj.parent, pos: hero.obj.position.clone(), quat: hero.obj.quaternion.clone() };
    player.add(hero.obj);
    hero.obj.quaternion.identity();
    scene.add(player);
    mixer = new THREE.AnimationMixer(hero.obj);
    acts = {};
    for (const k of Object.keys(CLIPS)) { const c = findClip(hero.clips || [], k); if (c) acts[k] = mixer.clipAction(c); }
    cur = null;
    setupRoles(); resetRoles();
    ctx.mapEd.helpers.visible = false; ctx.mapEd.applyEnv();
    respawn();
    play('idle', 0);
    hud.root.hidden = false; hud.title.textContent = map.name;
    hud.mobile.hidden = !matchMedia('(pointer: coarse)').matches;
    closeDialog();
    toast(matchMedia('(pointer: coarse)').matches ? 'Левая часть экрана — джойстик, правая — камера' : 'WASD — идти, Shift — шагом, Пробел — прыжок, E — действие, мышь — камера, Esc — выход');
  }
  function stop() {
    if (!st.active) return;
    st.active = false;
    mixer?.stopAllAction(); mixer?.uncacheRoot(hero.obj); mixer = null;
    if (saved) { saved.parent?.add(hero.obj); hero.obj.position.copy(saved.pos); hero.obj.quaternion.copy(saved.quat); }
    scene.remove(player); player = null;
    collider?.dispose(); collider = null;
    resetRoles();
    hud.root.hidden = true; keys.clear();
  }

  /* ---------- шаг физики (капсула против BVH) ---------- */
  const seg = new THREE.Line3(), box = new THREE.Box3(), tp = new THREE.Vector3(), cp = new THREE.Vector3(), dv = new THREE.Vector3();
  function physics(dt, move) {
    st.vel.y += st.onGround ? -20 * dt : -20 * dt;
    pos.addScaledVector(st.vel, dt);
    pos.addScaledVector(move, dt);
    seg.start.copy(pos); seg.end.copy(pos).y += H - 2 * R;
    box.makeEmpty(); box.expandByPoint(seg.start); box.expandByPoint(seg.end); box.min.addScalar(-R); box.max.addScalar(R);
    collider.boundsTree.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri) => {
        const dist = tri.closestPointToSegment(seg, tp, cp);
        if (dist < R) { const depth = R - dist, dir = cp.sub(tp).normalize(); seg.start.addScaledVector(dir, depth); seg.end.addScaledVector(dir, depth); }
      },
    });
    dv.subVectors(seg.start, pos);
    st.onGround = dv.y > Math.abs(dt * st.vel.y * 0.25);
    const off = Math.max(0, dv.length() - 1e-5);
    dv.normalize().multiplyScalar(off);
    pos.add(dv);
    if (!st.onGround) { dv.normalize(); st.vel.addScaledVector(dv, -dv.dot(st.vel)); } else st.vel.set(0, 0, 0);
    if (pos.y < -40) respawn();
  }

  /* ---------- кадр ---------- */
  const camT = new THREE.Vector3(), camP = new THREE.Vector3(), rc = new THREE.Raycaster();
  function update(dt) {
    if (!st.active) return;
    dt = Math.min(dt, 0.05);
    // направление движения относительно камеры
    let ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let iz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    if (stick.id !== null) { ix = stick.x; iz = stick.y; }
    let mag = Math.min(1, Math.hypot(ix, iz));
    if (dialog || st.caught > 0) mag = 0;
    const walk = keys.has('ShiftLeft') || keys.has('ShiftRight') || (stick.id !== null && mag < 0.6);
    const speed = walk ? 1.9 : 4.6;
    const move = new THREE.Vector3();
    if (mag > 0.05) {
      const a = Math.atan2(ix, iz) + st.yaw; // от камеры: W — туда, куда смотрит камера
      move.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(speed * mag);
      st.face += angDiff(a, st.face) * Math.min(1, dt * 10);
    }
    for (let i = 0; i < 4; i++) physics(dt / 4, move);
    player.position.set(pos.x, pos.y - R, pos.z);
    player.rotation.y = st.face;
    // анимация
    if (!st.onGround && st.vel.y < -2 && !st.jumping) play('fall', 0.2);
    else if (st.onGround) {
      st.jumping = false;
      play(mag < 0.05 ? 'idle' : walk ? 'walk' : 'run', 0.2);
      if (cur) cur.timeScale = mag < 0.05 ? 1 : walk ? Math.max(0.6, mag * 1.6) : 1;
    }
    mixer.update(dt);
    updateRoles(dt);
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) hud.msg.hidden = true; }
    // камера: орбита вокруг игрока, не сквозь стены
    camT.set(pos.x, pos.y + 1.1, pos.z);
    const dir = new THREE.Vector3(Math.sin(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.cos(st.yaw) * Math.cos(st.pitch));
    let d = st.dist;
    rc.set(camT, dir); rc.far = d;
    const hit = intersectCollider(rc);
    if (hit) d = Math.max(0.6, hit.distance - 0.25);
    camP.copy(camT).addScaledVector(dir, d);
    camera.position.lerp(camP, Math.min(1, dt * 12));
    camera.lookAt(camT);
  }
  const rayMesh = new THREE.Mesh();
  function intersectCollider(r) {
    const hits = collider.boundsTree.raycast(r.ray, THREE.DoubleSide);
    let best = null;
    for (const h of hits) if (h.distance <= r.far && (!best || h.distance < best.distance)) best = h;
    return best;
  }
  void rayMesh;

  /* ---------- HUD ---------- */
  function buildHUD() {
    const root = document.createElement('div'); root.id = 'game-hud'; root.hidden = true;
    root.innerHTML = `<div class="g-top"><b class="g-title"></b><span class="g-count"></span><button class="ed-b" data-a="exit">⟵ В редактор (Esc)</button></div>
      <div class="g-msg" hidden></div><div class="g-sign" hidden></div><div class="g-prompt" hidden></div>
      <div class="g-dialog" hidden><b></b><p></p><small>E / тап — дальше</small></div>
      <div class="g-stick"><i></i></div>
      <div class="g-mobile" hidden><button data-a="act">Действие</button><button data-a="jump">Прыжок</button></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'exit') ctx.onExit?.(); else if (a === 'jump') jump(); else if (a === 'act') interact();
      if (e.target.closest('.g-dialog')) interact();
    });
    return { root, title: root.querySelector('.g-title'), count: root.querySelector('.g-count'), msg: root.querySelector('.g-msg'), sign: root.querySelector('.g-sign'),
      prompt: root.querySelector('.g-prompt'), dialog: root.querySelector('.g-dialog'), dialogWho: root.querySelector('.g-dialog b'), dialogText: root.querySelector('.g-dialog p'),
      stick: root.querySelector('.g-stick'), knob: root.querySelector('.g-stick i'), mobile: root.querySelector('.g-mobile') };
  }

  return { start, stop, update, get active() { return st.active; }, get playerPos() { return player?.position; } };
}
