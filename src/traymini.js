// Значок в трее: обычное меню (по умолчанию) или мини-плеер (настройка «Значок в трее»).
// Здесь — переключатель в настройках и передача «что играет» в мини-плеер (окно mini.html, src-tauri/src/mini.rs).
(() => {
  const KEY = "ym_tray";
  const IS_WIN = /Windows/i.test(navigator.userAgent);
  let mode = "menu";
  try { if (localStorage.getItem(KEY) === "mini") mode = "mini"; } catch {}
  const call = (cmd, args) => Promise.resolve(window.__TAURI__.core.invoke(cmd, args)).catch(() => {});

  // в Linux мини-плеер открывается пунктом меню трея всегда, поэтому данные нужны ему в любом режиме
  const wanted = () => mode === "mini" || !IS_WIN;
  let last = "", queued = false, forceNext = false;

  function snapshot() {
    const t = typeof current === "number" && current >= 0 ? queue?.[current] : null;
    const css = getComputedStyle(document.documentElement);
    const st = {
      has: !!t,
      title: t ? String(t.title || "") : "",
      artist: t ? (t.artists || []).map((a) => a?.name).filter(Boolean).join(", ") : "",
      cover: t ? cover(t, "200x200") || "" : "",
      playing: !!(audio && !audio.paused),
      pos: audio?.currentTime || 0,
      rate: audio?.playbackRate > 0 ? audio.playbackRate : 1,         // скорость: полоска в мини-плеере идёт с ней
      dur: audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (t?.durationMs || 0) / 1000,
      at: Date.now(),
      shuffleOk: false, shuffle: false, repeat: 0,
      accent: css.getPropertyValue("--accent").trim(),
      accent2: css.getPropertyValue("--accent2").trim(),
    };
    try { st.shuffleOk = modesActive(); st.shuffle = st.shuffleOk && shuffle; st.repeat = effRepeat(); } catch {}
    return st;
  }

  // вызывается из main.js: смена трека, пауза/воспроизведение, перемотка, режимы повтора/перемешивания
  window.miniPush = (force) => {
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
  };

  function apply() {
    call("tray_mode", { mini: mode === "mini" });
    document.querySelectorAll(".trseg .chip").forEach((c) => {
      const on = c.dataset.v === mode;
      c.classList.toggle("active", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
    last = ""; window.miniPush(true);
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
})();
