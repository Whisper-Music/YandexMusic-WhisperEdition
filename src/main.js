const invoke = async (cmd, args) => {
  try { return await window.__TAURI__.core.invoke(cmd, args); }
  catch (e) { throw e instanceof Error ? e : new Error(String(e)); }
};

const OAUTH_URL =
  "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d";
const $ = (s) => document.querySelector(s);

// Динамический CSS (свои цвета, CSS своих тем) — без элементов <style>: CSP приложения запрещает
// встроенные стили (style-src без 'unsafe-inline', аудит F-11). На constructable stylesheets
// (document.adoptedStyleSheets) CSP не распространяется; где их нет (старый WebKitGTK) — <link> на blob:
// этого же приложения (style-src разрешает только 'self' и blob:). Подключаются после всех файлов .css;
// настройки пользователя (ccStyle) — всегда последними, после CSS своих тем.
const DynCss = (() => {
  const sheets = new Map();
  const LAST = "ccStyle";
  const adopt = "adoptedStyleSheets" in Document.prototype && "replaceSync" in CSSStyleSheet.prototype;
  const order = () => [...sheets.keys()].filter((k) => k !== LAST).concat(sheets.has(LAST) ? [LAST] : []);
  function sync() {
    if (adopt) document.adoptedStyleSheets = order().map((k) => sheets.get(k));
    else for (const k of order()) { const l = sheets.get(k); if (l !== document.head.lastElementChild) document.head.append(l); }
  }
  return {
    set(key, css) {
      let sh = sheets.get(key);
      if (adopt) {
        if (!sh) { sh = new CSSStyleSheet(); sheets.set(key, sh); sync(); }
        sh.replaceSync(String(css));
        return;
      }
      if (!sh) { sh = document.createElement("link"); sh.rel = "stylesheet"; sheets.set(key, sh); }
      const old = sh.href;
      sh.href = URL.createObjectURL(new Blob([String(css)], { type: "text/css" }));
      if (old.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(old), 5000);
      sync();
    },
    remove(key) {
      const sh = sheets.get(key);
      if (!sh) return;
      sheets.delete(key);
      if (adopt) sync();
      else { if (sh.href.startsWith("blob:")) URL.revokeObjectURL(sh.href); sh.remove(); }
    },
  };
})();
window.DynCss = DynCss;
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
};
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
ICON.more = svgp("M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z");
ICON.download = svgp("M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z");
ICON.got = svgp("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 5v6.6l2.3-2.3 1.4 1.4-4.7 4.7-4.7-4.7 1.4-1.4 2.3 2.3V7h2z");
// «Не нравится» — как у Яндекса: перечёркнутый круг
ICON.dislike = svgp("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z");
ICON.plus = svgp("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z");
ICON.plAdd = svgp("M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z");
ICON.remove = svgp("M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z");
ICON.toTop = svgp("M4 4h16v2H4zm8 3l-6 6h4v7h4v-7h4z");
ICON.toEnd = svgp("M4 18h16v2H4zm8-1l6-6h-4V4h-4v7H6z");
ICON.image = svgp("M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z");
ICON.grip = svgp("M9 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 16a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z");
const fmtTime = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

let uid = localStorage.getItem("ym_uid");
let shown = [];
let queue = [];
let current = -1;
let playingId = null;
let searchTimer = null;
let searchType = "track";
let nav = 0;
let view = null;
const hist = [];
const likes = { done: false, tracks: [] };
let likedIds = new Set(lsJSON("ym_liked_ids", [], Array.isArray).map(String));      // последний известный список — сердечки работают и без сети
let dislikedIds = new Set(lsJSON("ym_disliked_ids", [], Array.isArray).map(String));   // «Не нравится» — тоже запоминается
let playCtx = "other", shuffle = false, repeat = 0, order = [], ordPos = 0, orderFor = null;
{ const m = lsJSON("ym_modes", {}, (v) => typeof v === "object"); shuffle = !!m.shuffle; repeat = [0, 1, 2].includes(m.repeat) ? m.repeat : 0; }
const LK = { ctx: "likes" };
const got = new Set();
const PL = { list: null, loading: null, full: new Map(), covers: new Map() };
let curPl = null;
let likesTab = "likes";
let likesQuery = "", likesSrc = [];     // поиск по лайкам: строка запроса и полный список, по которому ищем
const recArr = [];
const pins = lsJSON("ym_pins", [], Array.isArray)
  .filter((p) => p && typeof p === "object" && /^\d+$/.test(String(p.id)) && typeof p.title === "string")
  .slice(0, 50)
  .map((p) => ({ type: ["artist", "playlist"].includes(p.type) ? p.type : "album", id: p.id, title: p.title.slice(0, 200), year: Number.isFinite(p.year) ? p.year : undefined }));
let tabsActive = false, pinItem = null;
const DEFAULT_SEED = "user:onyourwave";
const wave = { on: false, session: null, batch: null, loading: false, queue: [], pos: -1, seed: DEFAULT_SEED, name: "", album: null };
let artistWaveItem = null;
let playAlbum = null;
const heard = new Set(lsJSON("ym_heard", [], Array.isArray).filter((x) => typeof x === "string" || typeof x === "number").slice(-600));
{ const sv = lsJSON("ym_wave_seed", null, (v) => typeof v === "object"); if (typeof sv?.seed === "string" && /^[\w-]+:[\w.-]+$/.test(sv.seed)) { wave.seed = sv.seed; wave.name = typeof sv.name === "string" ? sv.name.slice(0, 100) : ""; } }
const savedVol = parseFloat(localStorage.getItem("ym_vol"));
let audio = null, audioViz = false, volume = savedVol >= 0 && savedVol <= 1 ? savedVol : 0.8, playSeq = 0, curBlob = null;
let actx = null, analyser = null, freq = null;
let needLoad = false, resumePos = 0, lastSave = 0;
const viz = {
  run: false, bass: 0, mid: 0, sm: new Float32Array(128), skip: false,
  last: 0, kick: 0, eAvg: 0, ePrev: 0, lastBeat: 0,            // такт: всплеск баса относительно среднего уровня
  bars: new Float32Array(64), peaks: new Float32Array(64),     // столбцы и их «шапки», которые медленно опускаются
};
const VIZ_STYLES = ["circle", "bars"];

const TRUSTED_SUFFIXES = ["yandex.net", "yandex.ru", "yandex.com", "yandex.by", "yandex.kz"];
const hostTrusted = (h) => TRUSTED_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
    return hostTrusted(u.hostname.toLowerCase()) ? u.href : "";
  } catch { return ""; }
}
function lsJSON(key, fallback, ok = () => true) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v != null && ok(v) ? v : fallback; }
  catch { return fallback; }
}
function mkImg(src, cls) {
  const im = document.createElement("img");
  im.alt = ""; if (cls) im.className = cls;
  im.loading = "lazy"; im.decoding = "async";      // обложки вне экрана не грузятся и не держат память, пока до них не долистали
  im.src = src || COVER_W;
  return im;
}
// Заглушка «W» для обложек: нет адреса обложки, нет сети или сервер не отдал картинку.
// Ловим ошибки всех картинок на странице (событие error не всплывает — слушаем на этапе перехвата).
const COVER_W = "assets/cover-w.svg";
document.addEventListener("error", (e) => {
  const im = e.target;
  if (!(im instanceof HTMLImageElement) || im.closest("#settingsPage")) return;
  if ((im.getAttribute("src") || "") === COVER_W) return;          // сама заглушка не загрузилась — не зацикливаемся
  im.src = COVER_W;
}, true);

// Офлайн-режим: нет интернета или сервера Яндекс Музыки не отвечают (5xx) — показываем скачанное.
// Ответ 4xx — это не «нет связи», а обычная ошибка запроса. Сетевые ошибки приходят из reqwest (net.rs) текстом.
const isNetErr = (e) => {
  const m = String(e?.message || e);
  return !navigator.onLine || /^HTTP 5\d\d\b/.test(m)
    || /error sending request|connect|dns|timed? ?out|network|unreachable|failed to lookup|no route|resolve/i.test(m);
};
let offline = false, offlineTimer = 0;
function setOffline(on) {
  if (offline === on) return;
  offline = on;
  document.body.classList.toggle("offline", on);
  clearInterval(offlineTimer);
  if (on) offlineTimer = setInterval(probeOnline, 30000);
}
let probing = false;
async function probeOnline() {
  if (!offline || probing || !uid) return;
  probing = true;
  try { await ym("account_status"); } catch { return; } finally { probing = false; }
  setOffline(false);
  showToast("Связь с Яндекс Музыкой восстановлена", 3500, { kind: "ok" });
  loadLikedIds(); loadDislikedIds();
  if (document.querySelector(".main").dataset.page === "likes" && likesTab === "likes" && !likes.done) goTop(showLikes);
}
window.addEventListener("online", probeOnline);

// Яндекс Музыка. Интерфейс называет только операцию и её параметры; адрес, метод, заголовки и токен
// знает Rust (src-tauri/src/net.rs, список OPS). Чтение и изменение данных аккаунта — разные команды
// (ym_read / ym_write) с разными разрешениями (capabilities/yandex-read.json и yandex-write.json).
const YM_WRITE = new Set(["like_add", "like_remove", "dislike_add", "dislike_remove", "rotor_feedback",
  "playlist_create", "playlist_rename", "playlist_change", "playlist_change_rel", "playlist_delete"]);
const strMap = (o) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) : null);
async function ym(op, { id = null, query = null, form = null, json = null } = {}) {
  const body = await invoke(YM_WRITE.has(op) ? "ym_write" : "ym_read",
    { op, id: id == null ? null : String(id), query: strMap(query), form: strMap(form), json });
  return JSON.parse(body).result;
}

const STYLE_DEF = {
  neon:  { accent: "#a66bff", accent2: "#e060ff", glow: 22, panel: 70, dim: 10, bg: "" },
  royal: { accent: "#c9a24b", accent2: "#8b1e2d", glow: 6, panel: 92, dim: 10, bg: "" },
  steam: { accent: "#c58a4b", accent2: "#8c4f24", glow: 4, panel: 90, dim: 10, bg: "" },
  lolitta: { accent: "#e2aab4", accent2: "#8c4a5c", glow: 4, panel: 94, dim: 10, bg: "" },
};
const STYLE_KEYS = ["accent", "accent2", "glow", "panel", "dim"];
// Свои стили из файлов .wmt (theme.js). У каждого есть «основа» — один из встроенных стилей:
// от неё берётся поведение, которое задаётся не CSS, а кодом (цвета Lolitta, отступы визуализатора и т.п.).
const BUILTIN = Object.keys(STYLE_DEF);
const themeReady = new Set();         // свои стили, чьи CSS уже подключены
const baseOf = (st = cfg.style) => (BUILTIN.includes(st) ? st : cfg.themes?.find((t) => t.id === st)?.base || "neon");
const styleDef = (st) => STYLE_DEF[st] || STYLE_DEF[baseOf(st)];
// Что умеет стиль — от этого зависит, какие настройки показывать. Свой стиль задаёт это в файле темы
// (settings whisper-music → features, заполняет theme.js); не задал — как у его основы.
//   glow — есть свечение (ползунок «Свечение»), animations — есть анимации (галочка «Анимации интерфейса»),
//   panelOpacity — панели могут быть прозрачными (ползунок «Прозрачность панелей»).
const themeFeatures = {};
// Возможности своих тем сверх CSS (settings whisper-music, разбирает theme.js → setFeatures):
// volKnob — громкость ручкой, layoutFixed — тема сама задаёт расположение, buttons — [[имя, действие], …].
const themeHooks = {};
const hook = (k, st = cfg.style) => themeHooks[st]?.[k];
function feature(name, st = cfg.style) {
  const f = themeFeatures[st]?.[name];
  if (typeof f === "boolean") return f;
  return name === "glow" ? baseOf(st) === "neon" : true;
}
const freshCfg = () => ({ style: "royal", blur: 6, viz: true, vizStyle: "circle", anim: true, bg: "", themes: [], s: Object.fromEntries(Object.keys(STYLE_DEF).map((k) => [k, { ...STYLE_DEF[k], cc: {} }])) });
function loadCfg() {
  let saved = null, old = null;
  try { saved = JSON.parse(localStorage.getItem("ym_cfg3") || "null"); } catch {}
  try { old = JSON.parse(localStorage.getItem("ym_cfg2") || "null"); } catch {}
  const c = freshCfg();
  if (saved) {
    for (const k of ["style", "blur", "viz", "vizStyle", "bg", "anim", "dyn", "dynColors"]) if (saved[k] !== undefined) c[k] = saved[k];
    for (const st of Object.keys(STYLE_DEF)) {
      Object.assign(c.s[st], saved.s?.[st] || {});
      if (saved.s?.[st]?.dim === undefined && saved.dim !== undefined) c.s[st].dim = saved.dim;
    }
    // свои стили: список (сами файлы лежат в IndexedDB) и их настройки
    c.themes = (Array.isArray(saved.themes) ? saved.themes : [])
      .filter((t) => t && /^[a-z0-9][a-z0-9-]{0,47}$/.test(t.id) && !STYLE_DEF[t.id] && typeof t.name === "string")
      .slice(0, 50)
      .map((t) => ({ id: t.id, name: t.name.slice(0, 60), base: STYLE_DEF[t.base] ? t.base : "neon", desc: String(t.desc || "").slice(0, 120) }));
    for (const t of c.themes) c.s[t.id] = { ...STYLE_DEF[t.base], cc: {}, ...(saved.s?.[t.id] || {}) };
  } else if (old) {
    for (const k of ["blur", "viz", "bg"]) if (old[k] !== undefined) c[k] = old[k];
    for (const k of STYLE_KEYS) if (old[k] !== undefined) c.s.neon[k] = old[k];
  }
  if (!c.s[c.style]) c.style = "royal";
  if (!VIZ_STYLES.includes(c.vizStyle)) c.vizStyle = "circle";
  return c;
}
let cfg = loadCfg();
const bgUrls = { neon: "", royal: "", steam: "", lolitta: "" };
const bgKinds = { neon: "", royal: "", steam: "", lolitta: "" };      // "image" | "video"
const bgPosters = { neon: "", royal: "", steam: "", lolitta: "" };    // кадр из видео — для превью в настройках
const bgKey = (st) => "bg:" + st;
const sty = () => cfg.s[cfg.style];
const curBg = () => bgUrls[cfg.style] || "";
const curBgVideo = () => bgKinds[cfg.style] === "video";

function fill(el) { el.style.setProperty("--p", ((el.value - el.min) / (el.max - el.min)) * 100 + "%"); }
function fillAll() { document.querySelectorAll("input[type=range]").forEach(fill); }

function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function relLum(rgb) { return rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); }
function btnHi(h) { const c = hexRgb(h); return c ? "#" + c.map((v) => Math.round(v * 0.7 + 255 * 0.3).toString(16).padStart(2, "0")).join("") : h; }      // = --btn-hi в CSS
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
function loInk(st) {
  const r = document.documentElement.style;
  const NAMES = ["--lo-on-btn", "--lo-on-tab", "--lo-on-tabbg", "--lo-on-act", "--lo-on-tabact", "--lo-ink", "--lo-on-mid", "--lo-on-l2"];
  const A = hexRgb(st.accent), B = hexRgb(st.accent2);
  if (baseOf() !== "lolitta" || !A || !B) {
    for (const n of NAMES) { r.removeProperty(n); r.removeProperty(n + "-sh"); }
    for (const n of ["--lo-ic", "--lo-title", "--l-btn", "--l-btn2", "--l-tab", "--l-tab2"]) r.removeProperty(n);
    return;
  }
  const mix = (a, b, p) => a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  const cr = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const H = hexRgb, W = [255, 255, 255], DARK = "#2a1218", LIGHT = "#fff6f7";
  const pick = (bgs, cands, t = 4.5) => {
    let best = cands[0], bv = -1;
    for (const c of cands) { const v = Math.min(...bgs.map((b) => cr(b, H(c)))); if (v >= t) return { c, v }; if (v > bv) { best = c; bv = v; } }
    return { c: best, v: bv };
  };
  const set = (name, p) => {
    r.setProperty(name, p.c);
    r.setProperty(name + "-sh", p.v >= 4.5 ? "none" : relLum(H(p.c)) > 0.35 ? "0 1px 2px rgba(30,8,15,.9), 0 0 6px rgba(30,8,15,.6)" : "0 0 4px rgba(255,255,255,.9), 0 1px 0 rgba(255,255,255,.7)");
  };
  const darken = (base, p, maxLum, C = B) => { let c = mix(C, H(base), p); while (relLum(c) > maxLum && p > 0) { p = Math.max(0, p - 0.04); c = mix(C, H(base), p); } return c; };
  const btn = [darken("#2a1218", 0.6, 0.06), darken("#1c0b10", 0.42, 0.035)];          // кнопки — от вторичного
  const tab = [darken("#2a1218", 0.45, 0.06, A), darken("#1c0b10", 0.3, 0.035, A)];    // вкладки верхней панели — от основного
  r.setProperty("--l-btn", hex(btn[0])); r.setProperty("--l-btn2", hex(btn[1]));
  r.setProperty("--l-tab", hex(tab[0])); r.setProperty("--l-tab2", hex(tab[1]));
  if (relLum(A) < 0.18) r.setProperty("--lo-title", hex(mix(A, H("#fff8f6"), 0.4))); else r.removeProperty("--lo-title");
  const act = [mix(B, W, 0.55), mix(B, W, 0.85)];
  const light = mix(A, H("#fbf0f0"), 0.5), lights = [mix(light, W, 0.55), light, mix(A, H("#f1d8d9"), 0.72)];
  const hi = mix(A, H("#fff8f6"), 0.4), lo = mix(A, H("#4a2430"), 0.65), ink = mix(A, H("#24100f"), 0.45);
  const l2hi = mix(B, H("#fff3f4"), 0.5), l2lo = mix(B, H("#12060a"), 0.62);
  set("--lo-on-btn", pick(btn, ["#f9eaec", LIGHT, DARK]));
  set("--lo-on-tab", pick(btn, [hex(hi), "#f9eaec", LIGHT, DARK]));
  set("--lo-on-tabbg", pick(tab, [hex(hi), "#f9eaec", LIGHT, DARK]));
  set("--lo-on-act", pick(act, [LIGHT, DARK]));
  set("--lo-on-tabact", pick([mix(A, W, 0.75), A], [hex(ink), DARK, LIGHT]));
  set("--lo-ink", pick(lights, [hex(ink), DARK, LIGHT]));
  set("--lo-on-mid", pick([A, lo], [LIGHT, DARK], 1.8));
  set("--lo-on-l2", pick([l2hi, B, l2lo], [LIGHT, DARK], 1.8));
  if (Math.min(...btn.map((b) => cr(b, A))) < 2.2) r.setProperty("--lo-ic", r.getPropertyValue("--lo-on-btn"));
  else r.removeProperty("--lo-ic");
}
// ---------- расширенная настройка цветов ----------
// Каждый параметр хранится отдельно для каждого стиля в cfg.s[стиль].cc. Пусто — «авто»: цвет берётся из основного/второго.
// css: { all | neon | royal | steam | lolitta: [[селекторы, объявления с $ вместо цвета], ...] } — для стиля берётся свой список, иначе all.
const PANEL = "color-mix(in srgb, $ calc(var(--panel-a) * 100%), transparent)";
const BALL = "radial-gradient(circle at 35% 30%, color-mix(in srgb, $ 55%, #fff), $ 60%, color-mix(in srgb, $ 70%, #000))";
const FRAMED = ["royal", "steam", "lolitta"];      // в этих стилях у кнопок есть настоящая рамка (border)
const bordered = (sel, notActive) => Object.fromEntries([
  ["all", [[notActive, "box-shadow: inset 0 0 0 1px $"]]],
  ...FRAMED.map((st) => [st, [[sel, "border-color: $"]]]),
]);
const SIDE_NAV = ".side .nav:not(.active)", SIDE_ACT = ".side .nav.active";
const BTN = ".main .nav:not(.active):not(.danger), .chip:not(.active), .pill:not(.active), .round, .modalbox .nav:not(.active):not(.danger)";
const BTN_ALL = ".main .nav:not(.danger), .chip, .pill, .round, .modalbox .nav:not(.danger)";
const BTN_ACT = ".main .nav.active:not(.danger), .chip.active, .pill.active, .stations .pill.active, .modalbox .nav.active:not(.danger), .login-box .nav.active:not(.danger)";
const PLAY = ".player .playbtn, .fbtns .playbtn, .wavebtn, .best .bplay, .stalbum .stplay";
const SEEK_TRACK = { all: "rgba(255,255,255,.16)", steam: "rgba(255,255,255,.12)", lolitta: "color-mix(in srgb, var(--accent2) 22%, transparent)" };
const VOL_TRACK = { all: "rgba(255,255,255,.16)", steam: "rgba(255,255,255,.12)", lolitta: "color-mix(in srgb, var(--accent) 30%, transparent)" };
const VOL_FILL = { all: "var(--accent)", lolitta: "var(--l-lo)" };
const inkOn = (hex) => { const c = hexRgb(String(hex).slice(0, 7)); return c && relLum(c) > 0.4 ? "#2a1218" : "#fff7f7"; };

