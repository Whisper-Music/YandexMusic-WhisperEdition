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
})();
