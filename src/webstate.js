// Перенос настроек и данных между окном приложения и вкладкой браузера (браузерная версия, webmode.rs).
// У окна (tauri://localhost) и вкладки (http://127.0.0.1:порт) разное хранилище, поэтому при каждом
// переключении одна сторона отдаёт всё в Rust (push), другая забирает (pull) — зеркально: что удалили, удаляется.
//   localStorage — целиком (кроме своих служебных ключей);
//   IndexedDB «whisper-edition» — строки и объекты в JSON, а Blob (темы, фоны, обложки) — отдельно, по одному;
//   у каждого Blob есть отметка (размер, тип, выборка байтов): то, что у другой стороны уже есть, не гоняется заново.
// Транспорт: WebState.tauri (окно, команды web_*) или WebState.http (вкладка, /__web/*).
(() => {
  const STAMPS = "ym_web_stamps";        // отметки Blob, которые уже лежат в IndexedDB этой стороны
  const SKIP = new Set([STAMPS]);

  // ---------- IndexedDB (своё открытие: в переходнике и на стартовой странице main.js нет) ----------
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open("whisper-edition", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  async function tx(mode, fn) {
    const db = await open();
    try {
      return await new Promise((res, rej) => {
        const t = db.transaction("kv", mode), rq = fn(t.objectStore("kv"));
        t.oncomplete = () => res(rq && rq.result);
        t.onerror = t.onabort = () => rej(t.error);
      });
    } finally { db.close(); }
  }
  const keys = () => tx("readonly", (s) => s.getAllKeys()).then((k) => k || []).catch(() => []);
  const get = (k) => tx("readonly", (s) => s.get(k));
  const put = (k, v) => tx("readwrite", (s) => s.put(v, k));
  const del = (k) => tx("readwrite", (s) => s.delete(k));

  // отметка Blob: размер, тип и FNV-1a по трём кускам (начало, середина, конец) — без чтения всех 48 МБ видео
  async function stampOf(b) {
    const N = 65536, parts = [b.slice(0, N), b.slice(Math.max(0, (b.size >> 1) - N / 2), (b.size >> 1) + N / 2), b.slice(Math.max(0, b.size - N))];
    let h = 0x811c9dc5;
    for (const p of parts) {
      const u = new Uint8Array(await p.arrayBuffer());
      for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    }
    return `${b.size}:${b.type}:${h.toString(16)}`;
  }
  const readStamps = () => { try { return JSON.parse(localStorage.getItem(STAMPS) || "{}") || {}; } catch { return {}; } };
  const saveStamps = (m) => { try { localStorage.setItem(STAMPS, JSON.stringify(m)); } catch {} };

  // ---------- отдать ----------
  async function push(t) {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k != null && !SKIP.has(k)) ls[k] = localStorage.getItem(k);
    }
    const idb = [], blobs = [];
    for (const k of await keys()) {
      if (typeof k !== "string") continue;
      let v;
      try { v = await get(k); } catch { continue; }
      if (v == null) continue;
      if (typeof v === "string") idb.push({ k, type: "string", v });
      else if (v instanceof Blob || v instanceof ArrayBuffer) {
        const b = v instanceof Blob ? v : new Blob([v]);
        const stamp = await stampOf(b);
        idb.push({ k, type: "blob", mime: b.type || "", stamp, ab: v instanceof ArrayBuffer });
        blobs.push([k, stamp, b]);
      } else {
        try { idb.push({ k, type: "json", v: JSON.parse(JSON.stringify(v)) }); } catch {}
      }
    }
    const have = (await t.stamps()) || {};
    for (const [k, stamp, b] of blobs) if (have[k] !== stamp) await t.putBlob(k, stamp, new Uint8Array(await b.arrayBuffer()));
    await t.putState({ v: 1, at: Date.now(), ls, idb });
    saveStamps(Object.fromEntries(blobs.map(([k, s]) => [k, s])));
  }

  // ---------- забрать (до запуска интерфейса этой стороны) ----------
  async function pull(t) {
    const st = await t.getState();
    if (!st || typeof st !== "object" || !st.ls || !Array.isArray(st.idb)) return false;
    for (const k of Object.keys({ ...localStorage })) if (!SKIP.has(k) && !(k in st.ls)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(st.ls)) { if (typeof v === "string") try { localStorage.setItem(k, v); } catch {} }
    const mine = readStamps(), had = new Set(await keys()), next = {};
    for (const e of st.idb) {
      if (!e || typeof e.k !== "string") continue;
      try {
        if (e.type === "string" || e.type === "json") await put(e.k, e.v);
        else if (e.type === "blob") {
          next[e.k] = e.stamp;
          if (mine[e.k] === e.stamp && had.has(e.k)) continue;        // уже есть такой же
          const buf = await t.getBlob(e.k);
          if (!buf) continue;
          await put(e.k, e.ab ? buf : new Blob([buf], { type: e.mime || "" }));
        }
      } catch {}
    }
    const want = new Set(st.idb.map((e) => e?.k));
    for (const k of had) if (typeof k === "string" && !want.has(k)) { try { await del(k); } catch {} }
    saveStamps(next);
    return true;
  }

  // ---------- транспорт ----------
  const tauri = {
    get invoke() { return window.__TAURI__.core.invoke; },
    stamps() { return this.invoke("web_stamps"); },
    putState(state) { return this.invoke("web_state_put", { state }); },
    putBlob(k, stamp, bytes) { return this.invoke("web_blob_put", bytes, { headers: { "x-key": encodeURIComponent(k), "x-stamp": encodeURIComponent(stamp) } }); },
    getState() { return this.invoke("web_state_get"); },
    async getBlob(key) { const r = await this.invoke("web_blob_get", { key }); return r instanceof ArrayBuffer ? r : r?.buffer || null; },
  };
  const H = { "X-Whisper": "1" };
  const ok = (r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r; };
  const http = {
    stamps: () => fetch("/__web/stamps", { headers: H }).then(ok).then((r) => r.json()),
    putState: (state) => fetch("/__web/state", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(state) }).then(ok),
    putBlob: (k, s, bytes) => fetch(`/__web/blob?k=${encodeURIComponent(k)}&s=${encodeURIComponent(s)}`, { method: "POST", headers: { ...H, "Content-Type": "application/octet-stream" }, body: bytes }).then(ok),
    getState: () => fetch("/__web/state", { headers: H }).then(ok).then((r) => r.json()),
    getBlob: (k) => fetch(`/__web/blob?k=${encodeURIComponent(k)}`, { headers: H }).then((r) => (r.ok ? r.arrayBuffer() : null)),
  };

  window.WebState = { push, pull, tauri, http };
})();
