/* PagaCerto — camada de base de dados (IndexedDB). Só ligação e operações genéricas.
 * Toda a lógica de negócio fica em repo.js. Os dados nunca saem do dispositivo.
 * DB_VERSION sobe quando o esquema muda; a migração faz-se em onupgradeneeded.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'pagacerto';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('payments')) {
          const s = db.createObjectStore('payments', { keyPath: 'id' });
          s.createIndex('dueDate', 'dueDate');
          s.createIndex('status', 'status');
          s.createIndex('planId', 'planId');
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('entities')) db.createObjectStore('entities', { keyPath: 'entity' });
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Base de dados bloqueada por outro separador.'));
    });
    return dbPromise;
  }

  // Executa fn(store) numa transação e resolve quando esta termina com sucesso.
  async function run(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = fn(store); } catch (e) { tx.abort(); reject(e); return; }
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transação cancelada'));
    });
  }

  const getAll = store => run(store, 'readonly', s => s.getAll());
  const get = (store, key) => run(store, 'readonly', s => s.get(key));
  const put = (store, value) => run(store, 'readwrite', s => { s.put(value); });
  const putMany = (store, values) => run(store, 'readwrite', s => { values.forEach(v => s.put(v)); });
  const del = (store, key) => run(store, 'readwrite', s => { s.delete(key); });
  const delMany = (store, keys) => run(store, 'readwrite', s => { keys.forEach(k => s.delete(k)); });
  const clear = store => run(store, 'readwrite', s => { s.clear(); });

  root.PagaDB = { open, getAll, get, put, putMany, del, delMany, clear };
}(typeof self !== 'undefined' ? self : this));
