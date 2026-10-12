// Rust-команды отклоняют промис строкой; превращаем её в Error, чтобы везде работал e.message (а не «undefined»)
const invoke = async (cmd, args) => {
  try { return await window.__TAURI__.core.invoke(cmd, args); }
  catch (e) { throw e instanceof Error ? e : new Error(String(e)); }
};

const API = "https://api.music.yandex.net";
const SALT = "XGRlBW9FXlekgbPrRHuSiA";
const OAUTH_URL =
  "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d";
const $ = (s) => document.querySelector(s);
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
};
const JSON_H = { "Content-Type": "application/json" };
const SPK = '<path fill="currentColor" d="M3 9v6h4l5 4V5L7 9z"/>';
const WV = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
const vsvg = (inner) => `<svg viewBox="0 0 24 24" width="22" height="22">${SPK}${inner}</svg>`;
ICON.mute = vsvg(WV("M16 9l5 6M21 9l-5 6"));
ICON.low = vsvg(WV("M15.5 9a4 4 0 0 1 0 6"));
ICON.high = vsvg(WV("M15.5 9a4 4 0 0 1 0 6") + WV("M18.5 6.5a8 8 0 0 1 0 11"));
const svgp = (d) => `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="${d}"/></svg>`;
ICON.heart = svgp("M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z");
ICON.heartOn = svgp("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z");
ICON.shuffle = svgp("M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z");
ICON.repeat = svgp("M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z");
ICON.repeatOne = svgp("M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z");
const fmtTime = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

let uid = localStorage.getItem("ym_uid");
let shown = [];          // треки на экране
let queue = [];          // очередь воспроизведения
let current = -1;
let playingId = null;
let searchTimer = null;
let searchType = "track";
let nav = 0;
let view = null;
const hist = [];
const likes = { done: false, tracks: [] };
let likedIds = new Set();
let playCtx = "other", shuffle = false, repeat = 0, order = [], ordPos = 0, orderFor = null;
{ const m = lsJSON("ym_modes", {}, (v) => typeof v === "object"); shuffle = !!m.shuffle; repeat = [0, 1, 2].includes(m.repeat) ? m.repeat : 0; }
const LK = { ctx: "likes" };
// закреплённое в верхней панели: { type: "album" | "artist", id, title, year? }; всё, что не похоже на закладку, отбрасываем
const pins = lsJSON("ym_pins", [], Array.isArray)
  .filter((p) => p && typeof p === "object" && /^\d+$/.test(String(p.id)) && typeof p.title === "string")
  .slice(0, 50)
  .map((p) => ({ type: p.type === "artist" ? "artist" : "album", id: p.id, title: p.title.slice(0, 200), year: Number.isFinite(p.year) ? p.year : undefined }));
let tabsActive = false, pinItem = null;
const DEFAULT_SEED = "user:onyourwave";
const wave = { on: false, session: null, batch: null, loading: false, queue: [], pos: -1, seed: DEFAULT_SEED, name: "", album: null };   // album: { id, title } — волна по альбому
let artistWaveItem = null;
let playAlbum = null;   // альбом, который сейчас играет целиком: { id, title }
const heard = new Set(lsJSON("ym_heard", [], Array.isArray).filter((x) => typeof x === "string" || typeof x === "number").slice(-600));   // что уже играло в волне
{ const sv = lsJSON("ym_wave_seed", null, (v) => typeof v === "object"); if (typeof sv?.seed === "string" && /^[\w-]+:[\w.-]+$/.test(sv.seed)) { wave.seed = sv.seed; wave.name = typeof sv.name === "string" ? sv.name.slice(0, 100) : ""; } }
const savedVol = parseFloat(localStorage.getItem("ym_vol"));
let audio = null, audioViz = false, volume = savedVol >= 0 && savedVol <= 1 ? savedVol : 0.8, playSeq = 0, curBlob = null;
let actx = null, analyser = null, freq = null;
let needLoad = false, resumePos = 0, lastSave = 0;
const viz = { run: false, bass: 0, mid: 0, sm: new Float32Array(128), skip: false };

// ---------- проверки адресов и данных ----------
// доверенные домены Яндекса; граница — точка, поэтому «evilyandex.net» не проходит
const TRUSTED_SUFFIXES = ["yandex.net", "yandex.ru", "yandex.com", "yandex.by", "yandex.kz"];
const hostTrusted = (h) => TRUSTED_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
// возвращает нормализованный адрес, только если это https на доверенный хост, иначе ""
function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
    return hostTrusted(u.hostname.toLowerCase()) ? u.href : "";
  } catch { return ""; }
}
// безопасное чтение JSON из localStorage: при порче данных возвращает запасное значение, а не роняет запуск
function lsJSON(key, fallback, ok = () => true) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v != null && ok(v) ? v : fallback; }
  catch { return fallback; }
}
function mkImg(src, cls) {            // картинки создаём через DOM, а не через строку HTML
  const im = document.createElement("img");
  im.alt = ""; if (cls) im.className = cls; if (src) im.src = src;
  return im;
}

// ---------- запросы (через Rust) ----------
// Authorization сюда не добавляется: заголовок подставляет Rust из системного хранилища, токен в JavaScript не попадает
const HEADERS = () => ({
  "User-Agent": "Yandex-Music-API",
  "X-Yandex-Music-Client": "YandexMusicAndroid/24023231",
});
async function http(url, { method = "GET", headers = {}, body = null } = {}) {
  return await invoke("http_request", { method, url, headers, body });
}
async function api(path, opts = {}) {
  const r = await http(API + path, { ...opts, headers: { ...HEADERS(), ...(opts.headers || {}) } });
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body).result;
}

// ---------- внешний вид ----------
const STYLE_DEF = {
  neon:  { accent: "#a66bff", accent2: "#e060ff", glow: 22, panel: 70, dim: 10, bg: "" },
  royal: { accent: "#c9a24b", accent2: "#8b1e2d", glow: 6, panel: 92, dim: 10, bg: "" },
  steam: { accent: "#c58a4b", accent2: "#8c4f24", glow: 4, panel: 90, dim: 10, bg: "" },
  lolitta: { accent: "#e2aab4", accent2: "#8c4a5c", glow: 4, panel: 94, dim: 10, bg: "" },
};
const STYLE_KEYS = ["accent", "accent2", "glow", "panel", "dim"];
const freshCfg = () => ({ style: "royal", blur: 6, viz: true, anim: true, bg: "", s: Object.fromEntries(Object.keys(STYLE_DEF).map((k) => [k, { ...STYLE_DEF[k] }])) });
function loadCfg() {
  let saved = null, old = null;
  try { saved = JSON.parse(localStorage.getItem("ym_cfg3") || "null"); } catch {}
  try { old = JSON.parse(localStorage.getItem("ym_cfg2") || "null"); } catch {}
  const c = freshCfg();
  if (saved) {
    for (const k of ["style", "blur", "viz", "bg", "anim"]) if (saved[k] !== undefined) c[k] = saved[k];
    for (const st of Object.keys(STYLE_DEF)) {
      Object.assign(c.s[st], saved.s?.[st] || {});
      // затемнение раньше было общим: прежнее значение переносим во все стили, если у стиля своего нет
      if (saved.s?.[st]?.dim === undefined && saved.dim !== undefined) c.s[st].dim = saved.dim;
    }
  } else if (old) {                       // прежние настройки (до выбора стиля) относились к неону
    for (const k of ["blur", "viz", "bg"]) if (old[k] !== undefined) c[k] = old[k];
    for (const k of STYLE_KEYS) if (old[k] !== undefined) c.s.neon[k] = old[k];
  }
  if (!c.s[c.style]) c.style = "royal";
  return c;
}
let cfg = loadCfg();
// у каждого стиля свой фон: blob-адреса по стилям; сами файлы лежат в IndexedDB под ключами "bg:<стиль>",
// а в cfg.s[стиль].bg — только метка "idb". cfg.bg остался лишь для переноса фона из старых версий.
const bgUrls = { neon: "", royal: "", steam: "", lolitta: "" };
const bgKey = (st) => "bg:" + st;
const sty = () => cfg.s[cfg.style];
const curBg = () => bgUrls[cfg.style] || "";

function fill(el) { el.style.setProperty("--p", ((el.value - el.min) / (el.max - el.min)) * 100 + "%"); }
function fillAll() { document.querySelectorAll("input[type=range]").forEach(fill); }

