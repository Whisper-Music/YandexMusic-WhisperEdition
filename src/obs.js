// Виджет «Сейчас играет» для OBS: переключатель и параметры в настройках, передача состояния в Rust
// (src-tauri/src/obs.rs держит маленький сервер на 127.0.0.1 и отдаёт страницу виджета src-tauri/obs/widget.html).
// Оформление виджета под стиль: секции «@@ css whisper-obs» и «@@ settings whisper-obs» файла темы (theme.js → wmtObs).
(() => {
  const KEY = "ym_obs";
  const LAYOUTS = ["style", "card", "compact", "bar"];
  const DEF = { enabled: false, layout: "style", alpha: null, hideOnPause: false };
  let o = { ...DEF };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v === "object") {
      o.enabled = v.enabled === true;
      o.layout = LAYOUTS.includes(v.layout) ? v.layout : "style";
      o.alpha = typeof v.alpha === "number" && v.alpha >= 0 && v.alpha <= 1 ? v.alpha : null;
      o.hideOnPause = v.hideOnPause === true;
    }
  } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} };
  const call = (cmd, args) => Promise.resolve(invoke(cmd, args));
  const $o = (id) => document.getElementById(id);
  let port = 0, key = "", last = "", lastTheme = "";

  // цвета: при динамическом фоне — из обложки, иначе — цвета стиля (getComputedStyle тут не годится:
  // --accent зарегистрирован как <color> и читается как rgb(), а виджету нужен #rrggbb)
  function colors() {
    try {
      const p = cfg.dyn === true && typeof dynPal !== "undefined" && dynPal ? dynPal : sty();
      return { accent: p.accent, accent2: p.accent2 };
    } catch { return { accent: "#a66bff", accent2: "#e060ff" }; }
  }

  function snapshot() {
    const t = typeof current === "number" && current >= 0 ? queue?.[current] : null;
    const c = colors();
    return {
      has: !!t,
      id: t ? String(t.id ?? "") : "",
      title: t ? String(t.title || "") : "",
      artist: t ? (t.artists || []).map((a) => a?.name).filter(Boolean).join(", ") : "",
      cover: t ? cover(t, "200x200") || "" : "",
      playing: !!(audio && !audio.paused),
      pos: audio?.currentTime || 0,
      dur: audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (t?.durationMs || 0) / 1000,
      rate: audio?.playbackRate > 0 ? audio.playbackRate : 1,
      at: Date.now(),
      accent: c.accent, accent2: c.accent2,
      base: document.documentElement.dataset.base || "neon",
      layout: o.layout === "style" ? "" : o.layout,
      alpha: o.alpha,
      hideOnPause: o.hideOnPause,
    };
  }

  function push(force) {
    if (!port) return;
    const s = snapshot();
    const key = JSON.stringify({ ...s, pos: 0, at: 0 });
    if (!force && key === last) return;
    last = key;
    call("obs_state", { state: s }).catch(() => {});
  }
  function pushTheme(force) {
    if (!port) return;
    const t = (typeof cfg !== "undefined" && window.wmtObs?.(cfg.style)) || null;
    const css = t?.css || "", settings = t?.settings || {};
    const key = cfg.style + "|" + css.length + "|" + css.slice(0, 200) + "|" + JSON.stringify(settings);
    if (!force && key === lastTheme) return;
    lastTheme = key;
    call("obs_theme", { css, settings }).catch(() => {});
    paint();      // виды и размер в подсказке зависят от стиля
  }
  // что стиль говорит о виджете (settings whisper-obs): какие виды умеет и какой размер источника нужен в OBS
  function themeObs() {
    const s = (typeof cfg !== "undefined" && window.wmtObs?.(cfg.style)?.settings) || {};
    const layouts = Array.isArray(s.layouts) ? s.layouts.filter((l) => ["card", "compact", "bar"].includes(l)) : [];
    const ok = (n) => typeof n === "number" && isFinite(n) && n >= 40 && n <= 4000;
    const size = Array.isArray(s.size) && ok(s.size[0]) && ok(s.size[1]) ? s.size.map(Math.round) : null;
    return { layouts, size };
  }

  // main.js сообщает о смене трека, паузе, перемотке и скорости через miniPush — подключаемся туда же
  const prevPush = window.miniPush;
  window.miniPush = (force) => { prevPush?.(force); push(force); };
  window.obsPush = push;
  // цвета (динамический фон) и стиль меняются без miniPush — проверяем изредка, отправляется только изменившееся
  setInterval(() => { push(false); pushTheme(false); }, 1500);

  // ---------- настройки ----------
  // ключ в адресе обязателен (obs.rs): без него виджет не получит, что играет
  const url = () => (port ? `http://127.0.0.1:${port}/?k=${key}` : "");
  function paint(err) {
    const on = $o("obsOn"), box = $o("obsBox");
    if (!on) return;
    on.checked = o.enabled;
    box.hidden = !o.enabled;
    $o("obsUrl").value = url();
    const th = themeObs();
    document.querySelectorAll(".obsseg .chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.v === o.layout);
      // вид, которого стиль не умеет, недоступен (виджет всё равно покажет вид стиля)
      const off = th.layouts.length > 0 && c.dataset.v !== "style" && !th.layouts.includes(c.dataset.v);
      c.disabled = off;
      c.title = off ? "Этот стиль оформляет виджет только по-своему — вид из стиля" : c.dataset.v === "style" ? c.title : "";
    });
    const a = $o("obsAlpha");
    a.value = Math.round((o.alpha ?? 0.55) * 100);
    if (typeof fill === "function") fill(a);
    $o("obsAlphaVal").textContent = o.alpha === null ? "как в стиле" : a.value + "%";
    $o("obsHide").checked = o.hideOnPause;
    const n = $o("obsNote");
    n.classList.toggle("err", !!err);
    n.textContent = err
      ? "Виджет не запустился: " + err
      : "В OBS: Источники → «+» → Браузер → вставь адрес. " +
        (th.size ? `Размер для этого стиля: ${th.size[0]} × ${th.size[1]}.` : "Размер: 520 × 130 (для «Полоски» — 560 × 60).");
  }
  async function apply() {
    let err = "";
    try { const r = await call("obs_config", { enabled: o.enabled }); port = Number(r?.port) || 0; key = String(r?.key || ""); }
    catch (e) { port = 0; key = ""; err = String(e?.message || e); }
    if (port) { last = ""; lastTheme = ""; push(true); pushTheme(true); }
    paint(err);
  }
  function set(patch) { Object.assign(o, patch); save(); paint(); push(true); }

  const on = $o("obsOn");
  if (on) {
    on.onchange = () => { o.enabled = on.checked; save(); apply(); };
    $o("obsCopy").onclick = async () => {
      if (!port) return;
      try { await navigator.clipboard.writeText(url()); showToast("Адрес виджета скопирован", 2500, { kind: "ok" }); }
      catch { $o("obsUrl").select(); }
    };
    $o("obsUrl").onfocus = (e) => e.target.select();
    document.querySelectorAll(".obsseg .chip").forEach((c) => {
      c.type = "button";
      c.onclick = () => set({ layout: c.dataset.v });
    });
    $o("obsAlpha").oninput = (e) => set({ alpha: +e.target.value / 100 });
    $o("obsAlpha").ondblclick = () => set({ alpha: null });          // двойной щелчок — вернуть как в стиле
    $o("obsHide").onchange = (e) => set({ hideOnPause: e.target.checked });
  }
  paint();
  if (o.enabled) apply();
})();