const CC_GROUPS = [
  { name: "Текст", items: [
    { k: "text", label: "Основной текст", vars: ["--text"], probe: ["body", "color"] },
    { k: "muted", label: "Второстепенный текст", vars: ["--muted"], probe: [".sub, .status, .muted, .swatch", "color"] },
    { k: "heading", label: "Заголовки", css: { all: [["#title, .main h2, .main h3, .card h3", "color: $; -webkit-text-fill-color: $"]] }, probe: ["#title", "color"] },
  ] },
  { name: "Фон окна", items: [
    { k: "winBg", label: "Фон окна (когда нет обоев)", css: { all: [["body", "background: $"]] }, probe: ["body", "background-color"] },
  ] },
  { name: "Верхняя панель", items: [
    { k: "tabBg", label: "Фон вкладок", css: { all: [[".tab:not(.active)", "background: $"]], royal: [[".tab:not(.active)::after", "background: $"]], steam: [[".tab:not(.active)::after", "background: $"]] }, probe: [".tab:not(.active)", "background-color"] },
    { k: "tabText", label: "Текст вкладок", css: { all: [[".tab:not(.active)", "color: $"]] }, probe: [".tab:not(.active)", "color"] },
    { k: "tabBorder", label: "Обводка", fb: "accent2", css: {
      all: [[".tab", "border-color: $"]],
      royal: [[".tab::before", "background: $"], [".tabs", "background: linear-gradient($, $) top / 100% 5px no-repeat"]],
      steam: [[".tab::before, .tab:hover::before, .tab.active::before", "background: $"],
              [".tabs", "background: linear-gradient($, $) 0 3px / 100% 1px no-repeat, linear-gradient(color-mix(in srgb, $ 45%, transparent), color-mix(in srgb, $ 45%, transparent)) 0 7px / 100% 1px no-repeat"]],
      lolitta: [[":root", "--l-edge-c: $"]],
    } },
    { k: "tabActBg", label: "Фон активной вкладки", css: { all: [[".tab.active", "background: $"]], royal: [[".tab.active::after", "background: $"]], steam: [[".tab.active::after", "background: $"]] }, probe: [".tab.active", "background-color"] },
    { k: "tabActText", label: "Текст активной вкладки", css: { all: [[".tab.active", "color: $"]] }, probe: [".tab.active", "color"] },
    { k: "titleBarBg", label: "Полоса заголовка окна", css: { all: [[".titlebar", "background: $"]] }, probe: [".titlebar", "background-color"] },
  ] },
  { name: "Боковая панель", items: [
    { k: "sideBg", label: "Фон панели", css: { all: [[".side", "background: " + PANEL]], steam: [[".side::before", "background: " + PANEL]] } },
    { k: "sideBorder", label: "Обводка панели", fb: "accent", css: { all: [[".side", "border-color: $"]], steam: [[".side::before", "border-color: $"]], royal: [[".side", "border-color: $"], [".side::before", "border-color: color-mix(in srgb, $ 55%, transparent)"]] } },
    { k: "navBg", label: "Фон кнопок", css: { all: [[SIDE_NAV, "background: $"]] }, probe: [SIDE_NAV, "background-color"], extra: SIDE_NAV + ":hover { filter: brightness(1.15); }" },
    { k: "navText", label: "Текст и значки кнопок", css: { all: [[SIDE_NAV, "color: $"]], steam: [[SIDE_NAV, "color: $"], [SIDE_NAV + "::before", "background: $"]], lolitta: [[SIDE_NAV, "color: $"], [SIDE_NAV + "::before", "background: $"]] }, probe: [SIDE_NAV, "color"] },
    { k: "navBorder", label: "Обводка кнопок", fb: "accent", css: bordered(".side .nav", SIDE_NAV) },
    { k: "navActBg", label: "Фон активной кнопки", fb: "accent2", css: { all: [[SIDE_ACT, "background: $"]] } },
    { k: "navActText", label: "Текст активной кнопки", css: { all: [[SIDE_ACT, "color: $"]], steam: [[SIDE_ACT, "color: $"], [SIDE_ACT + "::before", "background: $"]], lolitta: [[SIDE_ACT, "color: $"], [SIDE_ACT + "::before", "background: $"]] }, probe: [SIDE_ACT, "color"] },
    { k: "searchBg", label: "Фон поиска", css: { all: [[".search", "background: $"]], steam: [[".search", "background: var(--search-ic) 12px center / 16px 16px no-repeat, $"]], lolitta: [[".side .search", "background: var(--l-search) 16px center / 18px 18px no-repeat, $"]] }, probe: [".search", "background-color"] },
    { k: "searchText", label: "Текст поиска", css: { all: [[".search, .lkfindcnt", "color: $"], [".search::placeholder", "color: color-mix(in srgb, $ 62%, transparent)"]] }, probe: [".search", "color"],
      // выбран только фон поиска — текст сам становится тёмным на светлом фоне и светлым на тёмном
      gen: (cc) => cc.searchBg && !cc.searchText && /^#[0-9a-f]{6}/i.test(cc.searchBg)
        ? `.search, .lkfindcnt { color: ${inkOn(cc.searchBg)} !important; } .search::placeholder { color: color-mix(in srgb, ${inkOn(cc.searchBg)} 62%, transparent) !important; }` : "" },
  ] },
  { name: "Кнопки в окне", note: "Чипы, «Показать ещё», «Закрепить», кнопки в окнах", items: [
    { k: "btnBg", label: "Фон кнопок", css: { all: [[BTN, "background: $"]] }, extra: ".main .nav:not(.active):not(.danger):hover, .chip:not(.active):hover, .pill:not(.active):hover, .round:hover { filter: brightness(1.15); }" },
    { k: "btnText", label: "Текст кнопок", css: { all: [[BTN, "color: $"]] }, probe: [".main .nav:not(.active)", "color"] },
    { k: "btnBorder", label: "Обводка кнопок", fb: "accent", css: bordered(BTN_ALL, BTN) },
    { k: "btnActBg", label: "Фон выбранной кнопки", fb: "accent2", css: { all: [[BTN_ACT, "background: $"]] } },
    { k: "btnActText", label: "Текст выбранной кнопки", css: { all: [[BTN_ACT, "color: $; text-shadow: none"]] }, fb: "onAccent" },
  ] },
  { name: "Нижняя панель", items: [
    { k: "plBg", label: "Фон панели", css: { all: [[".player", "background: " + PANEL]], steam: [[".player::before", "background: " + PANEL]] } },
    { k: "plBorder", label: "Обводка панели", fb: "accent", css: { all: [[".player", "border-color: $"]], steam: [[".player::before", "border-color: $"]], royal: [[".player", "border-color: $"], [".player::before", "border-color: color-mix(in srgb, $ 55%, transparent)"]] } },
    { k: "plTitle", label: "Название трека", css: { all: [["#pTitle", "color: $"]] }, probe: ["#pTitle", "color"] },
    { k: "plArtist", label: "Исполнитель и время", css: { all: [["#pArtist, #pArtist a, .player .time", "color: $"]] }, probe: ["#pArtist", "color"] },
    { k: "plIcons", label: "Значки кнопок", css: { all: [[".player .ctrls button:not(.playbtn):not(.on), #volBtn, #pMore, .player #disBtn:not(.on), .player #sleepBtn:not(.on), .pinfo .likebtn:not(.on)", "color: $"]] }, probe: ["#prev", "color"] },
    { k: "plModeOn", label: "Включённые повтор и перемешивание", fb: "accent2", css: { all: [[".modebtn.on", "color: $"]] } },
  ] },
  { name: "Кнопка «Пуск» и «Моя волна»", items: [
    { k: "playBg", label: "Фон кнопки", fb: "accent2", css: { all: [[PLAY, "background: " + BALL]] } },
    { k: "playIcon", label: "Значок", fb: "onAccent", css: { all: [[PLAY, "color: $; text-shadow: none"]] } },
  ] },
  { name: "Полоса воспроизведения", items: [
    { k: "seekFill", label: "Пройденная часть", fb: "accent2", gen: (cc, st) => !cc.seekFill && !cc.seekTrack ? "" :
      `#seek::-webkit-slider-runnable-track, #fSeek::-webkit-slider-runnable-track { background: linear-gradient(90deg, ${cc.seekFill || "var(--accent2)"} var(--p, 0%), ${cc.seekTrack || SEEK_TRACK[st] || SEEK_TRACK.all} var(--p, 0%)) !important; }` },
    { k: "seekTrack", label: "Оставшаяся часть", gen: () => "" },
    { k: "seekThumb", label: "Ползунок", css: { all: [["#seek::-webkit-slider-thumb, #fSeek::-webkit-slider-thumb", "background: $"]] }, probe: ["#seek", "color"], fb: "#ffffff" },
  ] },
  { name: "Громкость", items: [
    { k: "volFill", label: "Уровень громкости", fb: "accent", gen: (cc, st) => !cc.volFill ? "" :
      `#vol::-webkit-slider-runnable-track { background: linear-gradient(90deg, ${cc.volFill} var(--p, 0%), ${VOL_TRACK[st] || VOL_TRACK.all} var(--p, 0%)) !important; }` },
  ] },
  { name: "Лайки", items: [
    { k: "like", label: "Цвет лайка", fb: "accent2", css: { all: [[".likebtn.on", "color: $"]] },
      gen: (cc, st) => st === "lolitta" && cc.like ? `.list .likebtn.on { background: ${BALL.replaceAll("$", cc.like)} !important; color: ${inkOn(cc.like)} !important; }` : "" },
  ] },
  { name: "Список треков", items: [
    { k: "rowHover", label: "Подсветка строки при наведении", fb: "accent", css: { all: [[".list li:hover", "background: color-mix(in srgb, $ 18%, transparent)"]] } },
    { k: "rowTitle", label: "Название трека", css: { all: [[".list .t", "color: $"]] }, probe: [".list .t", "color"] },
    { k: "rowArtist", label: "Исполнитель", css: { all: [[".list .a, .list .a a", "color: $"]] }, probe: [".list .a", "color"] },
  ] },
  { name: "Средняя панель", note: "Основная область со списками и страницами", items: [
    { k: "mainBg", label: "Фон средней панели", css: { all: [[".main", "background: $"]] }, probe: [".main", "background-color"] },
    { k: "listBg", label: "Фон списка треков", css: { all: [[".main .list:not(:empty), .qbody .list", "background: $"]] }, probe: [".main .list", "background-color"] },
    { k: "titleBg", label: "Фон заголовка страницы", css: { all: [[".head h2", "background: $; -webkit-text-fill-color: currentColor"]] } },
  ] },
  { name: "Меню и окна", note: "Меню трека, подсказки, окна-диалоги, панель очереди", items: [
    { k: "menuBg", label: "Фон", css: { all: [[".tmenu, .toast, .modalbox, .login-box, .qpanel, .stations", "background: $"]] }, probe: [".tmenu", "background-color"] },
    { k: "menuText", label: "Текст", css: { all: [[".tmenu, .tmenu button, .toast, .modalbox, .login-box, .qpanel, .stations", "color: $"]] }, probe: [".tmenu", "color"] },
  ] },
  { name: "Карточки и блоки", note: "Блоки настроек, статистики, альбомов", items: [
    { k: "cardBg", label: "Фон", css: { all: [[".card, .lastAlbum, .simcard, .stylecard", "background: " + PANEL]] }, probe: [".card", "background-color"] },
    { k: "cardBorder", label: "Обводка", css: { all: [[".card, .lastAlbum, .simcard, .stylecard", "border-color: $"]] }, probe: [".card", "border-top-color"] },
  ] },
  { name: "Переключатели и ползунки", note: "В настройках", items: [
    { k: "ctl", label: "Цвет включённого", fb: "accent", css: { all: [[".switch input:checked + i", "background: $"]] },
      gen: (cc) => cc.ctl ? `.settings input[type=range]::-webkit-slider-runnable-track { background: linear-gradient(90deg, ${cc.ctl} var(--p, 0%), rgba(255,255,255,.16) var(--p, 0%)) !important; }` : "" },
  ] },
  { name: "Визуализатор", items: [
    { k: "vizA", label: "Первый цвет", fb: "accent" },
    { k: "vizB", label: "Второй цвет", fb: "accent2" },
  ] },
  { name: "Свечение", only: "neon", note: "Только в неоновом стиле", items: [
    { k: "glow", label: "Цвет свечения", fb: "accent2", css: { neon: [[":root", "--glow-c: $; --btn-glow: $"]] } },
  ] },
];
const CC_ITEMS = CC_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g })));
// «Сразу для всех»: один цвет записывается во все перечисленные места (их потом можно поправить по отдельности)
const CC_BULK = [
  { label: "Фон всех панелей", note: "Верхняя полоса, боковая, средняя и нижняя панели, меню и окна", keys: ["titleBarBg", "sideBg", "mainBg", "plBg", "menuBg"] },
  { label: "Обводка всех панелей", note: "Верхняя, боковая, нижняя панели и карточки", keys: ["tabBorder", "sideBorder", "plBorder", "cardBorder"] },
  { label: "Фон всех кнопок", note: "Вкладки, кнопки боковой панели и кнопки в окне", keys: ["tabBg", "navBg", "btnBg"] },
  { label: "Текст и значки всех кнопок", note: "Вкладки, боковая панель, кнопки в окне, значки плеера", keys: ["tabText", "navText", "btnText", "plIcons"] },
  { label: "Обводка всех кнопок", note: "Кнопки боковой панели и кнопки в окне", keys: ["navBorder", "btnBorder"] },
  { label: "Фон выбранных кнопок", note: "Активная вкладка, активная кнопка боковой панели, выбранная кнопка в окне", keys: ["tabActBg", "navActBg", "btnActBg"] },
  { label: "Текст выбранных кнопок", note: "Активная вкладка, активная кнопка боковой панели, выбранная кнопка в окне", keys: ["tabActText", "navActText", "btnActText"] },
];
const ccOf = (st = cfg.style) => (cfg.s[st].cc ||= {});

function ccCss(st) {
  // Настройки пользователя главнее любых правил стиля, в том числе своих тем с !important:
  // повтор :root поднимает силу селектора (специфичность), а сам блок подключается последним (applyCustom).
  const cc = ccOf(st), pre = `:root:root:root:root[data-style="${st}"]`, out = [], base = baseOf(st);      // свой стиль настраивается как его основа
  const scope = (sel) => sel.split(",").map((x) => x.trim()).map((x) => (x === ":root" ? pre : `${pre} ${x}`)).join(", ");
  // Обводка, которой у стиля нет (толщина 0, как у окон Windows 98), — тогда выбранный цвет рисуется рамкой в 1px
  const noBorder = (sel) => sel.split(",").some((x) => {
    let el = null;
    try { el = document.querySelector(x.trim().replace(/::?(before|after)$/, "")); } catch {}
    return el && st === cfg.style && parseFloat(getComputedStyle(el).borderTopWidth) === 0 && !/::?(before|after)$/.test(x.trim());
  });
  for (const it of CC_ITEMS) {
    if (it.group.only && it.group.only !== base) continue;
    const v = cc[it.k];
    if (it.gen) { const g = it.gen(cc, base); if (g) out.push(g.replace(/(^|\})\s*([^{}]+)\{/g, (m, b, sel) => `${b}\n${scope(sel)} {`)); }
    if (!v) continue;
    if (it.vars) out.push(`${pre} { ${it.vars.map((n) => `${n}: ${v} !important`).join("; ")}; }`);
    const rules = it.css && (it.css[base] || it.css.all);
    for (const [sel, decl0] of rules || []) {
      const decl = /^border-color:/.test(decl0) && noBorder(sel) ? decl0 + "; border-style: solid; border-width: 1px" : decl0;
      const d = decl.replaceAll("$", v).split(/;\s*/).filter(Boolean).map((x) => x + " !important").join("; ");
      out.push(`${scope(sel)} { ${d}; }`);
    }
    if (it.extra) out.push(it.extra.replace(/^([^{]+)\{/, (m, sel) => scope(sel) + " {"));
  }
  return out.join("\n");
}
function applyCustom() {
  DynCss.set("ccStyle", "");                 // обводки проверяем по виду стиля без старых настроек
  DynCss.set("ccStyle", ccCss(cfg.style));   // DynCss держит этот блок последним — после CSS своих тем
}

// что показать в пипетке у «авто»-параметра: реальный цвет элемента, если его можно прочитать, иначе — основной/второй
function toHex(c) {
  const m = /rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:[,/]\s*([\d.]+))?/.exec(c || "");
  if (!m || (m[4] !== undefined && +m[4] < 0.35)) return null;
  return "#" + [m[1], m[2], m[3]].map((x) => Math.round(+x).toString(16).padStart(2, "0")).join("");
}
function ccAuto(it) {
  const st = sty();
  if (it.probe) {
    const [sel, prop] = it.probe, el = document.querySelector(sel);
    if (el) { const h = toHex(getComputedStyle(el).getPropertyValue(prop)); if (h) return h; }
  }
  if (it.fb === "onAccent") return getComputedStyle(document.documentElement).getPropertyValue("--on-accent").trim() || "#ffffff";
  if (it.fb && it.fb[0] === "#") return it.fb;
  if (it.vars) { const h = getComputedStyle(document.documentElement).getPropertyValue(it.vars[0]).trim(); if (/^#[0-9a-f]{6}$/i.test(h)) return h; }
  return it.fb === "accent" ? st.accent : st.accent2;
}

function openColorEditor() {
  if (document.querySelector(".ccmodal")) return;
  const wrap = document.createElement("div"); wrap.className = "login modal ccmodal";
  const box = document.createElement("div"); box.className = "panel login-box modalbox ccbox";
  const h = document.createElement("h2"); h.textContent = "Тонкая настройка цветов";
  const p = document.createElement("p"); p.className = "ccnote";
  const styleName = { neon: "Неон", royal: "Королевский", steam: "Стимпанк", lolitta: "Lolitta" }[cfg.style] || cfg.themes.find((t) => t.id === cfg.style)?.name || cfg.style;
  p.textContent = `Для стиля «${styleName}». Блёклые кружки — «авто»: цвет берётся из основного и второго. Изменения видны сразу.`;
  const scroll = document.createElement("div"); scroll.className = "ccscroll";
  const cc = ccOf();
  const rows = {};      // k -> { show(v), it, sync() } — строки отдельных мест
  const bulks = [];     // строки раздела «Сразу для всех»
  const alphaOf = (v) => (/^#[0-9a-f]{8}$/i.test(v || "") ? Math.round((parseInt(v.slice(7), 16) / 255) * 100) : 100);
  const dotsOf = (dots, keys) => dots.replaceChildren(...keys.filter((k) => cc[k]).slice(0, 6).map((k) => { const i = document.createElement("i"); i.style.background = cc[k]; return i; }));
  // одна строка: название, «авто», пипетка, непрозрачность, ✕
  // onSet(v) — выбран цвет (#rrggbb или #rrggbbaa), onClear() — вернуть «авто»
  const makeRow = (label, autoHex, onSet, onClear) => {
    const row = document.createElement("label"); row.className = "ccrow";
    const lb = document.createElement("span"); lb.textContent = label;
    const auto = document.createElement("small");
    const inp = document.createElement("input"); inp.type = "color";
    const al = document.createElement("input"); al.type = "range"; al.min = "0"; al.max = "100"; al.className = "ccalpha";
    al.title = "Непрозрачность: влево — прозрачнее";
    const pct = document.createElement("output"); pct.className = "ccpct";
    const compose = () => { const a = +al.value; return a >= 100 ? inp.value : inp.value + Math.round((a / 100) * 255).toString(16).padStart(2, "0"); };
    const put = () => { pct.textContent = al.value + "%"; fill(al); row.classList.add("set"); auto.textContent = "авто"; onSet(compose()); };
    inp.addEventListener("input", put);
    al.addEventListener("input", put);
    inp.addEventListener("change", () => saveCfg());
    al.addEventListener("change", () => saveCfg());
    const clr = document.createElement("button"); clr.type = "button"; clr.className = "ccclr"; clr.title = "Вернуть «авто»"; clr.textContent = "✕";
    clr.onclick = (e) => { e.preventDefault(); onClear(); saveCfg(); };
    // v — сохранённый цвет или пусто («авто»); hint — подпись вместо «авто» (например «разные»)
    const show = (v, hint) => {
      row.classList.toggle("set", !!v);
      auto.textContent = hint || "авто";
      row.classList.toggle("mixed", !!hint);
      inp.value = (v || autoHex()).slice(0, 7);
      al.value = alphaOf(v); pct.textContent = al.value + "%"; fill(al);
    };
    // пипетка — первая в строке-<label>: щелчок по названию открывает её; ползунок прозрачности — сразу за ней
    row.append(lb, auto, inp, al, pct, clr);
    return { row, show };
  };
  const refreshBulk = () => bulks.forEach((b) => b.sync());

  const groups = CC_GROUPS.filter((g) => !g.only || g.only === baseOf());
  const shown = new Set(groups.flatMap((g) => g.items.map((it) => it.k)));
  const itemOf = (k) => CC_ITEMS.find((it) => it.k === k);

  // «Сразу для всех»: один цвет — во все места своей группы (все панели, все кнопки…)
  {
    const d = document.createElement("details"); d.className = "ccgrp ccbulk"; d.open = true;
    const sm = document.createElement("summary");
    const nm = document.createElement("span"); nm.textContent = "Сразу для всех";
    const n = document.createElement("small"); n.textContent = "Один цвет сразу во все места. Потом любое из них можно поправить отдельно ниже";
    sm.append(nm, n);
    const box2 = document.createElement("div"); box2.className = "ccrows";
    for (const b of CC_BULK) {
      const keys = b.keys.filter((k) => shown.has(k));
      if (!keys.length) continue;
      const first = itemOf(keys[0]);
      const r = makeRow(b.label, () => ccAuto(first),
        (v) => { for (const k of keys) { cc[k] = v; rows[k]?.show(v); } applyCfg(); syncAllDots(); },
        () => { for (const k of keys) delete cc[k]; applyCfg(); for (const k of keys) rows[k]?.show(); syncAllDots(); r.show(); });
      if (b.note) r.row.title = b.note;
      const sync = () => {
        const vals = keys.map((k) => cc[k] || "");
        const same = vals.every((v) => v === vals[0]);
        if (same) r.show(vals[0]);
        else { const v = vals.find(Boolean) || ""; r.show(v, "разные"); }
      };
      bulks.push({ sync });
      sync();
      box2.append(r.row);
    }
    d.append(sm, box2); scroll.append(d);
  }

  const groupDots = [];
  const syncAllDots = () => groupDots.forEach(([dots, keys]) => dotsOf(dots, keys));
  for (const g of groups) {
    const d = document.createElement("details"); d.className = "ccgrp";
    const sm = document.createElement("summary");
    const nm = document.createElement("span"); nm.textContent = g.name;
    const dots = document.createElement("span"); dots.className = "ccdots";
    sm.append(nm, dots);
    if (g.note) { const n = document.createElement("small"); n.textContent = g.note; sm.append(n); }
    const box2 = document.createElement("div"); box2.className = "ccrows";
    const keys = g.items.map((it) => it.k);
    for (const it of g.items) {
      const r = makeRow(it.label, () => ccAuto(it),
        (v) => { cc[it.k] = v; applyCfg(); dotsOf(dots, keys); refreshBulk(); },
        () => { delete cc[it.k]; applyCfg(); r.show(); dotsOf(dots, keys); refreshBulk(); });
      r.show(cc[it.k]);
      rows[it.k] = r;
      box2.append(r.row);
    }
    groupDots.push([dots, keys]);
    dotsOf(dots, keys);
    d.append(sm, box2); scroll.append(d);
  }
  const row = document.createElement("div"); row.className = "row";
  const reset = document.createElement("button"); reset.className = "nav"; reset.textContent = "Сбросить всё";
  const ok = document.createElement("button"); ok.className = "nav active"; ok.textContent = "Готово";
  reset.onclick = () => {
    for (const k of Object.keys(cc)) delete cc[k];
    applyCfg(); saveCfg();
    Object.values(rows).forEach((r) => r.show());
    syncAllDots(); refreshBulk();
  };
  row.append(reset, ok);
  box.append(h, p, scroll, row);
  const close = () => { document.removeEventListener("keydown", onKey, true); wrap.remove(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  ok.onclick = close;
  wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
  wrap.append(box); document.body.append(wrap);
  scroll.querySelector("details")?.setAttribute("open", "");
}
$("#ccBtn").onclick = openColorEditor;

// ---------- динамический фон ----------
// Обложка трека скачивается через Rust (fetch_bytes) и превращается в blob: — так её можно и показать, и
// разобрать на цвета (картинку с чужого адреса холст прочитать не даёт). Слоёв обложки два: новая плавно
// проявляется поверх старой. Над ними — «аура» из цветов обложки, лёгкое зерно и виньетка (styles.css, .dynbg).
var dynPal = null, dynKey = "", dynSeq = 0, dynFront = 0;     // var: applyCfg вызывается и до этой строки
const dynCache = new Map();      // coverUri → { url, soft, echo, pal }
// Размытая и подкрашенная копия обложки — один раз на маленьком холсте, а не CSS-фильтром blur в каждом кадре.
// Уменьшение до side px уже размывает; затем коробочное размытие в пикселях (работает везде, в т.ч. в WebKitGTK,
// где у холста нет ctx.filter) и увеличение до out px, чтобы при растяжке на всё окно не было «ступенек».
function boxBlur(d, w, h, r) {
  const t = new Float32Array(d.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = -r; k <= r; k++) s += d[(y * w + Math.min(w - 1, Math.max(0, x + k))) * 4 + c];
    t[(y * w + x) * 4 + c] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let k = -r; k <= r; k++) s += t[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * 4 + c];
    d[(y * w + x) * 4 + c] = s / n;
  }
}
async function dynSoft(img, side, out, r, sat, bri) {
  const a = document.createElement("canvas"); a.width = a.height = side;
  const g = a.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, side, side);
  const id = g.getImageData(0, 0, side, side), d = id.data;
  for (let i = 0; i < d.length; i += 4) {                 // насыщенность и яркость — как filter: saturate() brightness()
    const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.max(0, (L + (d[i + c] - L) * sat) * bri));
  }
  boxBlur(d, side, side, r); boxBlur(d, side, side, r);
  g.putImageData(id, 0, 0);
  const b = document.createElement("canvas"); b.width = b.height = out;
  const h = b.getContext("2d", { willReadFrequently: true });
  h.imageSmoothingQuality = "high";
  h.drawImage(a, 0, 0, out, out);
  const id2 = h.getImageData(0, 0, out, out);
  boxBlur(id2.data, out, out, Math.max(1, Math.round(out / side)));      // сглаживаем швы после увеличения
  h.putImageData(id2, 0, 0);
  const blob = await new Promise((res) => b.toBlob(res, "image/png"));
  return blob ? URL.createObjectURL(blob) : "";
}
const dynRevoke = (v) => { for (const u of [v.url, v.soft, v.echo]) if (u) URL.revokeObjectURL(u); };
async function dynArt(t) {
  const key = String(t.coverUri || "");
  let it = dynCache.get(key);
  if (it) { dynCache.delete(key); dynCache.set(key, it); return it; }          // свежие — в конец
  const src = cover(t, "400x400");
  if (!src) return null;
  const buf = await invoke("fetch_bytes", { url: src });
  const url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
  let pal = null, soft = "", echo = "";
  try { pal = await paletteFrom(url); } catch {}
  try {
    const img = new Image(); img.src = url; await img.decode();
    soft = await dynSoft(img, 40, 160, 2, 1.5, 0.72);       // большие «дышащие» слои: сильное размытие
    echo = await dynSoft(img, 72, 216, 1, 1.4, 1);          // «эхо» обложки: размытие помягче
  } catch {}
  it = { url, soft: soft || url, echo: echo || url, pal };
  dynCache.set(key, it);
  while (dynCache.size > 16) { const [k, v] = dynCache.entries().next().value; if (v.url === dynShownUrl()) break; dynRevoke(v); dynCache.delete(k); }
  return it;
}
const dynLayers = () => document.querySelectorAll("#dynBg .dyn-l");
const dynShownUrl = () => dynLayers()[dynFront]?.dataset.url || "";
function dynShow(it) {
  const box = $("#dynBg"), ls = dynLayers();
  if (dynShownUrl() !== it.url) {
    const next = ls[1 - dynFront];
    next.style.backgroundImage = `url("${it.soft}")`; next.dataset.url = it.url;
    // перезапуск «дыхания», чтобы новая обложка начинала с того же кадра
    next.classList.remove("on"); void next.offsetWidth; next.classList.add("on");
    ls[dynFront].classList.remove("on");
    dynFront = 1 - dynFront;
    const [art, echo] = box.querySelectorAll(".dyn-art i");
    if (art) art.style.backgroundImage = `url("${it.url}")`;
    if (echo) echo.style.backgroundImage = `url("${it.echo}")`;
  }
  box.classList.add("ready");
  const p = it.pal;
  if (p) {
    box.style.setProperty("--dyn-a", p.accent); box.style.setProperty("--dyn-b", p.accent2);
    dynPal = { accent: p.accent, accent2: p.accent2 };
    if (dynColorsOn()) { $("#cAccent").value = p.accent; $("#cAccent2").value = p.accent2; }
  }
  applyCfg();
}
async function dynUpdate(t, force = false) {
  const my = ++dynSeq;
  if (cfg.dyn !== true) {
    $("#dynBg").classList.remove("ready");
    if (dynPal || force) { dynPal = null; dynKey = ""; applyCfg(); }
    syncBgVideo();
    return;
  }
  syncBgVideo();
  if (!t?.coverUri) { if (force) applyCfg(); return; }        // нет обложки (трек из файла) — остаётся прежний фон
  const key = String(t.coverUri);
  if (key === dynKey && !force) return;
  try {
    const it = await dynArt(t);
    if (my !== dynSeq || !it) return;
    dynKey = key;
    dynShow(it);
  } catch { if (force) applyCfg(); }
}

// Динамический фон: основные цвета берутся из обложки (dynPal), пока пользователь не выбрал их сам —
// тогда фон по обложке остаётся, а цвета — свои (cfg.dynColors = false). Сохранённые цвета стиля не трогаются.
function dynColorsOn() { return cfg.dyn === true && cfg.dynColors !== false; }      // объявление функции: applyCfg зовут и раньше этой строки
function applyCfg() {
  const r = document.documentElement.style, base = baseOf();
  const st = dynColorsOn() && dynPal ? { ...sty(), accent: dynPal.accent, accent2: dynPal.accent2 } : sty();
  document.body.classList.toggle("dyn-on", cfg.dyn === true);
  // свой стиль, чей CSS ещё не подключён (идёт загрузка при старте), временно показывается как его основа
  document.documentElement.dataset.style = BUILTIN.includes(cfg.style) || themeReady.has(cfg.style) ? cfg.style : base;
  document.documentElement.dataset.base = base;
  // стиль без анимаций (features.animations = false) — анимации выключены, как если бы сняли галочку
  document.documentElement.dataset.anim = cfg.anim === false || !feature("animations") ? "off" : "on";
  r.setProperty("--accent", st.accent);
  r.setProperty("--accent2", st.accent2);
  const oa = onAccent(btnHi(st.accent2), st.accent2);      // кнопки залиты вторичным цветом — текст на них подбираем под него
  r.setProperty("--on-accent", oa.color);
  r.setProperty("--on-accent-shadow", base === "neon" ? oa.shadow : "none");
  r.setProperty("--glow", (base === "neon" || !BUILTIN.includes(cfg.style) ? st.glow : STYLE_DEF[cfg.style].glow) + "px");
  r.setProperty("--panel-a", st.panel / 100);
  r.setProperty("--dim", st.dim / 100);
  r.setProperty("--bgblur", cfg.blur + "px");
  loInk(st);
  const vid = curBgVideo();
  const img = curBg() && !vid ? `url("${curBg()}")` : "none";
  r.setProperty("--bg-image", img);
  const prev = vid ? bgPosters[cfg.style] : curBg();
  $("#drop").style.setProperty("--drop-img", prev ? `url("${prev}")` : "none");
  syncBgVideo();
  applyCustom();
  applyViz();
  applyHooks();
}
// ---------- возможности своих тем: ручка громкости, своя раскладка, кнопки-действия ----------
// Кнопки темы: settings whisper-music → "buttons": { "power": "wave", … }. Приложение создаёт их всегда
// (#thBtns > button.thbtn[data-th="power"]), а где они стоят и как выглядят — решает CSS темы.
// Действие нажимает обычную кнопку приложения, поэтому работает так же и так же отключается.
const TH_ACTIONS = {
  wave: ["#waveBtn", "Моя волна"], play: ["#play", "Пуск/пауза"], next: ["#next", "Следующий"], prev: ["#prev", "Предыдущий"],
  like: ["#likeBtn", "В лайки"], dislike: ["#disBtn", "Не нравится"], mute: ["#volBtn", "Выключить звук"],
  shuffle: ["#shuffleBtn", "Случайный порядок"], repeat: ["#repeatBtn", "Повтор"], full: ["#cover", "Обложка на весь экран"],
  sleep: ["#sleepBtn", "Режим сна"], more: ["#pMore", "Ещё"],
  "page:wave": ["#wave", "Моя волна"], "page:likes": ["#likes", "Лайки"], "page:stats": ["#statsBtn", "Статистика"],
  "page:settings": ["#settingsBtn", "Настройки"], "page:profile": ["#profile", "Профиль"],
  "vol-up": [null, "Громче"], "vol-down": [null, "Тише"],
};
const thState = {
  wave: () => $("#waveBtn").classList.contains("playing"),
  play: () => document.body.classList.contains("is-playing"),
  like: () => $("#likeBtn").classList.contains("on"),
  dislike: () => $("#disBtn").classList.contains("on"),
  mute: () => volume === 0,
  shuffle: () => $("#shuffleBtn").classList.contains("on"),
  repeat: () => $("#repeatBtn").classList.contains("on"),
};
let thKey = "", thObs = null;
function renderThemeButtons(list) {
  const key = JSON.stringify(list);
  if (key === thKey) return;
  thKey = key;
  let box = $("#thBtns");
  if (!list.length) { box?.remove(); thObs?.disconnect(); thObs = null; return; }
  if (!box) { box = document.createElement("div"); box.id = "thBtns"; box.className = "thbtns"; document.body.append(box); }
  box.replaceChildren(...list.map(([name, act]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "thbtn"; b.dataset.th = name; b.dataset.act = act;
    b.title = TH_ACTIONS[act][1]; b.setAttribute("aria-label", TH_ACTIONS[act][1]);
    b.onclick = () => {
      if (act === "vol-up") return setVol(volume + 0.05);
      if (act === "vol-down") return setVol(volume - 0.05);
      const el = $(TH_ACTIONS[act][0]);
      if (el && !el.disabled) el.click();
    };
    return b;
  }));
  // состояние кнопок (.on): следим за классами тех элементов, по которым оно видно
  if (!thObs) {
    thObs = new MutationObserver(thSync);
    for (const el of [document.body, $("#waveBtn"), $("#likeBtn"), $("#disBtn"), $("#shuffleBtn"), $("#repeatBtn"), ...document.querySelectorAll(".side .nav")])
      if (el) thObs.observe(el, { attributes: true, attributeFilter: ["class", "disabled"] });
  }
  thSync();
}
function thSync() {
  const box = document.getElementById("thBtns");
  if (!box) return;
  for (const b of box.children) {
    const act = b.dataset.act, src = TH_ACTIONS[act]?.[0] && $(TH_ACTIONS[act][0]);
    const on = act.startsWith("page:") ? !!src?.classList.contains("active") : !!thState[act]?.();
    b.classList.toggle("on", on);
    b.disabled = !!src?.disabled;
  }
}
function applyHooks() {
  const de = document.documentElement, kn = !!hook("volKnob"), vb = $("#volBtn");
  de.toggleAttribute("data-vol-knob", kn);
  if (kn) { vb.setAttribute("role", "slider"); vb.setAttribute("aria-valuemin", "0"); vb.setAttribute("aria-valuemax", "100"); vb.setAttribute("aria-valuenow", String(Math.round(volume * 100))); }
  else ["role", "aria-valuemin", "aria-valuemax", "aria-valuenow"].forEach((a) => vb.removeAttribute(a));
  window.layoutLock?.(!!hook("layoutFixed"));
  renderThemeButtons(hook("buttons") || []);
  window.cliMount?.(hook("console") || null);          // стиль-консоль (cli.js)
}
function saveCfg() {
  try { localStorage.setItem("ym_cfg3", JSON.stringify(cfg)); $("#setNote").textContent = ""; return true; }
  catch { $("#setNote").textContent = "Не удалось сохранить настройки: закончилось место в хранилище приложения."; return false; }
}
const SLIDERS = [["#cAccent", "accent"], ["#cAccent2", "accent2"], ["#cGlow", "glow", 1], ["#cPanel", "panel", 1], ["#cDim", "dim", 1], ["#cBlur", "blur", 1]];
const getv = (k) => (STYLE_KEYS.includes(k) ? sty()[k] : cfg[k]);
const setv = (k, v) => { if (STYLE_KEYS.includes(k)) sty()[k] = v; else cfg[k] = v; };
function syncControls() {
  for (const [id, k] of SLIDERS) $(id).value = getv(k);
  if (dynColorsOn() && dynPal) { $("#cAccent").value = dynPal.accent; $("#cAccent2").value = dynPal.accent2; }      // видно, какие цвета сейчас взяты из обложки
  $("#cViz").checked = cfg.viz;
  syncVizStyles();
  $("#cAnim").checked = cfg.anim !== false;
  $("#cDyn").checked = cfg.dyn === true;
  // цвета можно выбрать всегда: при динамическом фоне свой выбор просто заменяет цвета обложки
  document.querySelectorAll("#cAccent, #cAccent2").forEach((el) => {
    el.disabled = false;
    el.title = dynColorsOn() ? "Сейчас цвета берутся из обложки — выбери свой, и он заменит их (фон останется)" : "";
  });
  $("#paletteBtn").disabled = dynColorsOn();
  $("#paletteBtn").title = dynColorsOn() ? "Пока включён динамический фон, цвета берутся из обложки" : "";
  // ползунки и галочки — только для того, что у стиля есть (feature)
  const glow = feature("glow"), panels = feature("panelOpacity"), anim = feature("animations");
  $("#cGlow").closest("label").style.display = glow ? "" : "none";
  $("#cPanel").closest("label").style.display = panels ? "" : "none";
  $("#glassTitle").textContent = glow ? (panels ? "Стекло и свечение" : "Свечение") : "Панели";
  $("#cAnim").closest("label").style.display = anim ? "" : "none";
  document.querySelectorAll(".stylecard").forEach((b) => b.classList.toggle("on", b.dataset.style === cfg.style));
  // под списком стилей (в компактном виде): «Автор · Название» выбранного стиля
  const sel = document.querySelector(".stylecard.on"), cap = $("#styleCap");
  if (cap) cap.textContent = sel ? [sel.querySelector(".scauth")?.textContent, sel.querySelector(".scname")?.textContent].filter(Boolean).join(" · ") : "";
  fillAll();
}
// свой цвет при динамическом фоне: фон по обложке остаётся, цвета интерфейса — выбранные
function manualColors() {
  if (!dynColorsOn()) return;
  cfg.dynColors = false;
  syncControls();
  showToast("Цвета выбраны вручную, фон по обложке остался", 6000, { kind: "ok", action: { label: "Вернуть цвета обложки", fn: () => { cfg.dynColors = true; saveCfg(); applyCfg(); syncControls(); } } });
}
for (const [id, key, num] of SLIDERS) {
  const el = $(id);
  el.addEventListener("input", () => { if (key === "accent" || key === "accent2") manualColors(); setv(key, num ? +el.value : el.value); applyCfg(); });      // пока тянешь — только применяем
  el.addEventListener("change", () => saveCfg());                                                     // на диск — когда отпустил
}
document.querySelectorAll("input[type=range]").forEach((el) => el.addEventListener("input", () => fill(el)));
document.querySelectorAll(".stylecard").forEach((b) => (b.onclick = () => { cfg.style = b.dataset.style; applyCfg(); saveCfg(); syncControls(); }));

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
  if (bgPosters[st]) URL.revokeObjectURL(bgPosters[st]);
  bgUrls[st] = blob ? URL.createObjectURL(blob) : "";
  bgKinds[st] = !blob ? "" : /^video\//.test(blob.type) ? "video" : "image";
  bgPosters[st] = "";
  if (bgKinds[st] === "video") {
    const url = bgUrls[st];
    videoFrame(url).then((c) => new Promise((r) => c.toBlob(r, "image/jpeg", 0.8))).then((b) => {
      if (!b || bgUrls[st] !== url) return;
      bgPosters[st] = URL.createObjectURL(b);
      if (st === cfg.style) $("#drop").style.setProperty("--drop-img", `url("${bgPosters[st]}")`);
    }).catch(() => {});
  }
}

// ---------- видеообои (mp4 / webm, в т.ч. из Wallpaper Engine) ----------
// Видео играет только когда его реально видно. Пауза: окно свёрнуто или в трее, открыт полноэкранный плеер.
// В трее видео ещё и выгружается целиком — декодер и буферы кадров (у 4K это сотни МБ) освобождаются.
let bgUnloaded = false;
function syncBgVideo() {
  const v = $("#bgVideo"), url = curBgVideo() && cfg.dyn !== true ? curBg() : "";
  if (!url || bgUnloaded) {
    v.hidden = true;
    if (v.getAttribute("src")) { v.pause(); v.removeAttribute("src"); v.load(); }      // отпускаем декодер
    return;
  }
  v.hidden = false;
  if (v.getAttribute("src") !== url) { v.src = url; }
  const show = !document.hidden && $("#full").hidden;
  if (show) { if (v.paused) v.play().catch(() => {}); }
  else if (!v.paused) v.pause();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) bgUnloaded = false; syncBgVideo(); });
