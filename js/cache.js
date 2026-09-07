/* Rendered squares are kept in this browser (IndexedDB) so a refresh at the same
   address paints instantly instead of re-reading the archive. Keyed by year and
   the exact window. Silently a no-op where IndexedDB is unavailable. */
(function () {
  const DB = 'drapp-cache', STORE = 'windows', MAX_ENTRIES = 240;   // ~20 addresses × 12 years
  let dbp = null;

  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('at', 'at');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }

  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  function keyFor(year, win) {
    return `${year}|${win.side}|${win.px}|${win.xmin.toFixed(2)}|${win.ymin.toFixed(2)}`;
  }

  async function get(year, win) {
    const db = await openDb();
    if (!db) return null;
    try {
      const rec = await tx(db, 'readonly', (s) => s.get(keyFor(year, win)));
      return rec || null;
    } catch (e) { return null; }
  }

  async function put(year, win, canvas, extra) {
    const db = await openDb();
    if (!db) return;
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) return;
    try {
      await tx(db, 'readwrite', (s) => s.put({ key: keyFor(year, win), year, blob, at: Date.now(), ...extra }));
      await prune(db);
    } catch (e) { /* quota or private mode: fine, just no cache */ }
  }

  async function prune(db) {
    const count = await tx(db, 'readonly', (s) => s.count());
    if (count <= MAX_ENTRIES) return;
    await new Promise((resolve) => {
      const t = db.transaction(STORE, 'readwrite');
      let toDrop = count - MAX_ENTRIES;
      t.objectStore(STORE).index('at').openCursor().onsuccess = (ev) => {
        const c = ev.target.result;
        if (c && toDrop-- > 0) { c.delete(); c.continue(); }
      };
      t.oncomplete = resolve; t.onerror = resolve;
    });
  }

  async function stats() {
    const db = await openDb();
    if (!db) return { entries: 0, bytes: 0 };
    try {
      const all = await tx(db, 'readonly', (s) => s.getAll());
      return { entries: all.length, bytes: all.reduce((n, r) => n + (r.blob ? r.blob.size : 0), 0) };
    } catch (e) { return { entries: 0, bytes: 0 }; }
  }

  async function clear() {
    const db = await openDb();
    if (!db) return;
    try { await tx(db, 'readwrite', (s) => s.clear()); } catch (e) { /* ignore */ }
  }

  /* Paint a cached record onto a canvas. */
  function draw(rec, canvas) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(rec.blob);
      const im = new Image();
      im.onload = () => { canvas.getContext('2d').drawImage(im, 0, 0); URL.revokeObjectURL(url); resolve(); };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('cached image unreadable')); };
      im.src = url;
    });
  }

  DRAPP.cache = { get, put, draw, stats, clear };
})();
