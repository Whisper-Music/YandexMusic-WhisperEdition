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
  const OBS = "whisper-obs";        // виджет для OBS (obs.js): своя секция css/settings в том же файле темы
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
  const ruleText = (sel, body) => `${sel} {${/\n/.test(body) ? body.replace(/\s+$/, "") + "\n" : " " + body.trim() + " "}}`;

  // при загрузке: селектор из файла -> селектор своего стиля
  function scopeSel(sel, id, gate = "") {
    const pre = `:root[data-style="${id}"]${gate}`;
    return splitTop(sel).map((s) => {
      const m = /^(:root|html)(?![\w-])/i.exec(s);
      return m ? pre + s.slice(m[0].length) : `${pre} ${s}`;
    }).join(", ");
  }
  // ---------- безопасность CSS темы ----------
  // Тема — чужой файл. Её CSS не должен ни ходить в сеть, ни подменять общие анимации и шрифты приложения.
  // Все проверки делаются по ТЕКСТУ ПОСЛЕ РАСКРЫТИЯ ЭКРАНИРОВАНИЯ и без комментариев: «@\69mport», «u\72l(» и «u/**/rl(»
  // браузер читает так же, как «@import» и «url(», а обычное регулярное выражение их не видит.
  const unesc = (s) => String(s)
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, "")
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\([\s\S])/gi, (m, h, c) => {
      if (!h) return c;
      const n = parseInt(h, 16);
      return !n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? "�" : String.fromCodePoint(n);
    });
  // top-level разбор по «;» (внутри строк, скобок и вложенных {} не режем)
  function splitDecls(body) {
    const out = []; let cur = "", depth = 0, q = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (q) { cur += c; if (c === "\\") cur += body[++i] ?? ""; else if (c === q) q = ""; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === "/" && body[i + 1] === "*") { const e = body.indexOf("*/", i + 2), j = e < 0 ? body.length : e + 2; cur += body.slice(i, j); i = j - 1; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
      if (c === ";" && depth === 0) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }
  // Можно ли оставить фрагмент CSS: из внешнего мира в нём разрешены только blob:-ссылки на ресурсы этой темы
  // (их ставит inject()), data: и #якоря. Функции, которые принимают адрес строкой (image-set, src…), не допускаются совсем.
  function cssSafe(text, allowed) {
    const t = unesc(text);
    if (/@\s*import\b/i.test(t) || /expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding/i.test(t)) return false;
    if (/(^|[^\w-])(?:-webkit-)?(image-set|cross-fade|element|paint|src)\s*\(/i.test(t)) return false;
    const re = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
    let m;
    while ((m = re.exec(t))) {
      const u = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!(allowed.has(u) || /^data:/i.test(u) || u.startsWith("#"))) return false;
    }
    // «url» без закрывающей скобки или с неразобранным содержимым
    if (/url\s*\(/i.test(t.replace(re, ""))) return false;
    return true;
  }
  const cleanBody = (body, allowed) => splitDecls(body).filter((d) => cssSafe(d, allowed)).join(";");

  // @keyframes и @font-face темы получают имена с её id: тема не может ни подменить общую анимацию или шрифт приложения,
  // ни повлиять на них, пока выбран другой стиль. Переименовываются только имена, которые тема определяет сама.
  const GROUPING = /^@(media|supports|container|layer|scope|starting-style)\b/i;
  const KEYFRAMES = /^@(-webkit-)?keyframes\s+/i;
  function collectNames(nodes, ctx) {
    for (const { prelude, body } of nodes) {
      if (body === null || prelude[0] !== "@") continue;
      const p = unesc(prelude);
      let m;
      if ((m = KEYFRAMES.exec(p))) ctx.kf.add(p.slice(m[0].length).trim().replace(/^["']|["']$/g, ""));
      else if (/^@font-face\b/i.test(p)) {
        const f = /font-family\s*:\s*([^;}]+)/i.exec(unesc(body));
        if (f) ctx.ff.add(f[1].trim().replace(/^["']|["']$/g, ""));
      } else if (GROUPING.test(p)) collectNames(cssParse(body), ctx);
    }
  }
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function renameIn(text, names, pre) {
    if (!names.size) return text;
    const re = new RegExp(`(?<![\\w-])(${[...names].map(escRe).join("|")})(?![\\w-])`, "g");
    return text.replace(re, pre + "$1");
  }
  const ANIM_PROP = /(^|[\s;{])(-webkit-)?animation(-name)?\s*:/i;
  // сдвиг, поворот и увеличение при наведении/нажатии — тоже анимация интерфейса: такие свойства из правил
  // с :hover/:active выносятся в отдельное правило, которое действует только при включённых анимациях
  const MOVE_PROP = /^\s*(-webkit-)?(transform|translate|scale|rotate)\s*:/i;
  const MOTION_ON = '[data-anim="on"]';
  const FONT_PROP = /(^|[\s;{])(--[\w-]*font[\w-]*|font(-family)?)\s*:/i;
  function renameDecls(body, ctx, pre) {
    return splitDecls(body).map((d) => {
      const u = unesc(d);
      if (ANIM_PROP.test(u)) return renameIn(d, ctx.kf, pre);
      if (FONT_PROP.test(u)) return renameIn(d, ctx.ff, pre);
      return d;
    }).join(";");
  }

  function emitCss(nodes, id, ctx, allowed) {
    const out = [], pre = `wmt-${id}-`;
    for (const { prelude, body } of nodes) {
      if (prelude[0] === "@") {
        const p = unesc(prelude);
        if (body === null) continue;                                                      // @import, @charset, @namespace и любые «@что-то;» без блока
        if (/^@layer\b/i.test(p)) {
          // слои темы получают имена с её id: тема не может ни попасть в слой приложения (app-motion-off в styles.css,
          // им выключаются анимации), ни встать в порядке слоёв перед ним
          const names = p.replace(/^@layer\b/i, "").trim();
          if (names && !/^[\w-]+(\.[\w-]+)*$/.test(names)) continue;
          out.push(`@layer${names ? " " + pre + names : ""} {\n${emitCss(cssParse(body), id, ctx, allowed)}\n}`);
          continue;
        }
        if (GROUPING.test(p)) { out.push(`${prelude} {\n${emitCss(cssParse(body), id, ctx, allowed)}\n}`); continue; }
        if (KEYFRAMES.test(p)) {
          const name = p.replace(KEYFRAMES, "").trim().replace(/^["']|["']$/g, "");
          if (!/^[\w-]+$/.test(name)) continue;
          const frames = cssParse(body).map((f) => ruleText(f.prelude, cleanBody(f.body ?? "", allowed))).join("\n");
          out.push(`@keyframes ${pre}${name} {\n${frames}\n}`);
          continue;
        }
        if (/^@font-face\b/i.test(p)) {
          const clean = cleanBody(body, allowed).replace(/font-family\s*:\s*([^;]+)/i, (m, v) => {
            const n = v.trim().replace(/^["']|["']$/g, "");
            return `font-family: "${pre}${n}"`;
          });
          if (/(^|[;\s])src\s*:/i.test(clean)) out.push(`@font-face {${clean}}`);        // без разрешённого источника шрифта правило бесполезно
          continue;
        }
        continue;                                                                        // @property, @page, @counter-style и прочее — не поддерживаются
      }
      if (prelude && body !== null) {
        const clean = renameDecls(cleanBody(body, allowed), ctx, pre);
        if (!clean.trim()) continue;
        if (/:(hover|active)\b/i.test(unesc(prelude))) {
          const ds = splitDecls(clean), move = ds.filter((d) => MOVE_PROP.test(unesc(d))), rest = ds.filter((d) => !MOVE_PROP.test(unesc(d)));
          if (rest.some((d) => d.trim())) out.push(ruleText(scopeSel(prelude, id), rest.join(";")));
          if (move.length) out.push(ruleText(scopeSel(prelude, id, MOTION_ON), move.join(";")));
        } else out.push(ruleText(scopeSel(prelude, id), clean));
      }
    }
    return out.join("\n");
  }
  function scopeCss(src, id, allowed = new Set()) {
    const nodes = cssParse(src), ctx = { kf: new Set(), ff: new Set() };
    collectNames(nodes, ctx);
    return emitCss(nodes, id, ctx, allowed);
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
    DynCss.set("wmt-" + id, scopeCss(css, id, new Set(urls)));   // наружу CSS темы не ходит: разрешены только blob:-ресурсы этой же темы
    themeReady.add(id);
  }
  // ---------- виджет для OBS: «@@ css whisper-obs» и «@@ settings whisper-obs» ----------
  // Виджет — отдельная страница в OBS, поэтому ресурсы темы вставляются прямо в CSS (data:), а всё, что ведёт
  // наружу (@import, url(http…), image-set…), вырезается: виджет ничего не загружает из сети, кроме обложки.
  function b64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function obsOf(th) {
    let css = th.css(OBS) || "";
    css = css.replace(/url\(\s*(['"]?)asset:([\w.-]+)\1\s*\)/gi, (m, q, name) => {
      const a = th.assets.get(name);
      if (!a || a.bytes.length > 1.5 * 1024 * 1024) return "none";
      return `url("data:${a.mime};base64,${b64(a.bytes)}")`;
    });
    css = css
      .replace(/@\s*import\b[^;]*;?/gi, "")
      .replace(/(?:-webkit-)?(image-set|cross-fade|element|paint|src)\s*\(/gi, "x-blocked(")
      .replace(/url\(\s*(?!["']?data:)[^)]*\)/gi, "none")
      .replace(/expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding/gi, "x-blocked:");
    const s = th.settings(OBS);
    return { css: css.length > 1024 * 1024 ? "" : css, settings: s && typeof s === "object" ? s : {} };
  }
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
  async function importText(data) {
    const th = await WMT.open(data);
    const m = th.manifest, id = m.id;
    if (BUILTIN.includes(id)) throw new Error(`manifest.id «${id}» — это встроенный стиль. Дай своему стилю другой id`);
    const base = BUILTIN.includes(m.base) ? m.base : "neon";
    if (!th.css(APP) && !th.tokens?.color) throw new Error("В теме нет ни секции «@@ css whisper-music», ни цветов в tokens — применять нечего");
    const known = cfg.themes.findIndex((t) => t.id === id);
    if (known < 0 && cfg.themes.length >= 50) throw new Error("Своих стилей уже 50 — удали ненужные");
    await IDB.set(KEY(id), typeof data === "string" ? data : new Blob([data]));      // храним как есть: текст или архив
    const entry = { id, name: m.name.trim().slice(0, 60), author: authorOf(m), base, desc: String(m.description || "").trim().slice(0, 120) };
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
      author: builtin ? AUTHOR : m0.author || "",
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
    // виджет для OBS: у своего стиля — секции из его файла как были; у копии встроенного — заготовка-подсказка
    const obsCss = orig?.css(OBS) || "/* Виджет «Сейчас играет» для OBS (Настройки → Виджет для OBS).\n   Разметка, классы и переменные — docs/WMT-FORMAT.md, раздел «Виджет для OBS». Например:\n   .w-bg { border-radius: 0; }\n   .w-title { letter-spacing: .04em; } */";
    const obsSettings = orig?.settings(OBS) || {};
    const theme = { comment, manifest, tokens, settings: { [APP]: settings, [OBS]: obsSettings }, css: { [APP]: css, [OBS]: obsCss } };
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
