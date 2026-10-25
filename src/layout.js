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
  // sw — ширина боковой панели, ph — высота нижней (px, перетаскиванием за край); 0 — размер по умолчанию
  const ly = { side: "left", sb: "full", pl: "full", time: "always", sw: 0, ph: 0 };
  const SW_MIN = 170, SW_MAX = 440, PH_GROW = 160;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    for (const k of Object.keys(OPTS)) if (OPTS[k].includes(v?.[k])) ly[k] = v[k];
    if (Number.isFinite(v?.sw) && v.sw >= SW_MIN && v.sw <= SW_MAX) ly.sw = Math.round(v.sw);
    if (Number.isFinite(v?.ph) && v.ph > 0 && v.ph <= 600) ly.ph = Math.round(v.ph);
  } catch {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(ly)); } catch {} };

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
    // свои размеры панелей (CSS-правила в layout.css действуют, только пока стоит атрибут)
    const useSw = !locked && ly.sw > 0 && ly.sb !== "mini";
    const usePh = !locked && ly.ph > 0 && ly.pl !== "mini";
    if (useSw) { root.style.setProperty("--ly-sw", ly.sw + "px"); root.setAttribute("data-ly-sw", ""); }
    else { root.style.removeProperty("--ly-sw"); root.removeAttribute("data-ly-sw"); }
    if (usePh) { root.style.setProperty("--ly-ph", ly.ph + "px"); root.setAttribute("data-ly-ph", ""); }
    else { root.style.removeProperty("--ly-ph"); root.removeAttribute("data-ly-ph"); }
    document.querySelectorAll(".lyhandle").forEach((h) => (h.hidden = locked));
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
    persist();
    apply();
    window.dispatchEvent(new Event("resize"));      // визуализатор и прочее, что меряет себя по размеру, пересчитаются
  }
  window.layoutSet = set;

  // ---------- размер панелей перетаскиванием за край ----------
  // Боковая: уже SNAP_SW — сворачивается в полосу (мини-режим), из полосы тянется обратно в обычную, шире — до SW_MAX.
  // Нижняя: ниже обычной высоты на SNAP_PH — становится однострочной (мини-режим), выше — растёт до +PH_GROW.
  // Двойной щелчок по краю возвращает размер по умолчанию.
  const SNAP_SW = 130, SNAP_PH = 28;
  let rzFrame = 0;
  const changed = () => {
    apply();
    if (!rzFrame) rzFrame = requestAnimationFrame(() => { rzFrame = 0; window.dispatchEvent(new Event("resize")); });
  };
  function dragger(h, axis, onStart, onMove) {
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || locked) return;
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const st = onStart(e);
      h.classList.add("drag");
      root.classList.add("lyresizing", "lyresizing-" + axis);
      const move = (ev) => onMove(st, ev);
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        h.classList.remove("drag");
        root.classList.remove("lyresizing", "lyresizing-" + axis);
        persist();
        window.dispatchEvent(new Event("resize"));
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
  }
  function initResize() {
    const app = document.querySelector(".app"), side = document.querySelector(".side"), player = document.querySelector(".player");
    if (!app || document.querySelector(".lyhandle")) return;
    const mk = (cls, tip) => {
      const h = document.createElement("div");
      h.className = "lyhandle " + cls; h.title = tip; h.setAttribute("aria-hidden", "true");
      app.append(h);
      return h;
    };
    if (side) {
      const h = mk("lyh-side", "Потяни, чтобы изменить ширину панели\nДвойной щелчок — обычная ширина");
      dragger(h, "x", (e) => ({ x: e.clientX, w: side.getBoundingClientRect().width, dir: ly.side === "right" ? -1 : 1 }), (st, e) => {
        const w = st.w + st.dir * (e.clientX - st.x);
        if (w < SNAP_SW) { if (ly.sb !== "mini") { ly.sb = "mini"; changed(); } return; }
        const sw = Math.round(Math.min(SW_MAX, window.innerWidth * 0.45, Math.max(SW_MIN, w)));
        if (ly.sb !== "full" || ly.sw !== sw) { ly.sb = "full"; ly.sw = sw; changed(); }
      });
      h.addEventListener("dblclick", () => { ly.sw = 0; ly.sb = "full"; persist(); changed(); });
    }
    if (player) {
      const h = mk("lyh-pl", "Потяни, чтобы изменить высоту панели\nДвойной щелчок — обычная высота");
      // обычная высота нижней панели — без своей высоты и в полном режиме
      const natural = () => {
        const had = root.hasAttribute("data-ly-ph");
        if (had) root.removeAttribute("data-ly-ph");
        const v = player.getBoundingClientRect().height;
        if (had) root.setAttribute("data-ly-ph", "");
        return v;
      };
      dragger(h, "y", (e) => ({ y: e.clientY, h: player.getBoundingClientRect().height, nat: ly.pl === "full" ? natural() : 0 }), (st, e) => {
        const want = st.h + (st.y - e.clientY);
        // после смены режима отсчёт идёт заново от текущего положения курсора — без «дребезга» на пороге
        const rebase = () => { st.y = e.clientY; st.h = player.getBoundingClientRect().height; };
        if (ly.pl === "mini") {
          if (want < st.h + SNAP_PH) return;
          ly.pl = "full"; ly.ph = 0; apply();
          st.nat = natural(); rebase();
          changed();
          return;
        }
        if (!st.nat) st.nat = natural();
        if (want < st.nat - SNAP_PH) { ly.pl = "mini"; ly.ph = 0; apply(); rebase(); changed(); return; }
        const ph = Math.round(Math.min(st.nat + PH_GROW, want));
        const next = ph > st.nat + 3 ? ph : 0;
        if (ly.ph !== next) { ly.ph = next; changed(); }
      });
      h.addEventListener("dblclick", () => { ly.ph = 0; ly.pl = "full"; persist(); changed(); });
    }
  }

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
    initResize();
    apply();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
