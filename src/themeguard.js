// Защита от «странных» стилей: что бы ни сделала тема .wmt, у пользователя остаётся обязательный минимум.
//
// Минимум — это действия, а не конкретные элементы:
//   * окно: закрыть, свернуть, перетащить (у окна нет системной рамки — без них его даже не закрыть);
//   * «Играть/пауза»;
//   * настройки (там меняется стиль).
// Действие доступно, если видна родная кнопка, ИЛИ у темы есть своя кнопка с этим действием (settings → "buttons":
// close, minimize, drag, play, page:settings), ИЛИ это стиль-консоль (play / style / gui — команды cli.js).
// Так перестроенные темы (retro-tv, консоль) проходят проверку, а тема, которая просто всё спрятала, — нет.
//
// Проверяются только свои стили (встроенные — наши), через пару секунд после включения стиля, при смене размера
// окна и раз в 20 с. «Видна» — у элемента есть размер, центр в окне, ни он, ни родители не спрятаны
// (display / visibility / opacity), и в центре его ничего не перекрывает (elementsFromPoint). Пока открыты окна,
// меню, очередь или плеер на весь экран — проверка откладывается: перекрывают они честно.
//
// Не прошла два раза подряд — сверху появляется аварийная полоса: кнопки недостающих действий и «Стандартный стиль».
// Полоса выводится в верхнем слое (popover), а оформление у неё — только свои инлайн-стили с !important: CSS темы
// её не перебьёт (инлайн !important сильнее любого правила из таблицы стилей). Если тема всё же спрятала и полосу
// (например, скрыла весь body), включается встроенный «Королевский» — как по Ctrl+Shift+Backspace.
// Автор ошибся, а у пользователя всё в порядке (кнопки показываются при наведении и т. п.) — «Не показывать для
// этого стиля» запоминает выбор (localStorage ym_tguard).
(() => {
  const KEY = "ym_tguard", PERIOD = 20000;
  const dismissed = new Set(lsJSON(KEY, [], Array.isArray).filter((x) => typeof x === "string").slice(0, 100));
  const saveDismissed = () => { try { localStorage.setItem(KEY, JSON.stringify([...dismissed])); } catch {} };
  // окна, меню, очередь, плеер на весь экран: если перекрывает это — проверка не годится, повторим позже
  const TRANSIENT = ".modal, .tmenu, .toast, .qpanel, #full, .login, .imgview, .kbhelp";
  const ACTS = {
    close: { name: "закрыть окно", el: "#wClose", th: ["close"] },
    minimize: { name: "свернуть окно", el: "#wMin", th: ["minimize"] },
    drag: { name: "перетащить окно", el: "#titlebar", th: ["drag"], area: true },
    play: { name: "пауза", el: "#play", th: ["play"], cli: true },
    settings: { name: "настройки", el: "#settingsBtn", th: ["page:settings"], cli: true },
  };
  let bar = null, fails = 0, lastStyle = "", checkT = 0;

  // ---------- видно ли и можно ли нажать ----------
  // true — доступно, false — нет, null — сейчас не понять (перекрыто окном или меню)
  function reachable(sel, area = false) {
    const el = document.querySelector(sel);
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const minW = area ? 40 : 10, minH = area ? 14 : 10;
    if (r.width < minW || r.height < minH) return false;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
      if (Number(cs.opacity) < 0.15) return false;
      if (n === el && cs.pointerEvents === "none") return false;
    }
    const top = (x, y) => document.elementsFromPoint(x, y).find((n) => !bar?.contains(n) && !n.classList?.contains("mascot"));
    // заголовок — область: тянут за любое свободное место, поэтому хватит одной точки, где сверху именно он
    // (а не кнопка в нём и не чужой блок поверх)
    if (area) {
      let unsure = false;
      for (const x of [r.left + 12, r.left + r.width * 0.3, cx, r.left + r.width * 0.6]) {
        const hit = top(Math.min(x, innerWidth - 1), cy);
        if (hit && el.contains(hit) && !hit.closest("button")) return true;
        if (hit?.closest(TRANSIENT)) unsure = true;
      }
      return unsure ? null : false;
    }
    const hit = top(cx, cy);
    if (!hit) return false;
    if (hit === el || el.contains(hit)) return true;
    if (hit.closest(TRANSIENT)) return null;
    return false;
  }

  // каких действий не хватает; null — проверить сейчас нельзя
  function missing() {
    if (document.hidden || document.querySelector(".modal") || document.body.classList.contains("vizfull-on")) return null;
    const full = document.getElementById("full");
    if (full && !full.hidden) return null;
    const thActs = new Set([...document.querySelectorAll("#thBtns .thbtn")].filter((b) => reachable(`#thBtns .thbtn[data-th="${CSS.escape(b.dataset.th)}"]`) === true).map((b) => b.dataset.act));
    const cli = document.body.classList.contains("cli-on");
    const out = [];
    let unsure = false;
    for (const [k, a] of Object.entries(ACTS)) {
      if (a.th.some((x) => thActs.has(x)) || (a.cli && cli)) continue;
      const v = reachable(a.el, a.area);
      if (v === null) unsure = true;
      else if (!v) out.push(k);
    }
    return unsure && out.length ? null : out;
  }

  const ownStyle = () => typeof cfg !== "undefined" && !BUILTIN.includes(cfg.style) && themeReady.has(cfg.style);
  const styleName = () => cfg.themes?.find((t) => t.id === cfg.style)?.name || cfg.style;

  function check() {
    if (!ownStyle() || dismissed.has(cfg.style)) { fails = 0; hide(); return; }
    const m = missing();
    if (m === null) return;
    if (!m.length) { fails = 0; hide(); return; }
    if (++fails < 2) { schedule(1500); return; }       // два раза подряд: стиль мог ещё доезжать (анимации, шрифты)
    show(m);
  }
  function schedule(ms) { clearTimeout(checkT); checkT = setTimeout(check, ms); }

  // ---------- аварийная полоса ----------
  // все стили — инлайн с !important: правила темы их не перебьют
  const css = (el, o) => { for (const [k, v] of Object.entries(o)) el.style.setProperty(k, v, "important"); return el; };
  const BASE = {
    all: "initial", "box-sizing": "border-box", font: "13px/1.3 'Segoe UI', system-ui, sans-serif",
    color: "#f4f1ea", visibility: "visible", opacity: "1", "pointer-events": "auto", transform: "none", filter: "none",
  };
  function button(label, title, fn, accent = false) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
    css(b, { ...BASE, display: "inline-flex", "align-items": "center", "justify-content": "center", height: "28px", padding: "0 10px",
      margin: "0", border: "1px solid rgba(255,255,255,.22)", "border-radius": "6px", cursor: "pointer", "white-space": "nowrap",
      background: accent ? "#c9a24b" : "rgba(255,255,255,.08)", color: accent ? "#16120c" : "#f4f1ea", "font-weight": accent ? "600" : "400" });
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    return b;
  }
  function build(miss) {
    const el = document.createElement("div");
    el.setAttribute("role", "toolbar"); el.setAttribute("aria-label", "Аварийная панель");
    const canPop = typeof el.showPopover === "function";
    if (canPop) el.setAttribute("popover", "manual");
    css(el, { ...BASE, display: "flex", position: "fixed", inset: "auto", top: "8px", left: "50%", right: "auto", bottom: "auto",
      translate: "-50% 0", margin: "0", "z-index": "2147483647", "align-items": "center", gap: "6px", "flex-wrap": "wrap",
      "max-width": "calc(100vw - 16px)", padding: "6px 8px 6px 12px", width: "auto", height: "auto", overflow: "visible",
      background: "rgba(18,16,22,.96)", border: "1px solid rgba(255,255,255,.18)", "border-radius": "10px",
      "box-shadow": "0 6px 24px rgba(0,0,0,.5)", cursor: "grab", "user-select": "none", "clip-path": "none", "mix-blend-mode": "normal" });
    // за пустое место полосы окно можно тащить — даже если тема убрала заголовок
    el.addEventListener("mousedown", (e) => { if (e.button === 0 && (e.target === el || e.target.dataset?.drag)) winDragFrom(e); });
    const txt = document.createElement("span"); txt.dataset.drag = "1";
    css(txt, { ...BASE, display: "inline", "margin-right": "4px", cursor: "grab", color: "#f4f1ea" });
    txt.textContent = `Стиль «${styleName()}» прячет: ${miss.map((k) => ACTS[k].name).join(", ")}`;
    el.append(txt);
    if (miss.includes("play")) el.append(button("⏯", "Пуск/пауза", () => togglePlay()));
    if (miss.includes("settings")) el.append(button("Настройки", "Открыть настройки", () => document.getElementById("settingsBtn")?.click()));
    if (miss.includes("minimize")) el.append(button("—", "Свернуть окно", () => invoke("win_minimize").catch(() => {})));
    if (miss.includes("close")) el.append(button("✕", "Закрыть окно", () => invoke("win_close").catch(() => {})));
    el.append(button("Стандартный стиль", "Включить встроенный «Королевский»", () => fallback(false), true));
    el.append(button("Не показывать", "Для этого стиля больше не показывать — если на самом деле всё доступно", () => {
      dismissed.add(cfg.style); saveDismissed(); hide();
      showToast("Для этого стиля панель больше не появится. Если что-то пропадёт — Ctrl+Shift+Backspace", 6000);
    }));
    document.body.append(el);
    if (canPop) { try { el.showPopover(); } catch {} }
    return el;
  }
  function show(miss) {
    const key = cfg.style + ":" + miss.join(",");
    if (bar?.dataset.key === key && bar.isConnected) return selfCheck();
    hide();
    bar = build(miss); bar.dataset.key = key;
    selfCheck();
  }
  function hide() {
    if (!bar) return;
    try { bar.hidePopover?.(); } catch {}
    bar.remove(); bar = null;
  }
  // тема спрятала даже полосу (скрыт весь body и т. п.) — помочь нечем, кроме встроенного стиля
  function selfCheck() {
    requestAnimationFrame(() => {
      if (!bar) return;
      const r = bar.getBoundingClientRect(), b = bar.querySelector("button");
      const hit = b && document.elementFromPoint(b.getBoundingClientRect().left + 4, b.getBoundingClientRect().top + 4);
      if (r.width < 40 || r.height < 16 || !hit || !bar.contains(hit)) fallback(true);
    });
  }
  function fallback(auto) {
    const name = styleName();
    hide(); fails = 0;
    cfg.style = "royal"; applyCfg(); saveCfg(); syncControls();
    showToast(auto ? `Стиль «${name}» спрятал всё окно — включён встроенный «Королевский»` : "Включён встроенный стиль «Королевский»", 6000, { kind: "ok" });
  }

  // ---------- когда проверять ----------
  setInterval(() => {
    const st = typeof cfg !== "undefined" ? cfg.style + (themeReady.has(cfg.style) ? "+" : "") : "";
    if (st !== lastStyle) { lastStyle = st; fails = 0; hide(); if (ownStyle()) schedule(1800); }
  }, 700);
  setInterval(() => { if (ownStyle() && !document.hidden) check(); }, PERIOD);
  let rz = 0;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (ownStyle()) { fails = 0; check(); } }, 1200); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ownStyle()) schedule(1000); });

  window.themeGuardCheck = () => { fails = 1; check(); };      // для автора темы: проверить сейчас (консоль DevTools)
})();
