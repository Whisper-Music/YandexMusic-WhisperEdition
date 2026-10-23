// Расположение интерфейса: сторона и вид боковой панели, вид нижней панели, показ времени трека.
// Скрипт подключён в <head> без defer: атрибуты ставятся на <html> до отрисовки — без «прыжка» при запуске.
// Внешний вид режимов — в layout.css.
(() => {
  const KEY = "ym_layout";
  const OPTS = {
    side: ["left", "right"],
    sb: ["full", "mini"],
    pl: ["full", "mini"],
    time: ["always", "hover"],
  };
  const ly = { side: "left", sb: "full", pl: "full", time: "always" };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    for (const k of Object.keys(OPTS)) if (OPTS[k].includes(v?.[k])) ly[k] = v[k];
  } catch {}

  const root = document.documentElement;
  // стиль оформления задаёт расположение сам (settings → "layout": "fixed"): режимы не применяются,
  // но выбор пользователя сохраняется и вернётся вместе с другим стилем
  const DEF = { side: "left", sb: "full", pl: "full", time: "always" };
  let locked = false;
  window.layoutLock = (on) => {
    if (locked === !!on) return;
    locked = !!on; apply();
    window.dispatchEvent(new Event("resize"));
  };
  function apply() {
    for (const k of Object.keys(OPTS)) root.setAttribute("data-ly-" + k, locked ? DEF[k] : ly[k]);
    document.getElementById("layoutCard")?.classList.toggle("lylock", locked);
    // в свёрнутой панели подписей не видно — показываем их подсказкой
    const fold = document.getElementById("sideFold");
    if (fold) fold.hidden = locked;
    if (fold) {
      fold.textContent = "Свернуть";
      fold.title = ly.sb === "mini" ? "Развернуть панель" : "Свернуть панель";
      fold.setAttribute("aria-expanded", ly.sb === "mini" ? "false" : "true");
    }
    document.querySelectorAll(".side > .nav:not(.sidefold)").forEach((b) => {
      if (ly.sb === "mini") { if (!b.title) { b.title = b.textContent.trim(); b.dataset.lyTitle = "1"; } }
      else if (b.dataset.lyTitle) { b.removeAttribute("title"); delete b.dataset.lyTitle; }
    });
    document.querySelectorAll(".lyseg[data-k]").forEach((g) => {
      g.querySelectorAll(".chip").forEach((c) => {
        const on = c.dataset.v === ly[g.dataset.k];
        c.classList.toggle("active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
    });
  }
  apply();

  function set(k, v) {
    if (!OPTS[k]?.includes(v) || ly[k] === v) return;
    ly[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(ly)); } catch {}
    apply();
    window.dispatchEvent(new Event("resize"));      // визуализатор и прочее, что меряет себя по размеру, пересчитаются
  }
  window.layoutSet = set;

  function init() {
    // поиск — в обёртку: в свёрнутой панели он кружок со значком и раскрывается поверх контента
    const s = document.getElementById("search");
    if (s && !s.parentElement.classList.contains("sbox")) {
      const box = document.createElement("div");
      box.className = "sbox";
      s.before(box); box.append(s);
    }

    // кнопка сворачивания прямо на панели — в самом низу
    const side = document.querySelector(".side");
    if (side && !document.getElementById("sideFold")) {
      const b = document.createElement("button");
      b.className = "nav sidefold"; b.id = "sideFold"; b.type = "button";
      b.onclick = () => set("sb", ly.sb === "mini" ? "full" : "mini");
      side.append(b);
    }

    document.querySelectorAll(".lyseg[data-k]").forEach((g) => {
      g.querySelectorAll(".chip").forEach((c) => { c.type = "button"; c.onclick = () => set(g.dataset.k, c.dataset.v); });
    });

    // подсказка со временем под курсором на линии воспроизведения
    const seek = document.getElementById("seek"), row = seek?.closest(".seekrow");
    if (row) {
      const tip = document.createElement("div");
      tip.className = "seektip";
      row.append(tip);
      const dur = () => {
        try {
          if (audio && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
          return (queue?.[current]?.durationMs || 0) / 1000;
        } catch { return 0; }
      };
      const fmt = (x) => (typeof fmtTime === "function" ? fmtTime(x) : `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`);
      seek.addEventListener("pointermove", (e) => {
        const d = dur();
        if (!d) { row.classList.remove("tipon"); return; }
        const r = seek.getBoundingClientRect(), rr = row.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        tip.textContent = fmt(f * d);
        tip.style.left = Math.min(rr.width - 18, Math.max(18, e.clientX - rr.left)) + "px";
        row.classList.add("tipon");
      });
      seek.addEventListener("pointerleave", () => row.classList.remove("tipon"));
    }
    apply();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
