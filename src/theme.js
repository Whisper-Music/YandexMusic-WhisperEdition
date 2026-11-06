"use strict";
// Свои стили оформления из файлов .wmt (Whisper Music Theme). Формат: core/wmt.js и docs/WMT-FORMAT.md,
// разбор и привязка CSS темы, фильтр безопасности — core/theme-css.js (общие для всех приложений Whisper).
//
// Как это устроено в приложении:
// * Встроенные стили (Неон, Королевский, Стимпанк, Lolitta) — это CSS-правила вида :root[data-style="royal"] .panel {…}.
// * «Сохранить стиль в файл» вынимает из CSS приложения все правила текущего стиля и пишет их в секцию
//   «@@ css whisper-music» уже без привязки к стилю: просто .panel {…}. Плюс цвета, эффекты, шрифты и фон.
// * При загрузке .wmt каждое правило из файла привязывается к новому стилю (:root[data-style="<id>"] .panel {…}),
//   поэтому свой стиль ничего не ломает в остальных, а в выпадающем ряду стилей появляется ещё одна карточка.
// * «Основа» (manifest.base) — встроенный стиль, чьё поведение из кода наследует свой: например, у основы
//   Lolitta есть банты и жемчуг на панелях и подбор контрастного текста под цвета.
(() => {
  const APP = "whisper-music";
  // общая секция для всех приложений Whisper: CSS по ролям ([data-w="search"], [data-w="player.volume"]),
  // ядро (core/whisper-core.js) переводит роли в селекторы этого приложения. Секция приложения идёт после неё и главнее.
  const CORE = window.Whisper?.CORE_SECTION || "whisper-core";
  const OBS = "whisper-obs";        // виджет для OBS (core/obs.js): своя секция css/settings в том же файле темы
  const KEY = (id) => "theme:" + id;
  const NAMES = { neon: "Неон", royal: "Королевский", steam: "Стимпанк", lolitta: "Lolitta" };
  const AUTHOR = "Whisper Music";                       // автор встроенных стилей (в настройках: «Автор · Название»)
  const authorOf = (m) => String(m?.author || "").trim().slice(0, 40);
  const meta = new Map();          // id -> { manifest, tokens, settings, obs } (без тяжёлых ресурсов)
  const blobUrls = new Map();      // id -> [blob: URL ресурсов, на которые ссылается CSS]
  const previews = new Map();      // id -> blob: URL картинки для карточки (manifest.preview)
  const note = (t, ok) => { const n = document.getElementById("wmtNote"); if (n) { n.textContent = t || ""; n.classList.toggle("ok", !!ok); } };
  const nameOf = (id) => NAMES[id] || cfg.themes.find((t) => t.id === id)?.name || id;

  // ---------- CSS: привязка правил к стилю и обратно ----------
  // Сам движок (разбор, привязка к стилю, безопасность, роли) — в ядре: core/theme-css.js. Здесь — только то, что про это приложение.
  const TC = window.WhisperThemeCss;
  const { splitTop, cssParse, scopeSel, scopeCss, extractFrom } = TC;

  async function extractCss(st) {
    const out = [];
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      let src = "";
      try { src = await (await fetch(link.href)).text(); } catch { continue; }
      const part = extractFrom(src, st);
      if (part.length) out.push(`/* ---------------- из ${link.getAttribute("href")} ---------------- */`, ...part);
    }
    return out.join("\n\n");
  }

  // ---------- что умеет стиль: settings whisper-music → features ----------
  // { "glow": false, "animations": false, "panelOpacity": false, "pinHide": false, "mascot": false } — не показывать
  // соответствующие настройки (и выключить анимации / режим «Скрывать закреплённые» / маскота).
  // Нет поля — как у основы стиля (main.js, feature()).
  const FEATURES = ["glow", "animations", "panelOpacity", "pinHide", "mascot"];
  function setFeatures(id, settings) {
    const f = settings?.features, out = {};
    if (f && typeof f === "object") for (const k of FEATURES) if (typeof f[k] === "boolean") out[k] = f[k];
    themeFeatures[id] = out;
    setHooks(id, settings);
  }
  // ---------- возможности сверх CSS: controls, layout, buttons (main.js → applyHooks) ----------
  // { "controls": { "volume": "knob" }, "layout": "fixed", "buttons": { "power": "wave", "ch-up": "next" }, "console": true }
  // Действия кнопок — только из списка приложения (TH_ACTIONS): тема может нажать кнопку приложения, но не больше.
  const BTN_NAME = /^[a-z][a-z0-9-]{0,23}$/;
  function setHooks(id, settings) {
    const h = {};
    if (settings?.controls?.volume === "knob") h.volKnob = true;
    if (settings?.layout === "fixed") h.layoutFixed = true;
    // консоль вместо обычного интерфейса (cli.js): команды — приложения, тема задаёт только приглашение и приветствие
    const c = settings?.console;
    if (c === true || (c && typeof c === "object" && !Array.isArray(c) && c.enabled !== false)) {
      const str = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u0009\u000b-\u001f]/g, "").slice(0, n) : "");
      h.console = { prompt: str(c?.prompt, 40), banner: str(c?.banner, 1200) };
    }
    const b = settings?.buttons;
    if (b && typeof b === "object" && !Array.isArray(b)) {
      const list = Object.entries(b).filter(([k, v]) => BTN_NAME.test(k) && typeof v === "string" && Object.hasOwn(TH_ACTIONS, v)).slice(0, 16);
      if (list.length) h.buttons = list;
    }
    themeHooks[id] = h;
  }

  // ---------- значения из tokens ----------
  const HEX = /^#[0-9a-f]{6}$/i;
  const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
  function defaultsFrom(m, base) {
    const s = { ...STYLE_DEF[base], cc: {}, bg: "" };
    const c = m.tokens?.color || {}, fx = m.tokens?.effects || {};
    if (HEX.test(c.accent)) s.accent = c.accent.toLowerCase();
    if (HEX.test(c.accent2)) s.accent2 = c.accent2.toLowerCase();
    const g = num(fx.glow, 0, 48); if (g !== null) s.glow = Math.round(g);
    const p = num(fx.panelOpacity, 0.2, 1); if (p !== null) s.panel = Math.round(p * 100);
    const d = num(fx.dim, 0, 0.85); if (d !== null) s.dim = Math.round(d * 100);
    const over = m.settings?.colorOverrides;
    if (over && typeof over === "object") {
      const known = new Set(CC_ITEMS.map((it) => it.k));
      for (const [k, v] of Object.entries(over)) if (known.has(k) && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) s.cc[k] = v.toLowerCase();      // #rrggbb или #rrggbbaa
    }
    return s;
  }
  // в списках и блоках общее оформление осветляет второстепенный текст под тёмные стили — цвет темы главнее
  const MUTED_IN = ":is(.settings > .card, .stats .card, .main .list, .main .lastAlbum, .main .similar, .main .plpage, .main .sub, .main > .status)";

  // ---------- подключение CSS темы ----------
  function inject(id, th) {
    for (const u of blobUrls.get(id) || []) URL.revokeObjectURL(u);
    // общая секция ролей → секция приложения → tokens; ресурсы url(asset:…) — blob:, наружу CSS темы не ходит
    const { css, urls } = TC.themeCss(th, id, APP, { core: CORE, mutedIn: MUTED_IN });
    // картинка для карточки стиля (manifest.preview = "asset:…")
    const pv = th.asset(th.manifest?.preview);
    previews.delete(id);
    if (pv && /^image\//.test(pv.mime)) { const u = URL.createObjectURL(new Blob([pv.bytes], { type: pv.mime })); urls.push(u); previews.set(id, u); }
    blobUrls.set(id, urls);
    DynCss.set("wmt-" + id, css);
    themeReady.add(id);
  }
  // ---------- виджет для OBS: «@@ css whisper-obs» и «@@ settings whisper-obs» (чистит core/theme-css.js) ----------
  const obsOf = (th) => TC.obsCss(th);
  window.wmtObs = (id) => meta.get(id)?.obs || null;

  function uninject(id) {
    DynCss.remove("wmt-" + id);
    for (const u of blobUrls.get(id) || []) URL.revokeObjectURL(u);
    blobUrls.delete(id); previews.delete(id); themeReady.delete(id); meta.delete(id); delete themeFeatures[id]; delete themeHooks[id];
  }

  // Сохранённая тема: текст (строка) или архив (Blob) — как её загрузили.
  async function loadStored(id) {
    const v = await IDB.get(KEY(id));
    if (!v) return null;
    return WMT.open(v instanceof Blob ? new Uint8Array(await v.arrayBuffer()) : v);
  }

  // Фон из темы: в архиве — файл background.<расширение>. Нет фона (например, загрузили только текст темы) —
  // фон стиля пустой, а сама тема всё равно применяется.
  async function applyThemeBg(th, id) {
    const a = th.background;
    if (!a) { await clearBg(id); return; }
    let blob;
    try {
      const vt = sniffVideo(a.bytes.subarray(0, 16));
      if (vt) {
        // видео из чужой темы: тот же лимит и проверка декодером, что у видеообоев, плюс потолок длительности и разрешения
        if (a.bytes.length > THEME_VIDEO_MAX) throw new Error(`видео весит больше ${THEME_VIDEO_MAX / 1048576} МБ`);
        const f = new File([a.bytes], a.name, { type: vt });
        await probeVideo(f);
        await prepareVideo(f, vt);
        blob = f;
      }
      else { const g = imageGuard(a.bytes); blob = new Blob([a.bytes], { type: g.type }); }
    } catch (e) { note(`Фон из темы пропущен: ${e.message}`); await clearBg(id); return; }
    try { await IDB.set(bgKey(id), blob); cfg.s[id].bg = "idb"; } catch { cfg.s[id].bg = ""; }
    setBgBlob(blob, id);
  }

  // Лимиты видео-фона из темы. Размер файла темы и так не больше WMT.MAX_FILE, но видео декодируется отдельно и жрёт память.
  // Аудит F-07: 48 МБ вместо 150 — видео в теме лишь фон, а декодер держит ещё несколько копий кадров.
  const THEME_VIDEO_MAX = 48 * 1048576, THEME_VIDEO_SECONDS = 600, THEME_VIDEO_SIDE = 4096;
  function probeVideo(file) {
    return new Promise((res, rej) => {
      const v = document.createElement("video"), url = URL.createObjectURL(file);
      const done = (fn, x) => { clearTimeout(tm); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); fn(x); };
      const tm = setTimeout(() => done(rej, new Error("видео не открывается (таймаут)")), 15000);
      v.preload = "metadata"; v.muted = true;
      v.onerror = () => done(rej, new Error("видео не открывается"));
      v.onloadedmetadata = () => {
        if (!isFinite(v.duration) || v.duration > THEME_VIDEO_SECONDS) return done(rej, new Error(`видео длиннее ${THEME_VIDEO_SECONDS / 60} минут`));
        if (Math.max(v.videoWidth, v.videoHeight) > THEME_VIDEO_SIDE) return done(rej, new Error(`разрешение видео больше ${THEME_VIDEO_SIDE} пикселей по стороне`));
        done(res, null);
      };
      v.src = url;
    });
  }

  // ---------- загрузка .wmt (текст или архив) ----------
  // Тему узнаём только по id: файл с тем же id — новая версия и заменяет установленную. Но id мог совпасть
  // у двух разных авторов (оба назвали тему «gold»), и тогда молча пропал бы чужой стиль вместе с фоном.
  // Похоже на другую тему — спрашиваем. «Другая» — автор не совпал; без автора у обеих — не совпало название.
  const sameKey = (s) => String(s || "").trim().toLowerCase();
  const otherTheme = (old, author, name) => {
    if (!old) return false;
    const a = sameKey(old.author), b = sameKey(author);
    if (a || b) return a !== b;
    return sameKey(old.name) !== sameKey(name);
  };
  window.wmtOtherTheme = otherTheme;                 // themelib.js: та же проверка для кнопки в библиотеке
  const by = (author) => (author ? ` (автор — ${author})` : " (автор не указан)");
  class ImportCancelled extends Error {}
  async function importText(data) {
    const th = await WMT.open(data);
    const m = th.manifest, id = m.id;
    if (BUILTIN.includes(id)) throw new Error(`manifest.id «${id}» — это встроенный стиль. Дай своему стилю другой id`);
    const base = BUILTIN.includes(m.base) ? m.base : "neon";
    if (!th.css(APP) && !th.css(CORE) && !th.tokens?.color) throw new Error("В теме нет ни секции «@@ css whisper-music» или «@@ css whisper-core», ни цветов в tokens — применять нечего");
    const known = cfg.themes.findIndex((t) => t.id === id);
    if (known < 0 && cfg.themes.length >= 50) throw new Error("Своих стилей уже 50 — удали ненужные");
    const entry = { id, name: m.name.trim().slice(0, 60), author: authorOf(m), base, desc: String(m.description || "").trim().slice(0, 120) };
    const old = known >= 0 ? cfg.themes[known] : null;
    if (otherTheme(old, entry.author, entry.name)) {
      const ok = await modal({
        title: "Заменить стиль?",
        text: `У тебя уже есть стиль «${old.name}»${by(old.author)} с таким же id «${id}», а этот файл — «${entry.name}»${by(entry.author)}. `
          + `Похоже, это разные темы. Если заменить, прежний стиль пропадёт вместе с его фоном и настройками цветов — `
          + `вернуть его можно только загрузив его файл заново. Две темы с одним id одновременно установить нельзя.`,
        ok: "Заменить", danger: true,
      });
      if (!ok) throw new ImportCancelled();
    }
    await IDB.set(KEY(id), typeof data === "string" ? data : new Blob([data]));      // храним как есть: текст или архив
    if (known >= 0) cfg.themes[known] = entry; else cfg.themes.push(entry);
    const settings = th.settings(APP);
    meta.set(id, { manifest: m, tokens: th.tokens, settings, obs: obsOf(th) });
    setFeatures(id, settings);
    cfg.s[id] = defaultsFrom({ tokens: th.tokens, settings }, base);
    inject(id, th);
    await applyThemeBg(th, id);
    cfg.style = id;
    applyCfg(); saveCfg(); syncControls(); renderCards();
    note(`${known >= 0 ? "Стиль обновлён" : "Добавлен стиль"} «${entry.name}» (основа — ${NAMES[base]})${th.background ? "" : ", без фоновой картинки"}.`, true);
    showToast(`Стиль «${entry.name}» ${known >= 0 ? "обновлён" : "добавлен"}`, 3500, { kind: "ok" });
  }
  // true — загружена, false — ошибка (подробности в настройках), null — пользователь сам отказался заменять
  async function importSafe(text) {
    try { await importText(text); return true; }
    catch (e) {
      if (e instanceof ImportCancelled) { note("Загрузка отменена — прежний стиль на месте."); return null; }
      note("Не удалось загрузить тему: " + (e?.message || e)); showToast("Тема не загружена — подробности в настройках", 4000); return false;
    }
  }

  // ---------- сохранение в .wmt ----------
  const ext = (mime) => ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" }[mime] || "bin");
  async function buildFile(st) {
    const builtin = BUILTIN.includes(st), s = cfg.s[st];
    // текст и шрифты читаем у самого стиля st (на мгновение включаем его, если сейчас выбран другой)
    const de = document.documentElement, was = [de.dataset.style, de.dataset.base];
    de.dataset.style = st; de.dataset.base = baseOf(st);
    const cs = getComputedStyle(de), bodyFont = getComputedStyle(document.body).fontFamily;
    const read = { text: cs.getPropertyValue("--text").trim(), muted: cs.getPropertyValue("--muted").trim(), display: cs.getPropertyValue("--font-display").trim() };
    [de.dataset.style, de.dataset.base] = was;
    const orig = builtin ? null : await loadStored(st);
    const m0 = orig?.manifest || {};
    const manifest = {
      id: builtin ? `${st}-copy` : st,
      name: builtin ? `${NAMES[st]} (копия)` : m0.name || nameOf(st),
      author: builtin ? AUTHOR : m0.author || "",
      description: builtin ? `Копия стиля «${NAMES[st]}». Поправь и загрузи обратно` : m0.description || "",
      version: m0.version || "1.0",
      base: baseOf(st),
      apps: orig?.css(CORE) ? [CORE, APP] : [APP],
      created: m0.created || new Date().toISOString(),
    };
    const tokens = {
      // muted у копии встроенного стиля не пишем: его цвет уже задан в CSS стиля, а muted из tokens действует и в списках,
      // где встроенное оформление этот цвет осветляет, — копия перестала бы совпадать с оригиналом
      color: { accent: s.accent, accent2: s.accent2, text: read.text || undefined },
      effects: { glow: s.glow, panelOpacity: +(s.panel / 100).toFixed(2), dim: +(s.dim / 100).toFixed(2), backgroundBlur: cfg.blur },
      font: { body: bodyFont, display: read.display || undefined },
    };
    // свой стиль: что было в его файле, сохраняем как было (кроме цветов и эффектов — их могли поменять в настройках)
    if (orig?.tokens) {
      tokens.color = { ...orig.tokens.color, accent: s.accent, accent2: s.accent2 };
      tokens.font = orig.tokens.font;
      for (const [k, v] of Object.entries(orig.tokens)) if (!["color", "effects", "font", "background"].includes(k)) tokens[k] = v;
    }
    // Фон — отдельным файлом background.<расширение> рядом с текстом темы (архив), а не base64 внутри текста.
    // Остальные файлы своей темы (превью, шрифты) тоже кладутся в архив как есть.
    let background = null;
    let bgBlob = null;
    if (s.bg === "idb") { try { bgBlob = await IDB.get(bgKey(st)); } catch {} }
    if (bgBlob) background = { ext: ext(bgBlob.type), bytes: new Uint8Array(await bgBlob.arrayBuffer()) };
    const files = [];
    for (const a of orig?.assets.values() || []) {
      if (a === orig.background || /^background\.[^.]+$/i.test(a.name)) continue;
      files.push({ name: a.name, bytes: a.bytes });
    }
    const settings = { ...(orig?.settings(APP) || {}) };
    // какие настройки показывать у стиля: у копии встроенного — как у него; у своего — как было в его файле
    if (!settings.features) settings.features = Object.fromEntries(FEATURES.map((k) => [k, feature(k, st)]));
    if (Object.keys(s.cc || {}).length) settings.colorOverrides = { ...s.cc }; else delete settings.colorOverrides;
    const css = builtin
      ? `/* Правила стиля «${NAMES[st]}». Пиши обычный CSS — приложение само привяжет его к этому стилю:\n   «.panel {…}» станет «:root[data-style="${manifest.id}"] .panel {…}», «:root {…}» — переменные стиля.\n   Всё, что не указано здесь, берётся из общего оформления приложения.\n   Цвета, текст и шрифты из tokens главнее одноимённых переменных здесь. */\n\n` + (await extractCss(st))
      : orig?.css(APP) || "";
    const comment = [
      "Whisper Music Theme — файл темы оформления. Описание формата: docs/WMT-FORMAT.md",
      "Как сделать свой стиль: поменяй manifest.id и name, поправь цвета в tokens и правила в «@@ css whisper-music»,",
      "затем в приложении: Настройки → Стиль оформления → «Загрузить тему». Загрузка с тем же id обновляет стиль.",
      "Тема с фоном — это zip, переименованный в .wmt: внутри этот текст (theme.wmt) и картинка background.jpg/png/mp4…",
      "Если стиль сломал вид окна: Ctrl+Shift+Backspace вернёт встроенный «Королевский».",
    ].join("\n");
    // виджет для OBS: у своего стиля — секции из его файла как были; у копии встроенного — заготовка-подсказка
    const obsCss = orig?.css(OBS) || "/* Виджет «Сейчас играет» для OBS (Настройки → Виджет для OBS).\n   Разметка, классы и переменные — docs/WMT-FORMAT.md, раздел «Виджет для OBS». Например:\n   .w-bg { border-radius: 0; }\n   .w-title { letter-spacing: .04em; } */";
    const obsSettings = orig?.settings(OBS) || {};
    // общая секция ролей: у своего стиля — как была в файле; у копии встроенного — заготовка-подсказка
    const coreCss = orig?.css(CORE) || "/* Общие правила для всех приложений Whisper (Yandex, VK…): пиши по ролям, а не по классам.\n   Например: [data-w=\"search\"] { border-radius: 0; } — любой поиск в любом приложении;\n   [data-w=\"player.volume\"] { … } — громкость в плеере. Список ролей — docs/CORE.md, раздел «Роли».\n   Правила из «@@ css whisper-music» ниже идут после этих и главнее. */";
    const theme = { comment, manifest, tokens, settings: { [APP]: settings, [OBS]: obsSettings }, css: { [CORE]: coreCss, [APP]: css, [OBS]: obsCss } };
    const data = await WMT.pack({ ...theme, background, files });
    return { manifest, data, archive: !!background || files.length > 0, text: WMT.serialize(theme) };
  }
  async function exportCurrent() {
    const st = cfg.style;
    try {
      note("Файл собирается…");
      const { manifest, data, archive } = await buildFile(st);
      // двоичные данные уходят в Rust одним куском, без перевода в JSON
      const path = await window.__TAURI__.core.invoke("theme_save", data, { headers: { "x-theme-name": encodeURIComponent(manifest.name) } });
      if (path) note(`Сохранено: ${path}`, true);
      else note("");
    } catch (e) { note("Не удалось сохранить тему: " + (e?.message || e)); }
  }

  // ---------- удаление ----------
  async function removeTheme(id) {
    const t = cfg.themes.find((x) => x.id === id);
    if (!t) return;
    const ok = await modal({ title: "Удалить стиль?", text: `Стиль «${t.name}» пропадёт из приложения вместе со своим фоном. Файл .wmt на диске останется.`, ok: "Удалить", danger: true });
    if (!ok) return;
    cfg.themes = cfg.themes.filter((x) => x.id !== id);
    await clearBg(id);
    delete cfg.s[id];
    try { await IDB.del(KEY(id)); } catch {}
    uninject(id);
    if (cfg.style === id) cfg.style = t.base;
    applyCfg(); saveCfg(); syncControls(); renderCards();
    note(`Стиль «${t.name}» удалён.`, true);
  }

  // ---------- карточки стилей ----------
  function renderCards() {
    const pick = document.querySelector(".stylepick");
    if (!pick) return;
    pick.querySelectorAll(".stylecard.custom").forEach((x) => x.remove());
    for (const t of cfg.themes) {
      const s = cfg.s[t.id] || {};
      const b = document.createElement("button");
      b.className = "stylecard custom"; b.dataset.style = t.id; b.title = `Свой стиль · основа — ${NAMES[t.base]}`;
      const pv = document.createElement("span"); pv.className = "sprev sp-custom";
      const img = previews.get(t.id) || (bgKinds[t.id] === "video" ? bgPosters[t.id] : bgUrls[t.id]);
      // превью: фон темы, если он есть, иначе тёмная плашка с рамкой в цветах темы — как у встроенных стилей
      const a1 = HEX.test(s.accent) ? s.accent : "#888888", a2 = HEX.test(s.accent2) ? s.accent2 : "#444444";
      pv.style.background = img
        ? `center / cover no-repeat url("${img}")`
        : `linear-gradient(135deg, color-mix(in srgb, ${a2} 55%, #0d0a12), #0d0a12 75%)`;
      pv.style.boxShadow = `inset 0 0 0 1px ${a1}, inset 0 0 0 5px rgba(13,10,18,.85), inset 0 0 0 6px color-mix(in srgb, ${a1} 55%, transparent)`;
      // «Автор · Название»: автор — отдельным элементом, чтобы в компактном виде остаться только с названием
      const nm = document.createElement("b"), sn = document.createElement("span");
      sn.className = "scname"; sn.textContent = t.name;
      if (t.author) { const sa = document.createElement("span"); sa.className = "scauth"; sa.textContent = t.author; nm.append(sa); }
      nm.append(sn);
      const sm = document.createElement("small"); sm.textContent = t.desc || `Свой стиль на основе «${NAMES[t.base]}»`;
      const del = document.createElement("span");
      del.className = "scdel"; del.setAttribute("role", "button"); del.title = "Удалить стиль"; del.textContent = "✕";
      del.onclick = (e) => { e.stopPropagation(); removeTheme(t.id); };
      b.append(pv, nm, sm, del);
      b.onclick = () => { cfg.style = t.id; applyCfg(); saveCfg(); syncControls(); };
      pick.append(b);
    }
    applyView();
    syncControls();
  }

  // ---------- вид списка стилей: обычные карточки или компактно (кружочки) ----------
  // Выбор пользователя запоминается; пока он не выбирал — компактный вид включается сам, когда карточек много.
  const VIEW_KEY = "styleView", AUTO_COMPACT_FROM = 6;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  function applyView() {
    const pick = document.querySelector(".stylepick");
    if (!pick) return;
    const saved = lsGet(VIEW_KEY);
    const compact = saved ? saved === "compact" : pick.querySelectorAll(".stylecard").length >= AUTO_COMPACT_FROM;
    pick.classList.toggle("compact", compact);
    const btn = document.getElementById("styleView");
    if (btn) {
      btn.setAttribute("aria-pressed", String(compact));
      btn.classList.toggle("on", compact);
      btn.title = compact ? "Обычный вид: карточки с описанием" : "Компактный вид: стили кружочками";
    }
    // в компактном виде описание прячется — оставляем его во всплывающей подсказке
    pick.querySelectorAll(".stylecard").forEach((c) => {
      if (!c.title) c.title = c.querySelector("small")?.textContent || "";
    });
  }

  // ---------- кнопки в настройках ----------
  function mountUi() {
    document.getElementById("styleView")?.addEventListener("click", () => {
      lsSet(VIEW_KEY, document.querySelector(".stylepick")?.classList.contains("compact") ? "full" : "compact");
      applyView();
    });
    const pick = document.querySelector(".stylepick");
    if (!pick || document.getElementById("wmtBar")) return;
    const bar = document.createElement("div");
    bar.id = "wmtBar"; bar.className = "wmtbar";
    bar.innerHTML = `
      <button class="nav wmtlib" id="wmtLib" title="Готовые темы из репозитория Whisper-Music/whisper-themes на GitHub">Библиотека тем</button>
      <div class="row">
        <button class="nav" id="wmtLoad" title="Файл .wmt — Whisper Music Theme">Загрузить тему…</button>
        <button class="nav" id="wmtSave">Сохранить стиль в файл…</button>
      </div>
      <p class="status" id="wmtNote"></p>
      <input type="file" id="wmtFile" accept=".wmt,.zip" hidden />`;
    (document.getElementById("styleCap") || pick).after(bar);      // подпись «Автор · Название» остаётся сразу под списком
    const file = document.getElementById("wmtFile");
    document.getElementById("wmtLoad").onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0]; file.value = "";
      if (!f) return;
      if (f.size > WMT.MAX_FILE) { note(`Файл темы больше ${WMT.MAX_FILE / 1048576} МБ`); return; }
      note("Тема загружается…");
      await importSafe(new Uint8Array(await f.arrayBuffer()));         // текст или архив — разберётся WMT.open
    };
    document.getElementById("wmtSave").onclick = exportCurrent;
    $("#settingsBtn").addEventListener("click", () => renderCards());      // превью карточек — с уже загруженными фонами
  }

  // перетащили в окно файл .wmt (события приходят из Rust — main.js, bg-drop)
  window.wmtDrop = (files) => {
    const list = Array.isArray(files) ? files : [];
    // .wmt (текст или архив); .zip — только если это тема (в нём есть theme.wmt), иначе это не наш файл
    const f = list.find((x) => /\.wmt$/i.test(String(x.name))) || (list.length === 1 && /\.zip$/i.test(String(list[0].name)) ? list[0] : null);
    if (!f) return false;
    (async () => {
      try {
        if (Number(f.size) > WMT.MAX_FILE) { note(`Файл темы больше ${WMT.MAX_FILE / 1048576} МБ`); return; }
        const buf = await invoke("bg_read", { id: f.id, kind: "theme" });      // лимит соблюдает и сама команда в Rust
        await importSafe(new Uint8Array(buf));
      } catch (e) { note("Не удалось прочитать тему: " + (e?.message || e)); }
    })();
    return true;
  };

  // для библиотеки тем (themelib.js): установка тем же путём, что «Загрузить тему…», и версия установленной темы
  window.wmtImport = (bytes) => importSafe(bytes);
  // «Темы комнаты» (core/together.js через kit.themeExport): текущий стиль файлом .wmt — так же, как «Сохранить в файл…»
  window.wmtExportCurrent = async () => {
    const { manifest, data } = await buildFile(cfg.style);
    return { id: manifest.id, name: manifest.name, author: manifest.author || "", bytes: data };
  };
  window.wmtVersion = (id) => String(meta.get(id)?.manifest?.version || "");

  // основной и второй цвета своего стиля — как в его файле (кнопка «Цвета темы» в настройках)
  window.wmtDefaultColors = (id) => {
    const t = cfg.themes.find((x) => x.id === id), mm = meta.get(id);
    if (!t || !mm) return null;
    const d = defaultsFrom({ tokens: mm.tokens, settings: mm.settings }, t.base);
    return { accent: d.accent, accent2: d.accent2 };
  };

  // «Сбросить всё» в настройках: цвета и фон своих стилей — как в их файлах
  window.wmtRestoreDefaults = async () => {
    for (const t of cfg.themes) {
      try {
        const th = await loadStored(t.id);
        if (!th) continue;
        cfg.s[t.id] = defaultsFrom({ tokens: th.tokens, settings: th.settings(APP) }, t.base);
        await applyThemeBg(th, t.id);
      } catch {}
    }
    renderCards();
  };

  // аварийный выход: свой стиль сломал вид окна — Ctrl+Shift+Backspace возвращает встроенный
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "Backspace") {
      cfg.style = "royal"; applyCfg(); saveCfg(); syncControls();
      showToast("Включён встроенный стиль «Королевский»", 3500, { kind: "ok" });
    }
  });

  // ---------- запуск: подключить сохранённые стили ----------
  (async () => {
    mountUi();
    let changed = false;
    for (const t of [...cfg.themes]) {
      try {
        const th = await loadStored(t.id);
        if (!th) throw new Error("нет файла");
        meta.set(t.id, { manifest: th.manifest, tokens: th.tokens, settings: th.settings(APP), obs: obsOf(th) });
        const au = authorOf(th.manifest);                 // темы, загруженные до появления подписи автора
        if ((t.author || "") !== au) { t.author = au; changed = true; }
        setFeatures(t.id, th.settings(APP));
        inject(t.id, th);
      } catch (e) {
        console.warn(`Стиль ${t.id} не загружен:`, e?.message);
        cfg.themes = cfg.themes.filter((x) => x.id !== t.id); delete cfg.s[t.id]; changed = true;
        if (cfg.style === t.id) cfg.style = t.base;
      }
    }
    if (changed) saveCfg();
    applyCfg(); renderCards();
    window.bootMark?.("themes");      // boot.js: CSS своих тем подключены — можно показывать интерфейс
  })();

  window.wmtInternals = { splitTop, scopeSel, scopeCss, cssParse, extractCss, buildFile, importText };      // для отладки и тестов
})();