// читаемый цвет текста для кнопок с градиентом accent → accent2: тёмный или белый, смотря у чего контраст
// с самым «неудобным» местом градиента (оба края и середина) выше; при слабом контрасте добавляем тень
function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function relLum(rgb) { return rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
function onAccent(a, b) {
  const DARK = "#0b0618", ca = hexRgb(a), cb = hexRgb(b);
  if (!ca || !cb) return { color: DARK, shadow: "none" };
  const spots = [ca, cb, ca.map((v, i) => Math.round((v + cb[i]) / 2))].map(relLum);
  const cr = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const dark = Math.min(...spots.map((l) => cr(l, relLum(hexRgb(DARK))))), white = Math.min(...spots.map((l) => cr(l, 1)));
  const useDark = dark >= white, best = Math.max(dark, white);
  const shadow = best >= 4.5 ? "none" : useDark ? "0 0 5px rgba(255,255,255,.55)" : "0 1px 4px rgba(0,0,0,.75)";
  return { color: useDark ? DARK : "#ffffff", shadow };
}
// Lolitta: цвет текста и иконок на кнопках, закладках и светлых панелях подбирается по контрасту с их настоящим фоном,
// поэтому всё читается при любых выбранных цветах (даже белом или чёрном). Фоны считаются так же, как color-mix в CSS.
function loInk(st) {
  const r = document.documentElement.style;
  const NAMES = ["--lo-on-btn", "--lo-on-tab", "--lo-on-act", "--lo-on-tabact", "--lo-ink", "--lo-on-mid"];
  const A = hexRgb(st.accent), B = hexRgb(st.accent2);
  if (cfg.style !== "lolitta" || !A || !B) {
    for (const n of NAMES) { r.removeProperty(n); r.removeProperty(n + "-sh"); }
    for (const n of ["--lo-ic", "--lo-title", "--l-btn", "--l-btn2"]) r.removeProperty(n);
    return;
  }
  const mix = (a, b, p) => a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  const cr = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const H = hexRgb, W = [255, 255, 255], DARK = "#2a1218", LIGHT = "#fff6f7";
  // первый кандидат с контрастом от t (для текста 4.5) ко всем точкам фона; если такого нет — самый контрастный
  const pick = (bgs, cands, t = 4.5) => {
    let best = cands[0], bv = -1;
    for (const c of cands) { const v = Math.min(...bgs.map((b) => cr(b, H(c)))); if (v >= t) return { c, v }; if (v > bv) { best = c; bv = v; } }
    return { c: best, v: bv };
  };
  const set = (name, p) => {
    r.setProperty(name, p.c);
    r.setProperty(name + "-sh", p.v >= 4.5 ? "none" : relLum(H(p.c)) > 0.35 ? "0 1px 2px rgba(30,8,15,.9), 0 0 6px rgba(30,8,15,.6)" : "0 0 4px rgba(255,255,255,.9), 0 1px 0 rgba(255,255,255,.7)");
  };
  // тёмные кнопки и закладки: при светлом «Втором» цвете (белый, пастель) фон затемняется настолько,
  // чтобы на нём читался светлый текст; при обычных цветах остаётся как задумано (60% и 42% второго цвета)
  const darken = (base, p, maxLum) => { let c = mix(B, H(base), p); while (relLum(c) > maxLum && p > 0) { p = Math.max(0, p - 0.04); c = mix(B, H(base), p); } return c; };
  const btn = [darken("#2a1218", 0.6, 0.06), darken("#1c0b10", 0.42, 0.035)];
  r.setProperty("--l-btn", hex(btn[0])); r.setProperty("--l-btn2", hex(btn[1]));
  // заголовок страницы переливается в основной цвет; если он слишком тёмный — в светлый оттенок, чтобы надпись читалась
  if (relLum(A) < 0.18) r.setProperty("--lo-title", hex(mix(A, H("#fff8f6"), 0.4))); else r.removeProperty("--lo-title");
  const act = [mix(A, W, 0.82), mix(A, B, 0.62)];                                  // активная кнопка
  const light = mix(A, H("#fbf0f0"), 0.5), lights = [mix(light, W, 0.55), light, mix(A, H("#f1d8d9"), 0.72)];   // светлые панели
  const hi = mix(A, H("#fff8f6"), 0.4), lo = mix(A, B, 0.5), ink = mix(B, H("#24100f"), 0.64);
  set("--lo-on-btn", pick(btn, ["#f9eaec", LIGHT, DARK]));
  set("--lo-on-tab", pick(btn, [hex(hi), "#f9eaec", LIGHT, DARK]));
  set("--lo-on-act", pick(act, [LIGHT, DARK]));
  set("--lo-on-tabact", pick([mix(A, W, 0.75), A], [hex(ink), DARK, LIGHT]));
  set("--lo-ink", pick(lights, [hex(ink), DARK, LIGHT]));
  set("--lo-on-mid", pick([A, lo], [LIGHT, DARK], 1.8));      // сердечки и значок медальона: светлые, пока заметны на розовом металле
  // иконки разделов — розовый металл, если он заметен на кнопке; иначе — цвет текста кнопки
  if (Math.min(...btn.map((b) => cr(b, A))) < 2.2) r.setProperty("--lo-ic", r.getPropertyValue("--lo-on-btn"));
  else r.removeProperty("--lo-ic");
}
function applyCfg() {
  const r = document.documentElement.style, st = sty();
  document.documentElement.dataset.style = cfg.style;
  document.documentElement.dataset.anim = cfg.anim === false ? "off" : "on";      // выключатель анимаций — действует во всех стилях
  r.setProperty("--accent", st.accent);
  r.setProperty("--accent2", st.accent2);
  const oa = onAccent(st.accent, st.accent2);
  r.setProperty("--on-accent", oa.color);
  r.setProperty("--on-accent-shadow", cfg.style === "neon" ? oa.shadow : "none");      // королевский стиль красит текст сам
  r.setProperty("--glow", (cfg.style === "neon" ? st.glow : STYLE_DEF[cfg.style].glow) + "px");      // свечение настраивается только в неоне
  r.setProperty("--panel-a", st.panel / 100);
  r.setProperty("--dim", st.dim / 100);
  r.setProperty("--bgblur", cfg.blur + "px");
  loInk(st);
  const img = curBg() ? `url("${curBg()}")` : "none";
  r.setProperty("--bg-image", img);
  $("#drop").style.setProperty("--drop-img", img);
  applyViz();
}
function saveCfg() {
  try { localStorage.setItem("ym_cfg3", JSON.stringify(cfg)); $("#setNote").textContent = ""; return true; }
  catch { $("#setNote").textContent = "Не удалось сохранить настройки: закончилось место в хранилище приложения."; return false; }
}
const SLIDERS = [["#cAccent", "accent"], ["#cAccent2", "accent2"], ["#cGlow", "glow", 1], ["#cPanel", "panel", 1], ["#cDim", "dim", 1], ["#cBlur", "blur", 1]];
const getv = (k) => (STYLE_KEYS.includes(k) ? sty()[k] : cfg[k]);
const setv = (k, v) => { if (STYLE_KEYS.includes(k)) sty()[k] = v; else cfg[k] = v; };
function syncControls() {                    // подставляет значения текущего стиля в настройки
  for (const [id, k] of SLIDERS) $(id).value = getv(k);
  $("#cViz").checked = cfg.viz;
  $("#cAnim").checked = cfg.anim !== false;
  const neon = cfg.style === "neon";
  $("#cGlow").closest("label").style.display = neon ? "" : "none";
  $("#glassTitle").textContent = neon ? "Стекло и свечение" : "Панели";
  document.querySelectorAll(".stylecard").forEach((b) => b.classList.toggle("on", b.dataset.style === cfg.style));
  fillAll();
}
for (const [id, key, num] of SLIDERS) {
  const el = $(id);
  el.addEventListener("input", () => { setv(key, num ? +el.value : el.value); applyCfg(); saveCfg(); });
}
document.querySelectorAll("input[type=range]").forEach((el) => el.addEventListener("input", () => fill(el)));
document.querySelectorAll(".stylecard").forEach((b) => (b.onclick = () => { cfg.style = b.dataset.style; applyCfg(); saveCfg(); syncControls(); }));

// ---------- фон: сам файл хранится в IndexedDB (там нет лимита в ~5 МБ, как в localStorage) ----------
const IDB = {
  db: null,
  open() {
    return (this.db ||= new Promise((res, rej) => {
      const r = indexedDB.open("whisper-edition", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction("kv", mode), rq = fn(t.objectStore("kv"));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  get: (k) => IDB.tx("readonly", (s) => s.get(k)),
  set: (k, v) => IDB.tx("readwrite", (s) => s.put(v, k)),
  del: (k) => IDB.tx("readwrite", (s) => s.delete(k)),
};
const bgNote = (m) => { $("#setNote").textContent = m || ""; };
function setBgBlob(blob, st = cfg.style) {
  if (bgUrls[st]) URL.revokeObjectURL(bgUrls[st]);
  bgUrls[st] = blob ? URL.createObjectURL(blob) : "";
}
function dataUrlToBlob(u) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u);
  if (!m) throw new Error("bad data url");
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] || "application/octet-stream" });
}

const BG_MAX_BYTES = IMG_LIMITS.maxBytes;     // больше этого фон не берём
const BG_MAX_SIDE = 3840;     // всё, что больше 4K, уменьшаем — иначе размытие и память страдают без пользы
// проверяет файл и возвращает { blob, info }; если файл не подходит — бросает ошибку с понятным текстом
async function prepareBg(f) {
  if (/^(video|audio)\//.test(f.type)) throw new Error("Видео и звук как фон не поддерживаются — выбери картинку или GIF.");
  // 1) формат, размеры и кадры — из заголовков, ещё до декодирования (imgguard.js)
  let g;
  try { g = imageGuard(new Uint8Array(await f.arrayBuffer())); }
  catch (e) { throw new Error(`«${f.name}»: ${e.message}`); }
  // тип берём из содержимого файла, а не из расширения
  if (f.type !== g.type) f = new File([f], f.name, { type: g.type });
  // 2) пробное декодирование: битый файл с правильным заголовком отсеется здесь
  let w = g.w, h = g.h;
  try { const bm = await createImageBitmap(f); w = bm.width; h = bm.height; bm.close(); }
  catch { throw new Error(`Не получилось открыть «${f.name}»: файл повреждён.`); }
  const flat = g.frames === 1 && ["image/jpeg", "image/png", "image/bmp"].includes(g.type);      // анимации не трогаем
  if (flat && Math.max(w, h) > BG_MAX_SIDE) {
    const k = BG_MAX_SIDE / Math.max(w, h), cw = Math.round(w * k), ch = Math.round(h * k);
    try {
      const small = await createImageBitmap(f, { resizeWidth: cw, resizeHeight: ch, resizeQuality: "high" });
      const c = document.createElement("canvas"); c.width = cw; c.height = ch;
      c.getContext("2d").drawImage(small, 0, 0); small.close();
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
      if (blob) return { blob, info: `Картинка ${w}×${h} очень большая — уменьшил до ${cw}×${ch}, на экране разницы не будет.` };
    } catch {}
  }
  return { blob: f, info: "" };
}
async function loadBg(f) {
  if (!f) { bgNote("Не получилось получить файл. Выбери его кнопкой или перетащи сам файл (не ссылку и не текст)."); return false; }
  if (f.size > BG_MAX_BYTES) { bgNote(`Файл «${f.name}» весит ${Math.round(f.size / 1048576)} МБ — это больше лимита в ${BG_MAX_BYTES / 1048576} МБ. Выбери файл поменьше.`); return false; }
  const st = cfg.style;              // фон достаётся тому стилю, который был открыт в момент выбора файла
  bgNote("Загружаю…");
  let prep;
  try { prep = await prepareBg(f); }
  catch (e) { bgNote(e.message || "Не удалось прочитать файл."); return false; }
  setBgBlob(prep.blob, st);
  cfg.s[st].bg = "idb";
  applyCfg();
  let kept = true;
  try { await IDB.set(bgKey(st), prep.blob); }
  catch (e) {
    kept = false;
    bgNote(e?.name === "QuotaExceededError" ? "Фон применён, но на диске не хватает места, чтобы сохранить его: после перезапуска он пропадёт." : "Фон применён, но сохранить его не удалось: после перезапуска он пропадёт.");
  }
  if (saveCfg() && kept) bgNote(prep.info);
  return true;
}
async function clearBg(st = cfg.style) {
  setBgBlob(null, st); cfg.s[st].bg = "";
  try { await IDB.del(bgKey(st)); } catch {}
}
// при старте: достаём файл из IndexedDB; фон из старой версии (data-URL в localStorage) переносим туда же
// общий фон из прежних версий достаётся стилю, который был выбран
async function initBg() {
  try {
    if (cfg.bg) {
      const blob = cfg.bg === "idb" ? await IDB.get("bg") : dataUrlToBlob(cfg.bg);
      if (blob) { await IDB.set(bgKey(cfg.style), blob); cfg.s[cfg.style].bg = "idb"; }
      await IDB.del("bg");
    }
  } catch {}
  cfg.bg = "";
  for (const st of Object.keys(bgUrls)) {
    if (cfg.s[st].bg !== "idb") continue;
    let blob = null;
    try { blob = await IDB.get(bgKey(st)); } catch {}
    if (!blob) { cfg.s[st].bg = ""; continue; }
    // фоны, сохранённые старыми версиями без проверки, проверяем перед показом; негодные удаляем
    try { imageGuard(new Uint8Array(await blob.arrayBuffer())); setBgBlob(blob, st); }
    catch (e) { console.warn(`Фон стиля ${st} отклонён:`, e?.message); cfg.s[st].bg = ""; try { await IDB.del(bgKey(st)); } catch {} }
  }
  if (saveCfg()) localStorage.removeItem("ym_cfg2");          // прежние настройки (с тяжёлой картинкой внутри) больше не нужны
  applyCfg();
}
$("#bgFile").onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; await loadBg(f); };
const drop = $("#drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); loadBg(e.dataTransfer.files[0]); };
$("#bgReset").onclick = async () => { await clearBg(); applyCfg(); saveCfg(); };
$("#cfgReset").onclick = async () => { const keep = cfg.style; for (const st of Object.keys(bgUrls)) await clearBg(st); cfg = freshCfg(); cfg.style = keep; applyCfg(); saveCfg(); syncControls(); };
$("#cViz").onchange = (e) => { cfg.viz = e.target.checked; applyViz(); saveCfg(); };
$("#cAnim").onchange = (e) => { cfg.anim = e.target.checked; applyCfg(); saveCfg(); };

// ---------- подбор цветов под фон ----------
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hsl2hex(h, s, l) {
  s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return "#" + f(0) + f(8) + f(4);
}
async function paletteFrom(src) {
  const img = new Image(); img.src = src; await img.decode();
  const S = 64, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data;
  const bins = Array.from({ length: 24 }, (_, i) => ({ h: i * 15 + 7.5, w: 0, s: 0 }));
  let sumS = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const [h, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
    sumS += s; n++;
    const w = s * (1 - Math.abs(2 * l - 1));          // сочные пиксели средней яркости важнее
    const b = bins[Math.floor(h / 15) % 24];
    b.w += w; b.s += s * w;
  }
  if (!n || sumS / n < 0.1) return { accent: "#e8e8f4", accent2: "#9a9ab4", mono: true };
  const sorted = bins.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const first = sorted[0];
  const dist = (a, b) => { const x = Math.abs(a - b) % 360; return Math.min(x, 360 - x); };
  const second = sorted.find((b) => b !== first && dist(b.h, first.h) >= 45 && b.w >= first.w * 0.25);
  const sat = (b) => Math.min(0.95, Math.max(0.6, b.s / b.w));
  return {
    accent: hsl2hex(first.h, sat(first), 0.64),
    accent2: second ? hsl2hex(second.h, sat(second), 0.62) : hsl2hex((first.h + 45) % 360, 0.8, 0.66),
  };
}
// подбирает цвета по текущему фону; возвращает { ok, mono } и пишет пояснение, если не вышло
async function pickPalette() {
  const note = $("#setNote");
  if (!curBg()) { note.textContent = "Сначала загрузи фон: цвета подбираются по нему."; return { ok: false }; }
  try {
    const p = await paletteFrom(curBg());
    sty().accent = p.accent; sty().accent2 = p.accent2;
    $("#cAccent").value = p.accent; $("#cAccent2").value = p.accent2;
    applyCfg(); saveCfg();
    note.textContent = p.mono ? "Фон почти без цвета, поэтому палитра получилась сдержанной серебристой." : "Цвета подобраны по фону.";
    return { ok: true, mono: !!p.mono };
  } catch { note.textContent = "Не удалось разобрать изображение."; return { ok: false }; }
}
$("#paletteBtn").onclick = pickPalette;

// ---------- обои с рабочего стола: Rust отдаёт файл текущих обоев Windows, дальше всё как с обычной картинкой ----------
function sniffImage(b) {                       // формат определяем по первым байтам: у файла обоев может не быть расширения
  const at = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8) return ["image/jpeg", "jpg"];
  if (b[0] === 0x89 && at(1, "PNG")) return ["image/png", "png"];
  if (at(0, "BM")) return ["image/bmp", "bmp"];
  if (at(0, "GIF8")) return ["image/gif", "gif"];
  if (at(0, "RIFF") && at(8, "WEBP")) return ["image/webp", "webp"];
  if (at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return ["image/avif", "avif"];
  return null;
}
$("#deskBtn").onclick = async () => {
  const btn = $("#deskBtn");
  btn.disabled = true;
  bgNote("Беру обои с рабочего стола…");
  try {
    let buf;
    try { buf = await invoke("desktop_wallpaper"); }
    catch (e) {
      const m = String(e?.message || e);
      throw new Error(/not found/i.test(m) ? "В этой сборке ещё нет функции обоев рабочего стола: обнови Rust-часть (desktop.rs)." : m);
    }
    const bytes = new Uint8Array(buf);
    const kind = sniffImage(bytes);
    if (!kind) throw new Error("Не удалось распознать формат обоев рабочего стола. Выбери картинку вручную.");
    if (!(await loadBg(new File([bytes], "desktop-wallpaper." + kind[1], { type: kind[0] })))) return;      // причину уже написал loadBg
    const r = await pickPalette();
    if (r.ok && !r.mono) bgNote("Готово: фон с рабочего стола применён, цвета подобраны.");
  } catch (e) { bgNote(e.message || "Не удалось взять обои рабочего стола."); }
  finally { btn.disabled = false; }
};

applyCfg(); syncControls();
initBg();

// ---------- токен ----------
// Токен лежит только в системном хранилище (Windows: «Диспетчер учётных данных») и никогда не попадает в JavaScript:
// его кладёт туда Rust, а заголовок Authorization к запросам на api.music.yandex.net тоже добавляет Rust.
// Поэтому даже вредоносный скрипт в окне не сможет прочитать токен или отправить его на чужой адрес.
const LEGACY_TOKEN_KEY = "ym_token";
async function tokenExists() {
  try { return !!(await invoke("token_exists")); } catch { return null; }        // null — Rust-команд нет (не обновлена Rust-часть)
}
async function migrateLegacyToken() {            // токен из старых версий лежал открытым текстом в localStorage — переносим и стираем
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacy) return "";
  try {
    await invoke("token_store", { token: legacy });
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    return "";
  } catch (e) {
    const m = String(e?.message || e);
    console.error("Перенос старого токена не удался:", m);
    // испорченный токен держать открытым текстом незачем — стираем; при сбое хранилища тоже стираем,
    // чтобы секрет не оставался в localStorage: пользователь просто войдёт заново
    try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch {}
    return /неправильно/i.test(m)
      ? "Сохранённый токен из старой версии повреждён и удалён — войди заново."
      : "Не удалось перенести токен из старой версии в системное хранилище (" + m + "). Из соображений безопасности он удалён — войди заново.";
  }
}

// ---------- вход ----------
async function finishLogin() {                    // токен уже в хранилище; проверяем его и узнаём uid
  try {
    const st = await api("/account/status");
    uid = st.account.uid;
  } catch (e) {
    if (/^HTTP 40[13]/.test(String(e?.message))) { try { await invoke("token_clear"); } catch {} }     // чужой/просроченный токен не оставляем
    throw e;
  }
  localStorage.setItem("ym_uid", uid);
}
function showLogin(msg = "") { $("#login").classList.remove("hidden"); $("#loginErr").textContent = msg; }
function afterLogin() { $("#login").classList.add("hidden"); goTop(showLikes); restorePlayer(); loadLikedIds(); }

// вход одной кнопкой: Rust открывает окно авторизации Яндекса, сам забирает токен и кладёт его в хранилище — копировать ничего не нужно
$("#oauthBtn").onclick = async () => {
  const btn = $("#oauthBtn");
  btn.disabled = true;
  $("#loginErr").textContent = "Войди в аккаунт Яндекса в открывшемся окне — оно закроется само.";
  try {
    await invoke("yandex_login");
    await finishLogin();
    $("#loginErr").textContent = "";
    afterLogin();
  } catch (e) {
    const m = String(e?.message || e);
    if (/not found/i.test(m)) { $("#manual").open = true; showLogin("В этой сборке нет автоматического входа: обнови Rust-часть (auth.rs, net.rs) или войди вручную по токену ниже."); }
    else if (/закрыто|уже открыто/.test(m)) showLogin(m + ".");
    else showLogin("Не удалось войти: " + m);
  } finally { btn.disabled = false; }
};

// запасной путь: ручной ввод токена
$("#getToken").onclick = (e) => { e.preventDefault(); window.__TAURI__.opener.openUrl(OAUTH_URL); };
$("#loginBtn").onclick = async () => {
  try {
    await invoke("token_store", { token: $("#tokenInput").value });
    $("#tokenInput").value = "";
    await finishLogin();
    afterLogin();
  } catch (e) { showLogin("Не удалось войти: " + (e?.message || e)); }
};
$("#profile").onclick = async () => {
  if (!confirm("Выйти из аккаунта?")) return;
  try { await invoke("token_clear"); }
  catch (e) { alert("Не удалось удалить токен из системного хранилища: " + (e?.message || e) + "\nВыход не выполнен — попробуй ещё раз."); return; }   // не делаем вид, что вышли
  localStorage.removeItem("ym_uid"); localStorage.removeItem(LEGACY_TOKEN_KEY);
  location.reload();
};

// ---------- вспомогательное ----------
const cover = (t, size = "100x100") => (t?.coverUri ? safeUrl("https://" + String(t.coverUri).replace("%%", size)) : "");   // только https и доверенные хосты
const plural = (n, f) => { const m = n % 100, d = n % 10; return f[m > 10 && m < 20 ? 2 : d === 1 ? 0 : d > 1 && d < 5 ? 1 : 2]; };
function fmtDate(a) {
  const d = Date.parse(a.releaseDate);
  if (!isNaN(d)) return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  return a.year ? String(a.year) : "";
}
const albumTime = (a) => Date.parse(a.releaseDate) || (a.year ? Date.UTC(a.year, 0, 1) : 0);
const albumInfo = (a) =>
  [fmtDate(a), a.trackCount ? `${a.trackCount} ${plural(a.trackCount, ["трек", "трека", "треков"])}` : ""].filter(Boolean).join(" · ");

function fillArtists(el, t) {
  el.textContent = "";
  (t.artists || []).forEach((a, i) => {
    if (i) el.append(", ");
    const s = document.createElement("span");
    s.className = "art"; s.textContent = a.name;
    s.onclick = (e) => { e.stopPropagation(); navigate(() => showArtist(a.id)); };
    el.append(s);
  });
}
const albumOf = (t) => t?.albums?.[0]?.id;

// ---------- отрисовка списков ----------
function renderList(tracks, append = false, opts = {}) {
  const list = $("#list");
  if (!append) { shown = []; list.innerHTML = ""; }
  const arr = shown;
  for (const t of tracks) {
    const i = arr.push(t) - 1;
    const li = document.createElement("li");
    li.dataset.id = t.id;
    if (String(t.id) === String(playingId)) li.classList.add("playing");
    const body = document.createElement("div");
    body.innerHTML = '<span class="t"></span><span class="a"></span>';
    li.append(mkImg(cover(t)), body);
    const tt = li.querySelector(".t");
    tt.textContent = t.title;
    const albumId = albumOf(t);
    if (albumId && !opts.noAlbumLink) {
      tt.classList.add("link");
      tt.onclick = (e) => { e.stopPropagation(); navigate(() => showAlbum(albumId)); };
    }
    fillArtists(li.querySelector(".a"), t);
    li.onclick = () => { wave.on = false; queue = arr; playCtx = opts.ctx || "other"; playAlbum = opts.album || null; play(i); };
    const hb = document.createElement("button");
    hb.className = "likebtn";
    setHeart(hb, likedIds.has(String(t.id)));
    hb.onclick = (e) => { e.stopPropagation(); toggleLike(t); };
    li.append(hb);
    list.appendChild(li);
  }
}

function entityItem({ img, round, title, subFn, onClick }) {
  const li = document.createElement("li");
  const body = document.createElement("div");
  body.innerHTML = '<span class="t"></span><span class="a"></span>';
  li.append(mkImg(safeUrl(img), round ? "rnd" : ""), body);
  li.querySelector(".t").textContent = title;
  subFn(li.querySelector(".a"));
  li.onclick = onClick;
  $("#list").appendChild(li);
}
function renderAlbums(items, withArtists = false) {
  for (const a of items) {
    entityItem({
      img: cover(a), title: a.title,
      subFn: (el) => {
        if (withArtists) { fillArtists(el, a); const x = albumInfo(a); if (x) el.append(" · " + x); }
        else el.textContent = albumInfo(a);
      },
      onClick: () => navigate(() => showAlbum(a.id)),
    });
  }
}
function renderArtists(items) {
  for (const a of items) {
    const u = a.cover?.uri || a.ogImage;
    entityItem({
      img: u ? cover({ coverUri: u }) : "", round: true, title: a.name,
      subFn: (el) => (el.textContent = "Артист"),
      onClick: () => navigate(() => showArtist(a.id)),
    });
  }
}

const pinKey = (type, id) => type + ":" + id;
const isPinned = (type, id) => pins.some((p) => p.type === type && String(p.id) === String(id));
function savePins() { try { localStorage.setItem("ym_pins", JSON.stringify(pins)); } catch {} }
function updatePinBtn() {
  const pb = $("#pinBtn");
  pb.hidden = !pinItem;
  if (!pinItem) return;
  const on = isPinned(pinItem.type, pinItem.id);
  pb.textContent = on ? "✓ Закреплён" : "Закрепить";
  pb.classList.toggle("active", on);
}
function unpin(type, id) {
  const i = pins.findIndex((p) => p.type === type && String(p.id) === String(id));
  if (i >= 0) pins.splice(i, 1);
  savePins(); renderTabs(tabsActive); updatePinBtn();
}
$("#pinBtn").onclick = () => {
  if (!pinItem) return;
  if (isPinned(pinItem.type, pinItem.id)) return unpin(pinItem.type, pinItem.id);
  pins.push({ type: pinItem.type, id: pinItem.id, title: pinItem.title, year: pinItem.year });
  savePins(); renderTabs(tabsActive); updatePinBtn();
};

function setHead({ title = "", img = "", round = true, back = false, sub = null, pin = null, artistWave = null }) {
  artistWaveItem = artistWave; $("#artistWaveBtn").hidden = !artistWave;
  pinItem = pin; updatePinBtn();
  $("#title").textContent = title;
  const im = $("#headImg"); im.hidden = !img; if (img) im.src = img;
  im.classList.toggle("sq", !round);
  $("#back").hidden = !back;
  const s = $("#sub");
  s.hidden = !sub; s.textContent = "";
  if (sub) sub(s);
}
function setChips(items, active, onPick) {
  const c = $("#chips"); c.hidden = false; c.innerHTML = "";
  for (const [id, label] of items) {
    const b = document.createElement("button");
    b.className = "chip" + (id === active ? " active" : "");
    b.textContent = label;
    b.onclick = () => onPick(id);
    c.append(b);
  }
}
function resetView() {
  vizStop();
  $("#stWrap").hidden = true; $("#waveInfo").hidden = true;
  $("#stations").hidden = true;
  document.querySelector(".main").classList.remove("wavemode");
  shown = []; $("#list").innerHTML = ""; $("#list").hidden = false;
  $("#more").hidden = true; $("#status").textContent = "";
  $("#chips").hidden = true; $("#lastAlbum").hidden = true; $("#similar").hidden = true;
  $("#wavePage").hidden = true; $("#settingsPage").hidden = true; $("#statsPage").hidden = true;
  document.querySelector(".main").scrollTop = 0;
}
function setActive(id) {
  document.querySelectorAll(".side .nav").forEach((b) => b.classList.toggle("active", b.id === id));
  document.querySelector(".main").dataset.page = id || "";      // для иконки-медальона у заголовка в стимпанке
}
const roman = (n) => {
  n = +n; if (!n || n < 1 || n > 3999) return "";
  let r = "";
  for (const [v, t] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) while (n >= v) { r += t; n -= v; }
  return r;
};
function renderTabs(active) {
  tabsActive = active;
  const box = $("#tabs");
  box.innerHTML = "";
  box.classList.toggle("pins", pins.length > 0);
  const mk = (label, key, fn, onClose, sub) => {
    const d = document.createElement("div");
    d.className = "tab" + (active === key ? " active" : "");
    const t = document.createElement("span"); t.textContent = label; d.append(t);
    const sm = document.createElement("small"); sm.textContent = sub || ""; d.append(sm);   // эпитафия видна только в королевском стиле
    if (onClose) {
      const x = document.createElement("i"); x.textContent = "✕"; x.title = "Открепить";
      x.onclick = (e) => { e.stopPropagation(); onClose(); };
      d.append(x);
    }
    d.insertAdjacentHTML("beforeend", `<span class="lodeco lo-tabbow" aria-hidden="true">${LO.bow2}</span>`);   // бантик под активной закладкой (виден только в Lolitta), второго цвета
    d.onclick = fn; box.append(d);
  };
  mk("Лайки", "likes", () => goTop(showLikes), null, "♥");
  for (const p of pins) {
    const isArtist = p.type === "artist";
    mk(p.title, pinKey(p.type, p.id), () => goTop(() => (isArtist ? showArtist(p.id) : showAlbum(p.id))), () => unpin(p.type, p.id), isArtist ? "♪" : roman(p.year) || "†");
  }
}
function syncIcons() {
  const playing = !audio.paused;
  document.body.classList.toggle("is-playing", playing);      // для CSS-анимаций «играет»
  $("#play").innerHTML = playing ? ICON.pause : ICON.play;
  $("#fPlay").innerHTML = playing ? ICON.pause : ICON.play;
  $("#qPlay").innerHTML = playing ? ICON.pause : ICON.play;
  $("#waveBtn").innerHTML = wave.on && playing ? ICON.pause : ICON.play;
  $("#waveBtn").classList.toggle("playing", wave.on && playing);
  Promise.resolve(invoke("tray_playing", { playing })).catch(() => {});     // подпись пункта в меню трея
}
// кнопки из меню значка в трее
window.__TAURI__.event?.listen("tray-ctl", (e) => {
  if (e.payload === "prev") $("#prev").click();
  else if (e.payload === "next") $("#next").click();
  else if (e.payload === "toggle") togglePlay();
});

// ---------- навигация ----------
function navigate(fn) { if (view) hist.push(view); view = fn; fn(); }   // переход «вглубь»
function goTop(fn) { hist.length = 0; view = fn; fn(); }                   // разделы боковой панели
$("#likes").onclick = () => goTop(showLikes);
$("#wave").onclick = () => goTop(showWave);
$("#settingsBtn").onclick = () => goTop(showSettings);
$("#statsBtn").onclick = () => goTop(showStats);
$("#back").onclick = () => { const p = hist.pop(); if (p) { view = p; p(); } else goTop(showLikes); };

// ---------- лайки ----------
async function showLikes() {
  const my = ++nav;
  setHead({ title: "Лайки" }); setActive("likes"); renderTabs("likes"); resetView();
  $("#search").value = "";
  if (likes.done) return renderList(likes.tracks, false, LK);
  $("#status").textContent = "Загрузка…";
  try {
    const lib = await api(`/users/${uid}/likes/tracks`);
    likedIds = new Set(lib.library.tracks.map((t) => String(t.id)));
    const ids = lib.library.tracks
      .slice()
      .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
      .map((t) => `${t.id}:${t.albumId}`);
    const acc = [];
    for (let i = 0; i < ids.length; i += 100) {
      const tracks = await api("/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "track-ids=" + encodeURIComponent(ids.slice(i, i + 100).join(",")),
      });
      if (my !== nav) return;
      acc.push(...tracks);
      renderList(tracks, i > 0, LK);
      $("#status").textContent = i + 100 < ids.length ? `Загружено ${acc.length} из ${ids.length}…` : "";
    }
    likes.tracks = acc; likes.done = true;
  } catch (e) { if (my === nav) $("#status").textContent = "Ошибка: " + e.message; }
}


