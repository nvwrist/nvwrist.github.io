// IndexedDB вьюера: models — свои персонажи, items — свои предметы снаряжения, maps — карты редактора карт.
let p = null;
const open = () => (p ??= new Promise((res, rej) => {
  const r = indexedDB.open('ps1-viewer', 3);
  r.onupgradeneeded = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps', { keyPath: 'id' });
  };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const tx = async (store, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const q = fn(t.objectStore(store));
    t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error);
  });
};
export const db = {
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
  put: (store, rec) => tx(store, 'readwrite', (s) => s.put(rec)),
  del: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
};