// первый кадр видео на холсте 320 px — для превью в настройках и подбора цветов
function videoFrame(url, side = 320) {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = url;
    const done = (fn, x) => { clearTimeout(tm); v.removeAttribute("src"); v.load(); fn(x); };
    const tm = setTimeout(() => done(rej, new Error("timeout")), 15000);
    v.onerror = () => done(rej, new Error("decode"));
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = () => {
      const k = side / Math.max(v.videoWidth, v.videoHeight), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(v.videoWidth * k)); c.height = Math.max(1, Math.round(v.videoHeight * k));
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      done(res, c);
    };
  });
}
// формат по первым байтам: MP4/MOV (ftyp) и WebM/MKV (EBML)
function sniffVideo(b) {
  if (b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^avi[fs]$/.test(brand) || /^(heic|heix|mif1|msf1)$/.test(brand)) return null;     // это картинки в той же обёртке
    return "video/mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return null;
}
const VIDEO_MAX_BYTES = 500 * 1048576;
async function prepareVideo(f, type) {
  if (f.size > VIDEO_MAX_BYTES) throw new Error(`Видео «${f.name}» весит ${Math.round(f.size / 1048576)} МБ — больше лимита в ${VIDEO_MAX_BYTES / 1048576} МБ.`);
  const blob = f.type === type ? f : new Blob([f], { type });
  const url = URL.createObjectURL(blob);
  try {
    const c = await videoFrame(url, 64);       // проверяем, что движок окна умеет это видео декодировать
    if (!c) throw new Error();
  } catch {
    throw new Error(`Видео «${f.name}» не воспроизводится: скорее всего, кодек H.265/HEVC или другой редкий. Подойдёт MP4 (H.264) или WebM (VP9/AV1).`);
  } finally { URL.revokeObjectURL(url); }
  return { blob, info: "Видеообои применены. Звук у них всегда выключен; пока окно свёрнуто или в трее, видео не играет." };
}

// Из набора файлов (несколько выбранных или целая папка) выбираем фон.
// Папка Wallpaper Engine: читаем project.json и берём указанный в нём файл.
async function pickBgFromFiles(files) {
  files = [...files].filter(Boolean);
  if (!files.length) return null;
  const pj = files.find((f) => f.name.toLowerCase() === "project.json");
  if (pj) {
    let meta;
    try { meta = JSON.parse(await pj.text()); } catch { throw new Error("project.json повреждён — не получилось его прочитать."); }
    const type = String(meta?.type || "").toLowerCase();
    if (type && type !== "video") throw new Error(`Это обои Wallpaper Engine типа «${type}» — их показывает только сама программа. Подойдут обои типа «video» (с файлом .mp4 или .webm).`);
    const want = String(meta?.file || "").split(/[\\/]/).pop().toLowerCase();
    const hit = files.find((f) => f.name.toLowerCase() === want);
    if (hit) return hit;
    if (files.length === 1) throw new Error(`В project.json указан файл «${meta?.file}». Выбери его вместе с project.json или перетащи сюда всю папку обоев.`);
  }
  const media = files.filter((f) => f !== pj && !/\.(json|url|txt|pdf|html?)$/i.test(f.name));
  return media.find((f) => /^video\//.test(f.type) || /\.(mp4|webm|m4v|mov|mkv)$/i.test(f.name))
    || media.find((f) => /^image\//.test(f.type)) || media[0] || null;
}
// Папку обоев (кнопка) и перетаскивание в окно принимает Rust (bg.rs): если отдать папку странице,
// WebView2 каждый раз спрашивает «Отправить N файлов на этот сайт?». Rust присылает только список имён
// (папка обходится не глубже 3 уровней), а содержимое нужного файла читается по номеру — лишнее не грузится.
function nativeFiles(list) {
  return (Array.isArray(list) ? list : []).map((e) => ({
    name: String(e.name || ""), type: "", size: Number(e.size) || 0, _id: e.id,
    async text() { return new TextDecoder().decode(new Uint8Array(await invoke("bg_read", { id: this._id, kind: "text" }))); },
  }));
}
const BG_MIME = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
};
async function loadNativeBg(list) {
  try {
    const pick = await pickBgFromFiles(nativeFiles(list));
    if (!pick) return await loadBg(null);
    bgNote("Загружаю…");
    const ext = (pick.name.split(".").pop() || "").toLowerCase();
    const lim = /^(mp4|m4v|mov|webm|mkv)$/.test(ext) ? VIDEO_MAX_BYTES : BG_MAX_BYTES;      // лимит проверяет и Rust до чтения файла
    if (pick.size > lim) throw new Error(`Файл «${pick.name}» весит ${Math.round(pick.size / 1048576)} МБ — больше лимита в ${lim / 1048576} МБ.`);
    const buf = await invoke("bg_read", { id: pick._id, kind: lim === VIDEO_MAX_BYTES ? "video" : "image" });      // потолок по сценарию держит и Rust
    return await loadBg(new File([buf], pick.name, { type: BG_MIME[ext] || "" }));
  } catch (e) { bgNote(e.message || "Не удалось прочитать файлы."); return false; }
}
async function loadBgFiles(files) {
  try { const f = await pickBgFromFiles(files); return await loadBg(f); }
  catch (e) { bgNote(e.message || "Не удалось прочитать файлы."); return false; }
}
function dataUrlToBlob(u) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u);
  if (!m) throw new Error("bad data url");
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] || "application/octet-stream" });
}

const BG_MAX_BYTES = IMG_LIMITS.maxBytes;
const BG_MAX_SIDE = 3840;
async function prepareBg(f) {
  const vt = sniffVideo(new Uint8Array(await f.slice(0, 16).arrayBuffer()));
  if (vt) return prepareVideo(f, vt);
  if (/^audio\//.test(f.type)) throw new Error("Звук как фон не поддерживается — выбери картинку, GIF или видео.");
  let g;
  try { g = imageGuard(new Uint8Array(await f.arrayBuffer())); }
  catch (e) { throw new Error(`«${f.name}»: ${e.message}`); }
  if (f.type !== g.type) f = new File([f], f.name, { type: g.type });
  let w = g.w, h = g.h;
  try { const bm = await createImageBitmap(f); w = bm.width; h = bm.height; bm.close(); }
  catch { throw new Error(`Не получилось открыть «${f.name}»: файл повреждён.`); }
  const flat = g.frames === 1 && ["image/jpeg", "image/png", "image/bmp"].includes(g.type);
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
  const isVid = /^video\//.test(f.type) || /\.(mp4|webm|m4v|mov|mkv)$/i.test(f.name);
  if (!isVid && f.size > BG_MAX_BYTES) { bgNote(`Файл «${f.name}» весит ${Math.round(f.size / 1048576)} МБ — это больше лимита в ${BG_MAX_BYTES / 1048576} МБ. Выбери файл поменьше.`); return false; }
  const st = cfg.style;
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
async function initBg() {
  try {
    if (cfg.bg) {
      const blob = cfg.bg === "idb" ? await IDB.get("bg") : dataUrlToBlob(cfg.bg);
      if (blob) { await IDB.set(bgKey(cfg.style), blob); cfg.s[cfg.style].bg = "idb"; }
      await IDB.del("bg");
    }
  } catch {}
  cfg.bg = "";
  for (const st of Object.keys(cfg.s)) {           // встроенные и свои стили
    if (cfg.s[st].bg !== "idb") continue;
    let blob = null;
    try { blob = await IDB.get(bgKey(st)); } catch {}
    if (!blob) { cfg.s[st].bg = ""; continue; }
    try {
      if (sniffVideo(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))) setBgBlob(blob, st);      // видео: проверено при добавлении
      else { imageGuard(new Uint8Array(await blob.arrayBuffer())); setBgBlob(blob, st); }
    }
    catch (e) { console.warn(`Фон стиля ${st} отклонён:`, e?.message); cfg.s[st].bg = ""; try { await IDB.del(bgKey(st)); } catch {} }
  }
  if (saveCfg()) localStorage.removeItem("ym_cfg2");
  applyCfg();
}
$("#bgFile").onchange = async (e) => { const fs = [...e.target.files]; e.target.value = ""; await loadBgFiles(fs); };
$("#bgDirBtn").onclick = async (e) => {
  e.preventDefault(); e.stopPropagation();
  try { const list = await invoke("bg_dir_pick"); if (list) await loadNativeBg(list); }
  catch (er) { bgNote("Не удалось открыть папку: " + er.message); }
};
// Перетаскивание файла или папки в окно: события приходят из Rust (bg.rs). Пока тащим над страницей
// настроек — подсвечиваем зону; бросить можно в любое место настроек.
const drop = $("#drop");
const onSettings = () => !$("#settingsPage").hidden;
window.__TAURI__.event?.listen("bg-drag", (e) => drop.classList.toggle("over", !!e.payload?.over && onSettings()));
window.__TAURI__.event?.listen("bg-drop", (e) => {
  drop.classList.remove("over");
  if (window.wmtDrop?.(e.payload?.files)) return;          // файл темы .wmt (theme.js) — принимается на любой странице
  if (!onSettings()) { showToast("Чтобы поставить фон, открой «Настройки» и перетащи файл туда"); return; }
  loadNativeBg(e.payload?.files);
});
$("#bgReset").onclick = async () => { await clearBg(); applyCfg(); saveCfg(); };
$("#cfgReset").onclick = async () => {
  const keep = cfg.style, themes = cfg.themes;
  for (const st of Object.keys(cfg.s)) await clearBg(st);
  cfg = freshCfg(); cfg.themes = themes;
  for (const t of themes) cfg.s[t.id] = { ...STYLE_DEF[t.base], cc: {} };
  cfg.style = cfg.s[keep] ? keep : "royal";
  await window.wmtRestoreDefaults?.();        // свои стили: цвета и фон — снова как в их файлах .wmt
  applyCfg(); saveCfg(); syncControls();
};
$("#cViz").onchange = (e) => { cfg.viz = e.target.checked; syncVizStyles(); applyViz(); saveCfg(); };
// список стилей визуализатора виден только когда визуализатор включён
var VIZ_NOTE = { circle: "Неровные круги вокруг кнопки: дышат с басом и вздрагивают на каждую долю.", bars: "Столбцы разной высоты по частотам: слева и справа от кнопки, бас ближе к центру." };
function syncVizStyles() {
  $("#vizStyles").hidden = !cfg.viz;
  document.querySelectorAll(".vizopt").forEach((b) => b.classList.toggle("active", b.dataset.viz === cfg.vizStyle));
  $("#vizNote").textContent = VIZ_NOTE[cfg.vizStyle] || "";
}
document.querySelectorAll(".vizopt").forEach((b) => (b.onclick = () => { cfg.vizStyle = b.dataset.viz; syncVizStyles(); saveCfg(); }));
$("#cAnim").onchange = (e) => { cfg.anim = e.target.checked; applyCfg(); saveCfg(); };
$("#cDyn").onchange = (e) => { cfg.dyn = e.target.checked; if (cfg.dyn) cfg.dynColors = true; saveCfg(); syncControls(); dynUpdate(queue[current], true); };

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
  let img;
  if (curBgVideo() && src === curBg()) img = await videoFrame(src, 160);           // видеообои — берём кадр
  else { img = new Image(); img.src = src; await img.decode(); }
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
    const w = s * (1 - Math.abs(2 * l - 1));
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

function sniffImage(b) {
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
    if (!(await loadBg(new File([bytes], "desktop-wallpaper." + kind[1], { type: kind[0] })))) return;
    const r = await pickPalette();
    if (r.ok && !r.mono) bgNote("Готово: фон с рабочего стола применён, цвета подобраны.");
  } catch (e) { bgNote(e.message || "Не удалось взять обои рабочего стола."); }
  finally { btn.disabled = false; }
};

applyCfg(); syncControls();
initBg();

const LEGACY_TOKEN_KEY = "ym_token";
async function tokenExists() {
  try { return !!(await invoke("token_exists")); } catch { return null; }
}
async function migrateLegacyToken() {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacy) return "";
  try {
    await invoke("token_store", { token: legacy });
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    return "";
  } catch (e) {
    const m = String(e?.message || e);
    console.error("Перенос старого токена не удался:", m);
    try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch {}
    return /неправильно/i.test(m)
      ? "Сохранённый токен из старой версии повреждён и удалён — войди заново."
      : "Не удалось перенести токен из старой версии в системное хранилище (" + m + "). Из соображений безопасности он удалён — войди заново.";
  }
}

// Плашка в заголовке окна: подписка Яндекс Плюс не активна (нет Плюса — не работают часть функций и качество).
// Состояние берём из /account/status: result.plus.hasPlus. Нет поля — ничего не показываем.
const PLUS_URL = "https://plus.yandex.ru/";
function updatePlusNotice(st) {
  const el = $("#plusNotice");
  if (!el) return;
  const has = st?.plus?.hasPlus;
  const inactive = has === false;
  el.hidden = !inactive;
  if (inactive) {
    $("#plusNoticeText").textContent = "Подписка Яндекс Плюс не активна. Проверьте оплату или оформите подписку";
    el.title = "Открыть страницу Яндекс Плюса";
  }
}
$("#plusNotice")?.addEventListener("click", () => { try { window.__TAURI__.opener.openUrl(PLUS_URL); } catch {} });
async function refreshPlusNotice() {
  if (!uid || offline) return;
  try { updatePlusNotice(await ym("account_status")); } catch {}
}
setInterval(refreshPlusNotice, 30 * 60 * 1000);
{
  let lastFocusCheck = 0;
  window.addEventListener("focus", () => { if (Date.now() - lastFocusCheck > 5 * 60 * 1000) { lastFocusCheck = Date.now(); refreshPlusNotice(); } });
}

async function finishLogin() {
  try {
    const st = await ym("account_status");
    uid = st.account.uid;
    updatePlusNotice(st);
  } catch (e) {
    if (/^HTTP 40[13]/.test(String(e?.message))) { try { await invoke("token_clear"); } catch {} }
    throw e;
  }
  localStorage.setItem("ym_uid", uid);
  warnPlainSecrets();
}
// Linux без «связки ключей» (Secret Service): токены лежат в файле открытым текстом (права 0600).
// Не молчим об этом (аудит F-08). Как только связка ключей появится, Rust сам перенесёт токен туда.
let plainWarned = false;
async function warnPlainSecrets() {
  if (plainWarned) return;
  let b = null;
  try { b = await invoke("secret_backend"); } catch { return; }
  if (b?.ym !== "file" && b?.wa !== "file") return;
  plainWarned = true;
  showToast("Нет системной связки ключей: токен сохранён в файл в папке настроек (открытым текстом, доступ только у тебя). "
    + "Установи GNOME Keyring, KWallet или KeePassXC — токен переедет туда сам.", 15000, { kind: "err" });
}
window.warnPlainSecrets = warnPlainSecrets;
function showLogin(msg = "") { $("#login").classList.remove("hidden"); $("#loginErr").textContent = msg; }
function afterLogin() { $("#login").classList.add("hidden"); goTop(showLikes); restorePlayer(); loadLikedIds(); loadDislikedIds(); }

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

$("#getToken").onclick = (e) => { e.preventDefault(); window.__TAURI__.opener.openUrl(OAUTH_URL); };
$("#loginBtn").onclick = async () => {
  try {
    await invoke("token_store", { token: $("#tokenInput").value });
    $("#tokenInput").value = "";
    await finishLogin();
    afterLogin();
  } catch (e) { showLogin("Не удалось войти: " + (e?.message || e)); }
};
// выход из аккаунта — только после подтверждения в окне (Esc, «Отмена» или клик мимо окна — остаёмся)
$("#profile").onclick = async () => {
  const ok = await modal({
    title: "Выйти из аккаунта?",
    text: "Вход будет сброшен на этом компьютере. Чтобы снова слушать музыку, нужно будет войти в Яндекс заново.",
    ok: "Выйти", danger: true,
  });
  if (!ok) return;
  // token_clear удаляет токен из системного хранилища и cookies Яндекса (иначе Яндекс пускал бы в аккаунт без пароля)
  try { await invoke("token_clear"); }
  catch (e) { showToast("Не удалось удалить токен из системного хранилища: " + (e?.message || e) + ". Выход не выполнен — попробуй ещё раз.", 6000, { kind: "err" }); return; }   // не делаем вид, что вышли
  await forgetAccountData();
  location.reload();
};
// Всё, что относится к аккаунту: очередь и место в треке, лайки, закладки, станция волны, «уже слышал», история
// прослушивания и поиска, свои обложки плейлистов. Настройки приложения, стили и скачанные треки остаются.
const ACCOUNT_KEYS = ["ym_uid", "ym_last", "ym_liked_ids", "ym_pins", "ym_heard", "ym_wave_seed", "ym_search_hist", "ym_history"];
async function forgetAccountData() {
  for (const k of [...ACCOUNT_KEYS, LEGACY_TOKEN_KEY]) { try { localStorage.removeItem(k); } catch {} }
  try {
    await IDB.tx("readwrite", (s) => {
      const r = s.openCursor();
      r.onsuccess = () => { const c = r.result; if (!c) return; if (String(c.key).startsWith("plcover:")) c.delete(); c.continue(); };
      return null;
    });
  } catch {}
}

const cover = (t, size = "100x100") => (t?.coverUri ? safeUrl("https://" + String(t.coverUri).replace("%%", size)) : "");
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
    if (a.id) s.onclick = (e) => { e.stopPropagation(); navigate(() => showArtist(a.id)); };   // у трека, восстановленного из имени файла, номера артиста нет
    el.append(s);
  });
}
const albumOf = (t) => t?.albums?.[0]?.id;