// ---------- статистика ----------
// Считается по твоим ЛАЙКАМ. У API Яндекс Музыки нет методов, которые отдают общее время прослушивания,
// число прослушиваний трека/артиста и рейтинги «по прослушиваниям» — поэтому таких показателей здесь нет.
async function loadAllLikes(onProgress, stale) {
  if (likes.done) return likes.tracks;
  const lib = await api(`/users/${uid}/likes/tracks`);
  likedIds = new Set(lib.library.tracks.map((t) => String(t.id)));
  const ids = lib.library.tracks.map((t) => `${t.id}:${t.albumId}`);
  const acc = [];
  for (let i = 0; i < ids.length; i += 100) {
    const tracks = await api("/tracks", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "track-ids=" + encodeURIComponent(ids.slice(i, i + 100).join(",")),
    });
    if (stale()) return null;
    acc.push(...tracks);
    onProgress(acc.length, ids.length);
  }
  likes.tracks = acc; likes.done = true;
  return acc;
}
const artistImg = (a) => (a?.cover?.uri ? cover({ coverUri: a.cover.uri }, "200x200") : "");
function computeStats(tracks) {
  const artists = new Map(), albums = new Map(), genres = new Map(), primary = new Map();
  let ms = 0, withDur = 0;
  for (const t of tracks) {
    if (!t) continue;
    const dur = Number.isFinite(t.durationMs) ? t.durationMs : 0;
    if (dur) { ms += dur; withDur++; }
    const arts = (t.artists || []).filter((a) => a && a.id != null && a.name);
    for (const a of arts) {
      const k = String(a.id), e = artists.get(k) || { id: a.id, name: a.name, count: 0, ms: 0, img: "" };
      e.count++; e.ms += dur;
      if (!e.img) e.img = artistImg(a) || cover(t, "200x200");        // фото артиста, а если его нет — обложка его трека
      artists.set(k, e);
    }
    if (arts[0]) { const k = String(arts[0].id), p = primary.get(k) || { id: arts[0].id, name: arts[0].name, count: 0, img: "" }; p.count++; primary.set(k, p); }
    const al = t.albums?.[0];
    if (al && al.id != null && al.title) {
      const k = String(al.id), e = albums.get(k) || { id: al.id, title: al.title, artist: al.artists?.[0]?.name || arts[0]?.name || "", artistId: al.artists?.[0]?.id ?? arts[0]?.id ?? null, count: 0, img: cover(al.coverUri ? al : t, "200x200") };
      e.count++; albums.set(k, e);
      if (typeof al.genre === "string" && al.genre) genres.set(al.genre, (genres.get(al.genre) || 0) + 1);
    }
  }
  const byCount = (a, b) => b.count - a.count || (b.ms || 0) - (a.ms || 0);
  for (const [k, p] of primary) p.img = artists.get(k)?.img || "";
  const primaryList = [...primary.values()].sort(byCount);
  return {
    total: tracks.length, ms, withDur,
    artists: [...artists.values()].filter((e) => e.count >= 2).sort(byCount).slice(0, 5),        // «любимыми» считаем тех, у кого от 2 понравившихся
    albums: [...albums.values()].filter((e) => e.count >= 2).sort(byCount).slice(0, 4),
    topGenre: [...genres.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    primary: primaryList, primaryTotal: primaryList.reduce((s, p) => s + p.count, 0),
  };
}
async function genreTitle(slug) {
  try {
    await loadStations();
    const hit = [...(stations.groups.genre || []), ...(stations.groups.subgenre || [])].find((x) => x.seed === "genre:" + slug);
    if (hit) return hit.name;
  } catch {}
  return slug.replace(/[-_]+/g, " ").replace(/^./, (ch) => ch.toUpperCase());
}
const fmtHM = (ms) => { const m = Math.round(ms / 60000), h = Math.floor(m / 60); return h ? `${h} ч ${m % 60} мин` : `${m} мин`; };
const fmtInt = (n) => n.toLocaleString("ru-RU");
const plRu = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
function fmtHours(ms) {          // «6,5 часа», «3 часа», «45 мин»
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} мин`;
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? `${r} ${plRu(r, "час", "часа", "часов")}` : `${String(r).replace(".", ",")} часа`;
}
const ICONS = {
  heart: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5.2l3.4 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"/></svg>',
  crown: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5z"/></svg>',
};
function statCard(icon, label, value) {
  const d = document.createElement("div"); d.className = "card statcard";
  d.innerHTML = icon + '<div><small></small><b></b></div>';
  d.querySelector("small").textContent = label; d.querySelector("b").textContent = value;
  return d;
}
function donutColors() {        // цвета долей — из цветов темы
  return [
    "var(--accent)", "var(--accent2)",
    "color-mix(in srgb, var(--accent) 50%, var(--accent2))",
    "color-mix(in srgb, var(--accent) 55%, #fff)",
    "color-mix(in srgb, var(--accent2) 55%, #000)",
  ];
}
async function playAlbumById(al) {
  try {
    const a = await api(`/albums/${al.id}/with-tracks`);
    const tracks = (a.volumes || []).flat();
    tracks.forEach((t) => { if (!t.coverUri) t.coverUri = a.coverUri; });
    if (!tracks.length) return;
    wave.on = false; queue = tracks; playCtx = "album"; playAlbum = { id: a.id, title: a.title }; play(0);
  } catch (e) { $("#stNote").textContent = "Не удалось включить альбом: " + e.message; }
}
async function showStats() {
  const my = ++nav;
  setHead({ title: "Статистика" }); setActive("statsBtn"); renderTabs(false); resetView();
  $("#list").hidden = true; $("#statsPage").hidden = false; $("#statsBody").hidden = true;
  const note = $("#stNote");
  note.textContent = "Загружаю понравившиеся треки…";
  let tracks;
  try { tracks = await loadAllLikes((n, total) => { note.textContent = `Загружаю понравившиеся: ${n} из ${total}…`; }, () => my !== nav); }
  catch (e) { if (my === nav) note.textContent = "Ошибка: " + e.message; return; }
  if (!tracks || my !== nav) return;
  if (!tracks.length) { note.textContent = "Пока нет понравившихся треков — статистика считается по ним."; return; }

  const s = computeStats(tracks);
  const genre = s.topGenre ? await genreTitle(s.topGenre) : null;
  if (my !== nav) return;

  const cards = $("#statCards"); cards.innerHTML = "";
  cards.append(statCard(ICONS.heart, "Понравившихся треков", fmtInt(s.total)));
  if (s.withDur) cards.append(statCard(ICONS.clock, "Длительность понравившихся", fmtHM(s.ms)));
  if (genre) cards.append(statCard(ICONS.star, "Любимый жанр", genre));

  const people = $("#stArtists"); people.innerHTML = "";
  s.artists.forEach((a, i) => {
    const d = document.createElement("div"); d.className = "stperson";
    d.append(mkImg(a.img));
    d.insertAdjacentHTML("beforeend", '<div class="rank"><span></span></div><b class="nm"></b><span class="hrs"></span><span class="cnt"></span>');
    d.querySelector(".rank span").textContent = String(i + 1);
    if (i === 0) d.querySelector(".rank").insertAdjacentHTML("beforeend", ICONS.crown);        // корона у первого места
    d.querySelector(".nm").textContent = a.name; d.querySelector(".nm").title = a.name;
    d.querySelector(".hrs").textContent = fmtHours(a.ms);
    d.querySelector(".cnt").textContent = `${fmtInt(a.count)} ${plRu(a.count, "понравившийся трек", "понравившихся трека", "понравившихся треков")}`;
    d.onclick = () => navigate(() => showArtist(a.id));
    people.append(d);
  });
  $("#boxArtists").hidden = !s.artists.length;

  const grid = $("#stAlbums"); grid.innerHTML = "";
  for (const al of s.albums) {
    const d = document.createElement("div"); d.className = "stalbum";
    const pic = document.createElement("button"); pic.className = "stpic"; pic.title = "Играть альбом"; pic.setAttribute("aria-label", "Играть альбом");
    pic.append(mkImg(al.img));
    pic.insertAdjacentHTML("beforeend", '<span class="stplay"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>');
    pic.onclick = () => playAlbumById(al);
    const ttl = document.createElement("button"); ttl.className = "stlink ttl"; ttl.textContent = al.title; ttl.title = al.title;
    ttl.onclick = () => navigate(() => showAlbum(al.id));
    const sub = document.createElement("div"); sub.className = "stsub";
    if (al.artist) {
      const ab = document.createElement("button"); ab.className = "stlink art"; ab.textContent = al.artist; ab.title = al.artist;
      if (al.artistId != null) ab.onclick = () => navigate(() => showArtist(al.artistId)); else ab.disabled = true;
      sub.append(ab);
    }
    const cn = document.createElement("span"); cn.className = "cn"; cn.textContent = `${fmtInt(al.count)} понравившихся`; sub.append(cn);
    d.append(pic, ttl, sub);
    grid.append(d);
  }
  $("#boxAlbums").hidden = !s.albums.length;

  // доли: 4 самых частых артиста (по первому исполнителю трека) и «Другие»
  const svg = $("#stDonut"), legend = $("#stLegend"); svg.innerHTML = ""; legend.innerHTML = "";
  if (s.primary.length >= 2) {
    const top = s.primary.slice(0, 4), rest = s.primaryTotal - top.reduce((x, p) => x + p.count, 0), colors = donutColors();
    const parts = top.map((p, i) => ({ id: p.id, name: p.name, count: p.count, img: p.img, color: colors[i] }));
    if (rest > 0) parts.push({ name: "Другие", count: rest, color: "rgba(255,255,255,.28)", other: true });
    const R = 40, C = 2 * Math.PI * R;
    const box = $("#boxShare"); box.querySelector(".stcardhover")?.remove();
    const tip = document.createElement("div"); tip.className = "stcardhover"; tip.hidden = true; box.append(tip);
    const rings = [], rows = [];
    const focus = (i) => {
      rings.forEach((r, k) => { r.classList.toggle("hot", k === i); r.classList.toggle("dim", k !== i); });
      rows.forEach((r, k) => r.classList.toggle("hot", k === i));
      const p = parts[i];
      if (p.other) { tip.hidden = true; return; }
      tip.replaceChildren();
      if (p.img) tip.append(mkImg(p.img));
      const b = document.createElement("b"); b.textContent = p.name;
      const sm = document.createElement("small"); sm.textContent = `${fmtInt(p.count)} ${plRu(p.count, "понравившийся трек", "понравившихся трека", "понравившихся треков")}`;
      tip.append(b, sm); tip.hidden = false;
    };
    const blur = () => { rings.forEach((r) => r.classList.remove("hot", "dim")); rows.forEach((r) => r.classList.remove("hot")); tip.hidden = true; };
    const move = (e) => {
      if (tip.hidden) return;
      const br = box.getBoundingClientRect();
      let x = e.clientX - br.left + 16, y = e.clientY - br.top + 16;
      x = Math.max(8, Math.min(x, br.width - tip.offsetWidth - 8)); y = Math.max(8, Math.min(y, br.height - tip.offsetHeight - 8));
      tip.style.left = x + "px"; tip.style.top = y + "px";
    };
    let start = 0, pctLeft = 100;
    parts.forEach((p, i) => {
      const frac = p.count / s.primaryTotal, len = Math.max(0, frac * C - 1.2);
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      ring.setAttribute("cx", 50); ring.setAttribute("cy", 50); ring.setAttribute("r", R);
      ring.setAttribute("stroke-dasharray", `${len} ${C - len}`); ring.setAttribute("stroke-dashoffset", -start * C);
      ring.style.stroke = p.color;
      svg.append(ring); rings.push(ring); start += frac;
      const pct = i === parts.length - 1 ? pctLeft : Math.round(frac * 100); pctLeft -= pct;
      const li = document.createElement("li");
      li.innerHTML = '<i class="dot"></i><span class="nm"></span><span class="pct"></span>';
      li.querySelector(".dot").style.background = p.color;
      li.querySelector(".nm").textContent = p.name; li.querySelector(".pct").textContent = pct + "%";
      legend.append(li); rows.push(li);
      for (const el of [ring, li]) { el.addEventListener("mouseenter", () => focus(i)); el.addEventListener("mouseleave", blur); el.addEventListener("mousemove", move); }
      if (!p.other && p.id != null) { ring.style.cursor = li.style.cursor = "pointer"; const go = () => navigate(() => showArtist(p.id)); ring.addEventListener("click", go); li.addEventListener("click", go); }
    });
    $("#stDonutNum").textContent = fmtInt(s.primaryTotal); $("#stDonutCap").textContent = "треков";
  }
  $("#boxShare").hidden = s.primary.length < 2;

  note.textContent = "";
  $("#statsBody").hidden = false;
}

// ---------- Моя волна ----------
function setHint(text) { $("#waveHint").textContent = text; $("#waveHint").hidden = false; $("#nowplay").hidden = true; }
function showNow(t) {
  $("#npTitle").textContent = t.title;
  $("#npTitle").classList.toggle("link", !!albumOf(t));
  fillArtists($("#npArtist"), t);
  $("#nowplay").hidden = false; $("#waveHint").hidden = true;
}
$("#npTitle").onclick = () => { const id = albumOf(queue[current]); if (id) navigate(() => showAlbum(id)); };

// ширина надписи «Моя волна» -> ширина кнопки жанров и боковых колонок (чтобы название трека было ровно по центру)
function fitHead() {
  if (!document.querySelector(".main").classList.contains("wavemode")) return;
  const r = document.createRange();
  r.selectNodeContents($("#title"));
  const w = Math.ceil(r.getBoundingClientRect().width);
  document.documentElement.style.setProperty("--hw", Math.max(w, 176) + "px");
  fitStations();
}
window.addEventListener("resize", fitHead);
if (document.fonts) document.fonts.ready.then(fitHead);

function showWave() {
  ++nav;
  setHead({ title: "Моя волна" }); setActive("wave"); renderTabs(false); resetView();
  $("#list").hidden = true; $("#wavePage").hidden = false; $("#stWrap").hidden = false; $("#waveInfo").hidden = false;
  document.querySelector(".main").classList.add("wavemode");
  if (wave.on && queue[current]) showNow(queue[current]);
  else setHint("Нажми, чтобы включить " + (wave.album ? `Мою волну по «${wave.album.title}»` : wave.name ? `волну «${wave.name}»` : "Мою волну"));
  updateStBtn();
  syncIcons();
  applyViz();
  fitHead();
  requestAnimationFrame(fitHead);
}
function waveFeedback(type, t, extra = {}) {
  if (!wave.on || !wave.session || !t) return;
  api(`/rotor/session/${wave.session}/feedback`, {
    method: "POST", headers: JSON_H,
    body: JSON.stringify({ event: { type, timestamp: new Date().toISOString(), trackId: String(t.id), ...extra }, batchId: wave.batch }),
  }).catch(() => {});
}
function markHeard(t) {
  heard.add(String(t.id));
  if (heard.size > 600) heard.delete(heard.values().next().value);
  try { localStorage.setItem("ym_heard", JSON.stringify([...heard])); } catch {}
}
const trackList = (r) => (r.sequence || []).map((s) => s.track).filter(Boolean);

async function waveMore() {
  if (wave.loading || !wave.on) return;
  wave.loading = true;
  try {
    const q = wave.queue, last = q[q.length - 1];
    let r;
    if (wave.session) {
      r = await api(`/rotor/session/${wave.session}/tracks`, {
        method: "POST", headers: JSON_H, body: JSON.stringify({ queue: [String(last.id)] }),
      });
    } else {          // после перезапуска старой сессии нет: открываем новую по той же станции
      r = await api("/rotor/session/new", {
        method: "POST", headers: JSON_H, body: JSON.stringify({ seeds: [wave.seed], includeTracksInResponse: true }),
      });
      wave.session = r.radioSessionId;
    }
    wave.batch = r.batchId;
    const have = new Set(q.map((t) => String(t.id)));
    const incoming = trackList(r).filter((t) => !have.has(String(t.id)));
    const fresh = incoming.filter((t) => !heard.has(String(t.id)));
    q.push(...(fresh.length ? fresh : incoming));
  } catch {} finally { wave.loading = false; }
}

// новая сессия волны; уже слышанные треки отсеиваем, чтобы каждый раз было свежее
async function waveStart(autoplay = true) {
  const r = await api("/rotor/session/new", {
    method: "POST", headers: JSON_H,
    body: JSON.stringify({ seeds: [wave.seed], includeTracksInResponse: true }),
  });
  const session = r.radioSessionId;
  let batch = r.batchId, tracks = trackList(r);
  let fresh = tracks.filter((t) => !heard.has(String(t.id)));
  for (let k = 0; k < 3 && fresh.length < 3 && tracks.length; k++) {
    const more = await api(`/rotor/session/${session}/tracks`, {
      method: "POST", headers: JSON_H, body: JSON.stringify({ queue: [String(tracks[tracks.length - 1].id)] }),
    });
    batch = more.batchId;
    const have = new Set(tracks.map((t) => String(t.id)));
    tracks = tracks.concat(trackList(more).filter((t) => !have.has(String(t.id))));
    fresh = tracks.filter((t) => !heard.has(String(t.id)));
  }
  if (!fresh.length) fresh = tracks;
  if (!fresh.length) throw new Error("волна не вернула треков");
  if (!autoplay && current !== -1) return;          // пока грузили, пользователь уже что-то включил
  Object.assign(wave, { on: true, session, batch, queue: fresh, pos: -1 });
  playCtx = "wave";
  queue = fresh;
  if (autoplay) play(0);
  else { current = 0; needLoad = true; showTrack(fresh[0]); }
}

$("#waveBtn").onclick = async () => {
  if (wave.on) { togglePlay(); return; }
  try {
    if (wave.session && wave.queue.length) {          // вернулись в уже идущую волну: следующий трек, а не заново
      wave.on = true; queue = wave.queue; playCtx = "wave";
      const next = wave.pos + 1;
      if (next >= queue.length) await waveMore();
      if (next < queue.length) { play(next); return; }
      wave.on = false;
    }
    setHint("Запускаю…");
    await waveStart();
  } catch (e) { wave.on = false; setHint("Не удалось запустить: " + e.message); }
};

// ---------- жанры и настроения ----------
// Яндекс перестал отдавать список станций (/rotor/stations/list возвращает пустой массив), поэтому:
// жанры берём из /genres, а настроение, характер и язык — из настроек Моей волны (/rotor/wave/settings),
// как в официальном приложении. Сиды вида genre:rock и settingMoodEnergy:fun Моя волна принимает.
const GROUPS = [["genre", "Жанры"], ["subgenre", "Поджанры"], ["mood", "Настроение"], ["character", "Характер"], ["language", "Язык"]];
const stations = { loaded: false, groups: {}, tab: "genre" };
// разделы /genres, которые не музыка (книги, подкасты, сказки) или для которых Моя волна не подбирает треки
const GENRE_SKIP = new Set(["all", "other", "holiday", "fairytales", "poemsforchildren", "podcasts", "audiobooks", "fiction",
  "nonfictionliterature", "booksnotinrussian", "arabicpoetry", "islamicgenre"]);
const WAVE_SETTINGS = [["moodEnergy", "mood"], ["diversity", "character"], ["language", "language"]];

async function loadStations(force = false) {
  if (stations.loaded && !force) return;
  const [gr, ws] = await Promise.allSettled([api("/genres"), api("/rotor/wave/settings?language=ru")]);
  const groups = {}; let seen = 0;
  const add = (type, seed, name) => { if (!name) return; (groups[type] ||= []).push({ seed, name: String(name) }); seen++; };
  const title = (g) => g?.titles?.ru?.title || g?.title;
  for (const g of gr.status === "fulfilled" && Array.isArray(gr.value) ? gr.value : []) {
    if (!g?.id || GENRE_SKIP.has(g.id) || g.showInMenu === false) continue;
    add("genre", `genre:${g.id}`, title(g));
    for (const s of Array.isArray(g.subGenres) ? g.subGenres : []) {
      if (s?.id && !GENRE_SKIP.has(s.id) && s.showInMenu !== false) add("subgenre", `genre:${s.id}`, title(s));
    }
  }
  const rest = ws.status === "fulfilled" ? ws.value?.settingRestrictions || {} : {};
  for (const [key, type] of WAVE_SETTINGS) {
    for (const v of rest[key]?.possibleValues || []) {
      if (!v?.unspecified && v?.serializedSeed) add(type, String(v.serializedSeed), v.name);
    }
  }
  if (!seen) throw (gr.reason || ws.reason || new Error("сервер вернул пустой список"));
  stations.groups = groups; stations.loaded = true;
  if (!groups[stations.tab]) stations.tab = GROUPS.map((g) => g[0]).find((t) => groups[t]) || Object.keys(groups)[0];
}
function stationsMessage(text, retry) {
  $("#stChips").innerHTML = "";
  const g = $("#stGrid"); g.innerHTML = "";
  const p = document.createElement("p"); p.className = "stmsg"; p.textContent = text; g.append(p);
  if (retry) { const b = document.createElement("button"); b.className = "pill"; b.textContent = "Повторить"; b.onclick = retry; g.append(b); }
}
async function openStationsList() {
  stationsMessage("Загружаю список…");
  try { await loadStations(true); renderStations(); }
  catch (e) { stationsMessage("Не удалось загрузить список: " + e.message, openStationsList); }
  fitStations();
}
function renderStations() {
  const chips = $("#stChips"); chips.innerHTML = "";
  const mk = (label, active, fn) => {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " active" : ""); b.textContent = label; b.onclick = fn; return b;
  };
  const known = new Set(GROUPS.map((g) => g[0]));
  const all = [...GROUPS, ...Object.keys(stations.groups).filter((t) => !known.has(t)).map((t) => [t, t])];
  for (const [type, label] of all) {
    if (stations.groups[type]) chips.append(mk(label, stations.tab === type, () => { stations.tab = type; renderStations(); }));
  }
  const grid = $("#stGrid"); grid.innerHTML = "";
  if (wave.seed !== DEFAULT_SEED) {
    const r = document.createElement("button");
    r.className = "pill reset"; r.textContent = "Обычная Моя волна"; r.onclick = () => pickStation(DEFAULT_SEED, "");
    grid.append(r);
  }
  for (const s of stations.groups[stations.tab] || []) {
    const b = document.createElement("button");
    b.className = "pill" + (s.seed === wave.seed ? " active" : "");
    b.textContent = s.name; b.onclick = () => pickStation(s.seed, s.name);
    grid.append(b);
  }
}
function updateStBtn() {
  const open = !$("#stations").hidden;
  const label = wave.album ? `Моя волна по «${wave.album.title || "альбому"}»` : wave.name ? `${wave.name} · сменить` : "Жанры и настроения";
  const lbl = document.createElement("span"); lbl.className = "lbl"; lbl.textContent = open ? "Закрыть список" : label;   // обёртка нужна для ограничения по строкам
  $("#stBtn").replaceChildren(lbl);
  $("#stBtn").title = open ? "" : label;
  $("#stBtn").classList.toggle("album", !!wave.album && !open);   // подпись «Моя волна по …» может занять две строки
  $("#stWrap").classList.toggle("album", !!wave.album);
  const custom = !!(wave.name || wave.album);
  $("#stReset").hidden = !custom;
  $("#stWrap").classList.toggle("has-reset", custom);
}
function setStations(open) { $("#stations").hidden = !open; updateStBtn(); if (open) fitStations(); }
// окно не выходит за пределы экрана: высота ограничена свободным местом под кнопкой
function fitStations() {
  const box = $("#stations");
  if (box.hidden) return;
  const bottom = document.querySelector(".main").getBoundingClientRect().bottom;
  const room = bottom - box.getBoundingClientRect().top - 8;
  box.style.maxHeight = Math.max(240, Math.min(room, window.innerHeight * 0.5)) + "px";
}
window.addEventListener("resize", fitStations);

async function pickStation(seed, name) {
  Object.assign(wave, { seed, name, album: null, session: null, queue: [], pos: -1, on: false });   // старая волна не продолжается
  try { localStorage.setItem("ym_wave_seed", JSON.stringify({ seed, name })); } catch {}
  setStations(false);
  setHint("Запускаю…");
  try { await waveStart(); } catch (e) { wave.on = false; setHint("Не удалось запустить: " + e.message); }
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { setStations(false); closeFull(); } });
document.addEventListener("click", (e) => {                 // клик мимо окна жанров закрывает его
  const path = e.composedPath();
  if (!$("#stations").hidden && !path.includes($("#stations")) && !path.includes($("#stBtn"))) setStations(false);
});
$("#artistWaveBtn").onclick = () => {
  const it = artistWaveItem; if (!it) return;
  showWave();
  pickStation("artist:" + it.id, it.name);
};
$("#stReset").onclick = () => pickStation(DEFAULT_SEED, "");

// альбом доиграл — продолжаем «Моей волной» по этому альбому (как в Яндекс Музыке). Такая волна не запоминается между запусками.
async function onQueueEnd() {
  if (wave.on || playCtx !== "album" || !playAlbum?.id) { syncIcons(); return; }
  const al = playAlbum; playAlbum = null;
  const prev = { seed: wave.seed, name: wave.name, album: wave.album };
  Object.assign(wave, { seed: "album:" + al.id, name: "", album: { id: al.id, title: al.title || "" }, session: null, queue: [], pos: -1, on: false });
  updateStBtn();
  try { await waveStart(); }
  catch { Object.assign(wave, prev, { on: false }); syncIcons(); }
  updateStBtn();
}
$("#stBtn").onclick = async () => {
  const open = $("#stations").hidden;
  setStations(open);
  if (!open) return;
  if (stations.loaded) { renderStations(); fitStations(); } else await openStationsList();
};

// ---------- настройки ----------
function showSettings() {
  ++nav;
  setHead({ title: "Настройки" }); setActive("settingsBtn"); renderTabs(false); resetView();
  $("#list").hidden = true; $("#settingsPage").hidden = false;
  fillAll();
}

// ---------- профиль артиста ----------
const artistCache = {};
async function loadAlbums(id) {
  const out = [];
  for (let p = 0; p < 5; p++) {
    const r = await api(`/artists/${id}/direct-albums?page=${p}&page-size=100&sort-by=year`);
    out.push(...(r.albums || []));
    if (!r.pager || out.length >= r.pager.total) break;
  }
  return out.sort((a, b) => albumTime(b) - albumTime(a));   // новые первыми
}
function loadArtist(id) {
  return (artistCache[id] ||= Promise.all([
    api(`/artists/${id}/brief-info`).catch(() => null),
    loadAlbums(id).catch(() => []),
  ]).then(([info, albums]) => ({ info, albums })));
}
function showLastAlbum(a) {
  const el = $("#lastAlbum");
  el.innerHTML = `<img alt="" /><small>Последний релиз</small><b></b><span></span>`;
  el.querySelector("img").src = cover(a, "200x200");
  el.querySelector("b").textContent = a.title;
  el.querySelector("span").textContent = fmtDate(a);
  el.onclick = () => navigate(() => showAlbum(a.id));
  el.hidden = false;
}

async function showArtist(id, tab = "tracks") {
  const my = ++nav;
  setHead({ title: "Загрузка…", back: true }); setActive(null); renderTabs(pinKey("artist", id)); resetView();
  setChips([["tracks", "Треки"], ["albums", "Альбомы"]], tab, (t) => showArtist(id, t));

  loadArtist(id).then(({ info, albums }) => {
    if (my !== nav) return;
    const c = info?.artist?.cover?.uri;
    const name = info?.artist?.name || "Артист";
    const listeners = Number(info?.stats?.lastMonthListeners);
    setHead({
      title: name, img: c ? cover({ coverUri: c }, "200x200") : "", back: true,
      pin: info?.artist?.name ? { type: "artist", id, title: name } : null,
      artistWave: info?.artist?.name ? { id, name } : null,
      sub: Number.isFinite(listeners) && listeners > 0 ? (el) => { el.textContent = `${fmtInt(listeners)} ${plRu(listeners, "слушатель", "слушателя", "слушателей")} за месяц`; } : null,
    });
    if (tab === "albums") {
      renderAlbums(albums);
      $("#status").textContent = albums.length ? "" : "Альбомов нет";
    } else if (albums.length) showLastAlbum(albums[0]);
  });
  if (tab === "albums") return;

  let page = 0;
  const loadMore = async () => {
    try {
      const r = await api(`/artists/${id}/tracks?page=${page}&page-size=50`);
      if (my !== nav) return;
      renderList(r.tracks, page > 0); page++;
      $("#more").hidden = !(r.pager && page * 50 < r.pager.total);
      $("#status").textContent = r.tracks.length || page > 1 ? "" : "Треков нет";
    } catch (e) { if (my === nav) $("#status").textContent = "Ошибка: " + e.message; }
  };
  $("#more").onclick = loadMore;
  loadMore();
}

// ---------- альбом ----------
async function showAlbum(id) {
  const my = ++nav;
  setHead({ title: "Загрузка…", back: true }); setActive(null); renderTabs(pinKey("album", id)); resetView();
  try {
    const a = await api(`/albums/${id}/with-tracks`);
    if (my !== nav) return;
    setHead({
      title: a.title, img: cover(a, "200x200"), round: false, back: true, pin: { type: "album", id: a.id, title: a.title, year: a.year },
      sub: (el) => {
        fillArtists(el, a);
        const x = albumInfo(a);
        if (x) el.append(" · " + x);
      },
    });
    const tracks = (a.volumes || []).flat();
    tracks.forEach((t) => { if (!t.coverUri) t.coverUri = a.coverUri; });
    renderList(tracks, false, { noAlbumLink: true, ctx: "album", album: { id: a.id, title: a.title } });
    $("#status").textContent = tracks.length ? "" : "Треков нет";
    loadSimilar(a, my);
  } catch (e) { if (my === nav) $("#status").textContent = "Ошибка: " + e.message; }
}

// похожие альбомы: берём похожих исполнителей и их свежие альбомы; нет данных — другие альбомы того же исполнителя
async function loadSimilar(a, my) {
  try {
    const mainId = a.artists?.[0]?.id;
    if (!mainId) return;
    const { info, albums } = await loadArtist(mainId);
    let items = [], title = "Похожие альбомы";
    const sim = (info?.similarArtists || []).slice(0, 6);
    if (sim.length) {
      const res = await Promise.allSettled(sim.map((q) => api(`/artists/${q.id}/direct-albums?page=0&page-size=20&sort-by=year`)));
      for (const r of res) {
        if (r.status !== "fulfilled") continue;
        items.push(...(r.value.albums || []).slice().sort((x, y) => albumTime(y) - albumTime(x)).slice(0, 2));
      }
    }
    if (!items.length) { title = "Другие альбомы исполнителя"; items = albums; }
    items = items.filter((x, i, arr) => String(x.id) !== String(a.id) && arr.findIndex((y) => y.id === x.id) === i).slice(0, 12);
    if (my !== nav || !items.length) return;
    $("#simTitle").textContent = title;
    const grid = $("#simGrid"); grid.innerHTML = "";
    for (const x of items) {
      const c = document.createElement("div");
      c.className = "simcard";
      c.innerHTML = "<img alt=\"\" /><b></b><span></span>";
      c.querySelector("img").src = cover(x, "200x200");
      c.querySelector("b").textContent = x.title;
      c.querySelector("span").textContent = [(x.artists || []).map((q) => q.name).join(", "), x.year].filter(Boolean).join(" · ");
      c.onclick = () => navigate(() => showAlbum(x.id));
      grid.append(c);
    }
    $("#similar").hidden = false;
  } catch {}
}

// ---------- поиск ----------
async function showSearch(q) {
  const my = ++nav;
  setHead({ title: "Поиск: " + q }); setActive(null); renderTabs(false); resetView();
  setChips([["track", "Треки"], ["artist", "Артисты"], ["album", "Альбомы"]], searchType, (t) => { searchType = t; showSearch(q); });
  try {
    const r = await api(`/search?text=${encodeURIComponent(q)}&type=${searchType}&page=0`);
    if (my !== nav) return;
    const items = r[{ track: "tracks", artist: "artists", album: "albums" }[searchType]]?.results || [];
    if (searchType === "track") renderList(items);
    else if (searchType === "artist") renderArtists(items);
    else renderAlbums(items, true);
    $("#status").textContent = items.length ? "" : "Ничего не найдено";
  } catch (e) { if (my === nav) $("#status").textContent = "Ошибка: " + e.message; }
}
$("#search").oninput = (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => goTop(q ? () => showSearch(q) : showLikes), 400);
};

// ---------- лайки ----------
function setHeart(b, on) {
  b.classList.toggle("on", on);
  b.innerHTML = on ? ICON.heartOn : ICON.heart;
  b.title = on ? "Убрать из лайков" : "В лайки";
}
function refreshHearts() {
  document.querySelectorAll(".list li").forEach((li) => {
    const b = li.querySelector(".likebtn");
    if (b) setHeart(b, likedIds.has(String(li.dataset.id)));
  });
  const t = queue[current];
  setHeart($("#likeBtn"), !!t && likedIds.has(String(t.id)));
  setHeart($("#fLike"), !!t && likedIds.has(String(t.id)));
}
async function loadLikedIds() {
  try {
    const lib = await api(`/users/${uid}/likes/tracks`);
    likedIds = new Set(lib.library.tracks.map((t) => String(t.id)));
    refreshHearts();
  } catch {}
}
async function toggleLike(t) {
  if (!t) return;
  const id = String(t.id), albumId = albumOf(t), was = likedIds.has(id);
  was ? likedIds.delete(id) : likedIds.add(id);
  refreshHearts();
  try {
    await api(`/users/${uid}/likes/tracks/${was ? "remove" : "add-multiple"}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "track-ids=" + encodeURIComponent(albumId ? `${id}:${albumId}` : id),
    });
    if (was) likes.tracks = likes.tracks.filter((x) => String(x.id) !== id);
    else if (likes.done) likes.tracks.unshift(t);
  } catch (e) {
    was ? likedIds.add(id) : likedIds.delete(id);
    refreshHearts();
    $("#status").textContent = "Не удалось изменить лайк: " + e.message;
  }
}
$("#likeBtn").onclick = () => toggleLike(queue[current]);

