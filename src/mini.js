// Мини-плеер у значка в трее. Что играет — присылает главное окно (через Rust: mini_state),
// кнопки уходят обратно через Rust (mini_ctl), который при необходимости будит главное окно.
(() => {
  const T = window.__TAURI__;
  const $ = (id) => document.getElementById(id);
  const ctl = (action) => T.core.invoke("mini_ctl", { action }).catch(() => {});
  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    repeatOne: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.2 10.6 12.6 10v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  let s = {}, raf = 0;

  function render(st) {
    s = st && typeof st === "object" ? st : {};
    const has = !!s.has;
    $("t").textContent = has ? s.title || "Без названия" : "Ничего не играет";
    $("a").textContent = has ? s.artist || "" : "";
    const cv = $("cv");
    if (s.cover && /^https:\/\//.test(s.cover)) { if (cv.getAttribute("src") !== s.cover) cv.src = s.cover; }
    else cv.removeAttribute("src");
    $("pp").innerHTML = s.playing ? ICON.pause : ICON.play;
    $("pp").title = s.playing ? "Пауза" : "Играть";
    const sh = $("sh");
    sh.disabled = !s.shuffleOk;
    sh.classList.toggle("on", !!s.shuffleOk && !!s.shuffle);
    sh.title = s.shuffleOk ? (s.shuffle ? "Случайный порядок: включён" : "Случайный порядок") : "Случайный порядок доступен только в альбомах и лайках";
    const rp = $("rp"), r = s.repeat | 0;
    rp.innerHTML = r === 2 ? ICON.repeatOne : ICON.repeat;
    rp.classList.toggle("on", r > 0);
    rp.title = ["Повтор выключен", "Повтор всего списка", "Повтор трека"][r] || "Повтор";
    for (const b of document.querySelectorAll(".ctl button:not(#sh)")) b.disabled = !has;
    const root = document.documentElement.style;
    if (/^#[0-9a-f]{3,8}$|^rgb/i.test(s.accent || "")) root.setProperty("--ac", s.accent);
    if (/^#[0-9a-f]{3,8}$|^rgb/i.test(s.accent2 || "")) root.setProperty("--ac2", s.accent2);
    tick();
  }

  // полоска времени идёт сама, пока играет и окно видно
  function tick() {
    cancelAnimationFrame(raf);
    const bar = $("bar");
    if (!s.has || !s.dur) { bar.style.width = "0"; return; }
    const pos = s.pos + (s.playing ? (Date.now() - s.at) / 1000 : 0);
    bar.style.width = Math.min(100, Math.max(0, (pos / s.dur) * 100)) + "%";
    if (s.playing && document.visibilityState === "visible") raf = requestAnimationFrame(() => setTimeout(tick, 250));
  }
  document.addEventListener("visibilitychange", tick);

  for (const b of document.querySelectorAll("button[data-a]")) {
    b.onclick = () => {
      const a = b.dataset.a;
      if (a === "toggle" && s.has) {           // отклик сразу, не дожидаясь главного окна
        s.pos = s.pos + (s.playing ? (Date.now() - s.at) / 1000 : 0); s.at = Date.now();
        s.playing = !s.playing; render(s);
      }
      ctl(a);
    };
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") ctl("hide");
    else if (e.key === " ") { e.preventDefault(); $("pp").click(); }
    else if (e.key === "ArrowRight") ctl("next");
    else if (e.key === "ArrowLeft") ctl("prev");
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  T.event.listen("mini-state", (e) => render(e.payload));
  T.core.invoke("mini_state_get").then(render).catch(() => render({}));
})();