function renderList(tracks, append = false, opts = {}) {
  const list = opts.target || $("#list");
  if (!append) { if (opts.target) opts.arr.length = 0; else shown = []; list.innerHTML = ""; }
  const arr = opts.target ? opts.arr : shown;
  for (const t of tracks) {
    const i = arr.push(t) - 1;
    const li = document.createElement("li");
    li.dataset.id = t.id;
    if (String(t.id) === String(playingId)) li.classList.add("playing");
    if (opts.grip) li.append(opts.grip(li, i));
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
    const mb = document.createElement("button");
    mb.className = "morebtn"; mb.title = "Ещё"; mb.innerHTML = ICON.more;
    mb.onclick = (e) => { e.stopPropagation(); openTrackMenu(t, mb, opts.menuCtx ? opts.menuCtx(i) : null); };
    if (opts.extra) li.append(opts.extra(t, li));
    li.append(hb, mb);
    syncGotRow(li);
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
  if (vizFullOn) setVizFull(false);
  vizStop();
  $("#stWrap").hidden = true; $("#waveInfo").hidden = true;
  $("#stations").hidden = true;
  document.querySelector(".main").classList.remove("wavemode");
  shown = []; $("#list").innerHTML = ""; $("#list").hidden = false;
  $("#more").hidden = true; $("#status").textContent = "";
  $("#chips").hidden = true; $("#lkFind").hidden = true; $("#lastAlbum").hidden = true; $("#similar").hidden = true;
  $("#wavePage").hidden = true; $("#settingsPage").hidden = true; $("#statsPage").hidden = true;
  $("#plPage").hidden = true; $("#plBar").hidden = true; $("#plRecs").hidden = true; $("#plCreateBtn").hidden = true;
  curPl = null; recArr.length = 0; $("#plRecList").innerHTML = "";
  document.querySelector(".main").scrollTop = 0;
}
function setActive(id, page) {        // page — имя страницы для CSS, когда в боковой панели ничего не подсвечено (артист, альбом)
  document.querySelectorAll(".side .nav").forEach((b) => b.classList.toggle("active", b.id === id));
  document.querySelector(".main").dataset.page = page || id || "";
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
    const sm = document.createElement("small"); sm.textContent = sub || ""; d.append(sm);
    if (onClose) {
      const x = document.createElement("i"); x.textContent = "✕"; x.title = "Открепить";
      x.onclick = (e) => { e.stopPropagation(); onClose(); };
      d.append(x);
    }
    d.insertAdjacentHTML("beforeend", `<span class="lodeco lo-tabbow" aria-hidden="true">${LO.bow2}</span>`);
    d.onclick = fn; box.append(d);
  };
  mk("Лайки", "likes", () => { likesQuery = ""; goTop(showLikes); }, null, "♥");
  for (const p of pins) {
    const open = p.type === "artist" ? () => showArtist(p.id) : p.type === "playlist" ? () => showPlaylist(p.id) : () => showAlbum(p.id);
    mk(p.title, pinKey(p.type, p.id), () => goTop(open), () => unpin(p.type, p.id), p.type === "artist" ? "♪" : p.type === "playlist" ? "♫" : roman(p.year) || "†");
  }
  // открытая закладка всегда в видимой части полосы (полоса прокручивается вбок, если закладки не помещаются)
  const on = box.querySelector(".tab.active");
  if (on) {
    const l = on.offsetLeft - box.offsetLeft, r = l + on.offsetWidth;
    if (l < box.scrollLeft) box.scrollLeft = l - 8;
    else if (r > box.scrollLeft + box.clientWidth) box.scrollLeft = r - box.clientWidth + 8;
  }
}
// закладок больше, чем помещается: полоса прокрутки у них скрыта, поэтому их листает обычное колесо мыши
$("#tabs").addEventListener("wheel", (e) => {
  const box = e.currentTarget;
  if (box.scrollWidth <= box.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;      // тачпад листает вбок сам
  e.preventDefault();
  box.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
}, { passive: false });
var trayPlaying = null;
// Переход между треками (загрузка следующего, повтор после сбоя, дозагрузка волны). Всё это время для Rust
// музыка «играет»: иначе в трее режим экономии через 1,5 с замораживал страницу (TrySuspend) посреди загрузки
// следующего трека — и волна стояла, пока окно не откроешь и не нажмёшь «назад»/«вперёд» или не обновишь страницу.
let transit = false, transitT = 0;
function setTransit(on) {
  clearTimeout(transitT);
  transit = on;
  if (on) transitT = setTimeout(() => { transit = false; syncIcons(); }, 180000);     // страховка: не держим страницу бодрой вечно
  if (audio) syncIcons();
}
function syncIcons() {
  const playing = !audio.paused;
  const active = playing || transit;
  document.body.classList.toggle("is-playing", playing);
  $("#play").innerHTML = playing ? ICON.pause : ICON.play;
  $("#fPlay").innerHTML = playing ? ICON.pause : ICON.play;
  $("#waveBtn").innerHTML = wave.on && playing ? ICON.pause : ICON.play;
  $("#waveBtn").classList.toggle("playing", wave.on && playing);
  waveOrbitsSync();
  window.discordPush?.();                 // Discord RPC (discord.js), если включён
  window.miniPush?.();                    // мини-плеер у значка в трее (traymini.js)
  if (active !== trayPlaying) { trayPlaying = active; Promise.resolve(invoke("tray_playing", { playing: active })).catch(() => {}); }   // в трей — только при смене
  thumbSync();
}
// Кнопки под миниатюрой окна на панели задач Windows (thumbbar.rs): «В лайки», «Назад», «Пауза/Играть», «Вперёд».
// В Rust отправляется только изменившееся состояние.
var thumbKey = "";       // var: syncIcons может сработать раньше этой строки
function thumbSync() {
  const t = queue[current];
  const st = { has: !!t, playing: !!audio && !audio.paused, liked: !!t && likedIds.has(String(t.id)) };
  const k = JSON.stringify(st);
  if (k === thumbKey) return;
  thumbKey = k;
  Promise.resolve(invoke("thumbbar_state", st)).catch(() => {});
}
// окно ушло в трей: Rust переводит движок окна в режим экономии; здесь отпускаем то, что легко загрузить заново
window.__TAURI__.event?.listen("power-save", () => {
  bgUnloaded = true; syncBgVideo();          // видеообои выгружаются полностью до показа окна
  lyricsCache.clear(); artistCache.clear();
  if (audio?.paused && curBlob && !audioViz) { URL.revokeObjectURL(curBlob); curBlob = null; }
});
window.__TAURI__.event?.listen("tray-ctl", (e) => {
  if (e.payload === "prev") $("#prev").click();
  else if (e.payload === "next") $("#next").click();
  else if (e.payload === "toggle") togglePlay();
  else if (e.payload === "shuffle") { if (!$("#shuffleBtn").disabled) $("#shuffleBtn").click(); }      // из мини-плеера
  else if (e.payload === "repeat") $("#repeatBtn").click();
  // глобальные горячие клавиши (hotkeys.js / hotkeys.rs)
  else if (e.payload === "vol_up") setVol(volume + 0.05);
  else if (e.payload === "vol_down") setVol(volume - 0.05);
  else if (e.payload === "mute") $("#volBtn").click();
  else if (e.payload === "seek_fwd" || e.payload === "seek_back") {
    if (audio && !needLoad && isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration - 0.5, audio.currentTime + (e.payload === "seek_fwd" ? 10 : -10)));
  } else if (e.payload === "like") { if (queue[current]) toggleLike(queue[current]); }
});

function navigate(fn) { if (view) hist.push(view); view = fn; fn(); }
function goTop(fn) { hist.length = 0; view = fn; fn(); }
$("#likes").onclick = () => { likesQuery = ""; goTop(showLikes); };
$("#wave").onclick = () => goTop(showWave);
$("#settingsBtn").onclick = () => goTop(showSettings);
$("#statsBtn").onclick = () => goTop(showStats);
$("#back").onclick = () => { const p = hist.pop(); if (p) { view = p; p(); } else goTop(showLikes); };

async function showLikes(tab = likesTab) {
  const my = ++nav;
  likesTab = tab === "playlists" ? "playlists" : "likes";
  setHead({ title: "Лайки" }); setActive("likes"); renderTabs("likes"); resetView();
  $("#search").value = "";
  setChips([["likes", "♥ Лайки"], ["playlists", "≡ Мои плейлисты"]], likesTab, (t) => { if (t !== likesTab) { view = () => showLikes(t); view(); } });
  if (likesTab === "playlists") return showMyPlaylists(my);
  lkFindShow();
  if (likes.done) { likesSrc = likes.tracks; return renderLikes(); }
  likesSrc = [];
  $("#status").textContent = "Загрузка…";
  try {
    const lib = await ym("likes");
    setOffline(false);
    const ids = rememberLikes(lib).map((t) => `${t.id}:${t.albumId}`);
    const acc = [];
    for (let i = 0; i < ids.length; i += 100) {
      const tracks = await ym("tracks", { form: { "track-ids": ids.slice(i, i + 100).join(",") } });
      if (my !== nav) return;
      acc.push(...tracks); likesSrc = acc;
      renderList(likesFilter(tracks), i > 0, LK);
      lkFindCount();
      $("#status").textContent = i + 100 < ids.length ? `Загружено ${acc.length} из ${ids.length}…` : "";
    }
    likes.tracks = mergeLikesAdded(acc); likes.done = true; likesSrc = likes.tracks;
    if (likes.tracks !== acc) redrawLikes(); else lkFindCount(true);
    backfillMeta(acc);
  } catch (e) {
    if (my !== nav) return;
    if (isNetErr(e)) return showOfflineLikes(my);
    $("#status").textContent = "Ошибка: " + e.message;
  }
}

// Новый лайк сразу появляется сверху открытой страницы «Лайки» (прокрутка не сбивается).
// Снятый лайк строку не убирает — сердечко гаснет, и трек можно тут же лайкнуть обратно.
const likesAdded = [];
const likesOpen = () => document.querySelector(".main").dataset.page === "likes" && likesTab === "likes" && !$("#list").hidden;
function redrawLikes() {
  if (!likesOpen()) return;
  const main = document.querySelector(".main"), top = main.scrollTop;
  likesSrc = likes.tracks;
  renderLikes();
  main.scrollTop = top;
}

// ---------- поиск по лайкам ----------
// Ищет по названию (с версией), артистам и альбомам; без учёта регистра и «ё». Несколько слов — все должны найтись
// (в любом порядке). Включённый трек из найденного ставит в очередь только найденные треки.
const normQ = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const hayCache = new WeakMap();
function trackHay(t) {
  let h = hayCache.get(t);
  if (h === undefined) {
    h = normQ([t.title, t.version, ...(t.artists || []).map((a) => a.name), ...(t.albums || []).map((a) => a.title)].filter(Boolean).join(" "));
    hayCache.set(t, h);
  }
  return h;
}
function likesFilter(tracks) {
  const words = normQ(likesQuery).split(" ").filter(Boolean);
  if (!words.length) return tracks;
  return tracks.filter((t) => { const h = trackHay(t); return words.every((w) => h.includes(w)); });
}
function lkFindCount(final = false) {
  const c = $("#lkFindCnt");
  if (!normQ(likesQuery)) { c.textContent = ""; return; }
  const n = shown.length;
  c.textContent = `${n} из ${likesSrc.length}`;
  if (!n && (final || likes.done)) $("#status").textContent = "Ничего не найдено";
  else if ($("#status").textContent === "Ничего не найдено") $("#status").textContent = "";
}
function renderLikes() {
  renderList(likesFilter(likesSrc), false, LK);
  lkFindCount(true);
}
function lkFindShow() {
  $("#lkFind").hidden = false;
  const inp = $("#lkFindIn");
  if (inp.value !== likesQuery) inp.value = likesQuery;
  $("#lkFindCnt").textContent = "";
}
let lkFindT = 0;
$("#lkFindIn").addEventListener("input", (e) => {
  clearTimeout(lkFindT);
  const v = e.target.value;
  lkFindT = setTimeout(() => {
    if (normQ(v) === normQ(likesQuery)) { likesQuery = v; return; }
    likesQuery = v;
    if (!likesOpen()) return;
    document.querySelector(".main").scrollTop = 0;
    if ($("#status").textContent === "Ничего не найдено") $("#status").textContent = "";
    renderLikes();
  }, 120);
});
$("#lkFindIn").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    if (e.target.value) { e.target.value = ""; e.target.dispatchEvent(new Event("input")); }
    else e.target.blur();
  } else if (e.key === "Enter") {
    // Enter — включить первый найденный трек
    clearTimeout(lkFindT); likesQuery = e.target.value; renderLikes();
    $("#list li")?.click();
  }
});
// Лайки, поставленные во время загрузки списка (его номера уже были получены), — в начало.
function mergeLikesAdded(acc) {
  const have = new Set(acc.map((x) => String(x.id)));
  const extra = likesAdded.splice(0).filter((x) => likedIds.has(String(x.id)) && !have.has(String(x.id)));
  return extra.length ? [...extra.reverse(), ...acc] : acc;
}

// Список лайков (новые сверху) запоминается: без сети по нему расставляются сердечки и порядок скачанных треков.
function rememberLikes(lib) {
  const list = lib.library.tracks
    .slice()
    .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
  likedIds = new Set(list.map((t) => String(t.id)));
  try { localStorage.setItem("ym_liked_ids", JSON.stringify(list.map((t) => String(t.id)))); } catch {}
  return list;
}

// ---------- офлайн: «Лайки» из скачанных треков ----------
// Описание трека берётся из индекса скачанного (сохраняется при скачивании); у старых загрузок
// его может не быть — тогда название и исполнители восстанавливаются из имени файла «Исполнитель — Название».
function offlineTrack(it) {
  const m = it.meta && typeof it.meta === "object" && it.meta.title ? it.meta : null;
  if (m) return { ...m, id: it.id };
  const name = String(it.name || it.id).replace(/ \(\d+\)$/, "");
  const k = name.indexOf(" — ");
  if (k < 0) return { id: it.id, title: name, artists: [] };
  return { id: it.id, title: name.slice(k + 3), artists: name.slice(0, k).split(", ").filter(Boolean).map((n) => ({ name: n })) };
}
async function offlineLikes() {
  let items = [];
  try { items = await invoke("downloaded_tracks"); } catch { return []; }
  got.clear(); for (const it of items) got.add(String(it.id));
  const rank = new Map(lsJSON("ym_liked_ids", [], Array.isArray).map((id, i) => [String(id), i]));
  // сначала лайкнутые — в порядке лайков, затем остальные скачанные — новые сверху
  items.sort((a, b) => {
    const ra = rank.get(String(a.id)), rb = rank.get(String(b.id));
    if (ra !== undefined || rb !== undefined) return (ra ?? Infinity) - (rb ?? Infinity) || 0;
    return (b.ts || 0) - (a.ts || 0);
  });
  return items.map(offlineTrack);
}
async function showOfflineLikes(my) {
  const tracks = await offlineLikes();
  if (my !== nav) return;
  setOffline(true);
  likesSrc = tracks;
  renderLikes();
  if (tracks.length && normQ(likesQuery) && !shown.length) return;
  $("#status").textContent = tracks.length
    ? `Нет связи с Яндекс Музыкой — показаны скачанные треки (${tracks.length}).`
    : "Нет связи с Яндекс Музыкой, а скачанных треков пока нет.";
}

async function loadAllLikes(onProgress, stale) {
  if (likes.done) return likes.tracks;
  const lib = await ym("likes");
  const ids = rememberLikes(lib).map((t) => `${t.id}:${t.albumId}`);
  const acc = [];
  for (let i = 0; i < ids.length; i += 100) {
    const tracks = await ym("tracks", { form: { "track-ids": ids.slice(i, i + 100).join(",") } });
    if (stale()) return null;
    acc.push(...tracks);
    onProgress(acc.length, ids.length);
  }
  likes.tracks = mergeLikesAdded(acc); likes.done = true;
  return likes.tracks;
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
      if (!e.img) e.img = artistImg(a) || cover(t, "200x200");
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
    artists: [...artists.values()].filter((e) => e.count >= 2).sort(byCount).slice(0, 5),
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
function fmtHours(ms) {
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
function donutColors() {
  return [
    "var(--accent)", "var(--accent2)",
    "color-mix(in srgb, var(--accent) 50%, var(--accent2))",
    "color-mix(in srgb, var(--accent) 55%, #fff)",
    "color-mix(in srgb, var(--accent2) 55%, #000)",
  ];
}
async function playAlbumById(al) {
  try {
    const a = await ym("album", { id: al.id });
    const tracks = (a.volumes || []).flat();
    tracks.forEach((t) => { if (!t.coverUri) t.coverUri = a.coverUri; });
    if (!tracks.length) return;
    wave.on = false; queue = tracks; playCtx = "album"; playAlbum = { id: a.id, title: a.title }; play(0);
  } catch (e) { $("#stNote").textContent = "Не удалось включить альбом: " + e.message; }
}
async function showStats() {
  const my = ++nav;
  setHead({ title: "Статистика" }); setActive("statsBtn"); renderTabs(false); resetView();
  $("#list").hidden = true; $("#statsPage").hidden = false; $("#statsBody").hidden = true; $("#lsBody").hidden = true;
  // «Записывать статистику» включена — страница прослушиваний (listenstats.js); вкладка «Лайки» — как ниже
  if (window.lstatsShow && (await window.lstatsShow(my))) return;
  if (my !== nav) return;
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
    if (i === 0) d.querySelector(".rank").insertAdjacentHTML("beforeend", ICONS.crown);
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

function setHint(text) { $("#waveHint").textContent = text; $("#waveHint").hidden = false; $("#nowplay").hidden = true; }
function showNow(t) {
  $("#npTitle").textContent = t.title;
  $("#npTitle").classList.toggle("link", !!albumOf(t));
  fillArtists($("#npArtist"), t);
  $("#nowplay").hidden = false; $("#waveHint").hidden = true;
}
$("#npTitle").onclick = () => { const id = albumOf(queue[current]); if (id) navigate(() => showAlbum(id)); };

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
  ym("rotor_feedback", {
    id: wave.session,
    json: { event: { type, timestamp: new Date().toISOString(), trackId: String(t.id), ...extra }, batchId: wave.batch },
  }).catch(() => {});
}
function markHeard(t) {
  heard.add(String(t.id));
  if (heard.size > 600) heard.delete(heard.values().next().value);
  try { localStorage.setItem("ym_heard", JSON.stringify([...heard])); } catch {}
}
const trackList = (r) => (r.sequence || []).map((s) => s.track).filter(Boolean);

// Дозагрузка «Моей волны». Через несколько часов rotor-сессия Яндекса протухает (или сеть мигает) — раньше ошибка
// глотала молча, очередь не пополнялась и после последнего трека воспроизведение просто останавливалось.
// Теперь: продолжаем сессию → при ошибке/пустом ответе заводим новую сессию по тому же seed (до 3 попыток).
let waveMoreP = null;
function waveMore() {
  if (!wave.on) return Promise.resolve(false);
  return waveMoreP ||= waveMoreRun().finally(() => { waveMoreP = null; });
}
async function waveMoreRun() {
  wave.loading = true;
  const q = wave.queue;
  let added = 0;
  try {
    const have = new Set(q.map((t) => String(t.id)));
    for (let k = 0; k < 3 && !added; k++) {
      if (k) await new Promise((r) => setTimeout(r, 1500 * k));
      if (wave.queue !== q || !wave.on) return false;
      try {
        let r;
        if (wave.session && k === 0) {
          r = await ym("rotor_tracks", { id: wave.session, json: { queue: [String(q[q.length - 1].id)] } });
        } else {
          r = await ym("rotor_new", { json: { seeds: [wave.seed], includeTracksInResponse: true } });
          wave.session = r.radioSessionId;
        }
        wave.batch = r.batchId;
        const incoming = trackList(r).filter((t) => !have.has(String(t.id)) && !dislikedIds.has(String(t.id)));
        const fresh = incoming.filter((t) => !heard.has(String(t.id)));
        const add = fresh.length ? fresh : incoming;
        if (wave.queue !== q) return false;
        for (const t of add) have.add(String(t.id));
        q.push(...add);
        added = add.length;
      } catch {}
      if (!added) wave.session = null;        // сессия не отдала новых треков — в следующей попытке начнём новую
    }
  } finally { wave.loading = false; }
  if (added) window.qRefresh?.();
  return added > 0;
}

async function waveStart(autoplay = true) {
  const r = await ym("rotor_new", { json: { seeds: [wave.seed], includeTracksInResponse: true } });
  const session = r.radioSessionId;
  const okT = (t) => !dislikedIds.has(String(t.id));
  let batch = r.batchId, tracks = trackList(r).filter(okT);
  let fresh = tracks.filter((t) => !heard.has(String(t.id)));
  for (let k = 0; k < 3 && fresh.length < 3 && tracks.length; k++) {
    const more = await ym("rotor_tracks", { id: session, json: { queue: [String(tracks[tracks.length - 1].id)] } });
    batch = more.batchId;
    const have = new Set(tracks.map((t) => String(t.id)));
    tracks = tracks.concat(trackList(more).filter((t) => okT(t) && !have.has(String(t.id))));
    fresh = tracks.filter((t) => !heard.has(String(t.id)));
  }
  if (!fresh.length) fresh = tracks;
  if (!fresh.length) throw new Error("волна не вернула треков");
  if (!autoplay && current !== -1) return;
  Object.assign(wave, { on: true, session, batch, queue: fresh, pos: -1 });
  playCtx = "wave";
  queue = fresh;
  if (autoplay) play(0);
  else { current = 0; needLoad = true; showTrack(fresh[0]); }
}

$("#waveBtn").onclick = async () => {
  if (wave.on) { togglePlay(); return; }
  try {
    if (wave.session && wave.queue.length) {
      wave.on = true; queue = wave.queue; playCtx = "wave";
      const next = wave.pos + 1;
      if (next >= queue.length) await waveMore();
      if (next < queue.length) { play(next); return; }
      wave.on = false;
    }
    await waveStart();
  } catch (e) { wave.on = false; setHint("Не удалось запустить: " + e.message); }
};

const GROUPS = [["genre", "Жанры"], ["subgenre", "Поджанры"], ["mood", "Настроение"], ["character", "Характер"], ["language", "Язык"]];
const stations = { loaded: false, groups: {}, tab: "genre" };
const GENRE_SKIP = new Set(["all", "other", "holiday", "fairytales", "poemsforchildren", "podcasts", "audiobooks", "fiction",
  "nonfictionliterature", "booksnotinrussian", "arabicpoetry", "islamicgenre"]);
const WAVE_SETTINGS = [["moodEnergy", "mood"], ["diversity", "character"], ["language", "language"]];

async function loadStations(force = false) {
  if (stations.loaded && !force) return;
  const [gr, ws] = await Promise.allSettled([ym("genres"), ym("wave_settings", { query: { language: "ru" } })]);
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
  const lbl = document.createElement("span"); lbl.className = "lbl"; lbl.textContent = open ? "Закрыть список" : label;
  $("#stBtn").replaceChildren(lbl);
  $("#stBtn").title = open ? "" : label;
  $("#stBtn").classList.toggle("album", !!wave.album && !open);
  $("#stWrap").classList.toggle("album", !!wave.album);
  const custom = !!(wave.name || wave.album);
  $("#stReset").hidden = !custom;
  $("#stWrap").classList.toggle("has-reset", custom);
}
function setStations(open) { $("#stations").hidden = !open; updateStBtn(); if (open) fitStations(); }
function fitStations() {
  const box = $("#stations");
  if (box.hidden) return;
  const bottom = document.querySelector(".main").getBoundingClientRect().bottom;
  const room = bottom - box.getBoundingClientRect().top - 8;
  box.style.maxHeight = Math.max(240, Math.min(room, window.innerHeight * 0.5)) + "px";
}
window.addEventListener("resize", fitStations);

async function pickStation(seed, name) {
  Object.assign(wave, { seed, name, album: null, session: null, queue: [], pos: -1, on: false });
  try { localStorage.setItem("ym_wave_seed", JSON.stringify({ seed, name })); } catch {}
  setStations(false);
  try { await waveStart(); } catch (e) { wave.on = false; setHint("Не удалось запустить: " + e.message); }
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { setStations(false); closeFull(); } });
document.addEventListener("click", (e) => {
  const path = e.composedPath();
  if (!$("#stations").hidden && !path.includes($("#stations")) && !path.includes($("#stBtn"))) setStations(false);
});
$("#artistWaveBtn").onclick = () => {
  const it = artistWaveItem; if (!it) return;
  showWave();
  pickStation("artist:" + it.id, it.name);
};
$("#stReset").onclick = () => pickStation(DEFAULT_SEED, "");

async function onQueueEnd() {
  if (wave.on || playCtx !== "album" || !playAlbum?.id) { setTransit(false); return; }
  const al = playAlbum; playAlbum = null;
  const prev = { seed: wave.seed, name: wave.name, album: wave.album };
  Object.assign(wave, { seed: "album:" + al.id, name: "", album: { id: al.id, title: al.title || "" }, session: null, queue: [], pos: -1, on: false });
  updateStBtn();
  try { await waveStart(); }
  catch { Object.assign(wave, prev, { on: false }); setTransit(false); }
  updateStBtn();
}
$("#stBtn").onclick = async () => {
  const open = $("#stations").hidden;
  setStations(open);
  if (!open) return;
  if (stations.loaded) { renderStations(); fitStations(); } else await openStationsList();
};

function showSettings() {
  ++nav;
  setHead({ title: "Настройки" }); setActive("settingsBtn"); renderTabs(false); resetView();
  $("#list").hidden = true; $("#settingsPage").hidden = false;
  fillAll();
  loadDlDir();
}

const artistCache = new Map();          // не больше 40 артистов в памяти: самый давний вылетает
const CACHE_MAX = 40;
async function loadAlbums(id) {
  const out = [];
  for (let p = 0; p < 5; p++) {
    const r = await ym("artist_albums", { id, query: { page: p, "page-size": 100, "sort-by": "year" } });
    out.push(...(r.albums || []));
    if (!r.pager || out.length >= r.pager.total) break;
  }
  return out.sort((a, b) => albumTime(b) - albumTime(a));
}
function loadArtist(id) {
  const key = String(id);
  if (artistCache.has(key)) { const v = artistCache.get(key); artistCache.delete(key); artistCache.set(key, v); return v; }
  if (artistCache.size >= CACHE_MAX) artistCache.delete(artistCache.keys().next().value);
  const p = Promise.all([
    ym("artist_brief", { id }).catch(() => null),
    loadAlbums(id).catch(() => []),
  ]).then(([info, albums]) => ({ info, albums }));
  p.catch(() => artistCache.delete(key));
  artistCache.set(key, p);
  return p;
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
  setHead({ title: "Загрузка…", back: true }); setActive(null, "artist"); renderTabs(pinKey("artist", id)); resetView();
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
      const r = await ym("artist_tracks", { id, query: { page, "page-size": 50 } });
      if (my !== nav) return;
      renderList(r.tracks, page > 0); page++;
      $("#more").hidden = !(r.pager && page * 50 < r.pager.total);
      $("#status").textContent = r.tracks.length || page > 1 ? "" : "Треков нет";
    } catch (e) { if (my === nav) $("#status").textContent = "Ошибка: " + e.message; }
  };
  $("#more").onclick = loadMore;
  loadMore();
}

