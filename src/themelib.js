// Библиотека тем: окно с темами из репозитория GitHub Whisper-Music/whisper-themes.
// Файлы приносит Rust (src-tauri/src/themelib.rs → themelib_fetch): только из этого репозитория и только
// index.json, previews/<id>.<jpg|png|webp> и themes/<id>.wmt. Установка — тем же путём, что «Загрузить тему…»
// (theme.js → wmtImport): тема проходит ту же проверку и сразу включается.
//
// index.json в репозитории:
//   { "format": 1, "themes": [ { "id", "name", "author", "description", "version", "base",
//                                "file": "themes/<id>.wmt", "preview": "previews/<id>.jpg", "size", "tags": [] } ] }
(() => {
  const REPO = "https://github.com/Whisper-Music/whisper-themes";
  const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
  const BUILTIN = ["neon", "royal", "steam", "lolitta"];
  const BASES = { neon: "Неон", royal: "Королевский", steam: "Стимпанк", lolitta: "Lolitta" };

  let index = null;                        // разобранный список (на время работы приложения)
  const previews = new Map();             // id -> blob: URL картинки
  let m = null;                            // открытое окно

  const fetchLib = async (path) => {
    const r = await invoke("themelib_fetch", { path });      // ArrayBuffer (tauri::ipc::Response)
    return new Uint8Array(r);
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const str = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n) : "");
  const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " МБ" : Math.max(1, Math.round(b / 1024)) + " КБ");

  // ---------- список ----------
  // Всё, что пришло из сети, проверяем: лишнее отбрасываем, пути — только те, что разрешит и Rust
  function parseIndex(bytes) {
    let j;
    try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("список тем повреждён"); }
    if (!j || !Array.isArray(j.themes)) throw new Error("непонятный формат списка тем");
    if (Number(j.format) > 1) throw new Error("список тем новее этой версии приложения — обнови приложение");
    const seen = new Set(), out = [];
    for (const t of j.themes.slice(0, 500)) {
      const id = str(t?.id, 48);
      if (!ID.test(id) || BUILTIN.includes(id) || seen.has(id)) continue;
      const file = `themes/${id}.wmt`;
      if (t.file && t.file !== file) continue;
      const pv = typeof t.preview === "string" && new RegExp(`^previews/${id}\\.(jpg|jpeg|png|webp)$`).test(t.preview) ? t.preview : "";
      seen.add(id);
      out.push({
        id, file, preview: pv,
        name: str(t.name, 60) || id,
        author: str(t.author, 40),
        desc: str(t.description, 200),
        version: str(t.version, 20),
        base: BASES[t.base] ? t.base : "neon",
        size: Number.isFinite(t.size) && t.size > 0 ? t.size : 0,
        tags: (Array.isArray(t.tags) ? t.tags : []).map((x) => str(x, 24)).filter(Boolean).slice(0, 6),
      });
    }
    return out;
  }
  async function loadIndex(force) {
    if (index && !force) return index;
    index = parseIndex(await fetchLib("index.json"));
    return index;
  }

  // картинки — по три за раз, чтобы не забивать канал, пока листают
  const pvQueue = [];
  let pvBusy = 0;
  function preview(t, img) {
    if (!t.preview) return;
    if (previews.has(t.id)) { img.src = previews.get(t.id); return; }
    pvQueue.push([t, img]); pump();
  }
  function pump() {
    while (pvBusy < 3 && pvQueue.length) {
      const [t, img] = pvQueue.shift();
      if (previews.has(t.id)) { img.src = previews.get(t.id); continue; }
      pvBusy++;
      fetchLib(t.preview)
        .then((b) => {
          const type = /\.png$/.test(t.preview) ? "image/png" : /\.webp$/.test(t.preview) ? "image/webp" : "image/jpeg";
          const u = URL.createObjectURL(new Blob([b], { type }));
          previews.set(t.id, u); img.src = u;
        })
        .catch(() => img.closest(".tlcard")?.classList.add("nopv"))
        .finally(() => { pvBusy--; pump(); });
    }
  }

  // ---------- состояние темы у пользователя ----------
  function stateOf(t) {
    const mine = cfg.themes.find((x) => x.id === t.id);
    if (!mine) return "new";
    const v = window.wmtVersion?.(t.id) || "";
    if (t.version && v && t.version !== v) return "update";
    return cfg.style === t.id ? "active" : "installed";
  }
  function paintButton(t, b) {
    const s = stateOf(t);
    b.disabled = s === "active";
    b.classList.toggle("active", s === "new" || s === "update");
    b.textContent = { new: "Установить", update: `Обновить до ${t.version}`, installed: "Включить", active: "Включена" }[s];
    b.title = { new: "Скачать тему и сразу включить", update: "В библиотеке новая версия темы", installed: "Тема уже установлена — включить её", active: "Эта тема сейчас включена" }[s];
  }

  async function install(t, b) {
    const s = stateOf(t);
    if (s === "installed") { cfg.style = t.id; applyCfg(); saveCfg(); syncControls(); repaint(); return; }
    b.disabled = true; b.textContent = "Скачиваю…";
    try {
      const bytes = await fetchLib(t.file);
      // файл должен быть той самой темой из списка — иначе он мог бы подменить чужую установленную тему
      const th = await WMT.open(bytes);
      if (th.manifest?.id !== t.id) throw new Error("файл темы не совпадает со списком библиотеки");
      b.textContent = "Устанавливаю…";
      const ok = await window.wmtImport(bytes);
      if (!ok) throw new Error("тема не прошла проверку — подробности в настройках");
    } catch (e) {
      showToast(`«${t.name}»: ${e?.message || e}`, 5000);
    }
    repaint();
  }

  // ---------- окно ----------
  function openLib() {
    if (m) return;
    const wrap = el("div", "login modal");
    const box = el("div", "panel login-box modalbox tlmodal");
    const head = el("div", "tlhead");
    head.append(el("h2", "", "Библиотека тем"));
    const find = el("input", "field tlfind"); find.type = "search"; find.placeholder = "Название, автор, описание"; find.spellcheck = false;
    head.append(find);
    const grid = el("div", "tlgrid");
    const note = el("p", "status tlnote");
    const foot = el("div", "row tlfoot");
    const repo = el("button", "nav", "Репозиторий на GitHub"); repo.type = "button";
    repo.title = "Там же можно предложить свою тему";
    repo.onclick = () => { try { window.__TAURI__.opener.openUrl(REPO); } catch {} };
    const reload = el("button", "nav", "Обновить список"); reload.type = "button";
    const done = el("button", "nav active", "Готово"); done.type = "button";
    foot.append(repo, reload, done);
    box.append(head, note, grid, foot);
    wrap.append(box); document.body.append(wrap);

    const close = () => { document.removeEventListener("keydown", onKey, true); wrap.remove(); m = null; };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    done.onclick = close;
    wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
    find.oninput = () => filter();
    reload.onclick = () => load(true);

    m = { grid, note, find, reload, cards: [] };
    load(false);
    setTimeout(() => find.focus(), 0);
  }

  async function load(force) {
    if (!m) return;
    m.note.textContent = "Загружаю список тем…"; m.note.hidden = false;
    m.reload.disabled = true;
    try {
      const list = await loadIndex(force);
      if (!m) return;
      render(list);
      m.note.textContent = list.length ? "" : "В библиотеке пока нет тем.";
      m.note.hidden = !!list.length;
    } catch (e) {
      if (!m) return;
      m.grid.textContent = "";
      m.note.textContent = "Не удалось получить список тем: " + (e?.message || e) + ". Проверь интернет и нажми «Обновить список».";
    } finally {
      if (m) m.reload.disabled = false;
    }
  }

  function render(list) {
    m.grid.textContent = ""; m.cards = [];
    for (const t of list) {
      const c = el("article", "tlcard");
      const pv = el("div", "tlpv"); const img = el("img"); img.alt = ""; img.decoding = "async"; pv.append(img);
      img.onload = () => c.classList.add("pvok");
      const body = el("div", "tlbody");
      const nm = el("b", "tlname"); nm.textContent = t.name;
      const by = el("small", "tlby", [t.author, t.version && "v" + t.version].filter(Boolean).join(" · "));
      const d = el("p", "tldesc", t.desc);
      const meta = el("div", "tlmeta");
      for (const x of [BASES[t.base] && "основа: " + BASES[t.base], t.size && size(t.size), ...t.tags].filter(Boolean)) meta.append(el("span", "", x));
      const b = el("button", "nav tlbtn"); b.type = "button";
      b.onclick = () => install(t, b);
      paintButton(t, b);
      body.append(nm, by, d, meta, b);
      c.append(pv, body);
      m.grid.append(c);
      m.cards.push({ t, c, b, text: [t.name, t.author, t.desc, ...t.tags].join(" ").toLowerCase() });
      if (!t.preview) c.classList.add("nopv"); else preview(t, img);
    }
    filter();
  }
  function filter() {
    if (!m) return;
    const q = m.find.value.trim().toLowerCase();
    let shown = 0;
    for (const x of m.cards) { const on = !q || x.text.includes(q); x.c.hidden = !on; if (on) shown++; }
    if (m.cards.length) { m.note.hidden = !!shown; m.note.textContent = shown ? "" : "Ничего не нашлось."; }
  }
  function repaint() { if (m) for (const x of m.cards) paintButton(x.t, x.b); }

  window.themeLibOpen = openLib;
  // кнопку «Библиотека тем» создаёт theme.js (строка с «Загрузить тему…») — ловим нажатие на документе
  document.addEventListener("click", (e) => { if (e.target.closest?.("#wmtLib")) openLib(); });
})();
