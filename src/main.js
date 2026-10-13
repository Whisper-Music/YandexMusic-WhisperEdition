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
ICON.more = svgp("M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z");
ICON.download = svgp("M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z");
ICON.got = svgp("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 5v6.6l2.3-2.3 1.4 1.4-4.7 4.7-4.7-4.7 1.4-1.4 2.3 2.3V7h2z");
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
let likedIds = new Set();
let playCtx = "other", shuffle = false, repeat = 0, order = [], ordPos = 0, orderFor = null;
{ const m = lsJSON("ym_modes", {}, (v) => typeof v === "object"); shuffle = !!m.shuffle; repeat = [0, 1, 2].includes(m.repeat) ? m.repeat : 0; }
const LK = { ctx: "likes" };
const got = new Set();
const PL = { list: null, loading: null, full: new Map(), covers: new Map() };
let curPl = null;
let likesTab = "likes";
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
  if (src) im.src = src;
  return im;
}

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

const STYLE_DEF = {
  neon:  { accent: "#a66bff", accent2: "#e060ff", glow: 22, panel: 70, dim: 10, bg: "" },
  royal: { accent: "#c9a24b", accent2: "#8b1e2d", glow: 6, panel: 92, dim: 10, bg: "" },
  steam: { accent: "#c58a4b", accent2: "#8c4f24", glow: 4, panel: 90, dim: 10, bg: "" },
  lolitta: { accent: "#e2aab4", accent2: "#8c4a5c", glow: 4, panel: 94, dim: 10, bg: "" },
};
const STYLE_KEYS = ["accent", "accent2", "glow", "panel", "dim"];
const freshCfg = () => ({ style: "royal", blur: 6, viz: true, vizStyle: "circle", anim: true, bg: "", s: Object.fromEntries(Object.keys(STYLE_DEF).map((k) => [k, { ...STYLE_DEF[k] }])) });
function loadCfg() {
  let saved = null, old = null;
  try { saved = JSON.parse(localStorage.getItem("ym_cfg3") || "null"); } catch {}
  try { old = JSON.parse(localStorage.getItem("ym_cfg2") || "null"); } catch {}
  const c = freshCfg();
  if (saved) {
    for (const k of ["style", "blur", "viz", "vizStyle", "bg", "anim"]) if (saved[k] !== undefined) c[k] = saved[k];
    for (const st of Object.keys(STYLE_DEF)) {
      Object.assign(c.s[st], saved.s?.[st] || {});
      if (saved.s?.[st]?.dim === undefined && saved.dim !== undefined) c.s[st].dim = saved.dim;
    }
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
  const pick = (bgs, cands, t = 4.5) => {
    let best = cands[0], bv = -1;
    for (const c of cands) { const v = Math.min(...bgs.map((b) => cr(b, H(c)))); if (v >= t) return { c, v }; if (v > bv) { best = c; bv = v; } }
    return { c: best, v: bv };
  };
  const set = (name, p) => {
    r.setProperty(name, p.c);
    r.setProperty(name + "-sh", p.v >= 4.5 ? "none" : relLum(H(p.c)) > 0.35 ? "0 1px 2px rgba(30,8,15,.9), 0 0 6px rgba(30,8,15,.6)" : "0 0 4px rgba(255,255,255,.9), 0 1px 0 rgba(255,255,255,.7)");
  };
  const darken = (base, p, maxLum) => { let c = mix(B, H(base), p); while (relLum(c) > maxLum && p > 0) { p = Math.max(0, p - 0.04); c = mix(B, H(base), p); } return c; };
  const btn = [darken("#2a1218", 0.6, 0.06), darken("#1c0b10", 0.42, 0.035)];
  r.setProperty("--l-btn", hex(btn[0])); r.setProperty("--l-btn2", hex(btn[1]));
  if (relLum(A) < 0.18) r.setProperty("--lo-title", hex(mix(A, H("#fff8f6"), 0.4))); else r.removeProperty("--lo-title");
  const act = [mix(A, W, 0.82), mix(A, B, 0.62)];
  const light = mix(A, H("#fbf0f0"), 0.5), lights = [mix(light, W, 0.55), light, mix(A, H("#f1d8d9"), 0.72)];
  const hi = mix(A, H("#fff8f6"), 0.4), lo = mix(A, B, 0.5), ink = mix(B, H("#24100f"), 0.64);
  set("--lo-on-btn", pick(btn, ["#f9eaec", LIGHT, DARK]));
  set("--lo-on-tab", pick(btn, [hex(hi), "#f9eaec", LIGHT, DARK]));
  set("--lo-on-act", pick(act, [LIGHT, DARK]));
  set("--lo-on-tabact", pick([mix(A, W, 0.75), A], [hex(ink), DARK, LIGHT]));
  set("--lo-ink", pick(lights, [hex(ink), DARK, LIGHT]));
  set("--lo-on-mid", pick([A, lo], [LIGHT, DARK], 1.8));
  if (Math.min(...btn.map((b) => cr(b, A))) < 2.2) r.setProperty("--lo-ic", r.getPropertyValue("--lo-on-btn"));
  else r.removeProperty("--lo-ic");
}
function applyCfg() {
  const r = document.documentElement.style, st = sty();
  document.documentElement.dataset.style = cfg.style;
  document.documentElement.dataset.anim = cfg.anim === false ? "off" : "on";
  r.setProperty("--accent", st.accent);
  r.setProperty("--accent2", st.accent2);
  const oa = onAccent(st.accent, st.accent2);
  r.setProperty("--on-accent", oa.color);
  r.setProperty("--on-accent-shadow", cfg.style === "neon" ? oa.shadow : "none");
  r.setProperty("--glow", (cfg.style === "neon" ? st.glow : STYLE_DEF[cfg.style].glow) + "px");
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
  applyViz();
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
  $("#cViz").checked = cfg.viz;
  syncVizStyles();
  $("#cAnim").checked = cfg.anim !== false;
  const neon = cfg.style === "neon";
  $("#cGlow").closest("label").style.display = neon ? "" : "none";
  $("#glassTitle").textContent = neon ? "Стекло и свечение" : "Панели";
  document.querySelectorAll(".stylecard").forEach((b) => b.classList.toggle("on", b.dataset.style === cfg.style));
  fillAll();
}
for (const [id, key, num] of SLIDERS) {
  const el = $(id);
  el.addEventListener("input", () => { setv(key, num ? +el.value : el.value); applyCfg(); });      // пока тянешь — только применяем
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
  const v = $("#bgVideo"), url = curBgVideo() ? curBg() : "";
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
// содержимое перетащенной папки (рекурсивно, не глубже 3 уровней)
async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.some((e) => e.isDirectory)) return [...dt.files];
  const out = [];
  const walk = async (e, depth) => {
    if (e.isFile) { out.push(await new Promise((r) => e.file(r, () => r(null)))); return; }
    if (!e.isDirectory || depth > 3) return;
    const rd = e.createReader();
    for (;;) {
      const batch = await new Promise((r) => rd.readEntries(r, () => r([])));
      if (!batch.length) break;
      for (const x of batch) await walk(x, depth + 1);
    }
  };
  for (const e of entries) await walk(e, 0);
  return out.filter(Boolean);
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
  for (const st of Object.keys(bgUrls)) {
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
$("#bgDir").onchange = async (e) => { const fs = [...e.target.files]; e.target.value = ""; await loadBgFiles(fs); };
$("#bgDirBtn").onclick = (e) => { e.preventDefault(); e.stopPropagation(); $("#bgDir").click(); };
const drop = $("#drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = async (e) => { e.preventDefault(); drop.classList.remove("over"); loadBgFiles(await filesFromDrop(e.dataTransfer)); };
$("#bgReset").onclick = async () => { await clearBg(); applyCfg(); saveCfg(); };
$("#cfgReset").onclick = async () => { const keep = cfg.style; for (const st of Object.keys(bgUrls)) await clearBg(st); cfg = freshCfg(); cfg.style = keep; applyCfg(); saveCfg(); syncControls(); };
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

async function finishLogin() {
  try {
    const st = await api("/account/status");
    uid = st.account.uid;
  } catch (e) {
    if (/^HTTP 40[13]/.test(String(e?.message))) { try { await invoke("token_clear"); } catch {} }
    throw e;
  }
  localStorage.setItem("ym_uid", uid);
}
function showLogin(msg = "") { $("#login").classList.remove("hidden"); $("#loginErr").textContent = msg; }
function afterLogin() { $("#login").classList.add("hidden"); goTop(showLikes); restorePlayer(); loadLikedIds(); }

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
$("#profile").onclick = async () => {
  if (!confirm("Выйти из аккаунта?")) return;
  try { await invoke("token_clear"); }
  catch (e) { alert("Не удалось удалить токен из системного хранилища: " + (e?.message || e) + "\nВыход не выполнен — попробуй ещё раз."); return; }
  localStorage.removeItem("ym_uid"); localStorage.removeItem(LEGACY_TOKEN_KEY);
  location.reload();
};

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
    s.onclick = (e) => { e.stopPropagation(); navigate(() => showArtist(a.id)); };
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
  $("#chips").hidden = true; $("#lastAlbum").hidden = true; $("#similar").hidden = true;
  $("#wavePage").hidden = true; $("#settingsPage").hidden = true; $("#statsPage").hidden = true;
  $("#plPage").hidden = true; $("#plBar").hidden = true; $("#plRecs").hidden = true; $("#plCreateBtn").hidden = true;
  curPl = null; recArr.length = 0; $("#plRecList").innerHTML = "";
  document.querySelector(".main").scrollTop = 0;
}
function setActive(id) {
  document.querySelectorAll(".side .nav").forEach((b) => b.classList.toggle("active", b.id === id));
  document.querySelector(".main").dataset.page = id || "";
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
  mk("Лайки", "likes", () => goTop(showLikes), null, "♥");
  for (const p of pins) {
    const open = p.type === "artist" ? () => showArtist(p.id) : p.type === "playlist" ? () => showPlaylist(p.id) : () => showAlbum(p.id);
    mk(p.title, pinKey(p.type, p.id), () => goTop(open), () => unpin(p.type, p.id), p.type === "artist" ? "♪" : p.type === "playlist" ? "♫" : roman(p.year) || "†");
  }
}
var trayPlaying = null;
function syncIcons() {
  const playing = !audio.paused;
  document.body.classList.toggle("is-playing", playing);
  $("#play").innerHTML = playing ? ICON.pause : ICON.play;
  $("#fPlay").innerHTML = playing ? ICON.pause : ICON.play;
  $("#waveBtn").innerHTML = wave.on && playing ? ICON.pause : ICON.play;
  $("#waveBtn").classList.toggle("playing", wave.on && playing);
  if (playing !== trayPlaying) { trayPlaying = playing; Promise.resolve(invoke("tray_playing", { playing })).catch(() => {}); }   // в трей — только при смене
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
});

function navigate(fn) { if (view) hist.push(view); view = fn; fn(); }
function goTop(fn) { hist.length = 0; view = fn; fn(); }
$("#likes").onclick = () => goTop(showLikes);
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
    } else {
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
    setHint("Запускаю…");
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
  setHint("Запускаю…");
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
    const r = await api(`/artists/${id}/direct-albums?page=${p}&page-size=100&sort-by=year`);
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
    api(`/artists/${id}/brief-info`).catch(() => null),
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
  refreshDlBtn();
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
async function lyricsRaw(id, fmt) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = await lyricsSign(id, ts);
  const r = await api(`/tracks/${id}/lyrics?format=${fmt}&timeStamp=${ts}&sign=${encodeURIComponent(sign)}`);
  if (!r?.downloadUrl) throw new Error("текста нет");
  const url = safeUrl(r.downloadUrl);
  if (!url) throw new Error("сервер вернул неожиданный адрес текста");
  const d = await http(url, { headers: { "User-Agent": "Yandex-Music-API" } });
  if (d.status < 200 || d.status >= 300) throw new Error("HTTP " + d.status);
  return d.body;
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
  const size = Math.max(120, Math.min(box.clientWidth, avail, 760));
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
  } else setFullMode("cover");
}

