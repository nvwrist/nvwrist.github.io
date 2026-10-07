import { libCatalog, thumbCSS } from '../library.js';

/*
 * Панель библиотеки моделей: категории, поиск (по-русски и по-английски), фильтр пака, сетка иконок.
 *   createBrowser(el, { onPick(item), filter(item) → bool, cats: ['build', …] | null, size: 52 })
 */
export function createBrowser(el, { onPick, filter = () => true, cats = null, size = 52 } = {}) {
  let catalog = null, cat = cats?.[0] || 'build', q = '', pack = '', limit = 120, selected = null;
  el.classList.add('lib-browser');
  el.innerHTML = '<p class="hint small">Загрузка библиотеки…</p>';

  async function init() {
    catalog = await libCatalog();
    render();
  }
  function list() {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return catalog.items.filter((it) => filter(it) && (q ? true : it.c === cat) && (!pack || it.p === pack)
      && words.every((w) => it.n.toLowerCase().includes(w) || it.en.toLowerCase().includes(w)));
  }
  function render() {
    if (!catalog) return;
    const counts = {};
    catalog.items.forEach((it) => { if (filter(it)) counts[it.c] = (counts[it.c] || 0) + 1; });
    const catList = Object.entries(catalog.cats).filter(([k]) => counts[k] && (!cats || cats.includes(k)));
    if (!catList.some(([k]) => k === cat)) cat = catList[0]?.[0];
    const items = list(), shown = items.slice(0, limit);
    el.innerHTML = `
      <div class="lib-cats">${catList.map(([k, l]) => `<button data-cat="${k}" class="${k === cat && !q ? 'on' : ''}">${l} <i>${counts[k]}</i></button>`).join('')}</div>
      <div class="lib-row"><input type="search" data-f="q" placeholder="Поиск: бочка, стена, tree…" value="${q.replace(/"/g, '&quot;')}">
        <select data-f="pack"><option value="">Все паки</option>${Object.entries(catalog.packs).map(([k, p]) => `<option value="${k}"${k === pack ? ' selected' : ''}>${p.name} — ${p.author}</option>`).join('')}</select></div>
      <div class="lib-grid">${shown.map((it) => `<button class="lib-it${selected === it.id ? ' on' : ''}" data-id="${it.id}" title="${it.n}\n${it.en} · ${catalog.packs[it.p]?.author}${it.a ? '\n▶ анимаций: ' + it.a.length : ''}"><span style="${thumbCSS(it, size)};width:${size}px;height:${size}px"></span><b>${it.n}</b>${it.a ? '<i>▶</i>' : ''}</button>`).join('') || '<p class="hint small">Ничего не нашлось</p>'}</div>
      ${items.length > limit ? `<button class="btn" data-more>Показать ещё (${items.length - limit})</button>` : ''}
      <p class="hint small">Всего моделей: ${catalog.items.length}. Все — CC0 (бесплатно, можно в своих играх).</p>`;
  }
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (c) { cat = c.dataset.cat; q = ''; limit = 120; return render(); }
    if (e.target.closest('[data-more]')) { limit += 240; return render(); }
    const b = e.target.closest('[data-id]');
    if (b) { selected = b.dataset.id; el.querySelectorAll('.lib-it.on').forEach((x) => x.classList.remove('on')); b.classList.add('on'); onPick?.(catalog.byId.get(b.dataset.id)); }
  });
  let t = 0;
  el.addEventListener('input', (e) => {
    if (e.target.dataset.f === 'q') { clearTimeout(t); t = setTimeout(() => { q = e.target.value; limit = 120; const pos = e.target.selectionStart; render(); const i = el.querySelector('[data-f=q]'); i.focus(); i.setSelectionRange(pos, pos); }, 250); }
  });
  el.addEventListener('change', (e) => { if (e.target.dataset.f === 'pack') { pack = e.target.value; limit = 120; render(); } });
  init();
  return { render, clearSelection() { selected = null; el.querySelectorAll('.lib-it.on').forEach((x) => x.classList.remove('on')); }, get catalog() { return catalog; } };
}