async function showAlbum(id) {
  const my = ++nav;
  setHead({ title: "Загрузка…", back: true }); setActive(null, "album"); renderTabs(pinKey("album", id)); resetView();
  try {
    const a = await ym("album", { id });
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

async function loadSimilar(a, my) {
  try {
    const mainId = a.artists?.[0]?.id;
    if (!mainId) return;
    const { info, albums } = await loadArtist(mainId);
    let items = [], title = "Похожие альбомы";
    const sim = (info?.similarArtists || []).slice(0, 6);
    if (sim.length) {
      const res = await Promise.allSettled(sim.map((q) => ym("artist_albums", { id: q.id, query: { page: 0, "page-size": 20, "sort-by": "year" } })));
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
// Окно поиска открывается сразу по клику в поле. Пустой запрос — вкладка «История»;
// при вводе — сверху «Лучший результат» (поле best из ответа /search?type=all), ниже список по выбранному фильтру.
const SEARCH_HIST_KEY = "ym_search_hist", SEARCH_HIST_MAX = 30;
const searchHist = lsJSON(SEARCH_HIST_KEY, [], Array.isArray)
  .filter((x) => typeof x === "string" && x.trim())
  .map((x) => x.trim().slice(0, 200))
  .slice(0, SEARCH_HIST_MAX);
let searchQ = "", searchTab = "history";
const searchInput = $("#search");
const SEARCH_KEYS = { track: "tracks", artist: "artists", album: "albums" };
const BEST_LABEL = { track: "Трек", artist: "Артист", album: "Альбом" };
const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5.2l3.4 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function saveSearchHist() { try { localStorage.setItem(SEARCH_HIST_KEY, JSON.stringify(searchHist)); } catch {} }
function pushSearchHist(q) {
  q = String(q || "").trim().slice(0, 200);
  if (!q) return;
  const i = searchHist.findIndex((x) => x.toLowerCase() === q.toLowerCase());
  if (i >= 0) searchHist.splice(i, 1);
  searchHist.unshift(q);
  if (searchHist.length > SEARCH_HIST_MAX) searchHist.length = SEARCH_HIST_MAX;
  saveSearchHist();
}
const searchOpen = () => document.querySelector(".main").dataset.page === "search";

function searchChips(active) {
  setChips([["track", "Треки"], ["artist", "Артисты"], ["album", "Альбомы"], ["history", "История"]], active, (t) => {
    if (t === "history") return goTop(() => showSearch(searchQ, true));
    searchType = t;
    if (!searchQ) { searchInput.focus(); return; }      // без запроса фильтру нечего показывать — просто ставим курсор в поле
    goTop(() => showSearch(searchQ));
  });
}

async function showSearch(q, historyTab = false) {
  const my = ++nav;
  searchQ = q;
  const tab = (searchTab = historyTab || !q ? "history" : searchType);
  setHead({ title: tab === "history" ? "Поиск" : "Поиск: " + q });
  setActive("search"); renderTabs(false); resetView();
  searchChips(tab);
  if (tab === "history") { renderSearchHist(); return; }

  $("#status").textContent = "Ищу…";
  const type = searchType, key = SEARCH_KEYS[type];
  // type=all возвращает best — лучшее совпадение, которое Яндекс ставит первым; второй запрос — полный список по фильтру
  const [allR, listR] = await Promise.allSettled([
    ym("search", { query: { text: q, type: "all", page: 0 } }),
    ym("search", { query: { text: q, type, page: 0 } }),
  ]);
  if (my !== nav) return;
  const all = allR.status === "fulfilled" ? allR.value : null;
  const list = listR.status === "fulfilled" ? listR.value : null;
  if (!all && !list) { $("#status").textContent = "Ошибка: " + (listR.reason?.message || allR.reason?.message || "нет ответа"); return; }

  let items = (list || all)?.[key]?.results || [];
  const best = all?.best;
  const bestOk = !!(best && BEST_LABEL[best.type] && best.result && best.result.id != null);
  if (bestOk && best.type === type) items = items.filter((x) => String(x.id) !== String(best.result.id));   // не дублируем его в списке

  if (type === "track") renderList(items);
  else if (type === "artist") renderArtists(items);
  else renderAlbums(items, true);
  if (bestOk) renderBest(best.type, best.result);
  $("#status").textContent = items.length || bestOk ? "" : "Ничего не найдено";
}

// карточка «Лучший результат» — первая строка списка, поэтому resetView убирает её вместе со списком
function renderBest(type, x) {
  const li = document.createElement("li");
  li.className = "best";
  const artUri = x.cover?.uri || x.ogImage;
  const imgUrl = type === "artist" ? (artUri ? cover({ coverUri: artUri }, "200x200") : "") : cover(x, "200x200");
  li.append(mkImg(imgUrl, type === "artist" ? "rnd" : ""));

  const body = document.createElement("div");
  body.className = "bbody";
  body.innerHTML = '<small class="blabel"></small><span class="t"></span><span class="a"></span>';
  body.querySelector(".blabel").textContent = "Лучший результат · " + BEST_LABEL[type];
  const tt = body.querySelector(".t"), sub = body.querySelector(".a");
  tt.textContent = type === "artist" ? x.name : x.title;
  li.append(body);

  const pb = document.createElement("button");
  pb.className = "bplay";
  pb.innerHTML = ICON.play;

  if (type === "track") {
    li.dataset.id = x.id;                                   // подсветка «играет» и сердечко обновляются вместе со списком
    if (String(x.id) === String(playingId)) li.classList.add("playing");
    fillArtists(sub, x);
    const albumId = albumOf(x);
    if (albumId) {
      tt.classList.add("link");
      tt.onclick = (e) => { e.stopPropagation(); navigate(() => showAlbum(albumId)); };
    }
    const start = () => {
      const rest = shown.filter((t) => String(t.id) !== String(x.id));   // после него играют треки из списка ниже
      wave.on = false; queue = [x, ...rest]; playCtx = "other"; playAlbum = null; play(0);
    };
    li.onclick = start;
    pb.title = "Слушать";
    pb.onclick = (e) => { e.stopPropagation(); start(); };
    const hb = document.createElement("button");
    hb.className = "likebtn";
    setHeart(hb, likedIds.has(String(x.id)));
    hb.onclick = (e) => { e.stopPropagation(); toggleLike(x); };
    const mb = document.createElement("button");
    mb.className = "morebtn"; mb.title = "Ещё"; mb.innerHTML = ICON.more;
    mb.onclick = (e) => { e.stopPropagation(); openTrackMenu(x, mb, null); };
    li.append(pb, hb, mb);
    syncGotRow(li);
  } else if (type === "album") {
    fillArtists(sub, x);
    const info = albumInfo(x);
    if (info) sub.append(" · " + info);
    li.onclick = () => navigate(() => showAlbum(x.id));
    pb.title = "Слушать альбом";
    pb.onclick = (e) => { e.stopPropagation(); playAlbumById(x); };
    li.append(pb);
  } else {
    sub.textContent = "Артист";
    li.onclick = () => navigate(() => showArtist(x.id));
    pb.title = "Моя волна по артисту";
    pb.onclick = (e) => { e.stopPropagation(); goTop(showWave); pickStation("artist:" + x.id, x.name); };
    li.append(pb);
  }
  $("#list").prepend(li);
}

function renderSearchHist() {
  const list = $("#list");
  list.innerHTML = "";
  if (!searchHist.length) {
    $("#status").textContent = "История пуста. Сюда попадают запросы, подтверждённые Enter, и те, по которым ты что-то включил или открыл.";
    return;
  }
  $("#status").textContent = "";
  for (const q of searchHist) {
    const li = document.createElement("li");
    li.className = "histitem";
    li.innerHTML = `<span class="hico">${CLOCK_SVG}</span><span class="t"></span><button class="hdel" title="Удалить из истории">✕</button>`;
    li.querySelector(".t").textContent = q;
    li.onclick = () => { searchInput.value = q; pushSearchHist(q); goTop(() => showSearch(q)); };
    li.querySelector(".hdel").onclick = (e) => {
      e.stopPropagation();
      const i = searchHist.indexOf(q);
      if (i >= 0) searchHist.splice(i, 1);
      saveSearchHist(); renderSearchHist();
    };
    list.append(li);
  }
  const clr = document.createElement("li");
  clr.className = "histclear";
  clr.innerHTML = '<button class="nav">Очистить историю</button>';
  clr.querySelector("button").onclick = () => { searchHist.length = 0; saveSearchHist(); renderSearchHist(); };
  list.append(clr);
}

// поле поиска: окно открывается по клику/фокусу, а не после первой буквы
function openSearch() {
  if (searchOpen()) return;
  const q = searchInput.value.trim();
  goTop(() => showSearch(q));
}
searchInput.addEventListener("focus", openSearch);
searchInput.addEventListener("click", openSearch);          // поле уже в фокусе, но открыт другой раздел
searchInput.oninput = () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  searchTimer = setTimeout(() => goTop(() => showSearch(q)), q ? 350 : 0);   // стёрли всё — сразу показываем историю
};
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    pushSearchHist(q);
    if (!(searchOpen() && q && q === searchQ && searchTab !== "history")) goTop(() => showSearch(q));   // те же результаты не перезапрашиваем
  } else if (e.key === "Escape") searchInput.blur();
});
// любое действие с результатом (включить, открыть, лайкнуть) сохраняет запрос в историю
$("#list").addEventListener("click", (e) => {
  if (searchOpen() && searchQ && searchTab !== "history" && e.target.closest("li") && !e.target.closest(".histitem, .histclear")) pushSearchHist(searchQ);
}, true);

function setHeart(b, on) {
  if (b.firstChild && b.classList.contains("on") === on) return;      // уже в нужном состоянии — не перерисовываем (в лайках тысячи строк)
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
  refreshPlayerBtns();
  thumbSync();
}
async function loadLikedIds() {
  try {
    const lib = await ym("likes");
    rememberLikes(lib);
    refreshHearts();
  } catch {}
}
async function toggleLike(t) {
  if (!t) return;
  const id = String(t.id), albumId = albumOf(t), was = likedIds.has(id);
  was ? likedIds.delete(id) : likedIds.add(id);
  if (!was && dislikedIds.delete(id)) saveDislikes();       // лайк снимает «Не нравится» (Яндекс делает так же)
  refreshHearts();
  try {
    await ym(was ? "like_remove" : "like_add", { form: { "track-ids": albumId ? `${id}:${albumId}` : id } });
    if (was) likes.tracks = likes.tracks.filter((x) => String(x.id) !== id);
    else if (likes.done) { likes.tracks = [t, ...likes.tracks.filter((x) => String(x.id) !== id)]; redrawLikes(); }
    else likesAdded.push(t);              // лайки ещё грузятся — трек добавится, когда загрузка закончится
  } catch (e) {
    was ? likedIds.add(id) : likedIds.delete(id);
    refreshHearts();
    $("#status").textContent = "Не удалось изменить лайк: " + e.message;
  }
}
$("#likeBtn").onclick = () => toggleLike(queue[current]);

function rememberDislikes(lib) {
  const ids = (lib?.library?.tracks || []).map((t) => String(t.id));
  dislikedIds = new Set(ids);
  try { localStorage.setItem("ym_disliked_ids", JSON.stringify(ids)); } catch {}
}
async function loadDislikedIds() {
  try { rememberDislikes(await ym("dislikes")); refreshPlayerBtns(); } catch {}
}
function saveDislikes() { try { localStorage.setItem("ym_disliked_ids", JSON.stringify([...dislikedIds])); } catch {} }
// «Не нравится»: трек уходит в дизлайки Яндекса (волна его больше не предложит), из лайков он убирается,
// а если он сейчас играет — сразу включается следующий.
async function toggleDislike(t) {
  if (!t) return;
  const id = String(t.id), albumId = albumOf(t), was = dislikedIds.has(id), wasLiked = likedIds.has(id);
  const isCur = queue[current] && String(queue[current].id) === id;
  was ? dislikedIds.delete(id) : dislikedIds.add(id);
  if (!was && wasLiked) likedIds.delete(id);
  saveDislikes(); refreshHearts();
  if (!was && isCur) $("#next").click();
  try {
    await ym(was ? "dislike_remove" : "dislike_add", { form: { "track-ids": albumId ? `${id}:${albumId}` : id } });
    if (!was && wasLiked) { likes.tracks = likes.tracks.filter((x) => String(x.id) !== id); redrawLikes(); }
    if (!was) showToast(`«${t.title}» — не нравится`, 5000, { kind: "ok", action: { label: "Отменить", fn: () => { if (dislikedIds.has(id)) toggleDislike(t); } } });
  } catch (e) {
    was ? dislikedIds.add(id) : dislikedIds.delete(id);
    if (!was && wasLiked) likedIds.add(id);
    saveDislikes(); refreshHearts();
    $("#status").textContent = "Не удалось изменить «Не нравится»: " + e.message;
  }
}

const modesActive = () => !wave.on && (playCtx === "likes" || playCtx === "album" || playCtx === "playlist");
const effRepeat = () => (modesActive() ? repeat : repeat === 2 ? 2 : 0);
function buildOrder() {
  order = queue.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const k = order.indexOf(current);
  if (k > 0) [order[0], order[k]] = [order[k], order[0]];
  ordPos = 0; orderFor = queue;
}
function nextIndex(auto) {
  if (auto && effRepeat() === 2) return current;
  if (!modesActive()) return current + 1;
  if (shuffle) {
    if (orderFor !== queue || order.length !== queue.length || order[ordPos] !== current) buildOrder();
    if (ordPos + 1 < order.length) return order[ordPos + 1];
    if (repeat === 1) { buildOrder(); return order.length > 1 ? order[1] : current; }
    return -1;
  }
  if (current + 1 < queue.length) return current + 1;
  return repeat === 1 ? 0 : -1;
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
  window.miniPush?.();
}
$("#shuffleBtn").onclick = () => { shuffle = !shuffle; if (shuffle) buildOrder(); saveModes(); updateModes(); };
$("#repeatBtn").onclick = () => { repeat = modesActive() ? (repeat + 1) % 3 : repeat === 2 ? 0 : 2; saveModes(); updateModes(); };

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
// Запрос текста и сам файл текста по ссылке из ответа берёт Rust (net.rs, ym_lyrics).
async function lyricsRaw(id, fmt) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = await lyricsSign(id, ts);
  return await invoke("ym_lyrics", { id: String(id), format: fmt, timeStamp: ts, sign });
}
async function fetchLyrics(id) {
  let body;
  try { body = await lyricsRaw(id, "LRC"); }
  catch { try { body = await lyricsRaw(id, "TEXT"); } catch { return { type: "none" }; } }
  const lines = parseLrc(body);
  if (lines.length >= 3) return { type: "lrc", lines };
  const text = body.replace(/\[[^\]]*\]/g, "").replace(/\r/g, "").trim();
  return text ? { type: "text", text } : { type: "none" };
}

// ---------- источники текста ----------
// Яндекс — основной; LRCLIB (lrclib.net, открытая база, часто с синхронизацией) — второй, запрос идёт через Rust
// (lyrics.rs). Если у выбранного источника текста нет, берётся другой; если текста нет нигде (или нет сети) —
// на весь экран показывается обложка.
const LYR_SRCS = ["yandex", "lrclib"];
const LYR_NAME = { yandex: "Яндекс", lrclib: "LRCLIB" };
let lyrPref = (() => { try { const v = localStorage.getItem("ym_lyr_src"); return LYR_SRCS.includes(v) ? v : "yandex"; } catch { return "yandex"; } })();
let lyrShown = "";            // источник, чей текст сейчас на экране
async function fetchLrclib(t) {
  const r = await invoke("lyrics_lrclib", {
    artist: (t.artists || []).map((a) => a?.name).filter(Boolean).join(", "),
    title: String(t.title || ""),
    album: t.albums?.[0]?.title || null,
    duration: t.durationMs ? t.durationMs / 1000 : null,
  });
  if (!r) return { type: "none" };
  if (r.synced) { const lines = parseLrc(r.synced); if (lines.length >= 3) return { type: "lrc", lines }; }
  if (r.plain && r.plain.trim()) return { type: "text", text: r.plain.replace(/\r/g, "").trim() };
  if (r.instrumental) return { type: "instr" };
  return { type: "none" };
}
async function lyricsFrom(t, src) {
  const key = String(t.id) + ":" + src;
  let res = lyricsCache.get(key);
  if (res) return res;
  try { res = src === "lrclib" ? await fetchLrclib(t) : await fetchLyrics(t.id); }
  catch { return { type: "none", err: true }; }                // ошибку сети не кэшируем — можно повторить
  lyricsCache.set(key, res);
  if (lyricsCache.size > 120) lyricsCache.delete(lyricsCache.keys().next().value);
  return res;
}
function paintLyrSrc() {
  for (const b of document.querySelectorAll("#fSrc [data-src]")) {
    b.classList.toggle("on", b.dataset.src === lyrShown);
  }
}
document.querySelectorAll("#fSrc [data-src]").forEach((b) => {
  b.onclick = () => {
    const t = queue[current];
    if (!t) return;
    const src = b.dataset.src;
    lyrPref = src;
    try { localStorage.setItem("ym_lyr_src", src); } catch {}
    loadFullLyrics(t, src);
  };
});

function setFullMode(m) {
  $("#full").dataset.mode = m;
  requestAnimationFrame(fitFull);
}
function fitFull() {
  const f = $("#full"), cv = $("#fCover");
  if (f.hidden) return;
  if (f.dataset.mode !== "cover") { cv.style.width = cv.style.height = ""; return; }
  const box = $("#fHead");
  const avail = box.clientHeight - $("#fTitles").offsetHeight - 22;
  const size = Math.max(120, Math.min(box.clientWidth, avail));
  cv.style.width = cv.style.height = size + "px";
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
  } else if (res.type === "instr") {
    box.className = "flyrics"; box.innerHTML = '<div class="fstatus">Инструментальная композиция — без слов</div>';
    setFullMode("lyrics");
  } else { box.className = "flyrics"; setFullMode("cover"); }
}

// only — источник выбран кнопкой: показываем именно его, даже если там пусто (чтобы было видно, что текста нет).
// Иначе — сначала предпочитаемый источник, при пустом ответе — другой.
async function loadFullLyrics(t, only = null) {
  const my = ++fullSeq;
  const box = $("#fLyrics");
  // пока ищем — обложка на весь экран; текст появится, только если он нашёлся
  box.className = "flyrics"; box.innerHTML = "";
  fLines = []; fIdx = -1;
  setFullMode("cover");
  $("#fSrc").classList.add("busy");
  const order = only ? [only] : [lyrPref, ...LYR_SRCS.filter((s) => s !== lyrPref)];
  let res = { type: "none" }, src = order[0], err = false;
  for (const s of order) {
    const r = await lyricsFrom(t, s);
    if (my !== fullSeq || $("#full").hidden) return;
    err ||= !!r.err;
    if (r.type !== "none") { res = r; src = s; break; }
  }
  $("#fSrc").classList.remove("busy");
  lyrShown = res.type === "none" ? "" : src;
  // источник выбран вручную, а текста там нет — короткая подсказка поверх обложки
  if (res.type === "none" && only) showToast(err ? `${LYR_NAME[only]}: не удалось получить текст — проверь интернет` : `У источника «${LYR_NAME[only]}» текста этой песни нет`, 3000);
  paintLyrSrc();
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
  $("#full").hidden = false; syncBgVideo();      // плеер закрывает фон целиком — видеообои на паузу
  fillFull(t);
  fLast = { cur: -1, dur: -1, tc: "", td: "" };
  if (!fullRun) { fullRun = true; requestAnimationFrame(fullFrame); }
}
function closeFull() { $("#full").hidden = true; fullRun = false; fullSeq++; $("#fSrc").classList.remove("busy"); syncBgVideo(); }

let fLast = { cur: -1, dur: -1, tc: "", td: "" };
function fullFrame() {
  if (!fullRun) return;
  if (document.hidden) { fullRun = false; return; }          // окно скрыто в трей — цикл встаёт, вернётся при показе
  requestAnimationFrame(fullFrame);
  const t = queue[current];
  if (!t) return;
  const cur = needLoad ? resumePos : audio.currentTime || 0;
  const dur = audio.duration || (t.durationMs || 0) / 1000;
  if (cur === fLast.cur && dur === fLast.dur) return;      // на паузе ничего не меняется — и в DOM ничего не пишем
  fLast.cur = cur; fLast.dur = dur;
  if (!fDrag) { $("#fSeek").value = dur ? (cur / dur) * 1000 : 0; fill($("#fSeek")); }
  const tc = fmtTime(cur), td = fmtTime(dur);
  if (tc !== fLast.tc) { $("#fTCur").textContent = tc; fLast.tc = tc; }
  if (td !== fLast.td) { $("#fTDur").textContent = td; fLast.td = td; }
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
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: document.documentElement.dataset.anim === "off" ? "auto" : "smooth" });
  }
}

$("#cover").onclick = openFull;
$("#cover").title = "Развернуть на весь экран";
$("#fClose").onclick = closeFull;
$("#fPlay").onclick = togglePlay;
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

const tmenu = document.createElement("div");
tmenu.className = "tmenu"; tmenu.hidden = true;
document.body.append(tmenu);
let tmenuBtn = null, menuSeq = 0;
function closeTrackMenu() {
  if (tmenu.hidden) return;
  menuSeq++;
  tmenu.hidden = true; tmenu.textContent = "";
  tmenuBtn?.classList.remove("open"); tmenuBtn = null;
}
function openMenu(btn, build) {
  if (tmenuBtn === btn) return closeTrackMenu();
  closeTrackMenu();
  tmenuBtn = btn; btn.classList.add("open"); tmenu.hidden = false;
  build(menuSeq);
}
function menuReset() { tmenu.textContent = ""; return ++menuSeq; }
const menuAlive = (seq) => !tmenu.hidden && seq === menuSeq;
function menuItem(icon, text, fn, { keep = false, arrow = false, danger = false, to = tmenu } = {}) {
  const b = document.createElement("button");
  b.className = "mi" + (danger ? " danger" : "");
  b.innerHTML = icon || ""; const s = document.createElement("span"); s.className = "mt"; s.textContent = text; b.append(s);
  if (arrow) b.insertAdjacentHTML("beforeend", '<i class="miarrow">›</i>');
  b.onclick = (e) => { e.stopPropagation(); if (!keep) closeTrackMenu(); fn(); };
  to.append(b);
  return b;
}
function menuHead(text, back) {
  const h = document.createElement("div"); h.className = "mhead";
  const b = document.createElement("button"); b.className = "mback"; b.textContent = "←"; b.title = "Назад";
  b.onclick = (e) => { e.stopPropagation(); back(); };
  const s = document.createElement("b"); s.textContent = text;
  h.append(b, s); tmenu.append(h);
}
function menuNote(text, to = tmenu) { const p = document.createElement("p"); p.className = "mnote"; p.textContent = text; to.append(p); return p; }
function menuSep() { const i = document.createElement("hr"); i.className = "msep"; tmenu.append(i); }
function placeMenu() {
  if (tmenu.hidden || !tmenuBtn) return;
  const r = tmenuBtn.getBoundingClientRect(), m = tmenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8));
  const below = r.bottom + 6 + m.height <= innerHeight - 8;
  const top = below ? r.bottom + 6 : Math.max(8, r.top - m.height - 6);
  tmenu.style.left = left + "px"; tmenu.style.top = top + "px";
}
document.addEventListener("pointerdown", (e) => { if (!tmenu.hidden && !tmenu.contains(e.target) && !tmenuBtn?.contains(e.target)) closeTrackMenu(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTrackMenu(); });
window.addEventListener("resize", closeTrackMenu);
document.addEventListener("scroll", (e) => { if (!tmenu.contains(e.target)) closeTrackMenu(); }, true);

const toast = document.createElement("div");
toast.className = "toast"; toast.hidden = true;
toast.setAttribute("role", "status"); toast.setAttribute("aria-live", "polite");
document.body.append(toast);
let toastTimer = 0;
function showToast(text, ms = 3500, { kind = "", action = null } = {}) {
  toast.textContent = "";
  toast.className = "toast" + (kind ? " " + kind : "");
  if (kind) { const ic = document.createElement("i"); ic.className = "tico"; ic.textContent = kind === "ok" ? "✓" : "✕"; toast.append(ic); }
  const s = document.createElement("span"); s.textContent = text; toast.append(s);
  if (action) {
    const b = document.createElement("button"); b.className = "tact"; b.textContent = action.label;
    b.onclick = () => { toast.hidden = true; clearTimeout(toastTimer); action.fn(); };
    toast.append(b);
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
}
const hideToast = () => { clearTimeout(toastTimer); toast.hidden = true; };

function modal({ title, text = "", input = null, check = null, ok = "Готово", danger = false }) {
  closeTrackMenu();
  return new Promise((resolve) => {
    const wrap = document.createElement("div"); wrap.className = "login modal";
    const box = document.createElement("form"); box.className = "panel login-box modalbox"; box.noValidate = true;
    const h = document.createElement("h2"); h.textContent = title; box.append(h);
    if (text) { const p = document.createElement("p"); p.textContent = text; box.append(p); }
    let inp = null, cb = null;
    if (input) {
      inp = document.createElement("input"); inp.type = "text"; inp.className = "field";
      inp.maxLength = input.max || 100; inp.placeholder = input.placeholder || ""; inp.value = input.value || "";
      box.append(inp);
    }
    if (check) {
      const l = document.createElement("label"); l.className = "switch";
      cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!check.checked;
      const sp = document.createElement("span"); sp.textContent = check.label;
      l.append(cb, document.createElement("i"), sp); box.append(l);
    }
    const err = document.createElement("p"); err.className = "status"; box.append(err);
    const row = document.createElement("div"); row.className = "row";
    const no = document.createElement("button"); no.type = "button"; no.className = "nav"; no.textContent = "Отмена";
    const yes = document.createElement("button"); yes.type = "submit"; yes.className = "nav active" + (danger ? " danger" : ""); yes.textContent = ok;
    row.append(no, yes); box.append(row);
    const done = (v) => { document.removeEventListener("keydown", onKey, true); wrap.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", onKey, true);
    no.onclick = () => done(null);
    wrap.onpointerdown = (e) => { if (e.target === wrap) done(null); };
    box.onsubmit = (e) => {
      e.preventDefault();
      if (inp && !inp.value.trim()) { err.textContent = "Введи название"; inp.focus(); return; }
      done({ value: inp ? inp.value.trim() : "", checked: cb ? cb.checked : false });
    };
    wrap.append(box); document.body.append(wrap);
    (inp || yes).focus(); inp?.select();
  });
}

// ---------- скорость воспроизведения ----------
// Ползунок 0.5–2 и пять готовых значений. Скорость общая для всех треков и запоминается между запусками;
// высота звука сохраняется (preservesPitch). defaultPlaybackRate нужен, чтобы смена src её не сбрасывала.
const SPEEDS = [0.5, 1, 1.25, 1.5, 2], SPEED_MIN = 0.5, SPEED_MAX = 2, SPEED_STEP = 0.05;
const clampSpeed = (v) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round((+v || 1) / SPEED_STEP) * SPEED_STEP));
let speed = (() => { try { return clampSpeed(localStorage.getItem("ym_speed") || 1); } catch { return 1; } })();
const fmtSpeed = (v) => (+v.toFixed(2)).toString().replace(".", ",") + "×";
function applySpeed(a) {
  if (!a) return;
  a.preservesPitch = true;
  a.defaultPlaybackRate = speed;
  if (a.playbackRate !== speed) a.playbackRate = speed;
}
function setSpeed(v) {
  speed = clampSpeed(v);
  try { localStorage.setItem("ym_speed", String(speed)); } catch {}
  applySpeed(audio);
  syncSpeedBadge();
  window.discordPush?.(true); window.miniPush?.(true);     // время в Discord и мини-плеере — с новой скоростью
}
function syncSpeedBadge() {
  const b = $("#pMore");
  if (!b) return;
  b.classList.toggle("spd", speed !== 1);
  b.dataset.speed = speed !== 1 ? fmtSpeed(speed) : "";
  b.title = speed !== 1 ? `Ещё · скорость ${fmtSpeed(speed)}` : "Ещё";
}
function menuSpeed() {
  const box = document.createElement("div"); box.className = "mspeed";
  const head = document.createElement("div"); head.className = "mspeedhead";
  const lbl = document.createElement("span"); lbl.textContent = "Скорость";
  const val = document.createElement("b"); val.textContent = fmtSpeed(speed);
  head.append(lbl, val);
  const r = document.createElement("input");
  r.type = "range"; r.min = SPEED_MIN; r.max = SPEED_MAX; r.step = SPEED_STEP; r.value = speed;
  r.setAttribute("aria-label", "Скорость воспроизведения");
  const row = document.createElement("div"); row.className = "mspeedrow";
  const btns = SPEEDS.map((v) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "mspd"; b.textContent = fmtSpeed(v);
    b.onclick = (e) => { e.stopPropagation(); setSpeed(v); sync(); };
    row.append(b); return b;
  });
  const sync = () => {
    r.value = speed; fill(r); val.textContent = fmtSpeed(speed);
    btns.forEach((b, i) => b.classList.toggle("on", Math.abs(SPEEDS[i] - speed) < 1e-6));
  };
  r.oninput = () => { setSpeed(r.value); sync(); };
  r.onclick = (e) => e.stopPropagation();
  r.ondblclick = () => { setSpeed(1); sync(); };       // двойной клик по ползунку — обычная скорость
  box.append(head, r, row);
  tmenu.append(box);
  sync();
}

