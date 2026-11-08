// Значок в трее: обычное меню (по умолчанию) или мини-плеер (настройка «Значок в трее»).
// Здесь — переключатель в настройках и передача «что играет» в мини-плеер (окно mini.html, src-tauri/src/mini.rs).
// «Что играет» берётся только из ядра Whisper (Whisper.player) — модуль не зависит от переменных main.js.
(() => {
  const W = window.Whisper;
  const KEY = "ym_tray";
  const IS_WIN = /Windows/i.test(navigator.userAgent);
  let mode = "menu";
  try { if (localStorage.getItem(KEY) === "mini") mode = "mini"; } catch {}
  const call = (cmd, args) => Promise.resolve(window.__TAURI__.core.invoke(cmd, args)).catch(() => {});

  // в Linux мини-плеер открывается пунктом меню трея всегда, поэтому данные нужны ему в любом режиме
  const wanted = () => mode === "mini" || !IS_WIN;
  let last = "", queued = false, forceNext = false;

  function snapshot() {
    const p = W.player.state(), t = p.track;
    const css = getComputedStyle(document.documentElement);
    return {
      has: !!t,
      title: t ? t.title : "",
      artist: t ? t.artists.map((a) => a.name).filter(Boolean).join(", ") : "",
      cover: t ? W.cover(t, 200) : "",
      playing: p.playing,
      pos: p.position,
      rate: p.rate,                     // скорость: полоска в мини-плеере идёт с ней
      dur: p.duration,
      at: Date.now(),
      shuffleOk: p.modes.available, shuffle: p.modes.shuffle, repeat: p.modes.repeat,
      accent: css.getPropertyValue("--accent").trim(),
      accent2: css.getPropertyValue("--accent2").trim(),
    };
  }

  // смена трека, пауза/воспроизведение, перемотка, скорость, режимы повтора/перемешивания — от ядра
  function push(force) {
    if (!wanted()) return;
    if (force) forceNext = true;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {                 // несколько изменений подряд — одна отправка
      queued = false;
      const s = snapshot();
      const key = JSON.stringify({ ...s, pos: 0, at: 0 });
      const f = forceNext; forceNext = false;
      if (!f && key === last) return;
      last = key;
      call("mini_state", { state: s });
    });
  }
  W.player.watch(push);
  window.miniPush = push;          // для совместимости: кто-то снаружи может попросить отправить заново

  function apply() {
    call("tray_mode", { mini: mode === "mini" });
    document.querySelectorAll(".trseg .chip").forEach((c) => {
      const on = c.dataset.v === mode;
      c.classList.toggle("active", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
    last = ""; push(true);
  }
  document.querySelectorAll(".trseg .chip").forEach((c) => {
    c.type = "button";
    c.onclick = () => {
      if (mode === c.dataset.v) return;
      mode = c.dataset.v === "mini" ? "mini" : "menu";
      try { localStorage.setItem(KEY, mode); } catch {}
      apply();
    };
  });
  // в Linux щелчков по значку нет — подсказка, где искать мини-плеер
  if (!IS_WIN) { const n = document.getElementById("trayNote"); if (n) n.textContent = "Мини-плеер открывается пунктом «Мини-плеер» в меню значка."; }
  apply();

  // ---------- цвет значка: обычный, чёрный, белый, в цветах стиля ----------
  // Рисуем здесь на холсте (знак «W» с волнами, как на значке приложения) и отдаём Rust готовые пиксели (tray_icon).
  // Чёрный и белый — один знак без круга, как системные значки; «как в стиле» — круг в цветах акцента.
  const IC_KEY = "ym_tray_icon", IC_SIZE = 64, ICONS = ["app", "black", "white", "style"];
  let icon = "app";
  try { const v = localStorage.getItem(IC_KEY); if (ICONS.includes(v)) icon = v; } catch {}
  let icLast = "";
  function glyph(g, color, k) {
    g.save();
    g.translate(32, 32); g.scale(k, k); g.translate(-32, -32);
    g.strokeStyle = color; g.lineCap = "round"; g.lineJoin = "round";
    g.lineWidth = 8.5;
    g.beginPath(); g.moveTo(6, 22); g.lineTo(15, 44); g.lineTo(25, 29); g.lineTo(35, 44); g.lineTo(44, 22); g.stroke();
    g.lineWidth = 4.5;
    for (const r of [15, 22]) { g.beginPath(); g.arc(40, 33, r, -0.7, 0.7); g.stroke(); }
    g.restore();
  }
  // светлый акцент — знак тёмный, иначе белый (как --on-accent у стилей)
  // (--accent зарегистрирован как <color>, поэтому getComputedStyle отдаёт его как rgb(…), а не #rrggbb)
  function dark(c) {
    let m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c || ""), rgb;
    if (m) rgb = m.slice(1, 4).map((x) => parseInt(x, 16));
    else if ((m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c || ""))) rgb = m.slice(1, 4).map(Number);
    else return false;
    return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 170;
  }
  function paintIcon(force) {
    let key = icon;
    if (icon === "style") {
      const css = getComputedStyle(document.documentElement);
      key += css.getPropertyValue("--accent").trim() + css.getPropertyValue("--accent2").trim();
    }
    if (!force && key === icLast) return;
    icLast = key;
    if (icon === "app") { call("tray_icon", { rgba: null, size: 0 }); return; }
    const cv = document.createElement("canvas"); cv.width = cv.height = IC_SIZE;
    const g = cv.getContext("2d");
    if (icon === "style") {
      const css = getComputedStyle(document.documentElement);
      const a = css.getPropertyValue("--accent").trim() || "#a66bff", b = css.getPropertyValue("--accent2").trim() || "#e060ff";
      const gr = g.createLinearGradient(0, 0, IC_SIZE, IC_SIZE);
      gr.addColorStop(0, a); gr.addColorStop(1, b);
      g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 31.5, 0, Math.PI * 2); g.fill();
      glyph(g, dark(a) ? "#14101c" : "#ffffff", 0.74);
    } else glyph(g, icon === "black" ? "#000000" : "#ffffff", 1);
    call("tray_icon", { rgba: Array.from(g.getImageData(0, 0, IC_SIZE, IC_SIZE).data), size: IC_SIZE });
  }
  function paintIconSeg() {
    document.querySelectorAll(".tricseg .chip").forEach((c) => {
      const on = c.dataset.v === icon;
      c.classList.toggle("active", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  document.querySelectorAll(".tricseg .chip").forEach((c) => {
    c.type = "button";
    c.onclick = () => {
      if (icon === c.dataset.v || !ICONS.includes(c.dataset.v)) return;
      icon = c.dataset.v;
      try { localStorage.setItem(IC_KEY, icon); } catch {}
      paintIconSeg(); paintIcon(true);
    };
  });
  // «как в стиле»: цвета меняются со сменой стиля, своими цветами и динамическим фоном (обложка трека).
  // Цвета у <html> плавно перетекают (≈1,2 с), поэтому проверяем чуть позже и шлём только изменившееся.
  let icT = 0;
  const icSoon = () => { if (icon !== "style") return; clearTimeout(icT); icT = setTimeout(() => paintIcon(false), 1500); };
  new MutationObserver(icSoon).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-style", "class"] });
  W.on?.("track", icSoon);
  paintIconSeg();
  if (icon !== "app") setTimeout(() => paintIcon(true), 1200);   // при запуске — когда стиль уже применён
})();