// ---------- повтор и случайный порядок (только альбомы и лайки) ----------
const modesActive = () => !wave.on && (playCtx === "likes" || playCtx === "album");
// повтор трека работает в любом разделе (и в волне), повтор всего списка — только в альбомах и лайках
const effRepeat = () => (modesActive() ? repeat : repeat === 2 ? 2 : 0);
function buildOrder() {
  order = queue.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const k = order.indexOf(current);
  if (k > 0) [order[0], order[k]] = [order[k], order[0]];
  ordPos = 0; orderFor = queue;
}
function nextIndex(auto) {
  if (auto && effRepeat() === 2) return current;           // повтор трека
  if (!modesActive()) return current + 1;
  if (shuffle) {
    if (orderFor !== queue || order.length !== queue.length || order[ordPos] !== current) buildOrder();
    if (ordPos + 1 < order.length) return order[ordPos + 1];
    if (repeat === 1) { buildOrder(); return order.length > 1 ? order[1] : current; }
    return -1;
  }
  if (current + 1 < queue.length) return current + 1;
  return repeat === 1 ? 0 : -1;                             // повтор альбома/списка
}
function prevIndex() {
  if (modesActive() && shuffle && orderFor === queue && order.length === queue.length && order[ordPos] === current) {
    return ordPos > 0 ? order[ordPos - 1] : current;
  }
  if (modesActive() && repeat === 1 && current === 0) return queue.length - 1;
  return current - 1;
}
function saveModes() { try { localStorage.setItem("ym_modes", JSON.stringify({ shuffle, repeat })); } catch {} }
function updateModes() {
  const on = modesActive(), sh = $("#shuffleBtn"), rp = $("#repeatBtn"), er = effRepeat();
  sh.disabled = !on;
  rp.disabled = false;
  sh.classList.toggle("on", on && shuffle);
  rp.classList.toggle("on", er > 0);
  sh.innerHTML = ICON.shuffle;
  rp.innerHTML = er === 2 ? ICON.repeatOne : ICON.repeat;
  sh.title = on ? (shuffle ? "Случайный порядок: включён" : "Случайный порядок") : "Случайный порядок доступен только в альбомах и лайках";
  rp.title = on ? ["Повтор выключен", "Повтор всего списка", "Повтор трека"][repeat] : er === 2 ? "Повтор трека: включён" : "Повтор трека";
}
$("#shuffleBtn").onclick = () => { shuffle = !shuffle; if (shuffle) buildOrder(); saveModes(); updateModes(); };
$("#repeatBtn").onclick = () => { repeat = modesActive() ? (repeat + 1) % 3 : repeat === 2 ? 0 : 2; saveModes(); updateModes(); };