function openTrackMenu(t, btn, ctx = null) { openMenu(btn, () => trackMenuMain(t, ctx)); }
function trackMenuMain(t, ctx) {
  menuReset();
  if (window.playNext && String(t.id) !== String(queue[current]?.id)) menuItem(ICON.playNext, "Играть следующим", () => window.playNext(t));
  menuItem(ICON.plAdd, "Добавить в плейлист", () => trackMenuPlaylists(t, ctx), { keep: true, arrow: true });
  if (ctx) {
    const p = PL.full.get(ctx.kind), n = p ? p.items.length : 0;
    menuSep();
    if (ctx.index > 0) menuItem(ICON.toTop, "Переместить в начало", () => plMoveTrack(ctx.kind, ctx.index, 0, t));
    if (ctx.index < n - 1) menuItem(ICON.toEnd, "Переместить в конец", () => plMoveTrack(ctx.kind, ctx.index, n - 1, t));
    if (cover(t)) menuItem(ICON.image, "Сделать обложкой плейлиста", () => plCoverFromTrack(ctx.kind, t));
    menuItem(ICON.remove, "Удалить из плейлиста", () => plRemoveTrack(ctx.kind, ctx.index, t), { danger: true });
  }
  menuSep();
  menuItem(got.has(String(t.id)) ? ICON.got : ICON.download, got.has(String(t.id)) ? "Уже скачан" : "Скачать трек", () => downloadTrack(t));
  window.waTrackMenu?.(t, ctx);         // «Сохранить в архив» (whisper.js)
  window.roomTrackMenu?.(t);            // «Предложить в комнату» (together.js), если ты гость в комнате
  if (window.eqOpen) { menuSep(); menuItem(ICON.eq || "", "Эквалайзер", () => window.eqOpen()); }    // eq.js
  if (tmenuBtn?.id === "pMore") { menuSep(); menuSpeed(); }       // скорость — только в меню нижней панели
  placeMenu();
}
async function trackMenuPlaylists(t, ctx) {
  const seq = menuReset();
  menuHead("Добавить в плейлист", () => trackMenuMain(t, ctx));
  menuItem(ICON.plus, "Новый плейлист…", async () => {
    const pl = await plCreateDialog(`С треком «${t.title}»`);
    if (pl) plAddTrack(pl.kind, t);
  });
  const box = document.createElement("div"); box.className = "mscroll"; tmenu.append(box);
  const wait = menuNote("Загружаю плейлисты…", box);
  placeMenu();
  let list;
  try { list = await plLoadList(); }
  catch (e) { if (menuAlive(seq)) { wait.textContent = "Не удалось загрузить плейлисты: " + plErr(e); placeMenu(); } return; }
  if (!menuAlive(seq)) return;
  wait.remove();
  if (!list.length) menuNote("Плейлистов пока нет — создай первый кнопкой выше.", box);
  for (const p of list) {
    const b = menuItem("", p.title, () => plAddTrack(p.kind, t), { to: box });
    b.classList.add("mpl");
    b.prepend(plCoverEl(p, "mthumb"));
    const c = document.createElement("small"); c.textContent = plCount(p.trackCount); b.append(c);
    if (ctx && String(ctx.kind) === String(p.kind)) b.title = "Это текущий плейлист";
  }
  placeMenu();
}

const kindOk = (k) => /^\d{1,12}$/.test(String(k));
const plCount = (n) => { n = Number(n) || 0; return `${n} ${plural(n, ["трек", "трека", "треков"])}`; };
const plName = (kind) => (PL.full.get(String(kind)) || PL.list?.find((p) => String(p.kind) === String(kind)))?.title || "плейлист";

function plErr(e) {
  const m = String(e?.message || e);
  if (/^HTTP 40[13]/.test(m)) return "нет доступа — попробуй выйти и войти снова";
  if (/^HTTP 404/.test(m)) return "плейлист не найден — возможно, его удалили";
  if (/^HTTP (409|412)|revision/i.test(m)) return "плейлист изменился на другом устройстве — обнови страницу и повтори";
  if (/^HTTP 5\d\d/.test(m)) return "сервер Яндекса не ответил, попробуй ещё раз";
  return m.replace(/^HTTP \d+: /, "").slice(0, 160);
}

async function plLoadList(force = false) {
  if (PL.list && !force) return PL.list;
  return (PL.loading ||= ym("playlists")
    .then((r) => (PL.list = (Array.isArray(r) ? r : []).filter((p) => p && kindOk(p.kind) && typeof p.title === "string")))
    .finally(() => { PL.loading = null; }));
}
function plUpsert(p) {
  if (!PL.list || !p || !kindOk(p.kind)) return;
  const i = PL.list.findIndex((x) => String(x.kind) === String(p.kind));
  const meta = { kind: p.kind, title: p.title, trackCount: p.trackCount, revision: p.revision, cover: p.cover, ogImage: p.ogImage, durationMs: p.durationMs, visibility: p.visibility };
  for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
  if (i >= 0) Object.assign(PL.list[i], meta); else PL.list.unshift(meta);
}

async function plFetch(kind) {
  kind = String(kind);
  const p = await ym("playlist", { id: kind });
  const raw = Array.isArray(p.tracks) ? p.tracks : [];
  const items = raw.map((x) => ({ id: String(x.id ?? x.track?.id), albumId: x.albumId ?? albumOf(x.track) }));
  const list = raw.map((x) => x.track || null);
  const missing = list.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
  for (let s = 0; s < missing.length; s += 100) {
    const part = missing.slice(s, s + 100);
    try {
      const got = await ym("tracks", { form: { "track-ids": part.map((i) => items[i].albumId ? `${items[i].id}:${items[i].albumId}` : items[i].id).join(",") } });
      const byId = new Map((got || []).map((t) => [String(t.id), t]));
      for (const i of part) list[i] = byId.get(items[i].id) || null;
    } catch {}
  }
  for (let i = 0; i < list.length; i++) {
    if (!list[i]) list[i] = { id: items[i].id, title: "Трек недоступен", artists: [], albums: items[i].albumId ? [{ id: items[i].albumId }] : [] };
    if (!items[i].albumId) items[i].albumId = albumOf(list[i]);
  }
  const full = { ...p, kind, tracks: undefined, items, list };
  PL.full.set(kind, full);
  plUpsert(full);
  return full;
}

let plChangeTail = "/change";
async function plChangeRaw(kind, revision, ops) {
  try {
    return await ym(plChangeTail === "/change" ? "playlist_change" : "playlist_change_rel", { id: kind, form: { kind, revision, diff: JSON.stringify(ops) } });
  } catch (e) {
    if (plChangeTail === "/change" && /^HTTP 404/.test(e.message)) { plChangeTail = "/change-relative"; return plChangeRaw(kind, revision, ops); }
    throw e;
  }
}
async function plChange(kind, build) {
  kind = String(kind);
  let p = PL.full.get(kind) || await plFetch(kind);
  for (let attempt = 0; ; attempt++) {
    const { ops, apply } = build(p);
    let r;
    try { r = await plChangeRaw(kind, p.revision ?? 0, ops); }
    catch (e) {
      if (attempt === 0 && /^HTTP 4(00|09|12)/.test(e.message)) { p = await plFetch(kind); continue; }
      throw e;
    }
    apply(p);
    if (r && typeof r === "object") {
      if (Number.isFinite(r.revision)) p.revision = r.revision; else p.revision = (p.revision || 0) + 1;
      for (const k of ["title", "cover", "durationMs", "ogImage"]) if (r[k] !== undefined) p[k] = r[k];
      if (Array.isArray(r.tracks) && r.tracks.map((x) => String(x.id ?? x.track?.id)).join() !== p.items.map((x) => x.id).join()) p = await plFetch(kind);
    }
    p.trackCount = p.items.length;
    plUpsert(p);
    if (curPl === kind) plRenderTracks();
    return p;
  }
}

function trackRef(t) {
  const albumId = albumOf(t);
  if (!t?.id || !albumId) throw new Error("у этого трека нет альбома — Яндекс не даёт добавить такой трек в плейлист");
  return { id: String(t.id), albumId: String(albumId) };
}
const plTrackIndex = (p, index, id) => (p.items[index]?.id === String(id) ? index : p.items.findIndex((x) => x.id === String(id)));

async function plAddTrack(kind, t, { at = null, force = false, verb = "добавлен в" } = {}) {
  kind = String(kind);
  const name = () => plName(kind);
  showToast(`Добавляю «${t.title}» в «${name()}»…`, 0);
  try {
    const ref = trackRef(t);
    const cur = PL.full.get(kind) || await plFetch(kind);
    if (!force && cur.items.some((x) => x.id === ref.id)) {
      hideToast();
      const ok = await modal({ title: "Трек уже в плейлисте", text: `«${t.title}» уже есть в «${name()}». Добавить ещё раз?`, ok: "Добавить ещё раз" });
      if (!ok) { showToast(`Ничего не изменилось: «${t.title}» уже был в «${name()}»`, 4000); return false; }
    }
    let pos = 0;
    await plChange(kind, (p) => {
      pos = at == null ? p.items.length : Math.max(0, Math.min(at, p.items.length));
      return { ops: [{ op: "insert", at: pos, tracks: [ref] }], apply: (q) => { q.items.splice(pos, 0, ref); q.list.splice(pos, 0, t); } };
    });
    const here = curPl === kind;
    showToast(`«${t.title}» ${verb} «${name()}»${here ? ` · ${pos + 1}-е место` : ""}`, 5000,
      { kind: "ok", action: here ? null : { label: "Открыть", fn: () => navigate(() => showPlaylist(kind)) } });
    if (here) flashRow(pos);
    return true;
  } catch (e) {
    showToast(`Не удалось добавить «${t.title}» в «${name()}»: ${plErr(e)}`, 7000, { kind: "err" });
    return false;
  }
}

async function plRemoveTrack(kind, index, t) {
  kind = String(kind);
  let at = index;
  try {
    await plChange(kind, (p) => {
      at = plTrackIndex(p, index, t.id);
      if (at < 0) throw new Error("этого трека в плейлисте уже нет");
      return { ops: [{ op: "delete", from: at, to: at + 1 }], apply: (q) => { q.items.splice(at, 1); q.list.splice(at, 1); } };
    });
    showToast(`«${t.title}» удалён из «${plName(kind)}»`, 7000,
      { kind: "ok", action: { label: "Вернуть", fn: () => plAddTrack(kind, t, { at, force: true, verb: "возвращён в" }) } });
  } catch (e) {
    showToast(`Не удалось удалить «${t.title}» из «${plName(kind)}»: ${plErr(e)}`, 7000, { kind: "err" });
  }
}

async function plMoveTrack(kind, from, to, t) {
  kind = String(kind);
  if (from === to) return;
  try {
    let dst = to;
    await plChange(kind, (p) => {
      const i = plTrackIndex(p, from, t.id);
      if (i < 0) throw new Error("этого трека в плейлисте уже нет");
      const ref = { id: p.items[i].id, albumId: p.items[i].albumId }, tr = p.list[i];
      if (!ref.albumId) throw new Error("у трека нет альбома — Яндекс не даёт его переставить");
      dst = Math.max(0, Math.min(to, p.items.length - 1));
      return {
        ops: [{ op: "delete", from: i, to: i + 1 }, { op: "insert", at: dst, tracks: [ref] }],
        apply: (q) => { q.items.splice(i, 1); q.list.splice(i, 1); q.items.splice(dst, 0, ref); q.list.splice(dst, 0, tr); },
      };
    });
    showToast(`Порядок сохранён: «${t.title}» теперь ${dst + 1}-й`, 3500, { kind: "ok" });
    if (curPl === kind) flashRow(dst);
  } catch (e) {
    showToast(`Не удалось переставить «${t.title}»: ${plErr(e)}`, 7000, { kind: "err" });
    if (curPl === kind) plRenderTracks();
  }
}

async function plCreate(title, isPublic) {
  const r = await ym("playlist_create", { form: { title, visibility: isPublic ? "public" : "private" } });
  if (!r || !kindOk(r.kind)) throw new Error("сервер вернул неожиданный ответ");
  if (PL.list) plUpsert({ ...r, trackCount: r.trackCount || 0 });
  return r;
}
async function plCreateDialog(text = "") {
  const r = await modal({ title: "Новый плейлист", text, input: { placeholder: "Название плейлиста", max: 100 }, check: { label: "Публичный — виден другим в твоём профиле", checked: false }, ok: "Создать" });
  if (!r) return null;
  try {
    const pl = await plCreate(r.value, r.checked);
    showToast(`Плейлист «${pl.title}» создан`, 5000, { kind: "ok", action: curPl ? null : { label: "Открыть", fn: () => navigate(() => showPlaylist(pl.kind)) } });
    if (!curPl && !$("#plPage").hidden) renderPlGrid();
    return pl;
  } catch (e) { showToast("Не удалось создать плейлист: " + plErr(e), 7000, { kind: "err" }); return null; }
}
async function plRename(kind) {
  kind = String(kind);
  const old = plName(kind);
  const r = await modal({ title: "Название плейлиста", input: { value: old, placeholder: "Название плейлиста", max: 100 }, ok: "Сохранить" });
  if (!r || r.value === old) return;
  try {
    const res = await ym("playlist_rename", { id: kind, form: { value: r.value } });
    const p = PL.full.get(kind);
    const title = res?.title || r.value;
    if (p) { p.title = title; if (Number.isFinite(res?.revision)) p.revision = res.revision; }
    plUpsert({ kind, title, revision: res?.revision });
    if (curPl === kind && p) plRenderHead(p);
    showToast(`Название изменено: «${old}» → «${title}»`, 5000, { kind: "ok" });
  } catch (e) { showToast("Не удалось переименовать плейлист: " + plErr(e), 7000, { kind: "err" }); }
}
async function plDelete(kind) {
  kind = String(kind);
  const name = plName(kind);
  const ok = await modal({ title: "Удалить плейлист?", text: `«${name}» будет удалён из твоей Яндекс Музыки на всех устройствах. Треки останутся в каталоге и в лайках.`, ok: "Удалить", danger: true });
  if (!ok) return;
  try {
    await ym("playlist_delete", { id: kind });
    PL.full.delete(kind);
    if (PL.list) PL.list = PL.list.filter((p) => String(p.kind) !== kind);
    const pi = pins.findIndex((p) => p.type === "playlist" && String(p.id) === kind);
    if (pi >= 0) { pins.splice(pi, 1); savePins(); }
    try { await IDB.del(plCoverKey(kind)); } catch {}
    PL.covers.delete(kind);
    showToast(`Плейлист «${name}» удалён`, 5000, { kind: "ok" });
    likesTab = "playlists"; goTop(showLikes);
  } catch (e) { showToast("Не удалось удалить плейлист: " + plErr(e), 7000, { kind: "err" }); }
}

const plCoverKey = (kind) => `plcover:${uid}:${kind}`;
async function plLocalCover(kind) {
  kind = String(kind);
  if (PL.covers.has(kind)) return PL.covers.get(kind);
  let url = "";
  try {
    const v = await IDB.get(plCoverKey(kind));
    if (v instanceof Blob) url = URL.createObjectURL(v);
    else if (typeof v === "string") url = safeUrl(v);
  } catch {}
  PL.covers.set(kind, url);
  return url;
}
async function plSetLocalCover(kind, value) {
  kind = String(kind);
  const old = PL.covers.get(kind);
  if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
  PL.covers.set(kind, value instanceof Blob ? URL.createObjectURL(value) : value || "");
  if (value) await IDB.set(plCoverKey(kind), value); else await IDB.del(plCoverKey(kind));
}
function plYandexCover(p, size = "200x200") {
  const c = p?.cover;
  const u = (c?.type === "pic" && c.uri) || c?.itemsUri?.[0] || c?.uri || p?.ogImage;
  return u ? cover({ coverUri: u }, size) : "";
}
function plCoverEl(p, cls) {
  const box = document.createElement("span"); box.className = "plcover " + (cls || "");
  const fill = (url) => {
    box.textContent = "";
    const items = p.cover?.type === "mosaic" ? (p.cover.itemsUri || []).slice(0, 4) : [];
    if (url) box.append(mkImg(url));
    else if (items.length === 4) { box.classList.add("mosaic"); for (const u of items) box.append(mkImg(cover({ coverUri: u }, "100x100"))); }
    else { const y = plYandexCover(p); if (y) box.append(mkImg(y)); else box.insertAdjacentHTML("beforeend", '<i class="plnone">♫</i>'); }
  };
  const known = PL.covers.get(String(p.kind));
  fill(known || "");
  if (known === undefined) plLocalCover(p.kind).then((u) => { if (u) { box.classList.remove("mosaic"); fill(u); } });
  return box;
}
async function plCoverFromFile(kind, f) {
  if (!f) return;
  try {
    if (f.size > IMG_LIMITS.maxBytes) throw new Error(`файл больше ${IMG_LIMITS.maxBytes / 1048576} МБ`);
    imageGuard(new Uint8Array(await f.arrayBuffer()));
    const bm = await createImageBitmap(f).catch(() => { throw new Error("файл повреждён или это не картинка"); });
    const side = Math.min(bm.width, bm.height), out = Math.min(600, side);
    const c = document.createElement("canvas"); c.width = c.height = out;
    c.getContext("2d").drawImage(bm, (bm.width - side) / 2, (bm.height - side) / 2, side, side, 0, 0, out, out);
    bm.close();
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
    if (!blob) throw new Error("не удалось обработать картинку");
    await plSetLocalCover(kind, blob);
    plCoverChanged(kind, "Обложка плейлиста обновлена (видна в этом приложении)");
  } catch (e) { showToast("Не удалось поставить обложку: " + (e?.message || e), 7000, { kind: "err" }); }
}
async function plCoverFromTrack(kind, t) {
  try { await plSetLocalCover(kind, cover(t, "600x600")); plCoverChanged(kind, `Обложка плейлиста — от «${t.title}»`); }
  catch (e) { showToast("Не удалось поставить обложку: " + (e?.message || e), 7000, { kind: "err" }); }
}
async function plCoverReset(kind) {
  try { await plSetLocalCover(kind, null); plCoverChanged(kind, "Вернул обложку Яндекса"); }
  catch (e) { showToast("Не удалось сбросить обложку: " + (e?.message || e), 7000, { kind: "err" }); }
}
function plCoverChanged(kind, msg) {
  showToast(msg, 4000, { kind: "ok" });
  const p = PL.full.get(String(kind));
  if (curPl === String(kind) && p) plRenderHead(p);
}
function plCoverMenu(btn) {
  const kind = curPl;
  openMenu(btn, () => {
    menuReset();
    menuItem(ICON.image, "Загрузить картинку…", () => { const i = $("#plCoverFile"); i.value = ""; i.click(); });
    if (PL.covers.get(kind)) menuItem(ICON.remove, "Вернуть обложку Яндекса", () => plCoverReset(kind));
    menuNote("Своя обложка видна только в этом приложении: загрузить её в Яндекс Музыку через API нельзя. Ещё можно взять обложку трека: «⋯» → «Сделать обложкой плейлиста».");
    placeMenu();
  });
}
$("#plCoverFile").onchange = (e) => { if (curPl) plCoverFromFile(curPl, e.target.files[0]); };

async function showMyPlaylists(my) {
  setHead({ title: "Мои плейлисты" });
  $("#plCreateBtn").hidden = false;
  $("#plPage").hidden = false; $("#list").hidden = true;
  $("#status").textContent = PL.list ? "" : "Загрузка…";
  if (PL.list) renderPlGrid();
  try { await plLoadList(true); if (my === nav) renderPlGrid(); }
  catch (e) { if (my === nav) $("#status").textContent = "Не удалось загрузить плейлисты: " + plErr(e); }
}
function renderPlGrid() {
  const g = $("#plGrid"); g.innerHTML = "";
  const list = PL.list || [];
  $("#status").textContent = list.length ? "" : "Плейлистов пока нет. Создай первый — кнопка «Создать плейлист» справа вверху.";
  for (const p of list) {
    const c = document.createElement("div");
    c.className = "simcard plcard"; c.tabIndex = 0;
    c.append(plCoverEl(p, "big"));
    const b = document.createElement("b"); b.textContent = p.title;
    const s = document.createElement("span"); s.textContent = plCount(p.trackCount) + (p.visibility === "private" ? " · личный" : "");
    c.append(b, s);
    c.onclick = () => navigate(() => showPlaylist(p.kind));
    c.onkeydown = (e) => { if (e.key === "Enter") c.click(); };
    g.append(c);
  }
}

async function showPlaylist(kind) {
  kind = String(kind);
  const my = ++nav;
  setHead({ title: "Загрузка…", back: true }); setActive(null); renderTabs(pinKey("playlist", kind)); resetView();
  curPl = kind;
  if (!kindOk(kind)) { $("#status").textContent = "Неверный плейлист"; return; }
  try {
    const p = await plFetch(kind);
    if (my !== nav) return;
    plRenderHead(p);
    $("#plBar").hidden = false;
    plRenderTracks();
    plLoadRecs(kind, my);
  } catch (e) { if (my === nav) { setHead({ title: "Плейлист", back: true }); $("#status").textContent = "Не удалось открыть плейлист: " + plErr(e); } }
}
function plRenderHead(p) {
  const local = PL.covers.get(p.kind);
  setHead({
    title: p.title, img: local || plYandexCover(p), round: false, back: true,
    pin: { type: "playlist", id: p.kind, title: p.title },
    sub: (el) => {
      const ms = p.list.reduce((s, t) => s + (Number.isFinite(t.durationMs) ? t.durationMs : 0), 0);
      el.textContent = [plCount(p.items.length), ms ? fmtHours(ms) : "", p.visibility === "private" ? "личный" : "публичный"].filter(Boolean).join(" · ");
    },
  });
  if (local === undefined) plLocalCover(p.kind).then((u) => { if (u && curPl === p.kind) { $("#headImg").src = u; $("#headImg").hidden = false; } });
}
function plRenderTracks() {
  const p = PL.full.get(curPl);
  if (!p) return;
  plRenderHead(p);
  const kind = p.kind;
  renderList(p.list, false, { ctx: "playlist", menuCtx: (i) => ({ kind, index: i }), grip: (li, i) => plGrip(li, i) });
  $("#status").textContent = p.list.length ? "" : "В плейлисте пока нет треков. Добавь их из рекомендаций ниже или у любого трека: «⋯» → «Добавить в плейлист».";
  $("#plPlay").disabled = !p.list.length;
  if (recArr.length) { const have = new Set(p.items.map((x) => x.id)); plShowRecs(recArr.filter((t) => !have.has(String(t.id)))); }
}
function flashRow(i) {
  const li = $("#list").children[i];
  if (!li) return;
  li.scrollIntoView({ block: "nearest", behavior: document.documentElement.dataset.anim === "off" ? "auto" : "smooth" });
  li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
}
$("#plCreateBtn").onclick = () => plCreateDialog();
$("#plPlay").onclick = () => { const p = PL.full.get(curPl); if (p?.list.length) { wave.on = false; queue = shown; playCtx = "playlist"; playAlbum = null; play(shuffle ? Math.floor(Math.random() * shown.length) : 0); } };
$("#plRename").onclick = () => curPl && plRename(curPl);
$("#plCoverBtn").onclick = (e) => curPl && plCoverMenu(e.currentTarget);
$("#plDelete").onclick = () => curPl && plDelete(curPl);

