import * as THREE from 'three';
import { SOCKETS, CATS, catalog } from './equip.js';
import { PRIMITIVES } from './items.js';
import { db } from './db.js';

/*
 * Панель режима «Снаряжение» в Мастерской.
 * Выбор: предмет (контейнер в гнезде) / гнездо (точка крепления на кости) / деталь своего предмета.
 * Гизмо двигает выбранное, числа — для точной подгонки; всё сохраняется через equip.commit().
 * ctx: { getEquip, toast, push(op), changed(), editPart(mesh), matUI(mats) → html, bindMat(el, mats), target(obj), frame(obj), refresh() }
 */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DEG = 180 / Math.PI;

export function createEquipPanel(ctx) {
  let sel = null; // { kind: 'item' | 'socket' | 'part', obj, c? , id? }
  let cat = null, showSock = false, importCat = 'weapon', newPrim = 'box', userItems = [];
  const eq = () => ctx.getEquip();

  async function loadCatalog(force) {
    if (!cat || force) {
      cat = await catalog();
      try { userItems = await db.all('items'); } catch { userItems = []; }
    }
    return cat;
  }

  function select(s) {
    sel = s;
    ctx.target(s?.obj || null);
    ctx.refresh();
  }
  // клик во вьюпорте: по предмету → предмет; по детали уже выбранного своего предмета → деталь; по гнезду → гнездо
  function pick(obj) {
    const e = eq(); if (!e) return false;
    if (obj?.userData.socketMarker) { const s = e.sockets.get(obj.userData.socketMarker); select({ kind: 'socket', id: obj.userData.socketMarker, obj: s.node }); return true; }
    let c = obj && e.findContainer(obj);
    if (!c && obj?.userData.clothingOf) c = e.containers().find((x) => x.userData.equip.uid === obj.userData.clothingOf);
    if (!c) { select(null); return false; }
    if (sel?.c === c || sel?.obj === c) {
      if (c.userData.equip.libItem && obj.isMesh && !obj.userData.clothingOf) { select({ kind: 'part', obj, c }); return true; }
    }
    select({ kind: 'item', obj: c, c });
    return true;
  }

  // перед/после перемещения гизмо — для отмены
  const mat = (o) => { o.updateMatrix(); return o.matrix.clone(); };
  function committed(obj, before) {
    const e = eq(); if (!e) return;
    const after = mat(obj);
    e.commit(obj);
    const set = (m) => { m.decompose(obj.position, obj.quaternion, obj.scale); obj.updateMatrixWorld(true); e.commit(obj); syncNums(); };
    ctx.push({ type: 'fn', undo: () => set(before), redo: () => set(after) });
    syncNums();
  }

  /* ---------- числа (позиция в см, поворот в градусах, размер в %) ---------- */
  let numsEl = null;
  function syncNums() {
    if (!numsEl || sel?.kind !== 'item') return;
    const c = sel.obj, k = eq().metersPerUnit(c.userData.equip.socket) * 100;
    const v = { px: c.position.x * k, py: c.position.y * k, pz: c.position.z * k, rx: c.rotation.x * DEG, ry: c.rotation.y * DEG, rz: c.rotation.z * DEG, s: c.scale.x * 100 };
    numsEl.querySelectorAll('[data-n]').forEach((i) => { if (document.activeElement !== i) i.value = +v[i.dataset.n].toFixed(1); });
  }
  function fromNums() {
    const c = sel.obj, k = eq().metersPerUnit(c.userData.equip.socket) * 100, g = (n) => +numsEl.querySelector(`[data-n=${n}]`).value || 0;
    const before = mat(c);
    c.position.set(g('px') / k, g('py') / k, g('pz') / k);
    c.rotation.set(g('rx') / DEG, g('ry') / DEG, g('rz') / DEG);
    const s = Math.max(1, g('s')) / 100, r = s / (c.scale.x || 1);
    c.scale.multiplyScalar(r);
    c.updateMatrixWorld(true);
    committed(c, before);
  }

  /* ---------- отрисовка панели ---------- */
  async function render(el) {
    const e = eq();
    if (!e) { el.innerHTML = '<p class="hint small">У этой модели нет скелета — снаряжение недоступно.</p>'; return; }
    await loadCatalog();
    if (sel && sel.kind !== 'socket' && !e.containers().includes(sel.c)) sel = null; // предмет сняли
    const items = e.containers().sort((a, b) => !!b.userData.equip.builtinId - !!a.userData.equip.builtinId);
    const btn = (op, l, t = '') => `<button class="btn" data-op="${op}" title="${esc(t)}">${l}</button>`;
    const groups = {};
    cat.forEach((it) => (groups[it.cat] ??= []).push(it));
    const addSel = `<select data-f="add"><option value="">＋ Надеть предмет…</option>${Object.entries(CATS).filter(([k]) => groups[k]).map(([k, l]) =>
      `<optgroup label="${l}">${groups[k].map((it) => `<option value="${esc(it.ref)}">${esc(it.name)}${it.user ? ' ★' : ''}${it.src === 'Quaternius CC0' ? ' ◆' : ''}</option>`).join('')}</optgroup>`).join('')}</select>`;
    let h = `<h3>Надето</h3><div class="ed-outliner eq-list">${items.map((c, i) => {
      const d = c.userData.equip;
      return `<div class="ed-row${sel?.c === c ? ' on' : ''}" data-ci="${i}"><button data-eye="${i}" title="Скрыть/показать">${c.visible ? '👁' : '—'}</button><span>${d.builtinId ? '◇ ' : ''}${esc(d.name)} <i>· ${SOCKETS[d.socket] || d.socket}${c.userData.bound ? ' · одежда' : ''}</i></span></div>`;
    }).join('') || '<p class="hint small">Ничего не надето</p>'}</div>
      ${addSel}
      <p class="hint small">◇ — из редактора внешности, ◆ — CC0-оружие Quaternius, ★ — твои предметы.</p>
      <div class="row"><label class="btn ed-file">Импорт .glb/.obj<input type="file" data-f="import" accept=".glb,.gltf,.obj" hidden></label>
        <select data-f="importCat" title="Категория для импорта и нового предмета">${Object.entries(CATS).map(([k, l]) => `<option value="${k}"${k === importCat ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="row">${btn('newItem', '＋ Новый предмет', 'Пустой предмет из примитива — собери его из деталей')}
        <select data-f="newPrim">${Object.entries(PRIMITIVES).map(([k, [l]]) => `<option value="${k}"${k === newPrim ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;

    if (sel?.kind === 'item' || sel?.kind === 'part') {
      const c = sel.c, d = c.userData.equip, lib = !!d.libItem;
      const parts = []; e.contentOf(c).traverse((o) => { if (o.isMesh) parts.push(o); });
      const num = (n, l, step) => `<label>${l}<input type="number" data-n="${n}" step="${step}"></label>`;
      h += `<h3>Предмет: ${esc(d.name)}</h3>
        <label class="field">Гнездо <select data-f="socket">${[...e.sockets.keys()].map((k) => `<option value="${k}"${k === d.socket ? ' selected' : ''}>${SOCKETS[k]}</option>`).join('')}</select></label>
        <div class="eq-nums">
          <div><span>Сдвиг, см</span>${num('px', 'X', 0.5)}${num('py', 'Y', 0.5)}${num('pz', 'Z', 0.5)}</div>
          <div><span>Поворот, °</span>${num('rx', 'X', 5)}${num('ry', 'Y', 5)}${num('rz', 'Z', 5)}</div>
          <div><span>Размер, %</span>${num('s', '', 5)}</div>
        </div>
        <div class="row">${btn('reset', 'Сброс', 'Вернуть положение по умолчанию')}${btn('mirror', 'В другую руку', 'Отзеркалить копию в парное гнездо')}${btn('frame', 'Показать')}</div>
        <div class="row">${btn('remove', d.builtinId ? 'Скрыть' : 'Снять')}${c.userData.bound ? btn('unbind', 'Отвязать от тела') : btn('cloth', 'Сделать одеждой', 'Привязать к костям: предмет будет гнуться вместе с телом')}</div>
        <div class="row">${btn('shape', 'Править форму →', 'Вершины/скульпт/покраска этого предмета')}${lib ? btn('download', 'Скачать .glb') : btn('mine', 'В «Мои предметы»', 'Сохранить копию в свою библиотеку: можно менять детали и надевать на любого персонажа')}</div>
        <h3>Детали предмета</h3>
        <div class="ed-outliner">${parts.map((m, i) => `<div class="ed-row${sel.obj === m ? ' on' : ''}" data-pi="${i}"><span>${i + 1}. ${esc(m.userData.partName || 'Деталь')}</span></div>`).join('')}</div>
        ${lib ? `<div class="row"><select data-f="prim">${Object.entries(PRIMITIVES).map(([k, [l]]) => `<option value="${k}">＋ ${l}</option>`).join('')}</select>${btn('addPart', 'Добавить')}${sel.kind === 'part' ? btn('delPart', 'Удалить деталь') : ''}</div>
          <p class="hint small">Клик по предмету ещё раз — выбрать деталь и двигать её гизмо.</p>`
        : '<p class="hint small">Детали можно добавлять/двигать у своих предметов — нажми «В „Мои предметы“».</p>'}
        ${ctx.matUI(matsOf(sel.kind === 'part' ? [sel.obj] : parts))}`;
    }

    h += `<h3>Гнёзда</h3>
      <label class="check"><input type="checkbox" data-f="showSock" ${showSock ? 'checked' : ''}> Показать гнёзда (оранжевые точки)</label>
      <label class="field">Гнездо <select data-f="sockSel"><option value="">— выбрать —</option>${[...e.sockets.keys()].filter((k) => k !== 'body').map((k) => `<option value="${k}"${sel?.kind === 'socket' && sel.id === k ? ' selected' : ''}>${SOCKETS[k]}</option>`).join('')}</select></label>`;
    if (sel?.kind === 'socket') {
      const s = e.sockets.get(sel.id);
      h += `<label class="field">Кость <select data-f="bone">${e.bones.map((b) => `<option${b === s.bone ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
        <div class="row">${btn('sockReset', 'Сбросить гнездо')}</div>
        <p class="hint small">Сдвинь гнездо гизмо — все предметы в нём сдвинутся вместе (подогнать хват под этого персонажа один раз).</p>`;
    }
    h += `<h3>Мои предметы</h3><div class="ed-outliner">${userItems.map((r) => `<div class="ed-row" data-uid="${esc(r.id)}"><span>★ ${esc(r.name)} <i>· ${CATS[r.cat] || ''}</i></span><button data-uop="wear" title="Надеть">＋</button><button data-uop="del" title="Удалить из библиотеки">✕</button></div>`).join('') || '<p class="hint small">Пусто. Создай новый предмет, импортируй файл или сохрани копию надетого.</p>'}</div>`;
    el.innerHTML = h;
    numsEl = el.querySelector('.eq-nums');
    syncNums();
    if (sel?.kind === 'item' || sel?.kind === 'part') {
      const parts = []; e.contentOf(sel.c).traverse((o) => { if (o.isMesh) parts.push(o); });
      ctx.bindMat(el, matsOf(sel.kind === 'part' ? [sel.obj] : parts), sel.c);
    }
  }
  function matsOf(meshes) {
    const out = new Set();
    for (const m of meshes) for (const x of [].concat(m.userData.orig || m.material)) if (x?.color) out.add(x);
    return [...out];
  }

  /* ---------- события панели ---------- */
  async function onInput(e, el) {
    const f = e.target.dataset.f, n = e.target.dataset.n, q = eq();
    if (n) { if (e.type === 'change') fromNums(); return; }
    if (!f || !q) return;
    const v = e.target.value;
    try {
      if (f === 'add' && v) { const c = await q.equip(v); ctx.changed(); select({ kind: 'item', obj: c, c }); }
      else if (f === 'importCat') importCat = v;
      else if (f === 'newPrim') newPrim = v;
      else if (f === 'import') {
        const file = e.target.files[0]; if (!file) return;
        ctx.toast('Импорт ' + file.name + '…');
        const c = await q.importItem(file, { cat: importCat });
        await loadCatalog(true); ctx.changed(); select({ kind: 'item', obj: c, c });
        ctx.toast('Предмет добавлен в «Мои предметы» и надет. Подгони его гизмо.');
      } else if (f === 'socket' && sel) { q.changeSocket(sel.c, v); ctx.changed(); select({ kind: 'item', obj: sel.c, c: sel.c }); }
      else if (f === 'showSock') { showSock = e.target.checked; q.showSockets(showSock); }
      else if (f === 'sockSel') {
        if (!v) return select(null);
        if (!showSock) { showSock = true; q.showSockets(true); }
        select({ kind: 'socket', id: v, obj: q.sockets.get(v).node });
      } else if (f === 'bone' && sel?.kind === 'socket') { q.setSocketBone(sel.id, v); ctx.toast('Гнездо перенесено на кость ' + v); ctx.refresh(); }
    } catch (err) { console.warn(err); ctx.toast('Ошибка: ' + (err.message || err)); }
  }
  async function onClick(e, el) {
    const q = eq(); if (!q) return;
    const eye = e.target.closest('[data-eye]');
    const items = q.containers().sort((a, b) => !!b.userData.equip.builtinId - !!a.userData.equip.builtinId);
    if (eye) { const c = items[+eye.dataset.eye]; q.setHidden(c, c.visible); return ctx.refresh(); }
    const row = e.target.closest('[data-ci]');
    if (row) { const c = items[+row.dataset.ci]; return select({ kind: 'item', obj: c, c }); }
    const prow = e.target.closest('[data-pi]');
    if (prow && sel?.c) {
      const parts = []; q.contentOf(sel.c).traverse((o) => { if (o.isMesh) parts.push(o); });
      const m = parts[+prow.dataset.pi];
      if (sel.c.userData.equip.libItem) return select({ kind: 'part', obj: m, c: sel.c });
      return ctx.editPart(m);
    }
    const urow = e.target.closest('[data-uop]');
    if (urow) {
      const id = urow.closest('[data-uid]').dataset.uid, r = userItems.find((x) => x.id === id);
      if (urow.dataset.uop === 'wear') { const c = await q.equip('u:' + id); ctx.changed(); select({ kind: 'item', obj: c, c }); }
      else if (confirm(`Удалить «${r?.name}» из библиотеки? Надетые копии тоже снимутся.`)) {
        await db.del('items', id);
        q.containers().filter((c) => c.userData.equip.ref === 'u:' + id).forEach((c) => q.remove(c));
        if (sel?.c && !q.containers().includes(sel.c)) sel = null;
        await loadCatalog(true); ctx.changed(); ctx.refresh();
      }
      return;
    }
    const op = e.target.closest('[data-op]')?.dataset.op;
    if (!op) return;
    const c = sel?.c;
    try {
      switch (op) {
        case 'newItem': {
          const name = prompt('Название предмета', 'Мой предмет') || 'Мой предмет';
          const socket = { shield: 'hand_l', bow: 'hand_l', head: 'head', hair: 'head', cloak: 'cloak', back: 'back', belt: 'hip_r', clothing: 'body' }[importCat] || 'hand_r';
          const nc = await q.createItem({ name, cat: importCat, socket, prim: newPrim });
          await loadCatalog(true); ctx.changed(); select({ kind: 'item', obj: nc, c: nc });
          ctx.toast('Создан «' + name + '». Добавляй детали снизу, двигай их гизмо.');
          break;
        }
        case 'reset': { const before = mat(c); q.resetItem(c); committed(c, before); break; }
        case 'mirror': { const nc = await q.mirror(c); if (nc) { ctx.changed(); select({ kind: 'item', obj: nc, c: nc }); } break; }
        case 'frame': ctx.frame(sel.obj); break;
        case 'remove': q.remove(c); select(null); ctx.changed(); break;
        case 'cloth': ctx.toast('Привязываю к телу…'); await new Promise((r) => setTimeout(r, 30)); q.makeClothing(c); ctx.changed(); select({ kind: 'item', obj: c, c }); break;
        case 'unbind': q.unbind(c); ctx.changed(); select({ kind: 'item', obj: c, c }); break;
        case 'shape': {
          const m = c.userData.bound?.[0] || (() => { let x = null; q.contentOf(c).traverse((o) => { if (!x && o.isMesh) x = o; }); return x; })();
          if (m) ctx.editPart(sel.kind === 'part' ? sel.obj : m);
          break;
        }
        case 'mine': { const name = prompt('Название в «Моих предметах»', c.userData.equip.name + ' (мой)'); if (name === null) break; const nc = await q.saveAsUserItem(c, name); await loadCatalog(true); ctx.changed(); select({ kind: 'item', obj: nc, c: nc }); ctx.toast('Сохранено в «Мои предметы» ★'); break; }
        case 'download': {
          const r = await db.get('items', c.userData.equip.libItem);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([r.buffer], { type: 'model/gltf-binary' })); a.download = (r.name || 'item') + '.glb'; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          break;
        }
        case 'addPart': {
          const t = e.target.closest('.row').querySelector('[data-f=prim]').value;
          const m = q.addPrimitive(c, t);
          if (m) { m.userData.partName = PRIMITIVES[t][0]; ctx.changed(); select({ kind: 'part', obj: m, c }); }
          break;
        }
        case 'delPart': {
          const parts = []; q.contentOf(c).traverse((o) => { if (o.isMesh) parts.push(o); });
          if (parts.length < 2) { ctx.toast('Последнюю деталь не удалить — сними предмет целиком'); break; }
          sel.obj.parent.remove(sel.obj);
          q.markDirty(c.userData.equip.libItem, c);
          select({ kind: 'item', obj: c, c });
          break;
        }
        case 'sockReset': q.resetSocket(sel.id); select({ kind: 'socket', id: sel.id, obj: q.sockets.get(sel.id).node }); break;
        default:
      }
    } catch (err) { console.warn(err); ctx.toast('Ошибка: ' + (err.message || err)); }
  }

  return {
    render, pick, select, committed, onInput, onClick, syncNums,
    get sel() { return sel; },
    reset() { sel = null; showSock = false; eq()?.showSockets(false); },
    leave() { eq()?.showSockets(false); },
    enter() { if (showSock) eq()?.showSockets(true); },
  };
}