// ---------- полноэкранный плеер: обложка, название и текст песни ----------
let fullRun = false, fullSeq = 0, fLines = [], fIdx = -1, fDrag = false;
const lyricsCache = new Map();

function parseLrc(txt) {
  const out = [];
  for (const raw of txt.split(/\r?\n/)) {
    const times = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!times.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of times) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(":", ".")), text });
  }
  return out.sort((a, b) => a.t - b.t);
}
async function lyricsSign(id, ts) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("p93jhgh689SBReK6ghtw62"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}${ts}`)));
  return btoa(String.fromCharCode(...sig));
}
async function lyricsRaw(id, fmt) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = await lyricsSign(id, ts);
  const r = await api(`/tracks/${id}/lyrics?format=${fmt}&timeStamp=${ts}&sign=${encodeURIComponent(sign)}`);
  if (!r?.downloadUrl) throw new Error("текста нет");
  const url = safeUrl(r.downloadUrl);
  if (!url) throw new Error("сервер вернул неожиданный адрес текста");
  const d = await http(url, { headers: { "User-Agent": "Yandex-Music-API" } });     // без Authorization: файлу текста токен не нужен
  if (d.status < 200 || d.status >= 300) throw new Error("HTTP " + d.status);
  return d.body;
}
// сначала синхронный текст (LRC), потом обычный; нет ни того ни другого — none
async function fetchLyrics(id) {
  let body;
  try { body = await lyricsRaw(id, "LRC"); }
  catch { try { body = await lyricsRaw(id, "TEXT"); } catch { return { type: "none" }; } }
  const lines = parseLrc(body);
  if (lines.length >= 3) return { type: "lrc", lines };
  const text = body.replace(/\[[^\]]*\]/g, "").replace(/\r/g, "").trim();
  return text ? { type: "text", text } : { type: "none" };
}

function setFullMode(m) {
  $("#full").dataset.mode = m;
  requestAnimationFrame(fitFull);
}
// режим «только обложка»: берём максимум места, но в разумных пределах
function fitFull() {
  const f = $("#full"), cv = $("#fCover");
  if (f.hidden) return;
  if (f.dataset.mode !== "cover") { cv.style.width = cv.style.height = ""; requestAnimationFrame(placeQuick); return; }
  const box = $("#fHead");
  const avail = box.clientHeight - $("#fTitles").offsetHeight - 22;
  const size = Math.max(120, Math.min(box.clientWidth, avail, 760));
  cv.style.width = cv.style.height = size + "px";
  requestAnimationFrame(placeQuick);
}
window.addEventListener("resize", fitFull);

function renderLyrics(res) {
  const box = $("#fLyrics");
  box.innerHTML = ""; fLines = []; fIdx = -1;
  if (res.type === "lrc") {
    box.className = "flyrics synced";
    for (const l of res.lines) {
      const d = document.createElement("div");
      d.className = "ln"; d.textContent = l.text || "♪";
      d.onclick = () => { if (!needLoad) audio.currentTime = l.t; };
      box.append(d); fLines.push({ t: l.t, el: d });
    }
    setFullMode("lyrics");
  } else if (res.type === "text") {
    box.className = "flyrics plain";
    const p = document.createElement("div"); p.className = "ptext"; p.textContent = res.text;
    box.append(p); setFullMode("lyrics");
  } else setFullMode("cover");
}

async function loadFullLyrics(t) {
  const my = ++fullSeq;
  const box = $("#fLyrics");
  box.className = "flyrics"; box.innerHTML = '<div class="fstatus">Ищу текст…</div>';
  fLines = []; fIdx = -1;
  setFullMode("lyrics");
  let res = lyricsCache.get(String(t.id));
  if (!res) { try { res = await fetchLyrics(t.id); } catch { res = { type: "none" }; } lyricsCache.set(String(t.id), res); }
  if (my !== fullSeq || $("#full").hidden) return;
  renderLyrics(res);
}

function fillFull(t) {
  const big = cover(t, "800x800");
  $("#fCover").src = big;
  $("#fBg").style.backgroundImage = big ? `url("${cover(t, "400x400")}")` : "none";
  $("#fTitle").textContent = t.title;
  fillArtists($("#fArtist"), t);
  $("#fTCur").textContent = "0:00"; $("#fTDur").textContent = fmtTime((t.durationMs || 0) / 1000);
  loadFullLyrics(t);
}
function openFull() {
  const t = queue[current];
  if (!t) return;
  $("#full").hidden = false;
  fillFull(t);
  if (!fullRun) { fullRun = true; requestAnimationFrame(fullFrame); }
}
function closeFull() { $("#full").hidden = true; $("#full").classList.remove("qc"); fullRun = false; fullSeq++; }

function fullFrame() {
  if (!fullRun) return;
  requestAnimationFrame(fullFrame);
  const t = queue[current];
  if (!t) return;
  const cur = needLoad ? resumePos : audio.currentTime || 0;
  const dur = audio.duration || (t.durationMs || 0) / 1000;
  if (!fDrag) { $("#fSeek").value = dur ? (cur / dur) * 1000 : 0; fill($("#fSeek")); }
  $("#fTCur").textContent = fmtTime(cur); $("#fTDur").textContent = fmtTime(dur);
  if (!fLines.length) return;
  let lo = 0, hi = fLines.length - 1, idx = -1;
  const x = cur + 0.2;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (fLines[m].t <= x) { idx = m; lo = m + 1; } else hi = m - 1; }
  if (idx === fIdx) return;
  fLines[fIdx]?.el.classList.remove("on");
  fIdx = idx;
  if (idx >= 0) {
    const el = fLines[idx].el, box = $("#fLyrics");
    el.classList.add("on");
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: cfg.anim === false ? "auto" : "smooth" });
  }
}

$("#cover").onclick = openFull;
$("#cover").title = "Развернуть на весь экран";
$("#fClose").onclick = closeFull;
$("#fPlay").onclick = togglePlay;
// клик по обложке в оверлее: плавающие кнопки пауза / следующий / предыдущий
function placeQuick() {
  const r = $("#fCover").getBoundingClientRect(), h = $("#fHead").getBoundingClientRect(), q = $("#fQuick");
  q.style.left = (r.left - h.left + r.width / 2) + "px";
  q.style.top = (r.top - h.top + r.height / 2) + "px";
}
$("#fHead").style.position = "relative";
$("#fCover").onclick = () => { $("#full").classList.toggle("qc"); placeQuick(); };
$("#qPlay").onclick = togglePlay;
$("#qNext").onclick = () => $("#next").click();
$("#qPrev").onclick = () => $("#prev").click();
window.addEventListener("resize", placeQuick);
$("#fNext").onclick = () => $("#next").click();
$("#fPrev").onclick = () => $("#prev").click();
$("#fLike").onclick = () => toggleLike(queue[current]);
$("#fTitle").onclick = () => { const id = albumOf(queue[current]); if (id) { closeFull(); navigate(() => showAlbum(id)); } };
$("#fArtist").addEventListener("click", closeFull, true);
$("#fSeek").addEventListener("pointerdown", () => { fDrag = true; });
window.addEventListener("pointerup", () => { fDrag = false; });
$("#fSeek").addEventListener("input", (e) => {
  fill(e.target);
  if (!needLoad && audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
});

// ---------- воспроизведение ----------
async function directLink(id) {
  const infos = await api(`/tracks/${id}/download-info`);
  const best = (Array.isArray(infos) ? infos : []).filter((i) => i && i.codec === "mp3").sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0];
  if (!best) throw new Error("для этого трека нет MP3-версии");
  const base = safeUrl(best.downloadInfoUrl);
  if (!base) throw new Error("сервер вернул неожиданный адрес файла");
  const url = base + (base.includes("?") ? "&" : "?") + "format=json";
  const info = JSON.parse((await http(url, { headers: { "User-Agent": "Yandex-Music-API" } })).body);
  const host = String(info.host || ""), path = String(info.path || ""), ts = String(info.ts || ""), s = String(info.s || "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(host) || !hostTrusted(host.toLowerCase()) || !/^\/[\w\-./%]+$/.test(path) || !/^[\w-]+$/.test(ts) || !/^[\w-]+$/.test(s))
    throw new Error("сервер вернул неожиданный адрес файла");
  const sign = await invoke("md5_hex", { input: SALT + path.slice(1) + s });
  return `https://${host}/get-mp3/${sign}/${ts}${path}`;
}
function markPlaying() {
  document.querySelectorAll(".list li").forEach((li) => li.classList.toggle("playing", li.dataset.id === String(playingId)));
}