async function plLoadRecs(kind, my) {
  $("#plRecs").hidden = false; $("#plRecNote").textContent = "Подбираю рекомендации…"; $("#plRecList").innerHTML = "";
  try {
    const r = await ym("playlist_recs", { id: kind });
    if (my !== nav) return;
    const p = PL.full.get(kind), have = new Set(p ? p.items.map((x) => x.id) : []);
    const tracks = (r?.tracks || []).filter((t) => t && t.id != null && !have.has(String(t.id)));
    recArr.length = 0;
    plShowRecs(tracks);
  } catch (e) { if (my === nav) $("#plRecNote").textContent = "Не удалось получить рекомендации: " + plErr(e); }
}
function plShowRecs(tracks) {
  const kind = curPl;
  $("#plRecNote").textContent = tracks.length ? "" : "Яндекс пока не подобрал рекомендации — добавь в плейлист ещё несколько треков и нажми «Обновить».";
  renderList(tracks, false, {
    target: $("#plRecList"), arr: recArr,
    extra: (t, li) => {
      const b = document.createElement("button");
      b.className = "recadd"; b.title = "Добавить в этот плейлист"; b.innerHTML = ICON.plus;
      b.onclick = async (e) => {
        e.stopPropagation(); b.disabled = true;
        if (await plAddTrack(kind, t)) li.classList.add("added"); else b.disabled = false;
      };
      return b;
    },
  });
}
$("#plRecsMore").onclick = () => curPl && plLoadRecs(curPl, nav);

function plGrip(li, from) {
  const g = document.createElement("span");
  g.className = "grip"; g.title = "Перетащи, чтобы изменить порядок"; g.innerHTML = ICON.grip;
  g.onclick = (e) => e.stopPropagation();
  g.onpointerdown = (e) => plDragStart(e, li, from);
  return g;
}
function plDragStart(e, li, from) {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  closeTrackMenu();
  const rows = [...$("#list").children], main = document.querySelector(".main");
  let slot = from, lastY = e.clientY, raf = 0, done = false;
  li.classList.add("dragging"); document.body.classList.add("pl-drag");
  const mark = () => {
    rows.forEach((r) => r.classList.remove("drop-before", "drop-after"));
    if (slot === from || slot === from + 1) return;
    if (slot < rows.length) rows[slot].classList.add("drop-before"); else rows[rows.length - 1].classList.add("drop-after");
  };
  const compute = () => {
    slot = rows.length;
    for (let k = 0; k < rows.length; k++) { const r = rows[k].getBoundingClientRect(); if (lastY < r.top + r.height / 2) { slot = k; break; } }
    mark();
  };
  const tick = () => {
    const r = main.getBoundingClientRect(), edge = 56;
    const dy = lastY < r.top + edge ? -14 : lastY > r.bottom - edge ? 14 : 0;
    if (dy) { main.scrollTop += dy; compute(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const move = (ev) => { lastY = ev.clientY; compute(); };
  const finish = (apply) => {
    if (done) return; done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    document.removeEventListener("keydown", key, true);
    rows.forEach((r) => r.classList.remove("drop-before", "drop-after"));
    li.classList.remove("dragging"); document.body.classList.remove("pl-drag");
    const to = slot > from ? slot - 1 : slot;
    if (apply && to !== from && curPl) plMoveTrack(curPl, from, to, shown[from]);
  };
  const up = () => finish(true), cancel = () => finish(false);
  const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); finish(false); } };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  document.addEventListener("keydown", key, true);
}

const downloading = new Set();
function syncGotRow(li) {
  const on = got.has(String(li.dataset.id));
  li.classList.toggle("got", on);
  let m = li.querySelector(".gotmark");
  if (on && !m) {
    m = document.createElement("span");
    m.className = "gotmark"; m.title = "Скачан"; m.innerHTML = ICON.got;
    li.insertBefore(m, li.querySelector(".recadd, .likebtn"));
  } else if (!on && m) m.remove();
}
function syncGot() {
  document.querySelectorAll(".list li").forEach(syncGotRow);
  refreshPlayerBtns();
}
async function loadGot() {
  try { const ids = await invoke("downloaded_ids"); got.clear(); for (const i of ids) got.add(String(i)); syncGot(); } catch {}
  if (likes.done) backfillMeta(likes.tracks);
}
// Краткое описание трека — сохраняется вместе со скачанным файлом, чтобы показать его в списке без сети.
const trackMin = (x) => ({
  id: x.id, title: x.title, version: x.version || undefined, coverUri: x.coverUri, durationMs: x.durationMs,
  artists: (x.artists || []).map((a) => ({ id: a.id, name: a.name })),
  albums: (x.albums || []).slice(0, 1).map((a) => ({ id: a.id, title: a.title })),
});
// Трекам, скачанным до появления офлайн-режима, описание дописывается, когда их данные есть под рукой (раз за запуск).
const metaSent = new Set();
function backfillMeta(tracks) {
  const items = [];
  for (const t of tracks || []) {
    const id = String(t?.id ?? "");
    if (!id || !got.has(id) || metaSent.has(id) || !t.title) continue;
    metaSent.add(id); items.push({ id, meta: trackMin(t) });
  }
  if (items.length) invoke("downloaded_meta", { items }).catch(() => {});
}
window.addEventListener("focus", loadGot);

async function downloadTrack(t, force = false) {
  if (!t) return;
  const id = String(t.id);
  if (downloading.has(id)) return showToast("Этот трек уже скачивается…");
  if (got.has(id) && !force) {
    return showToast(`«${t.title}» уже скачан`, 6000, { kind: "ok", action: { label: "Скачать ещё раз", fn: () => downloadTrack(t, true) } });
  }
  downloading.add(id); refreshPlayerBtns();
  const artists = (t.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const name = artists ? `${artists} — ${t.title}` : String(t.title || id);
  showToast(`Скачиваю «${t.title}»…`, 0);
  try {
    const path = await invoke("download_track", { name, id, meta: trackMin(t) });      // ссылку на файл Rust берёт сам по id
    got.add(id); metaSent.add(id); syncGot();
    showToast(`Сохранено: ${path}`, 5000, { kind: "ok" });
  } catch (e) {
    showToast("Не удалось скачать: " + e.message, 6000);
  } finally { downloading.delete(id); refreshPlayerBtns(); }
}

$("#disBtn").onclick = () => toggleDislike(queue[current]);
// «⋯» в нижней панели: то же меню, что у треков в списках, для играющего трека
$("#pMore").innerHTML = ICON.more;
syncSpeedBadge();
$("#pMore").onclick = (e) => { e.stopPropagation(); const t = queue[current]; if (t) openTrackMenu(t, e.currentTarget); };
// Кнопка «Не нравится» в нижней панели (скачивание — в меню «⋯»)
function refreshPlayerBtns() {
  const b = $("#disBtn"), t = queue[current];
  b.disabled = !t;
  $("#pMore").disabled = !t;
  const on = !!t && dislikedIds.has(String(t.id));
  if (!b.firstChild) b.innerHTML = ICON.dislike;
  b.classList.toggle("on", on);
  b.title = on ? "Убрать из «Не нравится»" : "Не нравится";
}
refreshPlayerBtns();

function showDlDir(info) {
  if (!info) return;
  $("#dlPath").textContent = info.path; $("#dlPath").title = info.path;
  $("#dlReset").disabled = !info.custom;
}
async function loadDlDir() {
  try { showDlDir(await invoke("download_dir_get")); $("#dlNote").textContent = ""; }
  catch (e) { $("#dlPath").textContent = "—"; $("#dlNote").textContent = "Не удалось узнать папку: " + e.message; }
}
$("#dlPick").onclick = async () => {
  try { const r = await invoke("download_dir_pick"); if (r) showDlDir(r); $("#dlNote").textContent = ""; }
  catch (e) { $("#dlNote").textContent = "Не удалось выбрать папку: " + e.message; }
};
$("#dlReset").onclick = async () => {
  try { showDlDir(await invoke("download_dir_reset")); $("#dlNote").textContent = ""; }
  catch (e) { $("#dlNote").textContent = "Не удалось сбросить папку: " + e.message; }
};
$("#dlOpen").onclick = async () => {
  try { await invoke("download_dir_open"); }
  catch (e) { $("#dlNote").textContent = "Не удалось открыть папку: " + e.message; }
};

// Прямая ссылка на MP3: download-info, адрес файла и подпись (MD5 по протоколу Яндекса) получает Rust (net.rs).
async function directLink(id) {
  return await invoke("ym_track_url", { id: String(id) });
}
function markPlaying() {
  document.querySelectorAll(".list li").forEach((li) => li.classList.toggle("playing", li.dataset.id === String(playingId)));
}

// Смена обложки в плеере. Если стиль задаёт анимации .cover.flip-out / .flip-in (Королевский — «монета»),
// старая обложка уходит на ребро, подменяется (новая к этому моменту уже загружена) и выходит с ребра.
// Анимаций нет (другой стиль, выключены «Анимации интерфейса») — картинка меняется сразу.
let coverSeq = 0;
const newAnims = (el, before) => el.getAnimations?.().filter((a) => !before.includes(a)) || [];
async function swapCover(src) {
  const el = $("#cover"), my = ++coverSeq;
  el.classList.remove("flip-out", "flip-in");
  if (!el.getAttribute("src") || el.getAttribute("src") === src || document.hidden || !el.getAnimations) { el.src = src; return; }
  const before = el.getAnimations();
  el.classList.add("flip-out");
  const out = newAnims(el, before);
  if (!out.length) { el.classList.remove("flip-out"); el.src = src; return; }
  const pre = new Image(); pre.src = src;
  await Promise.all([
    Promise.all(out.map((a) => a.finished)).catch(() => {}),
    Promise.race([pre.decode().catch(() => {}), new Promise((r) => setTimeout(r, 600))]),
  ]);
  if (my !== coverSeq) return;
  el.src = src;
  el.classList.remove("flip-out");
  const b2 = el.getAnimations();
  el.classList.add("flip-in");
  const inn = newAnims(el, b2);
  await Promise.all(inn.map((a) => a.finished)).catch(() => {});
  if (my === coverSeq) el.classList.remove("flip-in");
}
// клик по «Моей волне» — анимация «оттиска», если стиль её задаёт (Королевский: .wavebtn.stamp)
$("#waveBtn").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const b = e.currentTarget;
  b.classList.remove("stamp"); void b.offsetWidth; b.classList.add("stamp");
});
$("#waveBtn").addEventListener("animationend", (e) => { if (e.target === e.currentTarget && e.animationName.endsWith("royalStamp")) e.currentTarget.classList.remove("stamp"); });

function showTrack(t, pos = 0) {
  playingId = t.id; markPlaying();
  const pt = $("#pTitle");
  pt.textContent = t.title;
  pt.classList.toggle("link", !!albumOf(t));
  fillArtists($("#pArtist"), t);
  swapCover(cover(t));
  dynUpdate(t);
  const dur = (t.durationMs || 0) / 1000;
  $("#tCur").textContent = fmtTime(pos); $("#tDur").textContent = fmtTime(dur);
  $("#seek").value = dur ? (pos / dur) * 1000 : 0; fill($("#seek"));
  if (wave.on) showNow(t);
  refreshHearts(); updateModes();
  if (!$("#full").hidden) fillFull(t);
  window.qRefresh?.();                    // панель очереди (queue.js), если открыта
  window.discordPush?.();
  window.miniPush?.();
}

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

let playFail = 0;       // подряд неудачных загрузок трека
async function play(i, resumeAt = 0, isRetry = false) {
  if (i < 0) return;
  setTransit(true);
  loadAt = Date.now(); loadPos = resumeAt;
  if (i >= queue.length && wave.on && !isRetry) {
    const seq0 = playSeq;
    if (!(await waveMore())) { if (seq0 === playSeq) { loadAt = 0; setTransit(false); } return; }
  }
  if (i >= queue.length) { loadAt = 0; setTransit(false); return; }
  current = i; needLoad = false;
  const t = queue[i];
  showTrack(t, resumeAt);
  if (shuffle) {
    if (orderFor !== queue || order.length !== queue.length) buildOrder();
    else { const k = order.indexOf(i); if (k >= 0) ordPos = k; }
  }
  saveLast(resumeAt);
  if (!isRetry) window.qOnPlay?.(t);      // история прослушивания (queue.js)
  if (wave.on) {
    wave.pos = i; markHeard(t);
    if (!isRetry) waveFeedback("trackStarted", t);
    if (queue.length - i <= 3) waveMore();
  }
  const my = ++playSeq;
  const wantViz = vizWanted();
  if (!audio || audioViz !== wantViz) {
    const old = audio;
    if (old) { old.pause(); old._src?.disconnect(); old.removeAttribute("src"); old.load(); }
    audio = makeAudio(wantViz); audioViz = wantViz;
    if (!wantViz) {
      // визуализатор больше не нужен: звуковой граф засыпает (не крутит аудиопоток вхолостую),
      // а целиком скачанный прошлый трек освобождается из памяти
      if (actx && actx.state === "running") actx.suspend().catch(() => {});
      if (curBlob) { URL.revokeObjectURL(curBlob); curBlob = null; }
    }
  }
  try {
    // Скачанный трек играет с диска (ymlocal://, Rust отдаёт файл кусками) — без единого запроса в сеть.
    // Иначе Whisper Archive (whisper.js): трек есть в архиве — играет поток оттуда (wa://, кусками), иначе версия Яндекса.
    const local = got.has(String(t.id)) ? LOCAL_BASE + "track/" + encodeURIComponent(String(t.id)) : "";
    if (local) backfillMeta([t]);
    const wa = local ? null : window.waSource ? await window.waSource(t, queue[i + 1]) : null;
    if (my !== playSeq) return;
    window.waBadge?.(!!wa);
    curFromWa = !!wa; curLocal = !!local;
    let src;
    if (local || wa) {
      if (curBlob) { URL.revokeObjectURL(curBlob); curBlob = null; }
      audio.crossOrigin = "anonymous";       // свои протоколы отдают CORS — визуализатор может анализировать поток
      src = local || wa.url;
      if (wantViz) await ctxReady();
    } else {
      audio.removeAttribute("crossorigin");   // файлы Яндекса отдаются без CORS
      src = await directLink(t.id);
      if (my !== playSeq) return;
      if (wantViz) {
        const buf = await invoke("fetch_bytes", { url: src });
        if (my !== playSeq) return;
        if (curBlob) URL.revokeObjectURL(curBlob);
        src = curBlob = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
        await ctxReady();
      }
    }
    audio.src = src;
    if (!wa && !wantViz && curBlob) { URL.revokeObjectURL(curBlob); curBlob = null; }   // файл прошлого трека больше не нужен
    const seekResume = () => { if (resumeAt) audio.addEventListener("loadedmetadata", () => { audio.currentTime = resumeAt; }, { once: true }); };
    seekResume();
    try { await audio.play(); playFail = 0; }
    catch (err) {
      if (my !== playSeq) return;
      // скачанный файл не открылся (удалён или не читается) — забываем его и играем трек обычным путём
      if (local && err?.name === "NotSupportedError") {
        curLocal = false; got.delete(String(t.id)); syncGot();
        return play(i, resumeAt);
      }
      if (!wa || err?.name !== "NotSupportedError") throw err;
      // поток из архива не заиграл — берём файл целиком, а если и это не вышло, играет версия Яндекса
      let b = null;
      try { b = await window.waBlob(wa.id); } catch {}
      if (my !== playSeq) return;
      audio.removeAttribute("crossorigin");
      if (b) audio.src = curBlob = URL.createObjectURL(b);
      else {
        curFromWa = false; window.waBadge?.(false);
        const url = await directLink(t.id);
        if (my !== playSeq) return;
        audio.src = url;
      }
      seekResume();
      await audio.play();
    }
    if (my !== playSeq) return;
    playFail = 0; loadAt = 0; setTransit(false);
    if (/пробую ещё раз|перезапускаю/.test($("#status").textContent)) $("#status").textContent = "";
  } catch (e) {
    if (my !== playSeq) return;
    // Сбой загрузки (ссылка протухла, сеть мигнула): два повтора с новой ссылкой, потом в волне — следующий трек.
    if (!curLocal && ++playFail <= 2) {
      $("#status").textContent = "Не удалось загрузить трек — пробую ещё раз…";
      setTimeout(() => { if (my === playSeq) play(i, resumeAt, true); }, playFail * 2000);
      return;
    }
    if (!curLocal && wave.on && !isNetErr(e) && i + 1 < queue.length) {
      playFail = 0;
      $("#status").textContent = `«${t.title}» не загрузился — пропускаю`;
      play(i + 1);
      return;
    }
    loadAt = 0; setTransit(false);
    if (isNetErr(e) && !curLocal && !curFromWa) {
      setOffline(true);
      $("#status").textContent = `Нет связи с Яндекс Музыкой — «${t.title}» не скачан, сыграть его нельзя.`;
    } else $("#status").textContent = "Не удалось воспроизвести: " + e.message;
  }
}
// Адрес скачанных треков по правилам Tauri: http://ymlocal.localhost/… в Windows, ymlocal://localhost/… в Linux и macOS.
const LOCAL_BASE = (() => {
  try { return window.__TAURI__.core.convertFileSrc("", "ymlocal").replace(/\/?$/, "/"); } catch { return "ymlocal://localhost/"; }
})();
let curLocal = false;           // текущий трек играет из скачанного файла (ymlocal://)

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// Звуковой граф визуализатора. actx.resume() может не завершиться никогда (сменилось или пропало устройство вывода,
// система поспала) — раньше play() ждал его вечно. Ждём 4 с; не проснулся — пересоздаём граф с новым плеером.
async function ctxReady() {
  if (!actx || actx.state === "running") return true;
  await Promise.race([actx.resume().catch(() => {}), sleepMs(4000)]);
  if (actx.state === "running") return true;
  // вызывается из play() до того, как плееру дали адрес трека, — старый плеер просто выбрасываем
  const old = audio;
  try { actx.close(); } catch {}
  actx = null; analyser = null;
  if (old) { old.pause(); old._src?.disconnect(); old.removeAttribute("src"); old.load(); }
  audio = makeAudio(true); audioViz = true;
  await Promise.race([actx.resume().catch(() => {}), sleepMs(4000)]);
  return actx.state === "running";
}

// Сторож воспроизведения — последняя линия обороны, что бы ни было причиной:
// * трек не начал играть за 30 с (запрос завис, audio.play() не вернулся) — пробуем заново со свежей ссылкой;
// * трек играл и встал (позиция не двигается 20 с, хотя не на паузе) — перезапускаем с того же места.
// Две неудачи подряд — в волне идём к следующему треку.
let loadAt = 0, loadPos = 0, wdPos = -1, wdAt = 0;
function recoverPlayback(stalled) {
  const i = current, t = queue[i];
  if (!t) return;
  const pos = stalled ? audio.currentTime || 0 : loadPos;
  if (++playFail <= 2) {
    $("#status").textContent = stalled ? "Трек перестал грузиться — перезапускаю…" : "Трек не загружается — пробую ещё раз…";
    play(i, pos, true);
    return;
  }
  playFail = 0;
  if (wave.on || i + 1 < queue.length) {
    $("#status").textContent = `«${t.title}» не загрузился — пропускаю`;
    const n = nextIndex(false);
    if (n >= 0) { play(n); return; }
  }
  loadAt = 0; setTransit(false);
  $("#status").textContent = `«${t.title}» не загрузился — нажми «Играть», чтобы повторить.`;
}
setInterval(() => {
  if (!audio || needLoad || current < 0 || !queue[current]) return;
  const now = Date.now();
  if (transit) {
    if (loadAt && now - loadAt > 30000) { loadAt = 0; recoverPlayback(false); }
    return;
  }
  if (audio.paused || audio.ended || audio.seeking) { wdAt = 0; wdPos = -1; return; }
  const p = audio.currentTime;
  if (p !== wdPos || !wdAt) { wdPos = p; wdAt = now; return; }
  if (now - wdAt > 20000) { wdAt = 0; wdPos = -1; recoverPlayback(true); }
}, 5000);

function makeAudio(useViz) {
  const a = new Audio();
  a.volume = volume;
  applySpeed(a);
  a.onplay = syncIcons;
  // конец трека: браузер сначала шлёт pause, потом ended. Этот pause — не остановка: ended сразу включит следующий
  // трек, а сообщи мы в Rust «не играет» — в трее страницу заморозило бы раньше, чем следующий трек загрузится.
  a.onpause = () => { if (!a.ended) syncIcons(); };
  a.onplaying = () => { applySpeed(a); if (a === audio) { loadAt = 0; wdPos = -1; wdAt = 0; if (transit) setTransit(false); } };
  a.onseeked = () => { if (a === audio) { window.discordPush?.(true); window.miniPush?.(true); } };
  a.onended = () => {
    if (a !== audio) return;
    setTransit(true);
    if (effRepeat() === 2) { a.currentTime = 0; a.play(); return; }
    if (wave.on) waveFeedback("trackFinished", queue[current], { totalPlayedSeconds: Math.round(a.duration) });
    const n = nextIndex(true);
    if (n >= queue.length && wave.on) {
      // очередь волны кончилась раньше, чем успела пополниться — ждём подгрузку, а не останавливаемся
      const cur = current;
      $("#status").textContent = "Загружаю следующие треки волны…";
      waveMore().then((ok) => {
        if (a !== audio || current !== cur) return;
        if (ok && cur + 1 < queue.length) { $("#status").textContent = ""; play(cur + 1); }
        else { setTransit(false); $("#status").textContent = "Не удалось получить следующие треки волны — нажми «Играть», чтобы повторить."; }
      });
      return;
    }
    if (n >= 0) play(n); else onQueueEnd();
  };
  a.ontimeupdate = () => {
    if (a === audio && a.duration) {
      $("#seek").value = (a.currentTime / a.duration) * 1000; fill($("#seek"));
      const tc = fmtTime(a.currentTime), td = fmtTime(a.duration);
      if ($("#tCur").textContent !== tc) $("#tCur").textContent = tc;
      if ($("#tDur").textContent !== td) $("#tDur").textContent = td;
      if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveLast(a.currentTime); }
    }
  };
  if (useViz) {
    actx ||= new AudioContext();
    if (!analyser) {
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.35;      // меньше сглаживания — удары не «размазываются»
      analyser.connect(actx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
    }
    a._src = actx.createMediaElementSource(a);
    a._src.connect(window.eqInput ? window.eqInput() : analyser);      // источник → эквалайзер → анализатор → динамики
  }
  return a;
}

const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
// анализ звука нужен, когда визуализатор включён и его видно (играет волна или открыта страница волны)
// Звуковой граф (Web Audio) нужен ещё и эквалайзеру (eq.js): с ним трек идёт через фильтры. Без визуализатора
// и с выключенным эквалайзером граф не создаётся вовсе — звук играет напрямую, без лишней работы.
function vizWanted() { return (cfg.viz && (wave.on || !$("#wavePage").hidden)) || !!window.eqActive?.(); }
function applyViz() {
  waveOrbitsSync();
  $("#viz").hidden = !cfg.viz;
  $("#vizFsBtn").hidden = !cfg.viz;
  if (!cfg.viz && vizFullOn) setVizFull(false);
  document.querySelector(".stage").classList.toggle("viz", cfg.viz);
  if ($("#wavePage").hidden) return;
  if (cfg.viz) { vizStart(); ensureVizAudio(); } else vizStop();
}
// Раньше анализ подключался только при старте СЛЕДУЮЩЕГО трека, поэтому сразу после включения визуализатор
// просто переливался. Теперь уже играющий трек незаметно переводится на анализируемый плеер с той же позиции.
let vizSwapSeq = 0;
let curFromWa = false;          // текущий трек играет из Whisper Archive (поток wa:// или, запасной путь, файл в curBlob)
async function ensureVizAudio() {
  if (!vizWanted() || audioViz || needLoad || !audio || !audio.src || current < 0 || !queue[current]) return;
  const my = ++vizSwapSeq, seq = playSeq, t = queue[current];
  let na = null;
  try {
    // Трек из архива: тот же поток wa:// (с CORS — его можно анализировать), ничего не качаем; если играл файл
    // целиком (запасной путь) — берём его. Брать трек у Яндекса нельзя — заиграла бы другая версия.
    // Скачанный трек (ymlocal://) — тот же файл с диска, тоже с CORS.
    const stream = (curFromWa || curLocal) && !curBlob ? audio.currentSrc || audio.src : "";
    let blob = curFromWa ? curBlob : null;
    if (!curFromWa && !curLocal) {
      const url = await directLink(t.id);
      const buf = await invoke("fetch_bytes", { url });
      if (my !== vizSwapSeq || seq !== playSeq || audioViz || !vizWanted()) return;
      blob = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
    }
    na = makeAudio(true);
    if (stream) na.crossOrigin = "anonymous";
    na.src = stream || blob;
    await new Promise((res, rej) => { na.addEventListener("loadedmetadata", res, { once: true }); na.addEventListener("error", () => rej(new Error("decode")), { once: true }); });
    if (my !== vizSwapSeq || seq !== playSeq || audioViz) throw new Error("stale");
    await Promise.race([actx.resume(), sleepMs(4000)]);
    if (actx.state !== "running") throw new Error("audio context");
    const old = audio, wasPlaying = !old.paused;
    na.currentTime = old.currentTime || 0;
    if (curBlob && curBlob !== blob) URL.revokeObjectURL(curBlob);
    curBlob = blob; audio = na; audioViz = true; na = null;
    if (wasPlaying) await audio.play();
    old.pause(); old._src?.disconnect(); old.removeAttribute("src"); old.load();
    syncIcons();
  } catch {
    if (na) { na.pause(); na._src?.disconnect(); na.removeAttribute("src"); na.load(); }
  }
}
function vizStart() { if (!viz.run) { viz.run = true; viz.lastDraw = 0; requestAnimationFrame(vizFrame); } }
// окно спрятано в трей или свёрнуто — циклы отрисовки останавливаются полностью; при показе — снова запускаются
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (!$("#wavePage").hidden || vizFullOn) applyViz();
  if (!$("#full").hidden && !fullRun) { fullRun = true; fLast.cur = -1; requestAnimationFrame(fullFrame); }
});
function vizStop() { viz.run = false; orbReset(); }

// Орбиты вокруг кнопки «Моя волна» (#waveOrbits, их рисует CSS стиля — например, Неон).
// Пока волна играет — у слоя класс .on, а вращения (@keyframes neonSpin) ускоряются через playbackRate:
// так скорость меняется плавно, без скачка фазы, как было бы при смене animation-duration.
function waveOrbitsSync() {
  const o = $("#waveOrbits");
  if (!o) return;
  const on = $("#waveBtn").classList.contains("playing");
  o.classList.toggle("on", on);
  if ($("#wavePage").hidden || getComputedStyle(o).display === "none") return;
  const rate = on ? 2.4 : 1;
  for (const a of o.getAnimations?.({ subtree: true }) || []) {
    if (/(^|-)neonSpin$/.test(a.animationName || "") && a.playbackRate !== rate) {
      if (a.updatePlaybackRate) a.updatePlaybackRate(rate); else a.playbackRate = rate;
    }
  }
}
// (состояние — в viz: vizStop может сработать раньше, чем объявлен кэш vz)
// такт для орбит: --kick (0…1) на .stage и ударная волна на каждый удар бочки (только при живом анализаторе)
function orbReset() {
  if (viz.orbKick !== undefined) { $(".stage")?.style.removeProperty("--kick"); viz.orbKick = undefined; }
  if (viz.orbLive) { $("#waveOrbits")?.classList.remove("beats"); viz.orbLive = false; }
}
function orbBeat(live) {
  const k = live ? Math.round(viz.kick * 40) / 40 : 0;
  if (k !== viz.orbKick) { viz.orbKick = k; vz.stage.style.setProperty("--kick", k); }
  if (live !== viz.orbLive) { viz.orbLive = live; vz.orb.classList.toggle("beats", live); }
  if (live && viz.beatNow) {
    viz.orbN = (viz.orbN + 1) % 2 || 0;
    const r = vz.orb.children[3 + viz.orbN];
    r?.animate?.([
      { opacity: 0.95, scale: 1, borderWidth: "3px" },
      { opacity: 0, scale: 1.85 + viz.kick * 0.25, borderWidth: "0.5px" },
    ], { duration: 950, easing: "cubic-bezier(.1, .6, .3, 1)" });
  }
}

