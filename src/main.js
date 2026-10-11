const { invoke } = window.__TAURI__.core;

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
  neon:  { accent: "#a66bff", accent2: "#e060ff", glow: 22, panel: 70 },
  royal: { accent: "#c9a24b", accent2: "#8b1e2d", glow: 6, panel: 92 },
};
const STYLE_KEYS = ["accent", "accent2", "glow", "panel"];
const freshCfg = () => ({ style: "royal", dim: 10, blur: 6, viz: true, bg: "", s: { neon: { ...STYLE_DEF.neon }, royal: { ...STYLE_DEF.royal } } });
function loadCfg() {
  let saved = null, old = null;
  try { saved = JSON.parse(localStorage.getItem("ym_cfg3") || "null"); } catch {}
  try { old = JSON.parse(localStorage.getItem("ym_cfg2") || "null"); } catch {}
  const c = freshCfg();
  if (saved) {
    for (const k of ["style", "dim", "blur", "viz", "bg"]) if (saved[k] !== undefined) c[k] = saved[k];
    for (const st of ["neon", "royal"]) Object.assign(c.s[st], saved.s?.[st] || {});
  } else if (old) {                       // прежние настройки (до выбора стиля) относились к неону
    for (const k of ["dim", "blur", "viz", "bg"]) if (old[k] !== undefined) c[k] = old[k];
    for (const k of STYLE_KEYS) if (old[k] !== undefined) c.s.neon[k] = old[k];
  }
  if (!c.s[c.style]) c.style = "royal";
  return c;
}
let cfg = loadCfg();
let bgUrl = "";          // blob-адрес текущего фона; сам файл лежит в IndexedDB, а в cfg.bg — только метка "idb"
const sty = () => cfg.s[cfg.style];

function fill(el) { el.style.setProperty("--p", ((el.value - el.min) / (el.max - el.min)) * 100 + "%"); }
function fillAll() { document.querySelectorAll("input[type=range]").forEach(fill); }

function applyCfg() {
  const r = document.documentElement.style, st = sty();
  document.documentElement.dataset.style = cfg.style;
  r.setProperty("--accent", st.accent);
  r.setProperty("--accent2", st.accent2);
  r.setProperty("--glow", st.glow + "px");
  r.setProperty("--panel-a", st.panel / 100);
  r.setProperty("--dim", cfg.dim / 100);
  r.setProperty("--bgblur", cfg.blur + "px");
  const img = bgUrl ? `url("${bgUrl}")` : "none";
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
function setBgBlob(blob) {
  if (bgUrl) URL.revokeObjectURL(bgUrl);
  bgUrl = blob ? URL.createObjectURL(blob) : "";
}
function dataUrlToBlob(u) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(u);
  if (!m) throw new Error("bad data url");
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] || "application/octet-stream" });
}