function showTrack(t, pos = 0) {
  playingId = t.id; markPlaying();
  const pt = $("#pTitle");
  pt.textContent = t.title;
  pt.classList.toggle("link", !!albumOf(t));
  fillArtists($("#pArtist"), t);
  $("#cover").src = cover(t);
  const dur = (t.durationMs || 0) / 1000;
  $("#tCur").textContent = fmtTime(pos); $("#tDur").textContent = fmtTime(dur);
  $("#seek").value = dur ? (pos / dur) * 1000 : 0; fill($("#seek"));
  if (wave.on) showNow(t);
  refreshHearts(); updateModes();
  if (!$("#full").hidden) fillFull(t);
}

// запоминаем очередь и позицию, чтобы после запуска продолжить с того же места
function saveLast(pos = 0) {
  if (needLoad || !queue[current]) return;
  const min = (x) => ({
    id: x.id, title: x.title, coverUri: x.coverUri, durationMs: x.durationMs,
    artists: (x.artists || []).map((a) => ({ id: a.id, name: a.name })),
    albums: (x.albums || []).slice(0, 1).map((a) => ({ id: a.id })),
  });
  try { localStorage.setItem("ym_last", JSON.stringify({ q: queue.slice(current, current + 50).map(min), pos: Math.floor(pos), ctx: playCtx, album: playAlbum, wave: wave.on ? { seed: wave.seed, name: wave.name, album: wave.album } : null })); } catch {}
}
window.addEventListener("pagehide", () => saveLast(audio ? audio.currentTime : 0));

