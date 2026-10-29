// Библиотека тем: окно с темами из репозитория GitHub Whisper-Music/whisper-themes.
// Файлы приносит Rust (src-tauri/src/themelib.rs → themelib_fetch): только из этого репозитория и только
// index.json, previews/<папка>/<id>.<jpg|png|webp> и themes/<папка>/<id>.wmt. Установка — тем же путём,
// что «Загрузить тему…» (theme.js → wmtImport): тема проходит ту же проверку и сразу включается.
//
// Темы разложены по папкам (CATS): сначала окно показывает папки, по нажатию — темы папки,
// в папке «По артистам» — ещё и по исполнителям. Поиск ищет сразу во всех папках.
//
// index.json в репозитории (format 2):
//   { "format": 2,
//     "categories": [ { "id", "name", "description" } ],            — подписи папок (необязательно)
//     "themes": [ { "id", "category", "name", "author", "artist", "description", "version", "base",
//                   "file": "themes/<папка>/<id>.wmt", "preview": "previews/<папка>/<id>.jpg", "size", "tags": [] } ] }
// Список старого вида (format 1: themes/<id>.wmt без папок) тоже читается — такие темы попадают в «Whisper Music».
(() => {
  const REPO = "https://github.com/Whisper-Music/whisper-themes";
  const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
  const BUILTIN = ["neon", "royal", "steam", "lolitta"];
  const BASES = { neon: "Неон", royal: "Королевский", steam: "Стимпанк", lolitta: "Lolitta" };
  const FORMAT = 2;
  // Папки библиотеки. Тот же список — в themelib.rs (CATEGORIES): других путей Rust не скачает.
  const CATS = [
    { id: "whisper", name: "Whisper Music", desc: "Темы от автора приложения" },
    { id: "community", name: "Пользователи", desc: "Темы, которые прислали пользователи" },
    { id: "artists", name: "По артистам", desc: "Темы в стиле конкретного исполнителя" },
  ];
  const CAT_IDS = CATS.map((c) => c.id);

  let index = null;                        // { cats, themes } — разобранный список (на время работы приложения)
  const previews = new Map();             // id -> blob: URL картинки
  let m = null;                            // открытое окно
  let lastCat = null;                      // какая папка была открыта в прошлый раз (до перезапуска)

  const fetchLib = async (path) => {
    const r = await invoke("themelib_fetch", { path });      // ArrayBuffer (tauri::ipc::Response)
    return new Uint8Array(r);
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const str = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n) : "");
  const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " МБ" : Math.max(1, Math.round(b / 1024)) + " КБ");
  const plural = (n, a, b, c) => { const d = n % 10, h = n % 100; return d === 1 && h !== 11 ? a : d >= 2 && d <= 4 && (h < 12 || h > 14) ? b : c; };
  const count = (n) => `${n} ${plural(n, "тема", "темы", "тем")}`;

  // ---------- список ----------
  // Всё, что пришло из сети, проверяем: лишнее отбрасываем, пути — только те, что разрешит и Rust
  function parseIndex(bytes) {
    let j;
    try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("список тем повреждён"); }
    if (!j || !Array.isArray(j.themes)) throw new Error("непонятный формат списка тем");
    if (Number(j.format) > FORMAT) throw new Error("список тем новее этой версии приложения — обнови приложение");
    // подписи папок: из списка можно поменять название и описание, но не добавить новую папку
    const names = new Map((Array.isArray(j.categories) ? j.categories : []).map((c) => [str(c?.id, 24), c]));
    const cats = CATS.map((c) => ({ id: c.id, name: str(names.get(c.id)?.name, 40) || c.name, desc: str(names.get(c.id)?.description, 120) || c.desc }));
    const seen = new Set(), themes = [];
    for (const t of j.themes.slice(0, 1000)) {
      const id = str(t?.id, 48);
      if (!ID.test(id) || BUILTIN.includes(id) || seen.has(id)) continue;
      const flat = Number(j.format) < 2;                     // format 1: файлы без папок
      const cat = flat ? "whisper" : str(t.category, 24);
      if (!CAT_IDS.includes(cat)) continue;
      const dir = flat ? "" : cat + "/";
      const file = `themes/${dir}${id}.wmt`;
      if (t.file && t.file !== file) continue;
      const pvRe = new RegExp(`^previews/${dir}${id}\\.(jpg|jpeg|png|webp)$`);
      const pv = typeof t.preview === "string" && pvRe.test(t.preview) ? t.preview : "";
      seen.add(id);
      themes.push({
        id, cat, file, preview: pv,
        name: str(t.name, 60) || id,
        author: str(t.author, 40),
        artist: str(t.artist, 60),
        desc: str(t.description, 200),
        version: str(t.version, 20),
        base: BASES[t.base] ? t.base : "neon",
        size: Number.isFinite(t.size) && t.size > 0 ? t.size : 0,
        tags: (Array.isArray(t.tags) ? t.tags : []).map((x) => str(x, 24)).filter(Boolean).slice(0, 6),
      });
    }
    // порядок: по папкам, у артистов — по исполнителю, дальше по названию
    const ord = (t) => CAT_IDS.indexOf(t.cat);
    themes.sort((a, b) => ord(a) - ord(b) || (a.cat === "artists" ? a.artist.localeCompare(b.artist, "ru") : 0) || a.name.localeCompare(b.name, "ru"));
    return { cats, themes };
  }
  async function loadIndex(force) {
    if (index && !force) return index;
    index = parseIndex(await fetchLib("index.json"));
    return index;
  }

  // картинки — по три за раз, чтобы не забивать канал, пока листают
  const pvQueue = [];
  let pvBusy = 0;
  function preview(t, img, onFail) {
    if (!t.preview) { onFail?.(); return; }
    if (previews.has(t.id)) { img.src = previews.get(t.id); return; }
    pvQueue.push([t, img, onFail]); pump();
  }
  function pump() {
    while (pvBusy < 3 && pvQueue.length) {
      const [t, img, onFail] = pvQueue.shift();
      if (previews.has(t.id)) { img.src = previews.get(t.id); continue; }
      pvBusy++;
      fetchLib(t.preview)
        .then((b) => {
          const type = /\.png$/.test(t.preview) ? "image/png" : /\.webp$/.test(t.preview) ? "image/webp" : "image/jpeg";
          const u = URL.createObjectURL(new Blob([b], { type }));
          previews.set(t.id, u); img.src = u;
        })
        .catch(() => onFail?.())
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
    b.disabled = true; b.textContent = "Скачивается…";
    try {
      const bytes = await fetchLib(t.file);
      // файл должен быть той самой темой из списка — иначе он мог бы подменить чужую установленную тему
      const th = await WMT.open(bytes);
      if (th.manifest?.id !== t.id) throw new Error("файл темы не совпадает со списком библиотеки");
      b.textContent = "Устанавливается…";
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
    const back = el("button", "nav tlback", "←"); back.type = "button"; back.title = "Назад к папкам"; back.hidden = true;
    const crumbs = el("h2", "tlcrumbs");
    const root = el("span", "tlroot", "Библиотека тем");
    const here = el("span", "tlhere");
    crumbs.append(root, here);
    const find = el("input", "field tlfind"); find.type = "search"; find.placeholder = "Поиск по всем папкам"; find.spellcheck = false;
    head.append(back, crumbs, find);
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
    // Esc внутри папки — назад к папкам (если не идёт поиск), в списке папок — закрыть окно
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (find.value) { find.value = ""; filter(); return; }
      if (m?.cat) { openCat(null); return; }
      close();
    };
    document.addEventListener("keydown", onKey, true);
    done.onclick = close;
    wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
    find.oninput = () => filter();
    reload.onclick = () => load(true);
    back.onclick = () => openCat(null);
    root.onclick = () => { if (m?.cat || find.value) { find.value = ""; openCat(null); } };

    m = { box, grid, note, find, reload, back, here, cat: lastCat, cards: [], folders: [], groups: [] };
    load(false);
    setTimeout(() => find.focus(), 0);
  }

  async function load(force) {
    if (!m) return;
    m.note.textContent = "Список тем загружается…"; m.note.hidden = false;
    m.reload.disabled = true;
    try {
      const lib = await loadIndex(force);
      if (!m) return;
      render(lib);
    } catch (e) {
      if (!m) return;
      m.grid.textContent = ""; m.cards = []; m.folders = []; m.groups = [];
      m.note.hidden = false;
      m.note.textContent = "Не удалось получить список тем: " + (e?.message || e) + ". Проверь интернет и нажми «Обновить список».";
    } finally {
      if (m) m.reload.disabled = false;
    }
  }

  function card(t, cats) {
    const c = el("article", "tlcard");
    c.dataset.cat = t.cat;
    const pv = el("div", "tlpv"); const img = el("img"); img.alt = ""; img.decoding = "async"; pv.append(img);
    img.onload = () => c.classList.add("pvok");
    const body = el("div", "tlbody");
    const nm = el("b", "tlname"); nm.textContent = t.name;
    const by = el("small", "tlby", [t.author, t.version && "v" + t.version].filter(Boolean).join(" · "));
    const d = el("p", "tldesc", t.desc);
    const meta = el("div", "tlmeta");
    // папка — только в результатах поиска (внутри папки и так понятно, где ты)
    meta.append(el("span", "tlcat", cats.find((x) => x.id === t.cat)?.name || ""));
    if (t.artist) meta.append(el("span", "tlartist", t.artist));
    for (const x of [BASES[t.base] && "основа: " + BASES[t.base], t.size && size(t.size), ...t.tags].filter(Boolean)) meta.append(el("span", "", x));
    const b = el("button", "nav tlbtn"); b.type = "button";
    b.onclick = () => install(t, b);
    paintButton(t, b);
    body.append(nm, by, d, meta, b);
    c.append(pv, body);
    if (!t.preview) c.classList.add("nopv"); else preview(t, img, () => c.classList.add("nopv"));
    return { t, c, b, text: [t.name, t.author, t.artist, t.desc, ...t.tags].join(" ").toLowerCase() };
  }

  function folder(cat, list) {
    const f = el("button", "tlfolder"); f.type = "button";
    f.dataset.cat = cat.id;
    const mosaic = el("div", "tlmosaic");
    // обложка папки — превью первых трёх тем
    const withPv = list.filter((t) => t.preview).slice(0, 3);
    mosaic.dataset.n = String(withPv.length);
    for (const t of withPv) {
      const img = el("img"); img.alt = ""; img.decoding = "async";
      img.onload = () => img.classList.add("ok");
      mosaic.append(img); preview(t, img, () => img.remove());
    }
    const tab = el("span", "tltab");
    const body = el("span", "tlfbody");
    body.append(el("b", "tlfname", cat.name), el("small", "tlfdesc", cat.desc), el("span", "tlfcount", list.length ? count(list.length) : "Пока пусто"));
    f.append(tab, mosaic, body);
    if (!list.length) f.classList.add("empty");
    f.onclick = () => openCat(cat.id);
    return { cat, f, n: list.length };
  }

  function render(lib) {
    m.grid.textContent = ""; m.cards = []; m.folders = []; m.groups = [];
    m.cats = lib.cats;
    for (const cat of lib.cats) {
      const fo = folder(cat, lib.themes.filter((t) => t.cat === cat.id));
      m.folders.push(fo); m.grid.append(fo.f);
    }
    let lastArtist = null;
    for (const t of lib.themes) {
      // в папке артистов — заголовок перед темами каждого исполнителя
      if (t.cat === "artists" && t.artist !== lastArtist) {
        lastArtist = t.artist;
        const h = el("h3", "tlgroup", t.artist || "Без артиста");
        m.groups.push(h); m.grid.append(h);
      }
      const x = card(t, lib.cats);
      m.cards.push(x); m.grid.append(x.c);
    }
    if (m.cat && !lib.cats.some((c) => c.id === m.cat)) m.cat = null;
    filter();
  }

  function openCat(id) {
    if (!m) return;
    m.cat = id; lastCat = id;
    m.grid.scrollTop = 0;
    filter();
  }

  // что видно: папки (корень), темы одной папки или результаты поиска по всем папкам
  function filter() {
    if (!m) return;
    const q = m.find.value.trim().toLowerCase();
    const searching = !!q, cat = searching ? null : m.cat;
    const name = m.cats?.find((c) => c.id === m.cat)?.name || "";
    m.back.hidden = !m.cat || searching;
    m.here.textContent = searching ? "\u00a0/ поиск" : m.cat ? "\u00a0/ " + name : "";       // неразрывный пробел: обычный у края flex-элемента пропадает
    m.box.classList.toggle("tlin", !!cat);
    m.grid.classList.toggle("tlsearch", searching);
    m.grid.classList.toggle("tlroot", !searching && !cat);
    for (const fo of m.folders) fo.f.hidden = searching || !!cat;
    for (const h of m.groups) h.hidden = searching || cat !== "artists";
    let shown = 0;
    for (const x of m.cards) {
      const on = searching ? x.text.includes(q) : cat === x.t.cat;
      x.c.hidden = !on; if (on) shown++;
    }
    let msg = "";
    if (!m.cards.length && !m.folders.length) msg = "В библиотеке пока нет тем.";
    else if (searching && !shown) msg = "Ничего не нашлось.";
    else if (cat && !shown) msg = "В этой папке пока нет тем.";
    m.note.textContent = msg; m.note.hidden = !msg;
  }
  function repaint() { if (m) for (const x of m.cards) paintButton(x.t, x.b); }

  window.themeLibOpen = openLib;
  // кнопку «Библиотека тем» создаёт theme.js (строка с «Загрузить тему…») — ловим нажатие на документе
  document.addEventListener("click", (e) => { if (e.target.closest?.("#wmtLib")) openLib(); });
})();
