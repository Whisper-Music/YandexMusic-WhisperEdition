// Расположение интерфейса: сторона и вид боковой панели, вид нижней панели, показ времени трека,
// где показывать закреплённые (сверху закладками или сбоку колонкой — её рисует renderRail в main.js).
// Скрипт подключён в <head> без defer: атрибуты ставятся на <html> до отрисовки — без «прыжка» при запуске.
// Внешний вид режимов — в layout.css.
(() => {
  const KEY = "ym_layout";
  const OPTS = {
    side: ["left", "right"],
    sb: ["full", "mini"],
    pl: ["full", "mini"],
    time: ["always", "hover"],
    pins: ["top", "side"],          // закреплённые: полосой закладок сверху или колонкой у боковой панели (как папки в Telegram)
    pinhide: ["off", "on"],         // закреплённые спрятаны и выезжают при наведении на край (Интерфейс → «Скрывать закреплённые»)
    ui: ["normal", "super"],        // мини-вид: боковая панель — плавающая колонка значков, плеер — «таблетка» снизу
  };
  // sw — ширина боковой панели, ph — высота нижней (px, перетаскиванием за край); 0 — размер по умолчанию
  const ly = { side: "left", sb: "full", pl: "full", time: "always", pins: "top", pinhide: "off", ui: "normal", sw: 0, ph: 0 };
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
  const DEF = { side: "left", sb: "full", pl: "full", time: "always", pins: "top", pinhide: "off", ui: "normal" };
  let locked = false;
  const moved = [];                 // мини-вид: переставленные кнопки плеера и метки их мест (superDom)
  let smBtn = null;                 // мини-вид: кнопка «⋮» в таблетке
  window.layoutLock = (on) => {
    if (locked === !!on) return;
    locked = !!on; apply();
    window.dispatchEvent(new Event("resize"));
  };
  // стиль не выдерживает «Скрывать закреплённые» (settings → "features": { "pinHide": false }): режим не применяется,
  // выбор пользователя сохраняется и вернётся вместе с другим стилем (main.js → applyHooks)
  let noPinHide = false;
  window.layoutNoPinHide = (on) => {
    if (noPinHide === !!on) return;
    noPinHide = !!on; apply();
    window.dispatchEvent(new Event("resize"));
  };
  // в мини-вид боковая панель — всегда значками (правила свёрнутой панели), нижняя — своя раскладка,
  // закреплённые — закладками сверху (колонке сбоку негде встать); выбор пользователя для обычного вида сохраняется
  const isSuper = () => !locked && ly.ui === "super";
  const SUPER = { sb: "mini", pl: "full", pins: "top" };
  const eff = (k) => (locked ? DEF[k] : isSuper() && k in SUPER ? SUPER[k] : k === "pinhide" && noPinHide ? "off" : ly[k]);
  function apply() {
    for (const k of Object.keys(OPTS)) root.setAttribute("data-ly-" + k, eff(k));
    superDom(isSuper());
    // свои размеры панелей (CSS-правила в layout.css действуют, только пока стоит атрибут)
    const useSw = !locked && !isSuper() && ly.sw > 0 && ly.sb !== "mini";
    const usePh = !locked && !isSuper() && ly.ph > 0 && ly.pl !== "mini";
    if (useSw) { root.style.setProperty("--ly-sw", ly.sw + "px"); root.setAttribute("data-ly-sw", ""); }
    else { root.style.removeProperty("--ly-sw"); root.removeAttribute("data-ly-sw"); }
    if (usePh) { root.style.setProperty("--ly-ph", ly.ph + "px"); root.setAttribute("data-ly-ph", ""); }
    else { root.style.removeProperty("--ly-ph"); root.removeAttribute("data-ly-ph"); }
    document.querySelectorAll(".lyhandle").forEach((h) => (h.hidden = locked || isSuper()));
    document.getElementById("layoutCard")?.classList.toggle("lylock", locked);
    document.getElementById("layoutCard")?.classList.toggle("lysuper", isSuper());
    // в свёрнутой панели подписей не видно — показываем их подсказкой
    const fold = document.getElementById("sideFold");
    const sbMini = eff("sb") === "mini";
    if (fold) fold.hidden = locked;
    if (fold) {
      fold.textContent = "Свернуть";
      // в мини-вид эта кнопка возвращает обычный вид
      fold.title = isSuper() ? "Обычный вид (Ctrl+Shift+M)" : sbMini ? "Развернуть панель" : "Свернуть панель";
      fold.setAttribute("aria-expanded", sbMini ? "false" : "true");
    }
    document.querySelectorAll(".side > .nav:not(.sidefold)").forEach((b) => {
      if (sbMini) { if (!b.title) { b.title = b.textContent.trim(); b.dataset.lyTitle = "1"; } }
      else if (b.dataset.lyTitle) { b.removeAttribute("title"); delete b.dataset.lyTitle; }
    });
    const ph = document.getElementById("pinHide");
    if (ph) { ph.checked = ly.pinhide === "on"; ph.disabled = locked || noPinHide; }
    if (eff("pinhide") !== "on") root.classList.remove("pinpeek-on");
    measureSide();
    document.querySelectorAll(".lyseg[data-k]").forEach((g) => {
      g.querySelectorAll(".chip").forEach((c) => {
        const on = c.dataset.v === ly[g.dataset.k];
        c.classList.toggle("active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
    });
  }
  apply();

  // ---------- мини-вид ----------
  // Боковая панель — плавающая колонка значков слева по центру (правила свёрнутой панели + layout.css), плеер —
  // «таблетка» по центру снизу: слева плитка с обложкой и автором, в таблетке линия и кнопки ♥ ⏮ ⏯ ⏭ ✕ и «⋮».
  // «⋮» открывает над правым краем столбик значков: «Слушать вместе», сон, очередь и история, громкость, «⋯», режимы.
  // Лайк и дизлайк на это время переезжают в ряд кнопок, перемешивание и повтор — в столбик (на месте остаются
  // метки-комментарии, по ним всё возвращается). Ничего не пересоздаётся: те же кнопки с теми же id и обработчиками.
  // (moved и smBtn объявлены выше, рядом с locked: apply() зовёт superDom ещё при загрузке скрипта)
  function superDom(on) {
    const ctrls = document.querySelector(".player .ctrls"), pright = document.querySelector(".player .pright");
    if (!ctrls || !pright) return;                                   // разметки ещё нет (скрипт в <head>) — позже, из init()
    const has = moved.length > 0;
    if (on === has) return;
    if (on) {
      const put = (id, where) => {
        const el = document.getElementById(id);
        if (!el) return;
        const mark = document.createComment("ly-super:" + id);
        el.before(mark); moved.push([el, mark]); where(el);
      };
      put("likeBtn", (el) => ctrls.prepend(el));
      put("disBtn", (el) => ctrls.append(el));
      put("shuffleBtn", (el) => pright.prepend(el));
      put("repeatBtn", (el) => pright.prepend(el));
      if (!smBtn) {
        smBtn = document.createElement("button");
        smBtn.id = "smMore"; smBtn.type = "button"; smBtn.className = "smmore";
        smBtn.title = "Ещё: слушать вместе, сон, очередь, громкость";
        smBtn.setAttribute("aria-haspopup", "true");
        smBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>';
        smBtn.onclick = (e) => { e.stopPropagation(); smOpen(!root.classList.contains("sm-open")); };
      }
      ctrls.append(smBtn);
    } else {
      smOpen(false);
      while (moved.length) { const [el, mark] = moved.pop(); mark.replaceWith(el); }
      smBtn?.remove();
    }
    // Плитка, таблетка и столбик — каждая своя панель: класс .panel, чтобы их оформляли стиль и темы
    // (рамки «Мела», орнамент «Королевского»…) так же, как боковую панель. Свой фон у обёртки .player снят (layout.css).
    for (const el of document.querySelectorAll(".player > .pinfo, .player > .pcenter, .player > .pright")) {
      if (on && !el.classList.contains("panel")) { el.classList.add("panel"); el.dataset.lyPanel = "1"; }
      else if (!on && el.dataset.lyPanel) { el.classList.remove("panel"); delete el.dataset.lyPanel; }
    }
    tileTitle(on);
  }
  // название и автор — во всплывающей подсказке плитки (если не влезли целиком)
  let tileObs = null;
  function tileTitle(on) {
    const tile = document.querySelector(".player .pinfo"), t = document.getElementById("pTitle"), a = document.getElementById("pArtist");
    if (!tile || !t) return;
    const upd = () => { tile.title = [t.textContent.trim(), a?.textContent.trim()].filter(Boolean).join(" — "); };
    if (on) {
      upd();
      if (!tileObs && "MutationObserver" in window) {
        tileObs = new MutationObserver(upd);
        for (const n of [t, a]) if (n) tileObs.observe(n, { childList: true, characterData: true, subtree: true });
      }
    } else {
      tileObs?.disconnect(); tileObs = null;
      tile.removeAttribute("title");
    }
  }
  function smOpen(v) {
    root.classList.toggle("sm-open", !!v);
    smBtn?.setAttribute("aria-expanded", v ? "true" : "false");
  }
  // столбик закрывается щелчком мимо него и Esc (громкость и меню «⋯» внутри работают как обычно)
  document.addEventListener("pointerdown", (e) => {
    if (!root.classList.contains("sm-open")) return;
    if (e.target.closest?.(".player .pright, #smMore, .tmenu, .modal")) return;
    smOpen(false);
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("sm-open")) smOpen(false); });

  // Включить и выключить: Ctrl+Shift+M (в окне, не в полях ввода) или двойной щелчок по пустому месту боковой или
  // нижней панели (не по кнопкам, линии и подписям). В мини-вид ещё — кнопка-стрелка внизу колонки.
  let hintShown = false;
  function toggleSuper() {
    if (locked) { if (typeof showToast === "function") showToast("Стиль задаёт расположение сам — мини-вид с ним не работает", 3500); return; }
    set("ui", isSuper() ? "normal" : "super");
    if (isSuper() && !hintShown && typeof showToast === "function") {
      hintShown = true;
      showToast("Мини-вид: Ctrl+Shift+M или двойной щелчок по пустому месту панели — обычный вид", 5000);
    }
  }
  window.layoutToggleSuper = toggleSuper;
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyM")) return;
    if (e.target.closest?.("input, textarea, [contenteditable]") || document.querySelector(".modal")) return;
    e.preventDefault(); toggleSuper();
  });
  const EMPTY_SKIP = "button, a, input, select, textarea, label, [role=button], .seekrow, .meta, .cover, .volpop, .sbox, .lyhandle, .roomline";
  document.addEventListener("dblclick", (e) => {
    const t = e.target;
    if (!t.closest?.(".side, .player") || t.closest(EMPTY_SKIP)) return;
    window.getSelection?.()?.removeAllRanges();
    toggleSuper();
  });

  function set(k, v) {
    if (!OPTS[k]?.includes(v) || ly[k] === v) return;
    ly[k] = v;
    persist();
    apply();
    // колонка закреплённых стала видна — перерисовать, чтобы подтянулись обложки (renderRail — в main.js)
    if (k === "pins" && typeof renderRail === "function") { try { renderRail(typeof tabsActive !== "undefined" ? tabsActive : "likes"); } catch {} }
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

  // ---------- узкая боковая панель ----------
  // У стилей со значками в кнопках («Стимпанк», «Lolitta») длинные подписи («Статистика») в узкой панели
  // вылезали за край. По настоящей ширине панели ставим data-ly-sbw = s | xs — layout.css ужимает кнопки.
  function measureSide() {
    const side = document.querySelector(".side");
    if (!side) return;
    const w = side.getBoundingClientRect().width;
    const lvl = locked || eff("sb") === "mini" || !w ? "" : w < 205 ? "xs" : w < 240 ? "s" : "";
    if (lvl) { if (root.getAttribute("data-ly-sbw") !== lvl) root.setAttribute("data-ly-sbw", lvl); }
    else root.removeAttribute("data-ly-sbw");
  }

  // ---------- скрытые закреплённые: выезжают при наведении на край ----------
  // Сверху — по положению курсора: всё, что выше поиска (заголовок окна с «Yandex Music», промежуток,
  // верх боковой панели), открывает закладки; кнопки окна (свернуть/закрыть) — нет. Ловушка-элемент тут не годится:
  // широкую полосу пришлось бы класть поверх панелей, и она мешала бы нажимать.
  // Сбоку — полоса-«ловушка» .pinpeek в отступе окна с внешней стороны.
  // Открывшись, закладки/колонка раздвигают интерфейс и встают на место; увёл курсор — прячутся почти сразу.
  const PEEK_OPEN_MS = 60, PEEK_CLOSE_MS = 160;
  function initPeek() {
    const app = document.querySelector(".app");
    if (!app || document.querySelector(".pinpeek")) return;
    const zone = document.createElement("div");
    zone.className = "pinpeek"; zone.setAttribute("aria-hidden", "true");
    app.append(zone);
    let tOpen = 0, tClose = 0, closedAt = 0, rz = 0, openLim = 0;
    const on = () => eff("pinhide") === "on";
    const isOpen = () => root.classList.contains("pinpeek-on");
    // размеры панелей меняются плавно — визуализатор и прочее пересчитываются, когда движение закончится
    const resized = () => { clearTimeout(rz); rz = setTimeout(() => window.dispatchEvent(new Event("resize")), 260); };
    const toggle = (v) => {
      if (isOpen() === v) return;
      root.classList.toggle("pinpeek-on", v);
      if (!v) closedAt = Date.now();
      resized();
    };
    // таймеры не перезапускаются на каждое движение мыши — иначе, пока водишь курсором, панель не спряталась бы никогда;
    // сразу после закрытия не открываем заново: интерфейс съехал обратно и край мог оказаться под курсором
    const open = () => {
      clearTimeout(tClose); tClose = 0;
      if (tOpen || isOpen() || !on() || Date.now() - closedAt < 250) return;
      tOpen = setTimeout(() => { tOpen = 0; toggle(true); }, PEEK_OPEN_MS);
    };
    const close = () => {
      clearTimeout(tOpen); tOpen = 0;
      if (tClose || !isOpen()) return;
      tClose = setTimeout(() => { tClose = 0; toggle(false); }, PEEK_CLOSE_MS);
    };
    const keep = () => { clearTimeout(tClose); tClose = 0; };

    // ---- сверху ----
    // граница — верх поиска в боковой панели (в свёрнутой панели — кружок поиска); без поиска — верх панели + 24px.
    // Но не ниже верха основной части окна: в мини-виде колонка с поиском висит посередине окна, и закладки
    // открывались от наведения на жанры и заголовки страницы. Зона — только полоса у самого верха, над страницей.
    const searchTop = () => {
      const main = document.querySelector(".main")?.getBoundingClientRect();
      const cap = main && main.height ? main.top + 4 : Infinity;
      const s = document.querySelector(".side .sbox") || document.getElementById("search");
      const r = s?.getBoundingClientRect();
      if (r && r.height) return Math.min(r.top, cap);
      const side = document.querySelector(".side")?.getBoundingClientRect();
      return Math.min(side ? side.top + 24 : 80, cap);
    };
    document.addEventListener("pointermove", (e) => {
      if (!on() || root.getAttribute("data-ly-pins") !== "top") return;
      const tabs = document.getElementById("tabs");
      if (!tabs?.classList.contains("pins")) return;             // закреплённых нет — открывать нечего
      // открыто: держим, пока курсор выше прежней границы или над закладками (+ немного под ними);
      // прежняя граница — потому что интерфейс уехал вниз и поиск вместе с ним
      const lim = isOpen() ? Math.max(openLim, tabs.getBoundingClientRect().bottom + 10) : searchTop();
      const inside = e.clientY < lim && !e.target?.closest?.(".tbctl");
      if (!inside) { close(); return; }
      if (isOpen()) keep();
      else { openLim = lim; open(); }
    }, { passive: true });
    // курсор ушёл из окна (например, вверх за край) — прячем
    document.documentElement.addEventListener("mouseleave", () => { if (root.getAttribute("data-ly-pins") === "top") close(); });

    // ---- сбоку ----
    zone.addEventListener("pointerenter", open);
    zone.addEventListener("pointerleave", close);
    const rail = document.getElementById("pinRail");
    if (rail) {
      rail.addEventListener("pointerenter", () => { if (isOpen()) keep(); });
      rail.addEventListener("pointerleave", close);
    }
  }

  // ---------- поиск в свёрнутой панели: плавающее окошко ----------
  // В полосе поиск — кружок. Раньше по клику поле раскрывалось вбок прямо поверх страницы и закрывало её начало.
  // Теперь это окошко с ручкой сверху: тащишь за ручку — переезжает, куда удобно (место запоминается, ym_sfloat),
  // двойной щелчок по ручке — обратно к панели. Окошко живёт, пока поле в фокусе (Esc или щелчок мимо — закрыть).
  // Панель — containing block для position: fixed (у неё backdrop-filter, в мини-виде ещё и transform), поэтому
  // положение задаётся в координатах окна, а смещение до панели меряется и вычитается (place).
  const SF_KEY = "ym_sfloat", SF_W = 320, SF_H = 66;
  function initSearchFloat(box, inner, grip, input) {
    let pos = null;                     // { x, y } — левый верхний угол окошка в координатах окна
    try { const v = JSON.parse(localStorage.getItem(SF_KEY) || "null"); if (Number.isFinite(v?.x) && Number.isFinite(v?.y)) pos = { x: v.x, y: v.y }; } catch {}
    const mini = () => eff("sb") === "mini";
    const clamp = (p) => ({
      x: Math.round(Math.min(Math.max(8, p.x), Math.max(8, innerWidth - SF_W - 8))),
      y: Math.round(Math.min(Math.max(8, p.y), Math.max(8, innerHeight - SF_H - 8))),
    });
    // по умолчанию — рядом с кружком поиска, с внешней от панели стороны
    const home = () => {
      const r = box.getBoundingClientRect(), right = root.getAttribute("data-ly-side") === "right";
      return clamp({ x: right ? r.left - SF_W - 12 : r.right + 12, y: r.top - 16 });
    };
    function place(p) {
      // где окажется окошко при left/top = 0 — это и есть смещение containing block
      inner.style.setProperty("--sf-x", "0px"); inner.style.setProperty("--sf-y", "0px");
      const o = inner.getBoundingClientRect();
      inner.style.setProperty("--sf-x", Math.round(p.x - o.left) + "px");
      inner.style.setProperty("--sf-y", Math.round(p.y - o.top) + "px");
    }
    const open = () => {
      if (!mini() || box.classList.contains("sfloat")) return;
      box.classList.add("sfloat");
      place(clamp(pos || home()));
    };
    const close = () => { box.classList.remove("sfloat"); inner.style.removeProperty("--sf-x"); inner.style.removeProperty("--sf-y"); };
    input.addEventListener("focus", open);
    input.addEventListener("blur", () => { if (!root.classList.contains("sf-drag")) close(); });
    addEventListener("resize", () => { if (box.classList.contains("sfloat")) place(clamp(pos || home())); });
    // ручка: тянуть, не забирая фокус у поля (иначе окошко закрылось бы)
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const r = inner.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      root.classList.add("sf-drag");
      const move = (ev) => { pos = clamp({ x: ev.clientX - dx, y: ev.clientY - dy }); place(pos); };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        root.classList.remove("sf-drag");
        if (pos) { try { localStorage.setItem(SF_KEY, JSON.stringify(pos)); } catch {} }
        input.focus();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    grip.addEventListener("dblclick", (e) => {
      e.preventDefault();
      pos = null; try { localStorage.removeItem(SF_KEY); } catch {}
      place(home()); input.focus();
    });
  }

  function init() {
    // поиск — в обёртку: в свёрнутой панели он кружок со значком и раскрывается поверх контента
    const s = document.getElementById("search");
    if (s && !s.closest(".sbox")) {
      const box = document.createElement("div");
      box.className = "sbox";
      const inner = document.createElement("div");
      inner.className = "sinner";
      const grip = document.createElement("div");
      grip.className = "sgrip"; grip.title = "Потяни, чтобы передвинуть поиск\nДвойной щелчок — на место у панели";
      grip.setAttribute("aria-hidden", "true");
      s.before(box); inner.append(grip, s); box.append(inner);
      initSearchFloat(box, inner, grip, s);
    }

    // кнопка сворачивания прямо на панели — в самом низу
    const side = document.querySelector(".side");
    if (side && !document.getElementById("sideFold")) {
      const b = document.createElement("button");
      b.className = "nav sidefold"; b.id = "sideFold"; b.type = "button";
      b.onclick = () => (isSuper() ? set("ui", "normal") : set("sb", ly.sb === "mini" ? "full" : "mini"));
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
    const ph = document.getElementById("pinHide");
    if (ph) ph.onchange = () => set("pinhide", ph.checked ? "on" : "off");
    initPeek();
    const sideEl = document.querySelector(".side");
    if (sideEl && "ResizeObserver" in window) new ResizeObserver(() => measureSide()).observe(sideEl);
    initResize();
    apply();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