function togglePlay() {
  if (needLoad) { const p = resumePos; resumePos = 0; play(current, p); return; }
  audio.paused ? audio.play() : audio.pause();
}

async function restorePlayer() {
  try {
    const saved = JSON.parse(localStorage.getItem("ym_last") || "null");
    if (saved?.q?.length && current === -1) {
      queue = saved.q; current = 0; wave.on = false; playCtx = saved.ctx || "other"; playAlbum = saved.album || null;
      const sw = saved.wave;
      if (saved.ctx === "wave" && sw && typeof sw.seed === "string" && /^[\w-]+:[\w.-]+$/.test(sw.seed)) {
        // играла «Моя волна»: возвращаем её как волну (станция та же, а сессию откроем заново, когда понадобятся новые треки)
        const al = sw.album && /^\d+$/.test(String(sw.album.id)) ? { id: sw.album.id, title: String(sw.album.title || "").slice(0, 200) } : null;
        Object.assign(wave, { on: true, seed: sw.seed, name: typeof sw.name === "string" ? sw.name.slice(0, 100) : "", album: al, session: null, batch: null, queue, pos: 0 });
        playCtx = "wave"; playAlbum = null;
      }
      resumePos = saved.pos || 0; needLoad = true;
      showTrack(queue[0], resumePos);
      return;
    }
  } catch {}
  if (current === -1) { try { await waveStart(false); } catch {} }
  if (!queue.length) $("#pTitle").textContent = "Ничего не играет";
}

async function play(i, resumeAt = 0) {
  if (i < 0 || i >= queue.length) return;
  current = i; needLoad = false;
  const t = queue[i];
  showTrack(t, resumeAt);
  if (shuffle) {
    if (orderFor !== queue || order.length !== queue.length) buildOrder();
    else { const k = order.indexOf(i); if (k >= 0) ordPos = k; }
  }
  saveLast(resumeAt);
  if (wave.on) {
    wave.pos = i; markHeard(t);
    waveFeedback("trackStarted", t);
    if (queue.length - i <= 2) waveMore();
  }
  const my = ++playSeq;
  const wantViz = cfg.viz && wave.on;
  if (!audio || audioViz !== wantViz) {          // для анализа звука нужен «чистый» элемент <audio>
    const old = audio;
    if (old) { old.pause(); old._src?.disconnect(); old.removeAttribute("src"); old.load(); }
    audio = makeAudio(wantViz); audioViz = wantViz;
  }
  try {
    const url = await directLink(t.id);
    if (my !== playSeq) return;
    let src = url;
    if (wantViz) {
      const buf = await invoke("fetch_bytes", { url });
      if (my !== playSeq) return;
      if (curBlob) URL.revokeObjectURL(curBlob);
      src = curBlob = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      await actx.resume();
    }
    audio.src = src;
    if (resumeAt) audio.addEventListener("loadedmetadata", () => { audio.currentTime = resumeAt; }, { once: true });
    await audio.play();
  } catch (e) { if (my === playSeq) $("#status").textContent = "Не удалось воспроизвести: " + e.message; }
}

function makeAudio(useViz) {
  const a = new Audio();
  a.volume = volume;
  a.onplay = syncIcons;
  a.onpause = syncIcons;
  a.onended = () => {
    if (a !== audio) return;
    if (effRepeat() === 2) { a.currentTime = 0; a.play(); return; }   // повтор трека: сразу с начала
    if (wave.on) waveFeedback("trackFinished", queue[current], { totalPlayedSeconds: Math.round(a.duration) });
    const n = nextIndex(true);
    if (n >= 0) play(n); else onQueueEnd();
  };
  a.ontimeupdate = () => {
    if (a === audio && a.duration) {
      $("#seek").value = (a.currentTime / a.duration) * 1000; fill($("#seek"));
      $("#tCur").textContent = fmtTime(a.currentTime); $("#tDur").textContent = fmtTime(a.duration);
      if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveLast(a.currentTime); }
    }
  };
  if (useViz) {
    actx ||= new AudioContext();
    if (!analyser) {
      analyser = actx.createAnalyser();
      analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.65;
      analyser.connect(actx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
    }
    a._src = actx.createMediaElementSource(a);
    a._src.connect(analyser);
  }
  return a;
}

// ---------- визуализатор: неровные круги в ритм музыке ----------
const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
function applyViz() {
  $("#viz").hidden = !cfg.viz;
  document.querySelector(".stage").classList.toggle("viz", cfg.viz);
  if ($("#wavePage").hidden) return;
  cfg.viz ? vizStart() : vizStop();
}
function vizStart() { if (!viz.run) { viz.run = true; requestAnimationFrame(vizFrame); } }
function vizStop() { viz.run = false; }

function vizFrame(ts) {
  if (!viz.run) return;
  requestAnimationFrame(vizFrame);
  const cv = $("#viz"), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const live = audioViz && analyser && audio && !audio.paused;
  if (!live && (viz.skip = !viz.skip)) return;           // в простое рисуем реже
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);

  // спектр: бас, середина и сглаженные значения по «углам»
  let bass = 0, mid = 0;
  if (live) {
    analyser.getByteFrequencyData(freq);
    for (let k = 1; k <= 6; k++) bass += freq[k];
    for (let k = 7; k <= 40; k++) mid += freq[k];
    bass /= 6 * 255; mid /= 34 * 255;
  }
  viz.bass += (bass - viz.bass) * (bass > viz.bass ? 0.6 : 0.08);
  viz.mid += (mid - viz.mid) * 0.2;
  for (let k = 0; k < 128; k++) {
    const target = live ? freq[1 + Math.floor(Math.pow(k / 127, 1.7) * 150)] / 255 : 0;
    viz.sm[k] += (target - viz.sm[k]) * (target > viz.sm[k] ? 0.5 : 0.1);
  }

  const t = ts / 1000, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2, N = 120, RINGS = 5;
  const br = ($("#waveBtn").offsetWidth || 112) / 2;
  // в стимпанке вокруг кнопки шкала с рисками, в Lolitta — жемчужное кольцо: круги начинаем за ними
  const inner = Math.min(br + (cfg.style === "steam" || cfg.style === "lolitta" ? 28 : 14), R * 0.5), outer = Math.max(inner + 20, R * 0.76);
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, sty().accent); grad.addColorStop(1, sty().accent2);
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.9);
  glow.addColorStop(0, rgba(sty().accent, 0.1 + viz.bass * 0.3)); glow.addColorStop(1, rgba(sty().accent, 0));
  g.fillStyle = glow; g.fillRect(0, 0, w, h);

  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < RINGS; i++) {
    const base = (inner + ((outer - inner) * i) / (RINGS - 1)) * (1 + viz.bass * (0.12 - i * 0.02));
    const room = Math.max(R - 16 - base, 4);             // запас до края холста с учётом толщины свечения
    const wob = 0.7 + viz.mid * 1.6;
    const pts = [];
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const u = Math.abs(th - Math.PI) / Math.PI;                       // 0..1, симметрично по вертикали
      const s = viz.sm[(Math.floor(u * 127) + i * 9) % 128];
      const noise = 0.05 * Math.sin(2 * th + t * 0.5 + i * 1.3) + 0.04 * Math.sin(3 * th - t * 0.7 + i * 2.1) + 0.03 * Math.sin(5 * th + t * 0.9 + i * 0.7);
      let dev = base * noise * wob + s * R * 0.13 * (1 - i * 0.1);
      if (dev > 0) dev = room * Math.tanh(dev / room);   // мягкий предел: кольцо не упирается в край и не обрезается
      else dev = Math.max(dev, -(base - br - 6));        // и не залезает под кнопку
      const r = base + dev;
      pts.push([cx + Math.cos(th) * r, cy + Math.sin(th) * r]);
    }
    const path = new Path2D();
    const mid0 = [(pts[N - 1][0] + pts[0][0]) / 2, (pts[N - 1][1] + pts[0][1]) / 2];
    path.moveTo(mid0[0], mid0[1]);
    for (let j = 0; j < N; j++) {
      const a = pts[j], b = pts[(j + 1) % N];
      path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    path.closePath();
    if (i === 0) { g.globalAlpha = 0.07; g.fillStyle = grad; g.fill(path); }
    g.strokeStyle = grad;
    g.globalAlpha = 0.05; g.lineWidth = 18; g.stroke(path);
    g.globalAlpha = 0.12; g.lineWidth = 7; g.stroke(path);
    g.globalAlpha = 0.6 - i * 0.07; g.lineWidth = 1.6; g.stroke(path);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}