const BG_MAX_BYTES = 150 * 1048576;     // больше этого фон не берём
const BG_MAX_SIDE = 3840;     // всё, что больше 4K, уменьшаем — иначе размытие и память страдают без пользы
// проверяет файл и возвращает { blob, info }; если файл не подходит — бросает ошибку с понятным текстом
async function prepareBg(f) {
  if (/^(video|audio)\//.test(f.type)) throw new Error("Видео и звук как фон не поддерживаются — выбери картинку или GIF.");
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  // сначала createImageBitmap (справляется и с очень большими снимками), затем <img> (понимает, например, SVG)
  let w = 0, h = 0;
  try { const bm = await createImageBitmap(f); w = bm.width; h = bm.height; bm.close(); }
  catch {
    const url = URL.createObjectURL(f);
    try { const img = new Image(); img.src = url; await img.decode(); w = img.naturalWidth; h = img.naturalHeight; }
    catch { throw new Error(`Не получилось открыть «${f.name}»: формат ${ext ? "." + ext : f.type || "файла"} не поддерживается. Подойдут JPG, PNG, WebP, GIF, AVIF, BMP.`); }
    finally { URL.revokeObjectURL(url); }
  }
  const flat = ["image/jpeg", "image/png", "image/bmp"].includes(f.type);      // gif/webp могут быть анимированными — их не трогаем
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
  bgNote("Загружаю…");
  let prep;
  try { prep = await prepareBg(f); }
  catch (e) { bgNote(e.message || "Не удалось прочитать файл."); return false; }
  setBgBlob(prep.blob);
  cfg.bg = "idb";
  applyCfg();
  let kept = true;
  try { await IDB.set("bg", prep.blob); }
  catch (e) {
    kept = false;
    bgNote(e?.name === "QuotaExceededError" ? "Фон применён, но на диске не хватает места, чтобы сохранить его: после перезапуска он пропадёт." : "Фон применён, но сохранить его не удалось: после перезапуска он пропадёт.");
  }
  if (saveCfg() && kept) bgNote(prep.info);
  return true;
}
async function clearBg() {
  setBgBlob(null); cfg.bg = "";
  try { await IDB.del("bg"); } catch {}
}
// при старте: достаём файл из IndexedDB; фон из старой версии (data-URL в localStorage) переносим туда же
async function initBg() {
  try {
    if (cfg.bg && cfg.bg !== "idb") {
      const blob = dataUrlToBlob(cfg.bg);
      await IDB.set("bg", blob); cfg.bg = "idb";
    }
    if (cfg.bg === "idb") {
      const blob = await IDB.get("bg");
      if (blob) setBgBlob(blob); else cfg.bg = "";
    }
  } catch { cfg.bg = ""; }
  if (saveCfg()) localStorage.removeItem("ym_cfg2");          // прежние настройки (с тяжёлой картинкой внутри) больше не нужны
  applyCfg();
}
$("#bgFile").onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; await loadBg(f); };
const drop = $("#drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); loadBg(e.dataTransfer.files[0]); };
$("#bgReset").onclick = async () => { await clearBg(); applyCfg(); saveCfg(); };
$("#cfgReset").onclick = async () => { const keep = cfg.style; await clearBg(); cfg = freshCfg(); cfg.style = keep; applyCfg(); saveCfg(); syncControls(); };
$("#cViz").onchange = (e) => { cfg.viz = e.target.checked; applyViz(); saveCfg(); };

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
  if (!bgUrl) { note.textContent = "Сначала загрузи фон: цвета подбираются по нему."; return { ok: false }; }
  try {
    const p = await paletteFrom(bgUrl);
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
  if (!legacy) return;
  try { await invoke("token_store", { token: legacy }); localStorage.removeItem(LEGACY_TOKEN_KEY); } catch {}
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

function setHead({ title = "", img = "", round = true, back = false, sub = null, pin = null }) {
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
  $("#wavePage").hidden = true; $("#settingsPage").hidden = true;
  document.querySelector(".main").scrollTop = 0;
}
function setActive(id) { document.querySelectorAll(".side .nav").forEach((b) => b.classList.toggle("active", b.id === id)); }
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
  $("#play").innerHTML = playing ? ICON.pause : ICON.play;
  $("#fPlay").innerHTML = playing ? ICON.pause : ICON.play;
  $("#waveBtn").innerHTML = wave.on && playing ? ICON.pause : ICON.play;
  $("#waveBtn").classList.toggle("playing", wave.on && playing);
}

// ---------- навигация ----------
function navigate(fn) { if (view) hist.push(view); view = fn; fn(); }   // переход «вглубь»
function goTop(fn) { hist.length = 0; view = fn; fn(); }                   // разделы боковой панели
$("#likes").onclick = () => goTop(showLikes);
$("#wave").onclick = () => goTop(showWave);
$("#settingsBtn").onclick = () => goTop(showSettings);
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
const GROUPS = [["genre", "Жанры"], ["mood", "Настроения"], ["epoch", "Эпохи"], ["activity", "Занятия"]];
const stations = { loaded: false, groups: {}, tab: "genre" };

async function loadStations() {
  if (stations.loaded) return;
  const r = await api("/rotor/stations/list?language=ru");
  for (const it of r) {
    const st = it.station; if (!st || !st.name) continue;
    const type = st.id?.type ?? String(st.id).split(":")[0];
    const tag = st.id?.tag ?? String(st.id).split(":")[1];
    if (!type || !tag) continue;
    (stations.groups[type] ||= []).push({ seed: `${type}:${tag}`, name: st.name });
  }
  stations.loaded = true;
  if (!stations.groups[stations.tab]) stations.tab = GROUPS.map((g) => g[0]).find((t) => stations.groups[t]) || stations.tab;
}
function renderStations() {
  const chips = $("#stChips"); chips.innerHTML = "";
  const mk = (label, active, fn) => {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " active" : ""); b.textContent = label; b.onclick = fn; return b;
  };
  for (const [type, label] of GROUPS) {
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
  box.style.maxHeight = Math.max(150, Math.min(room, window.innerHeight * 0.5)) + "px";
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
  try { await loadStations(); renderStations(); }
  catch (e) { $("#stGrid").textContent = "Не удалось загрузить список: " + e.message; }
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
    setHead({ title: name, img: c ? cover({ coverUri: c }, "200x200") : "", back: true, pin: info?.artist?.name ? { type: "artist", id, title: name } : null });
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
function closeFull() { $("#full").hidden = true; fullRun = false; fullSeq++; }

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
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: "smooth" });
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
  const inner = Math.min(br + 14, R * 0.5), outer = Math.max(inner + 20, R * 0.76);
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

// ---------- старт ----------
audio = makeAudio(false);
setVol(volume);
updateModes(); setHeart($("#likeBtn"), false); setHeart($("#fLike"), false);
syncIcons();
(async () => {
  await migrateLegacyToken();
  const has = await tokenExists();
  if (has === null) showLogin("Не найдены команды хранилища токена: обнови Rust-часть (auth.rs и net.rs).");
  else if (has && uid) { goTop(showLikes); restorePlayer(); loadLikedIds(); }
  else showLogin();
})();