async function loadFullLyrics(t) {
  const my = ++fullSeq;
  const box = $("#fLyrics");
  box.className = "flyrics"; box.innerHTML = '<div class="fstatus">Ищу текст…</div>';
  fLines = []; fIdx = -1;
  setFullMode("lyrics");
  let res = lyricsCache.get(String(t.id));
  if (!res) { try { res = await fetchLyrics(t.id); } catch { res = { type: "none" }; } lyricsCache.set(String(t.id), res); if (lyricsCache.size > 60) lyricsCache.delete(lyricsCache.keys().next().value); }
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
  $("#full").hidden = false; syncBgVideo();      // плеер закрывает фон целиком — видеообои на паузу
  fillFull(t);
  fLast = { cur: -1, dur: -1, tc: "", td: "" };
  if (!fullRun) { fullRun = true; requestAnimationFrame(fullFrame); }
}
function closeFull() { $("#full").hidden = true; fullRun = false; fullSeq++; syncBgVideo(); }

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
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: cfg.anim === false ? "auto" : "smooth" });
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

function openTrackMenu(t, btn, ctx = null) { openMenu(btn, () => trackMenuMain(t, ctx)); }
function trackMenuMain(t, ctx) {
  menuReset();
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

const FORM_H = { "Content-Type": "application/x-www-form-urlencoded" };
const formBody = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
const plPath = (kind, tail = "") => `/users/${uid}/playlists/${kind}${tail}`;
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
  return (PL.loading ||= api(`/users/${uid}/playlists/list`)
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
  const p = await api(plPath(kind));
  const raw = Array.isArray(p.tracks) ? p.tracks : [];
  const items = raw.map((x) => ({ id: String(x.id ?? x.track?.id), albumId: x.albumId ?? albumOf(x.track) }));
  const list = raw.map((x) => x.track || null);
  const missing = list.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
  for (let s = 0; s < missing.length; s += 100) {
    const part = missing.slice(s, s + 100);
    try {
      const got = await api("/tracks", { method: "POST", headers: FORM_H, body: "track-ids=" + encodeURIComponent(part.map((i) => items[i].albumId ? `${items[i].id}:${items[i].albumId}` : items[i].id).join(",")) });
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
    return await api(plPath(kind, plChangeTail), { method: "POST", headers: FORM_H, body: formBody({ kind, revision, diff: JSON.stringify(ops) }) });
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
  const r = await api(`/users/${uid}/playlists/create`, { method: "POST", headers: FORM_H, body: formBody({ title, visibility: isPublic ? "public" : "private" }) });
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
    const res = await api(plPath(kind, "/name"), { method: "POST", headers: FORM_H, body: formBody({ value: r.value }) });
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
    await api(plPath(kind, "/delete"), { method: "POST", headers: FORM_H });
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
  li.scrollIntoView({ block: "nearest", behavior: cfg.anim === false ? "auto" : "smooth" });
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
    const r = await api(plPath(kind, "/recommendations"));
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
  refreshDlBtn();
}
async function loadGot() {
  try { const ids = await invoke("downloaded_ids"); got.clear(); for (const i of ids) got.add(String(i)); syncGot(); } catch {}
}
window.addEventListener("focus", loadGot);

async function downloadTrack(t, force = false) {
  if (!t) return;
  const id = String(t.id);
  if (downloading.has(id)) return showToast("Этот трек уже скачивается…");
  if (got.has(id) && !force) {
    return showToast(`«${t.title}» уже скачан`, 6000, { kind: "ok", action: { label: "Скачать ещё раз", fn: () => downloadTrack(t, true) } });
  }
  downloading.add(id); refreshDlBtn();
  const artists = (t.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const name = artists ? `${artists} — ${t.title}` : String(t.title || id);
  showToast(`Скачиваю «${t.title}»…`, 0);
  try {
    const url = await directLink(t.id);
    const path = await invoke("download_track", { url, name, id });
    got.add(id); syncGot();
    showToast(`Сохранено: ${path}`, 5000, { kind: "ok" });
  } catch (e) {
    showToast("Не удалось скачать: " + e.message, 6000);
  } finally { downloading.delete(id); refreshDlBtn(); }
}

$("#dlBtn").onclick = () => downloadTrack(queue[current]);
function refreshDlBtn() {
  const b = $("#dlBtn"), t = queue[current];
  b.disabled = !t;
  b.classList.toggle("busy", !!t && downloading.has(String(t.id)));
  const have = !!t && got.has(String(t.id));
  b.classList.toggle("got", have);
  b.innerHTML = have ? ICON.got : ICON.download;
  b.title = have ? "Трек скачан" : "Скачать трек";
}
refreshDlBtn();

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
    if (effRepeat() === 2) { a.currentTime = 0; a.play(); return; }
    if (wave.on) waveFeedback("trackFinished", queue[current], { totalPlayedSeconds: Math.round(a.duration) });
    const n = nextIndex(true);
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
    a._src.connect(analyser);
  }
  return a;
}

const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
// анализ звука нужен, когда визуализатор включён и его видно (играет волна или открыта страница волны)
function vizWanted() { return cfg.viz && (wave.on || !$("#wavePage").hidden); }
function applyViz() {
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
async function ensureVizAudio() {
  if (!vizWanted() || audioViz || needLoad || !audio || !audio.src || current < 0 || !queue[current]) return;
  const my = ++vizSwapSeq, seq = playSeq, t = queue[current];
  let na = null;
  try {
    const url = await directLink(t.id);
    const buf = await invoke("fetch_bytes", { url });
    if (my !== vizSwapSeq || seq !== playSeq || audioViz || !vizWanted()) return;
    na = makeAudio(true);
    const blob = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
    na.src = blob;
    await new Promise((res, rej) => { na.addEventListener("loadedmetadata", res, { once: true }); na.addEventListener("error", () => rej(new Error("decode")), { once: true }); });
    if (my !== vizSwapSeq || seq !== playSeq || audioViz) throw new Error("stale");
    await actx.resume();
    const old = audio, wasPlaying = !old.paused;
    na.currentTime = old.currentTime || 0;
    if (curBlob) URL.revokeObjectURL(curBlob);
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
function vizStop() { viz.run = false; }

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
  const A = sty().accent, B = sty().accent2;
  const key = `${full}|${cfg.vizStyle}|${cfg.style}|${w}x${h}|${A}|${B}`;
  const fresh = key !== vz.key;
  if (fresh) { vz.key = key; vz.br = ($("#waveBtn").offsetWidth || 112) / 2; }      // стиль мог поменять размер кнопки

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

  const t = ts / 1000, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2, N = vz.N, RINGS = 5;
  if (full) {                                        // на весь экран — свои, более лёгкие варианты, чтобы фон было видно
    if (cfg.vizStyle === "bars") drawBarsBottom(g, w, h, t, live, ease, fresh, A, B); else drawOrbit(g, w, h, t, live, A, B);
    viz.beatNow = false; return;
  }
  viz.beatNow = false;
  const br = vz.br;
  if (cfg.vizStyle === "bars") { drawBars(g, w, h, t, br, live, ease, fresh, A, B); return; }
  if (!vz.cos) vzTables();
  const inner = Math.min(br + (cfg.style === "steam" || cfg.style === "lolitta" ? 28 : 14), R * 0.5), outer = Math.max(inner + 20, R * 0.76);
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
  const cy = h / 2, gapC = br + 14, side = w / 2 - gapC - 6;
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
}
$("#vol").addEventListener("input", (e) => setVol(e.target.value / 100));
$("#volBtn").onclick = () => { if (volume > 0) { lastVol = volume; try { localStorage.setItem("ym_lastvol", String(lastVol)); } catch {} setVol(0); } else setVol(lastVol || 0.5); };
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
  const defs = `<svg width="0" height="0" style="position:absolute;width:0;height:0" aria-hidden="true"><defs>
    <linearGradient id="loG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--l-hi)"/><stop offset=".55" style="stop-color:var(--l-mid)"/><stop offset="1" style="stop-color:var(--l-lo)"/></linearGradient>
    <linearGradient id="loG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--l2-hi)"/><stop offset=".55" style="stop-color:var(--l2-mid)"/><stop offset="1" style="stop-color:var(--l2-lo)"/></linearGradient>
    <radialGradient id="loR" cx=".42" cy=".38" r=".7"><stop offset="0" style="stop-color:var(--l-hi)"/><stop offset=".55" style="stop-color:var(--l-mid)"/><stop offset="1" style="stop-color:var(--l-lo)"/></radialGradient>
    <radialGradient id="loP" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fff"/><stop offset=".45" style="stop-color:var(--l-pearl)"/><stop offset="1" style="stop-color:var(--l-lo)"/></radialGradient>
    <radialGradient id="loV" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="loM" cx=".5" cy=".3" r=".8"><stop offset="0" style="stop-color:var(--l-mid)"/><stop offset=".6" style="stop-color:var(--l-lo)"/><stop offset="1" style="stop-color:var(--l-btn)"/></radialGradient>
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
  else if (has && uid) { goTop(showLikes); restorePlayer(); loadLikedIds(); }
  else showLogin(migMsg);
})();
