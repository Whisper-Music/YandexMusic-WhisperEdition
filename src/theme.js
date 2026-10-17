"use strict";
// Свои стили оформления из файлов .wmt (Whisper Music Theme). Формат: wmt.js и docs/WMT-FORMAT.md.
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
  const KEY = (id) => "theme:" + id;
  const NAMES = { neon: "Неон", royal: "Королевский", steam: "Стимпанк", lolitta: "Lolitta" };
  const meta = new Map();          // id -> { manifest, tokens, settings } (без тяжёлых ресурсов)
  const blobUrls = new Map();      // id -> [blob: URL ресурсов, на которые ссылается CSS]
  const previews = new Map();      // id -> blob: URL картинки для карточки (manifest.preview)
  const note = (t, ok) => { const n = document.getElementById("wmtNote"); if (n) { n.textContent = t || ""; n.classList.toggle("ok", !!ok); } };
  const nameOf = (id) => NAMES[id] || cfg.themes.find((t) => t.id === id)?.name || id;

  // ---------- CSS: привязка правил к стилю и обратно ----------
  // разделить список селекторов по запятым верхнего уровня (запятые внутри :is(), [attr="a,b"] не в счёт)
  function splitTop(s) {
    const out = []; let depth = 0, q = "", cur = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { cur += c; if (c === "\\") cur += s[++i] ?? ""; else if (c === q) q = ""; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // Разбор CSS-текста на правила. Браузерный разбор (CSSOM) здесь не годится: при пересборке он теряет
  // сокращённые свойства с var() (например, «background: linear-gradient(… var(--x) …)» превращается в пустоту).
  // Поэтому тексты правил переносятся как есть — с исходным форматированием и комментариями внутри.
  function cssParse(src) {
    const nodes = [], n = src.length;
    let i = 0;
    const endStr = (k) => { const q = src[k++]; while (k < n && src[k] !== q) { if (src[k] === "\\") k++; k++; } return k + 1; };
    const endCmt = (k) => { const e = src.indexOf("*/", k + 2); return e < 0 ? n : e + 2; };
    const skipWs = () => { for (;;) { while (i < n && /\s/.test(src[i])) i++; if (src.startsWith("/*", i)) i = endCmt(i); else break; } };
    const readPrelude = () => {
      let s = "", depth = 0;
      while (i < n) {
        const c = src[i];
        if (c === '"' || c === "'") { const j = endStr(i); s += src.slice(i, j); i = j; continue; }
        if (src.startsWith("/*", i)) { i = endCmt(i); s += " "; continue; }
        if (c === "(" || c === "[") depth++; else if (c === ")" || c === "]") depth--;
        if (depth <= 0 && (c === "{" || c === ";" || c === "}")) break;
        s += c; i++;
      }
      return s.trim().replace(/\s+/g, " ");
    };
    const readBlock = () => {
      const start = ++i; let depth = 1;
      while (i < n) {
        const c = src[i];
        if (c === '"' || c === "'") { i = endStr(i); continue; }
        if (src.startsWith("/*", i)) { i = endCmt(i); continue; }
        if (c === "{") depth++;
        else if (c === "}" && !--depth) { const body = src.slice(start, i); i++; return body; }
        i++;
      }
      return src.slice(start);
    };
    for (;;) {
      skipWs();
      if (i >= n) break;
      if (src[i] === "}") { i++; continue; }
      const prelude = readPrelude();
      if (i >= n || src[i] === ";") { i++; if (prelude) nodes.push({ prelude, body: null }); continue; }
      if (src[i] === "}") { i++; continue; }
      nodes.push({ prelude, body: readBlock() });
    }
    return nodes;
  }
  const GROUPING = /^@(media|supports|container|layer|scope|document|starting-style)\b/i;
  const ruleText = (sel, body) => `${sel} {${/\n/.test(body) ? body.replace(/\s+$/, "") + "\n" : " " + body.trim() + " "}}`;

  // при загрузке: селектор из файла -> селектор своего стиля
  function scopeSel(sel, id) {
    const pre = `:root[data-style="${id}"]`;
    return splitTop(sel).map((s) => {
      const m = /^(:root|html)(?![\w-])/i.exec(s);
      return m ? pre + s.slice(m[0].length) : `${pre} ${s}`;
    }).join(", ");
  }
  function scopeCss(src, id) {
    const out = [];
    for (const { prelude, body } of cssParse(src)) {
      if (prelude[0] === "@") {
        if (/^@(import|charset|namespace)\b/i.test(prelude)) continue;                 // внешние файлы не подключаем
        if (body !== null && GROUPING.test(prelude)) out.push(`${prelude} {\n${scopeCss(body, id)}\n}`);
        else out.push(body === null ? prelude + ";" : `${prelude} {${body}}`);           // @keyframes, @font-face, @property…
      } else if (prelude && body !== null) out.push(ruleText(scopeSel(prelude, id), body));
    }
    return out.join("\n");
  }
  // При сохранении встроенного стиля: все его правила из CSS приложения, уже без привязки к стилю.
  // Вместе с ними — общие правила «:root[data-style] …» (для любого стиля): в CSS приложения они стоят между
  // правилами стилей и намеренно перекрывают часть из них. Свой стиль подключается последним, и без них порядок
  // перекрытия поменялся бы (например, другие отступы нижней панели) — а так копия совпадает с оригиналом.
  function extractFrom(src, st, pad = "") {
    const want = new RegExp(`\\[data-style(?:=["']?${st}["']?)?\\]`, "g"), res = [];
    for (const { prelude, body } of cssParse(src)) {
      if (body === null) continue;
      if (prelude[0] === "@") {
        if (!GROUPING.test(prelude)) continue;                          // @keyframes и т.п. остаются общими в приложении
        const inner = extractFrom(body, st, pad + "  ");
        if (inner.length) res.push(`${pad}${prelude} {\n${inner.join("\n\n")}\n${pad}}`);
        continue;
      }
      const parts = splitTop(prelude).filter((s) => { want.lastIndex = 0; return want.test(s); }).map((s) => {
        const x = s.replace(want, "");
        return x.startsWith(":root ") ? x.slice(6).trim() : x;
      });
      if (parts.length) res.push(pad + ruleText(parts.join(",\n" + pad), body));
    }
    return res;
  }
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
  // { "glow": false, "animations": false, "panelOpacity": false } — не показывать соответствующие настройки
  // (и выключить анимации). Нет поля — как у основы стиля (main.js, feature()).
  const FEATURES = ["glow", "animations", "panelOpacity"];
  function setFeatures(id, settings) {
    const f = settings?.features, out = {};
    if (f && typeof f === "object") for (const k of FEATURES) if (typeof f[k] === "boolean") out[k] = f[k];
    themeFeatures[id] = out;
  }

  // ---------- значения из tokens ----------
  const HEX = /^#[0-9a-f]{6}$/i;
  const cssVal = (v) => (typeof v === "string" && v.length <= 300 && !/[;{}<>\\]|\/\*|url\s*\(|expression/i.test(v) ? v.trim() : "");
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
  function tokensCss(tokens) {
    const c = tokens?.color || {}, f = tokens?.font || {}, root = [], body = [];
    if (cssVal(c.text)) root.push(`--text: ${cssVal(c.text)}`);
    if (cssVal(c.muted)) root.push(`--muted: ${cssVal(c.muted)}`);
    if (cssVal(f.display)) root.push(`--font-display: ${cssVal(f.display)}`);
    if (cssVal(f.body)) body.push(`font-family: ${cssVal(f.body)}`);
    // цвет фона окна заменяет фон целиком (в том числе градиенты основы); своя картинка лежит отдельно, в #bg
    if (cssVal(c.background)) body.push(`background: ${cssVal(c.background)}`);
    // в списках и блоках общее оформление осветляет второстепенный текст под тёмные стили — цвет темы главнее
    const blocks = cssVal(c.muted)
      ? `:is(.settings > .card, .stats .card, .main .list, .main .lastAlbum, .main .similar, .main .plpage, .main .sub, .main > .status) { --muted: ${cssVal(c.muted)}; }\n`
      : "";
    return (root.length ? `:root { ${root.join("; ")}; }\n` : "") + (body.length ? `body { ${body.join("; ")}; }\n` : "") + blocks;
  }

  // ---------- подключение CSS темы ----------
  function inject(id, th) {
    for (const u of blobUrls.get(id) || []) URL.revokeObjectURL(u);
    const urls = [];
    // ресурсы файла в CSS: url(asset:font.woff2) -> blob:
    // значения из tokens идут после CSS темы — они главнее тех же переменных в CSS
    let css = (th.css(APP) || "") + "\n" + tokensCss(th.tokens);
    css = css.replace(/url\(\s*(['"]?)asset:([\w.-]+)\1\s*\)/gi, (m, q, name) => {
      const a = th.assets.get(name);
      if (!a) return "none";
      const u = URL.createObjectURL(new Blob([a.bytes], { type: a.mime })); urls.push(u);
      return `url("${u}")`;
    });
    // картинка для карточки стиля (manifest.preview = "asset:…")
    const pv = th.asset(th.manifest?.preview);
    previews.delete(id);
    if (pv && /^image\//.test(pv.mime)) { const u = URL.createObjectURL(new Blob([pv.bytes], { type: pv.mime })); urls.push(u); previews.set(id, u); }
    blobUrls.set(id, urls);
    let el = document.getElementById("wmt-" + id);
    if (!el) { el = document.createElement("style"); el.id = "wmt-" + id; document.head.append(el); }
    el.textContent = scopeCss(css, id);           // ошибочные правила браузер просто пропустит; @import не подключается
    themeReady.add(id);
  }
  function uninject(id) {
    document.getElementById("wmt-" + id)?.remove();
    for (const u of blobUrls.get(id) || []) URL.revokeObjectURL(u);
    blobUrls.delete(id); previews.delete(id); themeReady.delete(id); meta.delete(id); delete themeFeatures[id];
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
    let blob = new Blob([a.bytes], { type: a.mime });
    try {
      const vt = sniffVideo(a.bytes.subarray(0, 16));
      if (vt) blob = new Blob([a.bytes], { type: vt });
      else { const g = imageGuard(a.bytes); blob = new Blob([a.bytes], { type: g.type }); }
    } catch (e) { note(`Фон из темы пропущен: ${e.message}`); await clearBg(id); return; }
    try { await IDB.set(bgKey(id), blob); cfg.s[id].bg = "idb"; } catch { cfg.s[id].bg = ""; }
    setBgBlob(blob, id);
  }

  // ---------- загрузка .wmt (текст или архив) ----------
  async function importText(data) {
    const th = await WMT.open(data);
    const m = th.manifest, id = m.id;
    if (BUILTIN.includes(id)) throw new Error(`manifest.id «${id}» — это встроенный стиль. Дай своему стилю другой id`);
    const base = BUILTIN.includes(m.base) ? m.base : "neon";
    if (!th.css(APP) && !th.tokens?.color) throw new Error("В теме нет ни секции «@@ css whisper-music», ни цветов в tokens — применять нечего");
    const known = cfg.themes.findIndex((t) => t.id === id);
    if (known < 0 && cfg.themes.length >= 50) throw new Error("Своих стилей уже 50 — удали ненужные");
    await IDB.set(KEY(id), typeof data === "string" ? data : new Blob([data]));      // храним как есть: текст или архив
    const entry = { id, name: m.name.trim().slice(0, 60), base, desc: String(m.description || "").trim().slice(0, 120) };
    if (known >= 0) cfg.themes[known] = entry; else cfg.themes.push(entry);
    const settings = th.settings(APP);
    meta.set(id, { manifest: m, tokens: th.tokens, settings });
    setFeatures(id, settings);
    cfg.s[id] = defaultsFrom({ tokens: th.tokens, settings }, base);
    inject(id, th);
    await applyThemeBg(th, id);
    cfg.style = id;
    applyCfg(); saveCfg(); syncControls(); renderCards();
    note(`${known >= 0 ? "Стиль обновлён" : "Добавлен стиль"} «${entry.name}» (основа — ${NAMES[base]})${th.background ? "" : ", без фоновой картинки"}.`, true);
    showToast(`Стиль «${entry.name}» ${known >= 0 ? "обновлён" : "добавлен"}`, 3500, { kind: "ok" });
  }
  async function importSafe(text) {
    try { await importText(text); return true; }
    catch (e) { note("Не удалось загрузить тему: " + (e?.message || e)); showToast("Тема не загружена — подробности в настройках", 4000); return false; }
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
      author: m0.author || "",
      description: builtin ? `Копия стиля «${NAMES[st]}». Поправь и загрузи обратно` : m0.description || "",
      version: m0.version || "1.0",
      base: baseOf(st),
      apps: [APP],
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
    const theme = { comment, manifest, tokens, settings: { [APP]: settings }, css: { [APP]: css } };
    const data = await WMT.pack({ ...theme, background, files });
    return { manifest, data, archive: !!background || files.length > 0, text: WMT.serialize(theme) };
  }
  async function exportCurrent() {
    const st = cfg.style;
    try {
      note("Собираю файл…");
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
      const nm = document.createElement("b"); nm.textContent = t.name;
      const sm = document.createElement("small"); sm.textContent = t.desc || `Свой стиль на основе «${NAMES[t.base]}»`;
      const del = document.createElement("span");
      del.className = "scdel"; del.setAttribute("role", "button"); del.title = "Удалить стиль"; del.textContent = "✕";
      del.onclick = (e) => { e.stopPropagation(); removeTheme(t.id); };
      b.append(pv, nm, sm, del);
      b.onclick = () => { cfg.style = t.id; applyCfg(); saveCfg(); syncControls(); };
      pick.append(b);
    }
    syncControls();
  }

  // ---------- кнопки в настройках ----------
  function mountUi() {
    const pick = document.querySelector(".stylepick");
    if (!pick || document.getElementById("wmtBar")) return;
    const bar = document.createElement("div");
    bar.id = "wmtBar"; bar.className = "wmtbar";
    bar.innerHTML = `
      <div class="row">
        <button class="nav" id="wmtLoad" title="Файл .wmt — Whisper Music Theme">Загрузить тему…</button>
        <button class="nav" id="wmtSave">Сохранить стиль в файл…</button>
      </div>
      <p class="status" id="wmtNote"></p>
      <input type="file" id="wmtFile" accept=".wmt,.zip" hidden />`;
    pick.after(bar);
    const file = document.getElementById("wmtFile");
    document.getElementById("wmtLoad").onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0]; file.value = "";
      if (!f) return;
      if (f.size > 300 * 1048576) { note("Файл темы больше 300 МБ"); return; }
      note("Загружаю тему…");
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
        const buf = await invoke("bg_read", { id: f.id });
        await importSafe(new Uint8Array(buf));
      } catch (e) { note("Не удалось прочитать тему: " + (e?.message || e)); }
    })();
    return true;
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
        meta.set(t.id, { manifest: th.manifest, tokens: th.tokens, settings: th.settings(APP) });
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
  })();

  window.wmtInternals = { splitTop, scopeSel, scopeCss, cssParse, extractCss, buildFile, importText };      // для отладки и тестов
})();