$("#pTitle").onclick = () => { const id = albumOf(queue[current]); if (id) navigate(() => showAlbum(id)); };
$("#play").onclick = togglePlay;
$("#next").onclick = () => {
  if (wave.on) waveFeedback("skip", queue[current], { totalPlayedSeconds: Math.round(audio.currentTime) });
  const n = nextIndex(false);
  if (n >= 0) play(n); else onQueueEnd();
};
$("#prev").onclick = () => {
  if (!needLoad && audio.currentTime > 3) { audio.currentTime = 0; return; }
  const n = prevIndex();
  if (n >= 0) play(n);
};
let lastVol = parseFloat(localStorage.getItem("ym_lastvol")) || 0.8;
function setVol(v) {
  volume = Math.max(0, Math.min(1, v));
  try { localStorage.setItem("ym_vol", String(volume)); } catch {}
  if (audio) audio.volume = volume;
  const pct = Math.round(volume * 100);
  $("#vol").value = pct; fill($("#vol"));
  $("#volVal").textContent = pct;
  $("#volBtn").innerHTML = ICON[volume === 0 ? "mute" : volume < 0.5 ? "low" : "high"];
}
$("#vol").addEventListener("input", (e) => setVol(e.target.value / 100));
$("#volBtn").onclick = () => { if (volume > 0) { lastVol = volume; try { localStorage.setItem("ym_lastvol", String(lastVol)); } catch {} setVol(0); } else setVol(lastVol || 0.5); };
$("#volWrap").addEventListener("wheel", (e) => { e.preventDefault(); setVol(volume + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
$("#seek").addEventListener("input", (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; });

// ---------- своя верхняя панель окна ----------
ICON.winMax = '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.2" y="2.2" width="7.6" height="7.6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
ICON.winRestore = '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M3.6 3.6V2.2h6.2v6.2H8.4M2.2 3.6h6.2v6.2H2.2z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
const win = (cmd) => Promise.resolve(invoke(cmd)).catch(() => {});
async function syncMax() {
  try {
    const m = await invoke("win_is_max");
    $("#wMax").innerHTML = m ? ICON.winRestore : ICON.winMax;
    $("#wMax").title = m ? "Свернуть в окно" : "Развернуть";
  } catch {}
}
$("#wMin").onclick = () => win("win_minimize");
$("#wMax").onclick = async () => { await win("win_toggle_max"); syncMax(); };
$("#wClose").onclick = () => win("win_close");
$("#titlebar").addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.target.closest("button")) return;
  win(e.detail === 2 ? "win_toggle_max" : "win_drag");
});
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(syncMax, 120); });
syncMax();

// ---------- стиль Lolitta: декор (банты, розы, жемчуг, камея, медальон) ----------
// Рисуется один раз; цвета берутся из переменных темы, поэтому декор перекрашивается вместе с «Основным» и «Вторым» цветом.
// В остальных стилях блоки .lodeco скрыты.
const LO = (() => {
  const P = (cx, cy, r) => `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="url(#loP)"/>`;
  const bow = `<svg viewBox="0 0 100 86"><g fill="url(#loG)" stroke="var(--l-lo)" stroke-width="1" stroke-linejoin="round">
    <path d="M47 43C44 56 36 68 24 82L33.5 79L38 86C45 71 50 57 52.5 44Z"/><path d="M53 43C56 56 64 68 76 82L66.5 79L62 86C55 71 50 57 47.5 44Z"/>
    <path d="M50 37C42 22 22 6 8 12C-2 18 3 38 18 45C29 49 41 45 50 41Z"/><path d="M50 37C58 22 78 6 92 12C102 18 97 38 82 45C71 49 59 45 50 41Z"/></g>
    <g fill="var(--l-lo)" opacity=".5"><path d="M50 39C38 30 22 23 13 26C20 34 35 41 50 41Z"/><path d="M50 39C62 30 78 23 87 26C80 34 65 41 50 41Z"/><path d="M48 46C46 58 40 68 32 78L36 77C42 68 47 58 49.5 47Z"/><path d="M52 46C54 58 60 68 68 78L64 77C58 68 53 58 50.5 47Z"/></g>
    <g fill="none" stroke="var(--l-hi)" stroke-width="1.7" stroke-linecap="round" opacity=".95"><path d="M43 29C34 19 20 11 11 16"/><path d="M57 29C66 19 80 11 89 16"/></g>
    <rect x="42.5" y="31" width="15" height="15.5" rx="5" fill="url(#loG)" stroke="var(--l-lo)"/>
    <path d="M46 35Q50 33 54 35" fill="none" stroke="var(--l-hi)" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const rose = `<svg viewBox="0 0 60 60"><g fill="var(--l-lo)" stroke="var(--l-deep)" stroke-width=".5" stroke-opacity=".5"><path d="M30 31C40 33 51 40 58 53C45 52 35 45 30 31Z"/><path d="M30 31C20 35 10 43 3 56C16 53 26 45 30 31Z"/></g>
    <g fill="none" stroke="var(--l-hi)" stroke-width=".8" opacity=".7"><path d="M34 35C42 40 49 45 54 51"/><path d="M26 36C18 41 12 47 7 53"/></g>
    <circle cx="30" cy="29" r="18" fill="url(#loR)" stroke="var(--l-lo)" stroke-width=".9"/>
    <g fill="none" stroke="var(--l-lo)" stroke-width="1.3" stroke-linecap="round"><path d="M13 31C12 19 23 11 33 12C25 15 19 21 19 29"/><path d="M47 27C48 39 38 47 27 46C35 43 41 37 41 29"/><path d="M24 44C17 42 13 36 13 31"/><path d="M36 13C42 15 47 20 47 27"/><path d="M23 29a7 7 0 1 1 7 7a5 5 0 1 1 -5 -5a3 3 0 1 1 3 3"/></g>
    <g fill="none" stroke="var(--l-hi)" stroke-width="1.1" stroke-linecap="round" opacity=".85"><path d="M16 26C18 18 25 14 31 14"/><path d="M44 32C42 40 36 44 29 44"/></g></svg>`;
  const corner = `<svg viewBox="0 0 64 64"><g fill="none" stroke="url(#loG)" stroke-width="1.9" stroke-linecap="round">
    <path d="M5 60C5 28 28 5 60 5"/><path d="M5 45C5 29 12 17 22 12C29 9 34 14 31 18.5C29 21.5 24.5 20.5 24.5 17"/><path d="M45 5C29 5 17 12 12 22C9 29 14 34 18.5 31C21.5 29 20.5 24.5 17 24.5"/></g>
    <path d="M23 23C30 20 37 25 35 33C28 35 22 30 23 23Z" fill="url(#loG)" stroke="var(--l-lo)" stroke-width=".7"/>
    <path d="M25 25L32 31" stroke="var(--l-hi)" stroke-width=".8"/>${P(6, 6, 4.2)}${P(60, 5, 2.6)}${P(5, 60, 2.6)}${P(14, 14, 2)}</svg>`;
  const gem = `<svg viewBox="0 0 22 14"><path d="M1 7L11 1L21 7L11 13Z" fill="url(#loG)" stroke="var(--l-lo)" stroke-width=".8"/><path d="M11 1L11 13M1 7H21" stroke="var(--l-hi)" stroke-width=".5" opacity=".8"/>${P(11, 7, 2.3)}</svg>`;
  // камея: жемчужная оправа, розовая рамка, профиль дамы, бантик сверху и жемчужная капля снизу
  let ring = "";
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; ring += P(45 + 40 * Math.cos(a), 56 + 44 * Math.sin(a), 3.4); }
  const cameo = `<svg viewBox="0 0 90 106">${ring}
    <ellipse cx="45" cy="56" rx="35.5" ry="39.5" fill="none" stroke="url(#loG)" stroke-width="4.5"/>
    <ellipse cx="45" cy="56" rx="32" ry="36" fill="var(--l-lo)" stroke="var(--l-deep)" stroke-width="1" stroke-opacity=".4"/>
    <ellipse cx="45" cy="56" rx="32" ry="36" fill="url(#loV)"/>
    <clipPath id="loCamClip"><ellipse cx="45" cy="56" rx="32" ry="36"/></clipPath>
    <g clip-path="url(#loCamClip)"><path transform="translate(23 21) scale(.82)" fill="var(--l-pearl)" opacity=".95" d="M14 76C16 68 18 62 18 56C12 54 8 48 9 40C4 36 2 28 6 22C9 14 18 10 26 12C32 6 42 8 44 16C48 20 49 26 47 30C47 33 48 35 51 38L48 40C49 42 48 43 47 44C48 45 48 47 46 48C46 51 44 53 41 53C38 54 36 54 35 55C35 60 37 66 41 70C44 73 45 76 46 78Z"/>
    <path transform="translate(23 21) scale(.82)" d="M10 76C18 72 34 72 48 78" fill="none" stroke="var(--l-pearl)" stroke-width="2.4" stroke-dasharray="1 2.6" stroke-linecap="round"/></g>
    <svg x="33" y="0" width="24" height="21" viewBox="0 0 100 86">${bow.replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>
    ${P(45, 102.5, 3.4)}</svg>`;
  // медальон у заголовка страницы: зубчатая розовая оправа, тёмный бархат внутри, искра
  let star = "";
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 34 : 38.5; star += `${i ? "L" : "M"}${(40 + r * Math.cos(a)).toFixed(1)} ${(40 + r * Math.sin(a)).toFixed(1)}`; }
  const medal = `<svg viewBox="0 0 80 80"><path d="${star}Z" fill="url(#loG)" stroke="var(--l-lo)" stroke-width=".8"/>
    <circle cx="40" cy="40" r="30" fill="var(--l-deep)" stroke="var(--l-hi)" stroke-width="1.6"/>
    <circle cx="40" cy="40" r="26.5" fill="url(#loM)"/><circle cx="40" cy="40" r="26.5" fill="none" stroke="var(--l-pearl)" stroke-width=".8" stroke-dasharray="1 2.2" opacity=".8"/>${P(40, 3.5, 2.6)}${P(40, 76.5, 2.6)}${P(3.5, 40, 2.6)}${P(76.5, 40, 2.6)}
    <path d="M67 2L69 10L77 12L69 14L67 22L65 14L57 12L65 10Z" fill="#fff" opacity=".95"/><circle cx="67" cy="12" r="4" fill="#fff" opacity=".35"/></svg>`;
  const defs = `<svg width="0" height="0" style="position:absolute;width:0;height:0" aria-hidden="true"><defs>
    <linearGradient id="loG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--l-hi)"/><stop offset=".55" style="stop-color:var(--l-mid)"/><stop offset="1" style="stop-color:var(--l-lo)"/></linearGradient>
    <linearGradient id="loG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--l2-hi)"/><stop offset=".55" style="stop-color:var(--l2-mid)"/><stop offset="1" style="stop-color:var(--l2-lo)"/></linearGradient>
    <radialGradient id="loR" cx=".42" cy=".38" r=".7"><stop offset="0" style="stop-color:var(--l-hi)"/><stop offset=".55" style="stop-color:var(--l-mid)"/><stop offset="1" style="stop-color:var(--l-lo)"/></radialGradient>
    <radialGradient id="loP" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fff"/><stop offset=".45" style="stop-color:var(--l-pearl)"/><stop offset="1" style="stop-color:var(--l-lo)"/></radialGradient>
    <radialGradient id="loV" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="loM" cx=".5" cy=".3" r=".8"><stop offset="0" style="stop-color:var(--l-mid)"/><stop offset=".6" style="stop-color:var(--l-lo)"/><stop offset="1" style="stop-color:var(--l-btn)"/></radialGradient>
  </defs></svg>`;
  const bow2 = bow.replaceAll("url(#loG)", "url(#loG2)");      // бантик второго цвета — под активной закладкой
  return { bow, bow2, rose, corner, gem, cameo, medal, defs };
})();
function loDecor() {
  document.body.insertAdjacentHTML("afterbegin", LO.defs);
  const box = (cls, html) => { const d = document.createElement("div"); d.className = "lodeco " + cls; d.setAttribute("aria-hidden", "true"); d.innerHTML = html; return d; };
  const i = (cls, svg = "") => `<i class="${cls}">${svg}</i>`;
  const corners = (list) => list.map((c) => i("lo-c " + c, LO.corner)).join("");
  document.querySelector(".side").append(box("lo-side",
    corners(["tl", "tr"]) + i("lo-pearls") + i("lo-rose rl", LO.rose) + i("lo-rose rr", LO.rose) + i("lo-bowb", LO.bow)));
  document.querySelector(".side .spacer").append(box("lo-cameo", i("lo-cam", LO.cameo) + i("lo-bowl", LO.bow) + i("lo-bowr", LO.bow)));
  document.querySelector(".player").append(box("lo-player",
    corners(["tl", "tr", "bl", "br"]) + i("lo-pearls") + i("lo-rose rl", LO.rose) + i("lo-rose rr", LO.rose) + i("lo-rose rt", LO.rose) + i("lo-bowt", LO.bow)));
  document.querySelector(".cols").append(box("lo-frame",
    corners(["tl", "tr", "bl", "br"]) + ["t", "b", "l", "r"].map((s) => i("lo-gem " + s, LO.gem)).join("") + i("lo-bowtr", LO.bow)));
  document.querySelector(".head").prepend(box("lo-medal", LO.medal + '<span class="lo-mi"></span>'));
  $("#waveBtn").after(box("lo-hearts", "<i></i>".repeat(8)));      // сердечки, всплывающие над кнопкой, пока играет Моя волна
}
loDecor();

// ---------- старт ----------
audio = makeAudio(false);
setVol(volume);
updateModes(); setHeart($("#likeBtn"), false); setHeart($("#fLike"), false);
syncIcons();
(async () => {
  const migMsg = await migrateLegacyToken();
  const has = await tokenExists();
  if (has === null) showLogin("Не найдены команды хранилища токена: обнови Rust-часть (auth.rs и net.rs).");
  else if (has && uid) { goTop(showLikes); restorePlayer(); loadLikedIds(); }
  else showLogin(migMsg);
})();