// Кэш визуализатора: холсты, контексты, градиенты и таблицы синусов создаются один раз,
// а не 60 раз в секунду — меньше работы процессору и сборщику мусора.
const vz = { cv: null, g: null, cvF: null, gF: null, key: "", br: 56, grad: null, glow: null, bgrad: null, floor: null,
  N: 120, cos: null, sin: null, uIdx: null, pts: null };
function vzTables() {
  const N = vz.N; vz.cos = new Float32Array(N); vz.sin = new Float32Array(N); vz.uIdx = new Uint8Array(N); vz.pts = new Float32Array(N * 2);
  for (let j = 0; j < N; j++) {
    const th = (j / N) * Math.PI * 2;
    vz.cos[j] = Math.cos(th); vz.sin[j] = Math.sin(th);
    vz.uIdx[j] = Math.floor((Math.abs(th - Math.PI) / Math.PI) * 127);
  }
}
function vizFrame(ts) {
  if (!viz.run) return;
  if (document.hidden) { viz.run = false; return; }        // окно скрыто — цикл останавливается совсем (вернётся по visibilitychange)
  requestAnimationFrame(vizFrame);
  const live = audioViz && analyser && audio && !audio.paused;
  // не чаще ~60 кадров/с, пока играет, и ~30 в простое — на мониторах 120–165 Гц больше не рисуем лишнего
  if (ts - (viz.lastDraw || 0) < (live ? 13 : 30)) return;
  viz.lastDraw = ts;
  const full = vizFullOn;
  const cv = full ? (vz.cvF ||= $("#vizFullCv")) : (vz.cv ||= $("#viz")), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const g = full ? (vz.gF ||= cv.getContext("2d")) : (vz.g ||= cv.getContext("2d"));
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    vz.br = ($("#waveBtn").offsetWidth || 112) / 2;          // размер кнопки меняется только вместе с размером холста
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  // динамический фон — визуализатор в цветах обложки (они главнее и своих цветов визуализатора)
  const dp = dynColorsOn() && dynPal ? dynPal : null;
  const A = dp ? dp.accent : sty().cc?.vizA || sty().accent, B = dp ? dp.accent2 : sty().cc?.vizB || sty().accent2;
  const key = `${full}|${cfg.vizStyle}|${cfg.style}|${document.documentElement.dataset.anim}|${w}x${h}|${A}|${B}`;
  const fresh = key !== vz.key;
  if (fresh) {
    vz.key = key; vz.br = ($("#waveBtn").offsetWidth || 112) / 2;      // стиль мог поменять размер кнопки
    // отступ визуализатора от кнопки: стиль или тема может задать его переменной --viz-gap на .stage (Неону нужно место под орбиты)
    vz.stage = $(".stage"); vz.orb = $("#waveOrbits");
    vz.gapCss = parseFloat(getComputedStyle(vz.stage).getPropertyValue("--viz-gap"));
    vz.orbOn = !!vz.orb && document.documentElement.dataset.anim === "on" && getComputedStyle(vz.orb).display !== "none";
    if (!vz.orbOn) orbReset();
  }

  let bass = 0, mid = 0;
  if (live) {
    analyser.getByteFrequencyData(freq);
    for (let k = 1; k <= 6; k++) bass += freq[k];
    for (let k = 7; k <= 40; k++) mid += freq[k];
    bass /= 6 * 255; mid /= 34 * 255;
  }
  const dt = Math.min(0.1, Math.max(0.001, (ts - (viz.last || ts)) / 1000)) || 0.016; viz.last = ts;
  const k60 = dt * 60;                                           // поправка на частоту кадров
  const ease = (cur, target, up, down) => cur + (target - cur) * (1 - Math.pow(1 - (target > cur ? up : down), k60));

  // такт: энергия самого низа (бочка, 40–170 Гц) против её среднего за последние ~полсекунды
  if (live) {
    const e = (freq[1] + freq[2] + freq[3] + freq[4]) / (4 * 255);
    viz.eAvg += (e - viz.eAvg) * (1 - Math.pow(0.95, k60));
    if (e > viz.eAvg * 1.18 + 0.03 && e - viz.ePrev > 0.015 && ts - viz.lastBeat > 200) { viz.kick = 1; viz.lastBeat = ts; viz.beatNow = true; }
    viz.ePrev = e;
  }
  viz.kick *= Math.exp(-dt * 6.5);

  viz.bass = ease(viz.bass, bass, 0.75, 0.16);
  viz.mid = ease(viz.mid, mid, 0.35, 0.15);
  for (let k = 0; k < 128; k++) {
    const target = live ? freq[1 + Math.floor(Math.pow(k / 127, 1.7) * 150)] / 255 : 0;
    viz.sm[k] = ease(viz.sm[k], target, 0.6, 0.14);
  }

  if (!full && vz.orbOn) orbBeat(live);                          // орбиты Неона дышат в такт
  const t = ts / 1000, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2, N = vz.N, RINGS = 5;
  if (full) {                                        // на весь экран — свои, более лёгкие варианты, чтобы фон было видно
    if (cfg.vizStyle === "bars") drawBarsBottom(g, w, h, t, live, ease, fresh, A, B); else drawOrbit(g, w, h, t, live, A, B);
    viz.beatNow = false; return;
  }
  viz.beatNow = false;
  const br = vz.br;
  if (cfg.vizStyle === "bars") { drawBars(g, w, h, t, br, live, ease, fresh, A, B); return; }
  if (!vz.cos) vzTables();
  const gap = Number.isFinite(vz.gapCss) ? vz.gapCss : baseOf() === "steam" || baseOf() === "lolitta" ? 28 : 14;
  const inner = Math.min(br + gap, R * 0.5), outer = Math.max(inner + 20, R * 0.76);
  if (fresh) {
    vz.grad = g.createLinearGradient(0, 0, w, h);
    vz.grad.addColorStop(0, A); vz.grad.addColorStop(1, B);
    vz.glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.92);    // радиус не больше половины меньшей стороны — подсветка не упирается в края
    vz.glow.addColorStop(0, rgba(A, 1)); vz.glow.addColorStop(1, rgba(A, 0));
  }
  const grad = vz.grad;
  g.globalAlpha = 0.1 + viz.bass * 0.25 + viz.kick * 0.18;         // яркость подсветки — через прозрачность, градиент тот же
  g.fillStyle = vz.glow; g.fillRect(0, 0, w, h);

  g.globalCompositeOperation = "lighter";
  const cs = vz.cos, sn = vz.sin, ui = vz.uIdx, pts = vz.pts, wob = 0.7 + viz.mid * 1.6;
  for (let i = 0; i < RINGS; i++) {
    const base = (inner + ((outer - inner) * i) / (RINGS - 1)) * (1 + viz.bass * (0.08 - i * 0.012) + viz.kick * (0.075 - i * 0.01));
    const room = Math.max(R - 16 - base, 4);
    const p1 = t * 0.5 + i * 1.3, p2 = -t * 0.7 + i * 2.1, p3 = t * 0.9 + i * 0.7, amp = R * 0.13 * (1 - i * 0.1), floorDev = -(base - br - 6);
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const s = viz.sm[(ui[j] + i * 9) % 128];
      const noise = 0.05 * Math.sin(2 * th + p1) + 0.04 * Math.sin(3 * th + p2) + 0.03 * Math.sin(5 * th + p3);
      let dev = base * noise * wob + s * amp;
      if (dev > 0) dev = room * Math.tanh(dev / room);
      else if (dev < floorDev) dev = floorDev;
      const r = base + dev;
      pts[j * 2] = cx + cs[j] * r; pts[j * 2 + 1] = cy + sn[j] * r;
    }
    const path = new Path2D();
    path.moveTo((pts[(N - 1) * 2] + pts[0]) / 2, (pts[(N - 1) * 2 + 1] + pts[1]) / 2);
    for (let j = 0; j < N; j++) {
      const a = j * 2, b = ((j + 1) % N) * 2;
      path.quadraticCurveTo(pts[a], pts[a + 1], (pts[a] + pts[b]) / 2, (pts[a + 1] + pts[b + 1]) / 2);
    }
    path.closePath();
    if (i === 0) { g.globalAlpha = 0.07; g.fillStyle = grad; g.fill(path); }
    g.strokeStyle = grad;
    g.globalAlpha = 0.05; g.lineWidth = 18; g.stroke(path);
    g.globalAlpha = 0.12; g.lineWidth = 7; g.stroke(path);
    g.globalAlpha = Math.min(1, 0.6 - i * 0.07 + viz.kick * 0.3); g.lineWidth = 1.6 + viz.kick * 0.8; g.stroke(path);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}

// уровень k-го столбца из n: частоты по логарифмической шкале, бас — k = 0
const BAR_BINS = 340;                                                      // ~15 кГц при fftSize 1024
function barLevel(k, n, t, live) {
  if (!live) return 0.035 + 0.025 * Math.sin(t * 1.4 + k * 0.55);         // в тишине — лёгкая рябь
  const lo = Math.floor(Math.pow(BAR_BINS, k / n)), hi = Math.max(lo + 1, Math.floor(Math.pow(BAR_BINS, (k + 1) / n)));
  let v = 0;
  for (let b = lo; b < hi && b < freq.length; b++) v = Math.max(v, freq[b]);
  v = Math.min(1, (v / 255) * (0.85 + (k / n) * 0.55));                   // верха тише — немного подтягиваем
  return Math.pow(v, 1.6) + viz.kick * 0.12 * (1 - k / n);
}
// Столбцы, свечения и «шапки» собираются в общие контуры и рисуются одним вызовом.
// Режим смешивания «lighter» складывает цвета, порядок не важен, а фигуры не пересекаются — картинка та же.

// весь экран, «Столбцами»: эквалайзер вдоль нижнего края, столбцы растут снизу вверх,
// бас в центре, высокие к краям; занимает только нижнюю треть — остальной экран отдан фону
function drawBarsBottom(g, w, h, t, live, ease, fresh, A, B) {
  const half = w / 2 - 6, n = Math.max(16, Math.min(64, Math.floor(half / 15))), step = half / n, bw = Math.max(3, step * 0.58);
  const base = h, maxH = h * 0.32;
  if (fresh) {
    vz.floor = g.createLinearGradient(0, h, 0, h - h * 0.22);              // лёгкое свечение у пола, дышит с басом
    vz.floor.addColorStop(0, rgba(A, 1)); vz.floor.addColorStop(1, rgba(A, 0));
    vz.bgrad = g.createLinearGradient(0, base - maxH, 0, base);             // к верху столбец становится прозрачнее
    vz.bgrad.addColorStop(0, rgba(B, 0.35)); vz.bgrad.addColorStop(0.55, rgba(A, 0.8)); vz.bgrad.addColorStop(1, rgba(A, 0.95));
  }
  g.globalAlpha = 0.10 + viz.bass * 0.12 + viz.kick * 0.10;
  g.fillStyle = vz.floor; g.fillRect(0, h - h * 0.22, w, h * 0.22);
  g.globalCompositeOperation = "lighter";
  const glowP = new Path2D(), capP = new Path2D();
  g.fillStyle = vz.bgrad;
  for (let k = 0; k < n; k++) {
    viz.bars[k] = ease(viz.bars[k], barLevel(k, n, t, live), 0.65, 0.18);
    const hh = Math.max(3, Math.min(1, viz.bars[k]) * maxH);
    viz.peaks[k] = Math.max(hh, viz.peaks[k] - maxH * 0.5 / 60 * (live ? 1 : 3));
    const barP = new Path2D();
    for (let d = -1; d <= 1; d += 2) {
      const x = w / 2 + d * (k * step + step / 2) - bw / 2;
      glowP.roundRect(x - 3, base - hh - 3, bw + 6, hh + 3, [(bw + 6) / 2, (bw + 6) / 2, 0, 0]);
      barP.roundRect(x, base - hh, bw, hh, [bw / 2, bw / 2, 0, 0]);
      if (live) capP.rect(x, base - viz.peaks[k] - 7, bw, 2);
    }
    g.globalAlpha = 0.6 + Math.min(0.4, viz.bars[k] * 0.5); g.fill(barP);
  }
  g.globalAlpha = 0.1; g.fill(glowP);
  if (live) { g.globalAlpha = 0.75; g.fillStyle = B; g.fill(capP); }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}

// весь экран, «Круговой» → «Орбита»: пустой центр (сквозь него видно фон), вокруг — тонкие лучи-частоты,
// на каждую долю от кольца расходится тонкая волна, всё медленно вращается
function drawOrbit(g, w, h, t, live, A, B) {
  const cx = w / 2, cy = h / 2, m = Math.min(w, h);
  const r0 = m * 0.15 * (1 + viz.bass * 0.05 + viz.kick * 0.06), L = m * 0.19;
  g.globalCompositeOperation = "lighter";
  viz.ripples ||= [];
  if (viz.beatNow) { viz.ripples.push(t); if (viz.ripples.length > 6) viz.ripples.shift(); }
  while (viz.ripples.length && t - viz.ripples[0] >= 1.8) viz.ripples.shift();
  g.strokeStyle = A;
  for (const b of viz.ripples) {
    const age = (t - b) / 1.8, r = r0 + age * m * 0.42;
    g.globalAlpha = Math.pow(1 - age, 2) * 0.32; g.lineWidth = 1.2 + (1 - age) * 1.5;
    g.beginPath(); g.arc(cx, cy, Math.min(r, m * 0.5 - 4), 0, Math.PI * 2); g.stroke();
  }
  const N = 160, rot = t * 0.035, path = new Path2D();
  for (let j = 0; j < N; j++) {
    const u = (j <= N / 2 ? j : N - j) / (N / 2);
    const s = viz.sm[Math.min(127, Math.floor(u * 110))];
    const len = 2 + Math.pow(s, 1.25) * L + viz.kick * 5;
    const th = rot + (j / N) * Math.PI * 2 - Math.PI / 2, c = Math.cos(th), sn = Math.sin(th);
    path.moveTo(cx + c * (r0 + 6), cy + sn * (r0 + 6));
    path.lineTo(cx + c * (r0 + 6 + len), cy + sn * (r0 + 6 + len));
  }
  const rg = g.createRadialGradient(cx, cy, r0, cx, cy, r0 + L * 0.9);
  rg.addColorStop(0, A); rg.addColorStop(1, B);
  g.strokeStyle = rg; g.lineCap = "round";
  g.globalAlpha = 0.14; g.lineWidth = 6; g.stroke(path);
  g.globalAlpha = 0.9; g.lineWidth = 2; g.stroke(path);
  g.strokeStyle = A;
  g.globalAlpha = 0.55 + viz.kick * 0.45; g.lineWidth = 1.5 + viz.kick * 2;
  g.beginPath(); g.arc(cx, cy, r0, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 0.18; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, r0 * 0.9, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.lineCap = "butt";
}

// столбцы разной высоты: зеркально слева и справа от кнопки и вверх-вниз от средней линии; бас — у кнопки
function drawBars(g, w, h, t, br, live, ease, fresh, A, B) {
  const cy = h / 2, gapC = br + (Number.isFinite(vz.gapCss) ? vz.gapCss : 14), side = w / 2 - gapC - 6;
  if (side < 30) return;
  const n = Math.max(8, Math.min(64, Math.floor(side / 10))), step = side / n, bw = Math.max(2, step * 0.6);
  const maxH = Math.max(10, Math.min(h / 2 - 10, side * 0.9));            // никогда не выходит за холст
  if (fresh) {
    vz.glow = g.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.min(w, h) * 0.46);
    vz.glow.addColorStop(0, rgba(A, 1)); vz.glow.addColorStop(1, rgba(A, 0));
    vz.bgrad = g.createLinearGradient(0, cy - maxH, 0, cy + maxH);
    vz.bgrad.addColorStop(0, B); vz.bgrad.addColorStop(0.5, A); vz.bgrad.addColorStop(1, B);
  }
  g.globalAlpha = 0.08 + viz.bass * 0.2 + viz.kick * 0.15;
  g.fillStyle = vz.glow; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "lighter";
  const glowP = new Path2D(), capP = new Path2D();
  g.fillStyle = vz.bgrad;
  for (let k = 0; k < n; k++) {
    viz.bars[k] = ease(viz.bars[k], barLevel(k, n, t, live), 0.65, 0.18);
    const hh = Math.max(2, Math.min(1, viz.bars[k]) * maxH);
    viz.peaks[k] = Math.max(hh, viz.peaks[k] - maxH * 0.6 * (1 / 60) * (live ? 1 : 3));
    const barP = new Path2D(), p = Math.min(maxH, viz.peaks[k] + 4);
    for (let d = -1; d <= 1; d += 2) {
      const x = w / 2 + d * (gapC + k * step + step / 2) - bw / 2;
      glowP.roundRect(x - 2, cy - hh - 2, bw + 4, hh * 2 + 4, (bw + 4) / 2);      // мягкое свечение
      barP.roundRect(x, cy - hh, bw, hh * 2, bw / 2);
      if (live) { capP.rect(x, cy - p - 1.5, bw, 1.5); capP.rect(x, cy + p, bw, 1.5); }
    }
    g.globalAlpha = 0.55 + Math.min(0.45, viz.bars[k] * 0.6); g.fill(barP);
  }
  g.globalAlpha = 0.12; g.fill(glowP);
  if (live) { g.globalAlpha = 0.7; g.fillStyle = B; g.fill(capP); }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}

// ---------- визуализатор на весь экран: панели прячутся, остаются фон и визуализатор ----------
var vizFullOn = false, vfIdleT = 0;      // var: читается в applyViz ещё до этой строки
function vfPoke() {                                  // показать кнопку выхода и курсор, через пару секунд снова спрятать
  const el = $("#vizFull");
  el.classList.remove("idle");
  clearTimeout(vfIdleT);
  vfIdleT = setTimeout(() => el.classList.add("idle"), 2200);
}
async function setVizFull(on) {
  if (on === vizFullOn || (on && (!cfg.viz || $("#wavePage").hidden))) return;
  vizFullOn = on;
  document.body.classList.toggle("vizfull-on", on);
  $("#vizFull").hidden = !on;
  viz.peaks.fill(0);
  if (on) {
    // кнопки «плей» в этом режиме нет — если ничего не играет, продолжаем трек, на котором остановились
    if (!audio || audio.paused || needLoad) {
      if (queue[current]) togglePlay(); else $("#waveBtn").click();      // совсем пусто — запускаем Мою волну
    }
    vizStart(); ensureVizAudio(); vfPoke();
  } else clearTimeout(vfIdleT);
  try { await invoke("win_set_fullscreen", { on }); } catch {}      // нет команды в Rust — просто на всё окно
  syncMax();
}
$("#vizFsBtn").onclick = () => setVizFull(true);
$("#vizFsExit").onclick = () => setVizFull(false);
$("#vizFull").addEventListener("mousemove", vfPoke);
$("#vizFull").addEventListener("dblclick", () => setVizFull(false));
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, [contenteditable]")) return;
  if (vizFullOn) {
    if (e.key === "Escape") setVizFull(false);
    else if (e.key === " ") { e.preventDefault(); togglePlay(); vfPoke(); }
    else if (e.code === "KeyF") setVizFull(false);
  } else if (e.code === "KeyF" && !$("#wavePage").hidden && $("#full").hidden) setVizFull(true);
});

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
  document.documentElement.style.setProperty("--vol", String(volume));      // громкость числом 0…1 — для CSS тем (ручка громкости)
  if (hook("volKnob")) $("#volBtn").setAttribute("aria-valuenow", String(pct));
  thSync();
}
$("#vol").addEventListener("input", (e) => setVol(e.target.value / 100));
$("#volBtn").onclick = () => { if (knob.moved) { knob.moved = false; return; } if (volume > 0) { lastVol = volume; try { localStorage.setItem("ym_lastvol", String(lastVol)); } catch {} setVol(0); } else setVol(lastVol || 0.5); };
// Громкость ручкой (тема с controls.volume = "knob"): тянуть вверх/вправо — громче, вниз/влево — тише;
// короткий щелчок без движения — как раньше, выключить/вернуть звук. Стрелки — по 5 %.
const knob = { y: 0, x: 0, v: 0, id: null, moved: false };
$("#volBtn").addEventListener("pointerdown", (e) => {
  if (!hook("volKnob") || e.button !== 0) return;
  Object.assign(knob, { y: e.clientY, x: e.clientX, v: volume, id: e.pointerId, moved: false });
  e.currentTarget.setPointerCapture(e.pointerId);
});
$("#volBtn").addEventListener("pointermove", (e) => {
  if (knob.id !== e.pointerId) return;
  const d = knob.y - e.clientY + (e.clientX - knob.x);
  if (!knob.moved && Math.abs(d) < 4) return;
  knob.moved = true;
  setVol(knob.v + d / 160);
});
const knobEnd = (e) => { if (knob.id === e.pointerId) knob.id = null; };
$("#volBtn").addEventListener("pointerup", knobEnd);
$("#volBtn").addEventListener("pointercancel", (e) => { knobEnd(e); knob.moved = false; });
$("#volBtn").addEventListener("keydown", (e) => {
  if (!hook("volKnob")) return;
  const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
  if (d) { e.preventDefault(); e.stopPropagation(); setVol(volume + d); }
});
$("#volWrap").addEventListener("wheel", (e) => { e.preventDefault(); setVol(volume + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
$("#seek").addEventListener("input", (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; });

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
// Перетаскивание начинаем не сразу по нажатию, а при первом движении мыши с зажатой кнопкой.
// В Linux (GTK) окно, которое уже «тащат», забирает себе мышь, и второй щелчок двойного клика
// до страницы не доходил — разворот по двойному щелчку не работал. В Windows поведение то же, что было.
$("#titlebar").addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.target.closest("button")) return;
  if (e.detail === 2) { win("win_toggle_max"); return; }
  const x0 = e.screenX, y0 = e.screenY;
  const move = (m) => {
    if (!(m.buttons & 1)) return stop();
    if (Math.abs(m.screenX - x0) + Math.abs(m.screenY - y0) < 3) return;
    stop(); win("win_drag");
  };
  const stop = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", stop); };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", stop);
});
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(syncMax, 120); });
syncMax();

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
  let star = "";
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 34 : 38.5; star += `${i ? "L" : "M"}${(40 + r * Math.cos(a)).toFixed(1)} ${(40 + r * Math.sin(a)).toFixed(1)}`; }
  const medal = `<svg viewBox="0 0 80 80"><path d="${star}Z" fill="url(#loG)" stroke="var(--l-lo)" stroke-width=".8"/>
    <circle cx="40" cy="40" r="30" fill="var(--l-deep)" stroke="var(--l-hi)" stroke-width="1.6"/>
    <circle cx="40" cy="40" r="26.5" fill="url(#loM)"/><circle cx="40" cy="40" r="26.5" fill="none" stroke="var(--l-pearl)" stroke-width=".8" stroke-dasharray="1 2.2" opacity=".8"/>${P(40, 3.5, 2.6)}${P(40, 76.5, 2.6)}${P(3.5, 40, 2.6)}${P(76.5, 40, 2.6)}
    <path d="M67 2L69 10L77 12L69 14L67 22L65 14L57 12L65 10Z" fill="#fff" opacity=".95"/><circle cx="67" cy="12" r="4" fill="#fff" opacity=".35"/></svg>`;
  const defs = `<svg width="0" height="0" class="lo-defs" aria-hidden="true"><defs>
    <linearGradient id="loG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="lgs-l-hi"/><stop offset=".55" class="lgs-l-mid"/><stop offset="1" class="lgs-l-lo"/></linearGradient>
    <linearGradient id="loG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="lgs-l2-hi"/><stop offset=".55" class="lgs-l2-mid"/><stop offset="1" class="lgs-l2-lo"/></linearGradient>
    <radialGradient id="loR" cx=".42" cy=".38" r=".7"><stop offset="0" class="lgs-l-hi"/><stop offset=".55" class="lgs-l-mid"/><stop offset="1" class="lgs-l-lo"/></radialGradient>
    <radialGradient id="loP" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fff"/><stop offset=".45" class="lgs-l-pearl"/><stop offset="1" class="lgs-l-lo"/></radialGradient>
    <radialGradient id="loV" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="loM" cx=".5" cy=".3" r=".8"><stop offset="0" class="lgs-l-mid"/><stop offset=".6" class="lgs-l-lo"/><stop offset="1" class="lgs-l-btn"/></radialGradient>
  </defs></svg>`;
  const bow2 = bow.replaceAll("url(#loG)", "url(#loG2)");
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
  $("#waveBtn").after(box("lo-hearts", "<i></i>".repeat(8)));
}
loDecor();

audio = makeAudio(false);
setVol(volume);
updateModes(); setHeart($("#likeBtn"), false); setHeart($("#fLike"), false);
syncIcons();
(async () => {
  loadGot();
  const migMsg = await migrateLegacyToken();
  const has = await tokenExists();
  if (has === null) showLogin("Не найдены команды хранилища токена: обнови Rust-часть (auth.rs и net.rs).");
  else if (has && uid) { goTop(showLikes); restorePlayer(); loadLikedIds(); loadDislikedIds(); warnPlainSecrets(); }
  else showLogin(migMsg);
})();

// ---------- вкладки настроек: Оформление / Плеер / Сервисы ----------
// Карточки остаются прямыми детьми .settings (на это опираются стили и темы); видна вкладка из data-tab.
// Карточка без data-tab (её добавил другой модуль) попадает в «Сервисы».
(() => {
  const page = $("#settingsPage"), TABS = ["look", "player", "services"];
  let tab = "look";
  try { const v = localStorage.getItem("ym_set_tab"); if (TABS.includes(v)) tab = v; } catch {}
  function setTab(t) {
    tab = t; page.dataset.tab = t;
    for (const c of page.children) if (c.classList.contains("card") && !c.dataset.tab) c.dataset.tab = "services";
    document.querySelectorAll("#setTabs .chip").forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    try { localStorage.setItem("ym_set_tab", t); } catch {}
  }
  document.querySelectorAll("#setTabs .chip").forEach((b) => { b.onclick = () => { setTab(b.dataset.tab); document.querySelector(".main").scrollTop = 0; }; });
  new MutationObserver(() => setTab(tab)).observe(page, { childList: true });
  setTab(tab);
})();
