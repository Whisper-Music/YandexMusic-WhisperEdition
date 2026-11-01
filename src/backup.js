// Резервные копии: файл .wbak с настройками, закреплёнными, темами, фонами и статистикой, автокопии на случай
// повреждения данных и восстановление из них. Карточка «Резервная копия» — Настройки → Приложение.
//
// Файл .wbak — zip (собирает WMT.zip из core/wmt.js): backup.json (список содержимого и настройки localStorage)
// + idb/… (темы, фоны, обложки плейлистов, статистика из IndexedDB). Сохраняет Rust (backup.rs) через диалог.
// Токенов в копии нет и быть не может: вход в Яндекс и ключ Whisper Archive лежат в системном хранилище (secret.rs),
// страница их не видит. Вдобавок здесь отсекаются ключи с «token/secret/…» в имени, старый ym_token и данные
// аккаунта (номер пользователя, кэш лайков) — копию можно спокойно переносить на другой компьютер.
//
// Автокопии (Rust хранит последние 8 каждого вида в папке настроек приложения, подпапка backups):
//   * настройки страницы — раз в 3 часа (если что-то изменилось) и перед любым восстановлением;
//   * список скачанных треков и папки загрузок — пишет сам download.rs; повреждённые он восстанавливает при запуске сам.
// Повреждённые настройки страницы замечает lsguard.js до запуска main.js — тогда здесь предлагается откат.
(() => {
  const FORMAT = "whisper-backup", SNAP_FORMAT = "whisper-settings", VER = 1;
  const MAX_FILE = 512 * 1048576, MAX_UNPACKED = 768 * 1048576, MAX_ENTRIES = 2000, MAX_LS_VALUE = 4 * 1048576;
  const SNAP_EVERY = 3 * 3600 * 1000;
  // что не уходит в копию ни при каких условиях
  const SECRET_RE = /token|secret|passw|cookie|session|credential|api[_-]?key/i;
  // данные аккаунта и производные кэши: на другом аккаунте или компьютере они только навредят
  const SKIP = new Set(["ym_token", "ym_uid", "ym_liked_ids", "ym_disliked_ids", "ym_boot", "wa_index", "wa_index_mine", "wa_email"]);
  const lsOk = (k) => typeof k === "string" && k.length > 0 && k.length <= 120 && !SECRET_RE.test(k) && !SKIP.has(k);
  // IndexedDB «whisper-edition» → группы копии
  const GROUPS = [
    { id: "themes", name: "Загруженные темы", test: (k) => /^theme:[a-z0-9][a-z0-9-]{0,47}$/.test(k) },
    { id: "bg", name: "Фоны и обложки плейлистов", test: (k) => /^bg:[a-z0-9][a-z0-9-]{0,47}$/.test(k) || /^plcover:\d{1,20}:[\w-]{1,40}$/.test(k) },
    { id: "stats", name: "Статистика прослушиваний", test: (k) => k === "lstats:v1" },
  ];
  const groupOf = (k) => GROUPS.find((g) => g.test(k))?.id || null;

  const $b = (id) => document.getElementById(id);
  const note = (t) => { const n = $b("bkNote"); if (n) n.textContent = t || ""; };
  const fmtSize = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`;
  const fmtDate = (ms) => new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 2 ? "только что" : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : fmtDate(ms);
  };
  const appVersion = async () => { try { return await window.__TAURI__.app.getVersion(); } catch { return ""; } };

  // ---------- что есть сейчас ----------
  function lsDump() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!lsOk(k)) continue;
      const v = localStorage.getItem(k);
      if (v != null && v.length <= MAX_LS_VALUE) out[k] = v;
    }
    return out;
  }
  const idbKeys = async () => { try { return (await IDB.tx("readonly", (s) => s.getAllKeys())) || []; } catch { return []; } };
  const sizeOf = (v) => v instanceof Blob ? v.size : typeof v === "string" ? v.length * 2 : v instanceof ArrayBuffer ? v.byteLength : (() => { try { return JSON.stringify(v).length; } catch { return 0; } })();

  // ---------- zip: запись — WMT.zip, чтение — своё (у WMT.unzip потолок под темы, 64 МБ) ----------
  const u16 = (b, p) => b[p] | (b[p + 1] << 8);
  const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  let CRC = null;
  function crc32(b) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function inflate(raw, size) {
    const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const out = new Uint8Array(size);
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > size) { reader.cancel().catch(() => {}); throw new Error("файл распаковывается в больший размер, чем заявлено"); }
      out.set(value, n); n += value.length;
    }
    return out.subarray(0, n);
  }
  async function unzip(b) {
    const bad = (why) => new Error("Файл копии повреждён: " + why);
    let e = -1;
    for (let p = b.length - 22; p >= Math.max(0, b.length - 65557); p--) if (u32(b, p) === 0x06054b50) { e = p; break; }
    if (e < 0) throw new Error("Это не файл резервной копии");
    const count = u16(b, e + 10), cdStart = u32(b, e + 16);
    if (count > MAX_ENTRIES) throw bad("слишком много файлов");
    const files = new Map(), dec = new TextDecoder();
    let p = cdStart, total = 0;
    for (let k = 0; k < count; k++) {
      if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw bad("оглавление");
      const flags = u16(b, p + 8), method = u16(b, p + 10), crc = u32(b, p + 16), csize = u32(b, p + 20), size = u32(b, p + 24);
      const nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), off = u32(b, p + 42);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith("/")) continue;
      if (flags & 1) throw bad("файл зашифрован");
      if (files.has(name)) throw bad(`два файла «${name}»`);
      if ((total += size) > MAX_UNPACKED) throw bad("распакованные данные слишком большие");
      if (off + 30 > b.length || u32(b, off) !== 0x04034b50) throw bad(`«${name}»`);
      const start = off + 30 + u16(b, off + 26) + u16(b, off + 28), end = start + csize;
      if (end > b.length || end > cdStart) throw bad(`данные «${name}» за пределами файла`);
      const raw = b.subarray(start, end);
      const data = method === 0 ? raw : method === 8 ? await inflate(raw, size) : null;
      if (!data) throw bad(`«${name}» сжат неизвестным способом`);
      if (data.length !== size || crc32(data) !== crc) throw bad(`контрольная сумма «${name}» не сходится`);
      files.set(name, data);
    }
    return files;
  }

  // ---------- сохранение копии ----------
  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm" };
  async function collect(groups) {
    const enc = new TextEncoder(), files = [], idb = [];
    let n = 0;
    for (const k of await idbKeys()) {
      const g = typeof k === "string" ? groupOf(k) : null;
      if (!g || !groups.has(g)) continue;
      let v;
      try { v = await IDB.get(k); } catch { continue; }
      if (v == null) continue;
      const base = `idb/${++n}`;
      if (typeof v === "string") { files.push({ name: base + ".txt", bytes: enc.encode(v) }); idb.push({ key: k, file: base + ".txt", type: "string" }); }
      else if (v instanceof Blob) {
        const name = `${base}.${EXT[v.type] || "bin"}`;
        files.push({ name, bytes: new Uint8Array(await v.arrayBuffer()) });
        idb.push({ key: k, file: name, type: "blob", mime: String(v.type || "").slice(0, 100) });
      } else {
        let j;
        try { j = JSON.stringify(v); } catch { continue; }
        files.push({ name: base + ".json", bytes: enc.encode(j) }); idb.push({ key: k, file: base + ".json", type: "json" });
      }
    }
    const ls = lsDump();
    const manifest = { format: FORMAT, v: VER, app: "Yandex Music — Whisper Edition", version: await appVersion(), created: new Date().toISOString(), groups: ["settings", ...groups], ls, idb };
    return [{ name: "backup.json", bytes: enc.encode(JSON.stringify(manifest)) }, ...files];
  }

  // окно выбора: что положить в копию (размеры — чтобы было видно, откуда большой файл)
  async function pickGroups() {
    const sizes = Object.fromEntries(GROUPS.map((g) => [g.id, { n: 0, bytes: 0 }]));
    for (const k of await idbKeys()) {
      const g = typeof k === "string" ? groupOf(k) : null;
      if (!g) continue;
      sizes[g].n++;
      try { sizes[g].bytes += sizeOf(await IDB.get(k)); } catch {}
    }
    return new Promise((resolve) => {
      closeTrackMenu?.();
      const wrap = document.createElement("div"); wrap.className = "login modal";
      const box = document.createElement("form"); box.className = "panel login-box modalbox bkbox"; box.noValidate = true;
      box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Резервная копия");
      const h = document.createElement("h2"); h.textContent = "Резервная копия";
      const p = document.createElement("p"); p.textContent = "Настройки, цвета, закреплённые, горячие клавиши и расположение попадут в копию всегда. Токены входа — никогда.";
      box.append(h, p);
      const checks = [];
      for (const g of GROUPS) {
        const s = sizes[g.id];
        const l = document.createElement("label"); l.className = "switch";
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = s.n > 0; cb.disabled = s.n === 0; cb.value = g.id;
        const sp = document.createElement("span"); sp.textContent = g.name;
        const sm = document.createElement("small"); sm.textContent = s.n ? `${s.n} · ${fmtSize(s.bytes)}` : "нет";
        sp.append(sm);
        l.append(cb, document.createElement("i"), sp); box.append(l); checks.push(cb);
      }
      const row = document.createElement("div"); row.className = "row";
      const no = document.createElement("button"); no.type = "button"; no.className = "nav"; no.textContent = "Отмена";
      const yes = document.createElement("button"); yes.type = "submit"; yes.className = "nav active"; yes.textContent = "Сохранить…";
      row.append(no, yes); box.append(row);
      const done = (v) => { document.removeEventListener("keydown", onKey, true); wrap.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
      document.addEventListener("keydown", onKey, true);
      no.onclick = () => done(null);
      wrap.onpointerdown = (e) => { if (e.target === wrap) done(null); };
      box.onsubmit = (e) => { e.preventDefault(); done(new Set(checks.filter((c) => c.checked).map((c) => c.value))); };
      wrap.append(box); document.body.append(wrap); yes.focus();
    });
  }

  let busy = false;
  async function save() {
    if (busy) return;
    const groups = await pickGroups();
    if (!groups) return;
    busy = true; note("Копия собирается…");
    try {
      const data = await WMT.zip(await collect(groups));
      if (data.length > MAX_FILE) throw new Error(`копия больше ${MAX_FILE / 1048576} МБ — сними галочку с фонов`);
      const day = new Date().toISOString().slice(0, 10);
      const path = await window.__TAURI__.core.invoke("backup_save", data, { headers: { "x-backup-name": `whisper-backup-${day}` } });
      note(path ? `Сохранено: ${path} (${fmtSize(data.length)})` : "");
      if (path) showToast("Резервная копия сохранена", 3000, { kind: "ok" });
    } catch (e) { note("Не удалось сохранить копию: " + (e?.message || e)); }
    finally { busy = false; }
  }

  // ---------- восстановление из файла ----------
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
  function readManifest(files) {
    const raw = files.get("backup.json");
    if (!raw) throw new Error("в файле нет backup.json — это не резервная копия Whisper");
    let m;
    try { m = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error("backup.json повреждён"); }
    if (m?.format !== FORMAT || typeof m.v !== "number") throw new Error("это не резервная копия Whisper");
    if (m.v > VER) throw new Error("копия сделана более новой версией приложения — обнови Whisper");
    if (!m.ls || typeof m.ls !== "object" || !Array.isArray(m.idb)) throw new Error("backup.json повреждён");
    return m;
  }
  const summary = (m) => {
    const cnt = {};
    for (const e of m.idb) { const g = groupOf(String(e?.key)); if (g) cnt[g] = (cnt[g] || 0) + 1; }
    const parts = [`настройки (${Object.keys(m.ls).filter(lsOk).length})`];
    if (cnt.themes) parts.push(`темы (${cnt.themes})`);
    if (cnt.bg) parts.push(`фоны и обложки (${cnt.bg})`);
    if (cnt.stats) parts.push("статистика");
    return parts.join(", ");
  };

  // записать настройки и данные; ключи, которых нет в копии, остаются как есть (кроме повреждённых — их убираем)
  async function apply(ls, idbEntries) {
    for (const [k, v] of Object.entries(ls)) {
      if (!lsOk(k) || typeof v !== "string" || v.length > MAX_LS_VALUE) continue;
      try { localStorage.setItem(k, v); } catch (e) { throw new Error("не хватило места для настроек: " + (e?.message || e)); }
    }
    for (const k of window.__lsCheck?.broken || []) if (!(k in ls)) { try { localStorage.removeItem(k); } catch {} }
    for (const [k, v] of idbEntries) await IDB.set(k, v);
  }

  async function restoreFile(file) {
    if (busy) return;
    if (file.size > MAX_FILE) { note(`Файл больше ${MAX_FILE / 1048576} МБ — это не резервная копия Whisper`); return; }
    busy = true; note("Файл читается…");
    try {
      const files = await unzip(new Uint8Array(await file.arrayBuffer()));
      const m = readManifest(files);
      const when = Date.parse(m.created);
      const ok = await modal({
        title: "Восстановить из копии?",
        text: `Копия ${isFinite(when) ? "от " + fmtDate(when) : "без даты"}${m.version ? `, версия ${m.version}` : ""}: ${summary(m)}. ` +
          "Эти настройки заменят текущие, приложение перезапустит интерфейс. Текущие настройки сначала сохранятся в автокопию — их можно будет вернуть.",
        ok: "Восстановить",
      });
      if (!ok) { note(""); return; }
      note("Восстанавливается…");
      // данные из файла проверяем до записи: ключ из известной группы, файл на месте, значение читается
      const entries = [];
      for (const e of m.idb) {
        const k = String(e?.key || "");
        if (!groupOf(k) || (k.startsWith("theme:") && !ID_RE.test(k.slice(6)))) continue;
        const bytes = files.get(String(e.file || ""));
        if (!bytes) continue;
        if (e.type === "string") entries.push([k, new TextDecoder().decode(bytes)]);
        else if (e.type === "blob") entries.push([k, new Blob([bytes], { type: /^[\w.+-]+\/[\w.+-]+$/.test(e.mime || "") ? e.mime : "" })]);
        else if (e.type === "json") { try { entries.push([k, JSON.parse(new TextDecoder().decode(bytes))]); } catch {} }
      }
      await snapshot(true);
      await apply(m.ls, entries);
      showToast("Копия восстановлена — интерфейс перезапускается", 0, { kind: "ok" });
      setTimeout(() => location.reload(), 900);
    } catch (e) { note("Не удалось восстановить: " + (e?.message || e)); }
    finally { busy = false; }
  }

  // ---------- автокопии ----------
  const snapData = async () => {
    const data = { format: SNAP_FORMAT, v: VER, version: await appVersion(), created: new Date().toISOString(), ls: lsDump(), idb: {} };
    try {
      const st = await IDB.get("lstats:v1");      // статистика — небольшой JSON, без неё автокопия была бы неполной
      if (st != null) { const j = JSON.stringify(st); if (j.length < 8 * 1048576) data.idb["lstats:v1"] = st; }
    } catch {}
    return JSON.stringify(data);
  };
  // перед восстановлением — обязательно (force); по таймеру — Rust сам пропустит, если рано или ничего не менялось
  async function snapshot(force = false) {
    try { return await invoke("snap_settings_save", { json: await snapData(), force }); } catch (e) { console.warn("автокопия настроек:", e?.message || e); return false; }
  }
  const listSnaps = (kind) => invoke("snap_list", { kind }).catch(() => []);

  async function restoreSnap(name) {
    const raw = await invoke("snap_settings_read", { name });
    let d;
    try { d = JSON.parse(raw); } catch { throw new Error("автокопия повреждена"); }
    if (d?.format !== SNAP_FORMAT || !d.ls || typeof d.ls !== "object") throw new Error("автокопия повреждена");
    const entries = [];
    if (d.idb?.["lstats:v1"] && typeof d.idb["lstats:v1"] === "object") entries.push(["lstats:v1", d.idb["lstats:v1"]]);
    await snapshot(true);
    await apply(d.ls, entries);
    showToast("Настройки восстановлены — интерфейс перезапускается", 0, { kind: "ok" });
    setTimeout(() => location.reload(), 900);
  }

  // окно со списком автокопий: настройки страницы и список скачанных треков
  async function autoDialog() {
    closeTrackMenu?.();
    const [sets, idx] = await Promise.all([listSnaps("settings"), listSnaps("downloaded")]);
    const wrap = document.createElement("div"); wrap.className = "login modal";
    const box = document.createElement("div"); box.className = "panel login-box modalbox bkbox";
    box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Автокопии");
    const h = document.createElement("h2"); h.textContent = "Автокопии";
    const p = document.createElement("p");
    p.textContent = "Whisper сам сохраняет настройки и список скачанных треков. Если что-то сломалось или пропало — выбери, на какой момент вернуть.";
    box.append(h, p);
    const close = () => { document.removeEventListener("keydown", onKey, true); wrap.remove(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const st = document.createElement("p"); st.className = "status";
    const section = (title, list, empty, fn) => {
      const h3 = document.createElement("h3"); h3.textContent = title; box.append(h3);
      if (!list.length) { const e = document.createElement("p"); e.className = "status"; e.textContent = empty; box.append(e); return; }
      const ul = document.createElement("div"); ul.className = "bklist";
      for (const s of list) {
        const b = document.createElement("button"); b.type = "button"; b.className = "outdev";
        const t = document.createElement("span"); t.className = "olbl"; t.textContent = fmtDate(s.ts * 1000);
        const sm = document.createElement("small"); sm.textContent = fmtSize(s.size);
        b.append(t, sm);
        b.onclick = async () => {
          if (box.inert) return;
          box.inert = true; st.textContent = "Восстанавливается…";
          try { await fn(s); } catch (e) { st.textContent = "Не удалось: " + (e?.message || e); }
          finally { box.inert = false; }
        };
        ul.append(b);
      }
      box.append(ul);
    };
    section("Настройки", sets, "Автокопий пока нет — первая появится через минуту после запуска.", (s) => restoreSnap(s.name));
    section("Список скачанных треков", idx, "Автокопий пока нет — она появится после скачивания трека.", async (s) => {
      const n = await invoke("dl_index_restore", { name: s.name });
      close();
      if (typeof loadGot === "function") await loadGot();
      showToast(`Список скачанных восстановлен: ${n} ${n % 10 === 1 && n % 100 !== 11 ? "трек" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "трека" : "треков"}`, 5000, { kind: "ok" });
    });
    const row = document.createElement("div"); row.className = "row";
    const x = document.createElement("button"); x.type = "button"; x.className = "nav"; x.textContent = "Закрыть"; x.onclick = close;
    row.append(x); box.append(st, row);
    wrap.append(box); document.body.append(wrap);
    document.addEventListener("keydown", onKey, true);
    wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
    x.focus();
  }

  async function paintAuto() {
    const el = $b("bkAuto");
    if (!el) return;
    const [sets, idx] = await Promise.all([listSnaps("settings"), listSnaps("downloaded")]);
    const last = (l) => (l.length ? ago(l[0].ts * 1000) : "нет");
    el.textContent = `Настройки: ${last(sets)} · скачанные: ${last(idx)}`;
  }

  // ---------- при запуске ----------
  // Через пару секунд: что Rust восстановил сам (список скачанных, папки загрузок) и не повреждены ли настройки
  // страницы. Автокопия по таймеру — через минуту, и только если всё цело: иначе «сброшенные» настройки
  // вытеснили бы целые копии, пока пользователь решает.
  async function startup() {
    try { for (const m of await invoke("recovery_status")) showToast(m, 9000); } catch {}
    const chk = window.__lsCheck || { broken: [], empty: false };
    const latest = (await listSnaps("settings"))[0];
    if (chk.broken.length || (chk.empty && latest)) {
      if (latest) {
        const what = chk.empty ? "Настройки оказались пустыми" : `Часть настроек была повреждена (${chk.broken.length})`;
        showToast(`${what} — вернуть из автокопии от ${fmtDate(latest.ts * 1000)}?`, 0, {
          action: { label: "Вернуть", fn: () => restoreSnap(latest.name).catch((e) => showToast("Не удалось: " + (e?.message || e), 6000, { kind: "err" })) },
        });
      } else if (chk.broken.length) showToast(`Часть настроек была повреждена (${chk.broken.length}) и сброшена к начальным`, 7000);
      return;
    }
    setTimeout(() => snapshot(false).then(paintAuto), 60000);
    setInterval(() => snapshot(false).then(paintAuto), SNAP_EVERY);
  }
  setTimeout(startup, 2500);

  // ---------- карточка ----------
  const pick = document.createElement("input");
  pick.type = "file"; pick.accept = ".wbak,.zip"; pick.hidden = true;
  pick.onchange = () => { const f = pick.files?.[0]; pick.value = ""; if (f) restoreFile(f); };
  document.body.append(pick);
  $b("bkSave")?.addEventListener("click", save);
  $b("bkLoad")?.addEventListener("click", () => pick.click());
  $b("bkAutoBtn")?.addEventListener("click", () => autoDialog().catch((e) => note("Не удалось открыть автокопии: " + (e?.message || e))));
  const page = $b("settingsPage");
  if (page) new MutationObserver(() => { if (!page.hidden && page.dataset.tab === "app") paintAuto(); }).observe(page, { attributes: true, attributeFilter: ["hidden", "data-tab"] });

  window.backupNow = () => snapshot(true);       // для отладки и других модулей: автокопия настроек сейчас
})();
