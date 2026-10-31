// Навигация клавиатурой внутри окна (не путать с глобальными сочетаниями из hotkeys.js — те работают и в свёрнутом окне).
//  • стрелки — ходить по меню слева, трекам, карточкам, вкладкам и кнопкам шапки; Enter — включить / открыть
//  • Home / End / PgUp / PgDn — по списку треков; ← из списка — в меню слева, → из меню — в список
//  • меню «⋯» (клавиша Menu или Shift+F10) — стрелками по пунктам, → открыть подменю, ← назад
//  • Ctrl+F — поиск, Пробел — пауза, Ctrl+←/→ — трек, Shift+←/→ — перемотка, Ctrl+↑/↓ — громкость,
//    M — звук, L — лайк, Alt+← / Backspace / боковая кнопка мыши — назад, F1 — список клавиш
(() => {
  const $k = (s, root = document) => root.querySelector(s);
  const $$k = (s, root = document) => [...root.querySelectorAll(s)];
  const main = $k(".main"), side = $k(".side");
  const root = document.documentElement;

  // ---------- что считается «вводом текста» и чужими клавишами ----------
  const TYPING = 'textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file])';
  const typing = (el) => !!el?.closest?.(TYPING);
  const ownKeys = (el) => !!el?.closest?.("input[type=range], input[type=checkbox], input[type=radio]");   // стрелки и пробел у них свои
  const blocked = () => !!document.querySelector(".modal") || !$k("#login")?.classList.contains("hidden")
    || !$k("#full")?.hidden || (typeof vizFullOn !== "undefined" && vizFullOn);

  // ---------- видимость и фокус ----------
  const visible = (el) => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  function focusEl(el) {
    if (!el) return false;
    if (el.tabIndex < 0 && !el.hasAttribute("tabindex")) el.tabIndex = -1;    // li и карточки — фокус только программно, Tab по ним не ходит
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }
  // подсветку фокуса показываем, только пока работают с клавиатуры
  const kbOn = () => root.classList.add("kbnav");
  document.addEventListener("pointerdown", () => root.classList.remove("kbnav"), true);

  // ---------- зоны ----------
  const sideItems = () => $$k(".nav", side).filter(visible);
  // всё, по чему ходят стрелки в основной части: треки и строки списков, карточки, вкладки, кнопки шапки
  const MAIN_SEL = [
    "li", ".simgrid > *", ".stgrid > *", ".chips > button", ".chips > .chip",
    ".head .nav", ".head .round", ".head .stbtn", ".plbar .nav", "#more", ".pill",
  ].join(", ");
  const inSettings = (el) => !!el.closest("#settingsPage, #statsPage");
  const mainItems = () => $$k(MAIN_SEL, main).filter((el) => !inSettings(el) && !el.closest(".tmenu") && visible(el));
  const zoneOf = (el) => (!el || el === document.body ? null : side.contains(el) ? "side" : main.contains(el) && el.matches(MAIN_SEL) ? "main" : null);

  // вход в список: играющий трек, если он на экране, иначе первый видимый элемент в области прокрутки
  function enterMain() {
    const items = mainItems();
    if (!items.length) return false;
    const playing = items.find((el) => el.classList.contains("playing"));
    const box = main.getBoundingClientRect();
    const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom; };
    return focusEl(playing && onScreen(playing) ? playing : items.find(onScreen) || items[0]);
  }
  const enterSide = () => focusEl($k(".nav.active", side) && visible($k(".nav.active", side)) ? $k(".nav.active", side) : sideItems()[0]);

  // ближайший элемент в нужную сторону (пространственная навигация — работает и для сеток, и для рядов кнопок)
  function nearest(from, items, dir) {
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of items) {
      if (el === from || el.contains(from) || from.contains(el)) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      let main_, cross;
      if (dir === "down") { if (b.top < a.bottom - 4) continue; main_ = b.top - a.bottom; cross = Math.abs(bx - ax); }
      else if (dir === "up") { if (b.bottom > a.top + 4) continue; main_ = a.top - b.bottom; cross = Math.abs(bx - ax); }
      else if (dir === "right") { if (b.left < a.right - 4) continue; main_ = b.left - a.right; cross = Math.abs(by - ay); }
      else { if (b.right > a.left + 4) continue; main_ = a.left - b.right; cross = Math.abs(by - ay); }
      const score = Math.max(0, main_) + cross * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }
  // соседний видимый li в том же списке — быстро, без перебора всех элементов (лайков бывают тысячи)
  function sibling(li, step) {
    let el = li;
    while ((el = step > 0 ? el.nextElementSibling : el.previousElementSibling)) if (el.tagName === "LI" && visible(el)) return el;
    return null;
  }
  const listOf = (li) => $$k(":scope > li", li.parentElement).filter(visible);

  function moveMain(cur, key) {
    const isLi = cur.tagName === "LI";
    if (isLi && (key === "Home" || key === "End")) { const l = listOf(cur); return focusEl(key === "Home" ? l[0] : l[l.length - 1]); }
    if (isLi && (key === "PageDown" || key === "PageUp")) {
      const l = listOf(cur), i = l.indexOf(cur);
      const page = Math.max(1, Math.floor(main.clientHeight / Math.max(24, cur.offsetHeight)) - 1);
      return focusEl(l[Math.max(0, Math.min(l.length - 1, i + (key === "PageDown" ? page : -page)))]);
    }
    if (isLi && (key === "ArrowDown" || key === "ArrowUp")) {
      const s = sibling(cur, key === "ArrowDown" ? 1 : -1);
      if (s) return focusEl(s);
    }
    const dir = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" }[key];
    if (!dir) return false;
    const n = nearest(cur, mainItems(), dir);
    if (n) return focusEl(n);
    if (dir === "left") return enterSide();          // левее ничего нет — в меню слева
    if (dir === "up") { main.scrollTo({ top: 0, behavior: "smooth" }); return true; }
    return true;
  }
  function moveSide(cur, key) {
    const l = sideItems(), i = l.indexOf(cur);
    if (key === "ArrowDown") return focusEl(l[(i + 1) % l.length]);
    if (key === "ArrowUp") return focusEl(l[(i - 1 + l.length) % l.length]);
    if (key === "Home") return focusEl(l[0]);
    if (key === "End") return focusEl(l[l.length - 1]);
    if (key === "ArrowRight") return enterMain();
    return false;
  }

  // ---------- меню «⋯» с клавиатуры ----------
  let kbMenu = false, menuFrom = null;
  const menuBtns = () => $$k("button", tmenu).filter(visible);
  function openMenuFor(li) {
    const mb = li?.querySelector(".morebtn");
    if (!mb) return false;
    kbMenu = true; menuFrom = li;
    mb.click();
    return true;
  }
  // меню собирается асинхронно и пересобирается для подменю — как только в нём появились пункты, ставим фокус на первый
  new MutationObserver(() => {
    if (tmenu.hidden) {
      if (kbMenu && menuFrom?.isConnected && (document.activeElement === document.body || !document.activeElement)) focusEl(menuFrom);
      kbMenu = false; menuFrom = null;
      return;
    }
    if (kbMenu && !tmenu.contains(document.activeElement)) {
      const first = $k(".mi", tmenu) || menuBtns()[0];
      if (first) first.focus({ preventScroll: true });
    }
  }).observe(tmenu, { childList: true, attributes: true, attributeFilter: ["hidden"] });
  function moveMenu(key) {
    const l = menuBtns();
    if (!l.length) return false;
    const i = l.indexOf(document.activeElement);
    if (key === "ArrowDown") return focusEl(l[(i + 1) % l.length]);
    if (key === "ArrowUp") return focusEl(l[i <= 0 ? l.length - 1 : i - 1]);
    if (key === "Home") return focusEl(l[0]);
    if (key === "End") return focusEl(l[l.length - 1]);
    if (key === "ArrowRight" && document.activeElement?.querySelector?.(".miarrow")) { kbMenu = true; document.activeElement.click(); return true; }
    if (key === "ArrowLeft") { const b = $k(".mback", tmenu); if (b) { kbMenu = true; b.click(); return true; } }
    return false;
  }

  // ---------- действия ----------
  function focusSearch() {
    const lk = $k("#lkFind");
    const inp = lk && !lk.hidden && visible(lk) ? $k("#lkFindIn") : $k("#search");
    if (!inp) return;
    inp.focus(); inp.select();
  }
  function goBack() {
    const b = $k("#back");
    if (b && !b.hidden) { b.click(); return true; }
    return false;
  }
  function seek(d) {
    if (!audio || needLoad || !isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration - 0.5, audio.currentTime + d));
  }
  function likeKey() {
    const li = document.activeElement?.closest?.("li");
    const hb = li && main.contains(li) ? li.querySelector(".likebtn") : null;
    if (hb) hb.click();
    else if (queue[current]) toggleLike(queue[current]);
  }

  // ---------- окно со списком клавиш (F1) ----------
  const HELP = [
    ["Пробел", "Пауза / играть"],
    ["Ctrl + → / ←", "Следующий / предыдущий трек"],
    ["Shift + → / ←", "Перемотать на 10 с"],
    ["Ctrl + ↑ / ↓", "Громче / тише"],
    ["M", "Выключить / включить звук"],
    ["L", "Лайк (выбранному или играющему треку)"],
    ["Ctrl + F", "Поиск (на странице лайков — поиск по лайкам)"],
    ["↑ ↓ ← →", "Ходить по меню, трекам и карточкам"],
    ["Enter", "Включить трек / открыть"],
    ["Home / End, PgUp / PgDn", "К началу / концу списка, на страницу"],
    ["Menu или Shift + F10", "Меню «⋯» у выбранного трека"],
    ["Alt + ← или Backspace", "Назад"],
    ["Q", "Очередь"],
    ["F", "Визуализатор на весь экран (на странице Моей волны)"],
    ["Esc", "Закрыть меню и окна"],
    ["F1", "Этот список"],
  ];
  let help = null;
  function closeHelp() {
    if (!help) return;
    document.removeEventListener("keydown", help.onKey, true);
    help.wrap.remove(); help = null;
  }
  function openHelp() {
    if (help) return closeHelp();
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const wrap = mk("div", "login modal");
    const box = mk("div", "panel login-box modalbox hkmodal kbhelp");
    const list = mk("div", "hklist");
    for (const [k, what] of HELP) {
      const row = mk("div", "hkrow");
      row.append(mk("span", "hkname", what), mk("span", "hkkey", k));
      list.append(row);
    }
    const foot = mk("div", "row");
    const ok = mk("button", "nav active", "Понятно"); ok.type = "button"; ok.onclick = closeHelp;
    foot.append(ok);
    box.append(mk("h2", "", "Клавиши в окне"), mk("p", "hksub", "Работают, пока окно приложения активно и курсор не в поле ввода. Сочетания для свёрнутого окна — в «Горячих клавишах»."), list, foot);
    wrap.append(box); document.body.append(wrap);
    wrap.onpointerdown = (e) => { if (e.target === wrap) closeHelp(); };
    const onKey = (e) => { if (e.key === "Escape" || e.key === "F1") { e.preventDefault(); e.stopPropagation(); closeHelp(); } };
    document.addEventListener("keydown", onKey, true);
    help = { wrap, onKey };
    ok.focus();
  }
  window.kbHelp = openHelp;
  const helpBtn = $k("#kbHelpBtn"); if (helpBtn) helpBtn.onclick = openHelp;      // кнопка в настройках

  // ---------- главный обработчик ----------
  const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const t = document.activeElement;
    const mod = e.ctrlKey || e.metaKey, plain = !mod && !e.altKey && !e.shiftKey;

    // Ctrl+F — поиск, работает и из полей ввода (заодно глушит встроенный поиск по странице WebView)
    if (mod && !e.altKey && e.code === "KeyF") {
      if (document.querySelector(".modal") || !$k("#login")?.classList.contains("hidden")) return;
      e.preventDefault(); focusSearch(); return;
    }
    if (e.key === "F1") { if (!document.querySelector(".modal")) { e.preventDefault(); openHelp(); } return; }
    if (typing(t) || blocked()) return;

    // меню «⋯» открыто — стрелки ходят по его пунктам
    if (!tmenu.hidden && NAV_KEYS.has(e.key) && plain) {
      if (moveMenu(e.key)) { e.preventDefault(); kbOn(); }
      return;
    }

    // плеер
    if (e.code === "Space" && !e.altKey && !mod) {
      if (ownKeys(t)) return;
      // кнопку, до которой дошли клавиатурой (Tab), пробел нажимает как обычно; после щелчка мышью — пауза
      if (root.classList.contains("kbnav") && t?.matches?.("button") && !main.contains(t) && !side.contains(t)) return;
      if (tmenu.contains(t)) return;
      e.preventDefault(); togglePlay(); return;
    }
    if (mod && !e.altKey && !e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault(); $k(e.key === "ArrowRight" ? "#next" : "#prev").click(); return;
    }
    if (mod && !e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault(); setVol(volume + (e.key === "ArrowUp" ? 0.05 : -0.05)); return;
    }
    if (e.shiftKey && !mod && !e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      if (ownKeys(t)) return;
      e.preventDefault(); seek(e.key === "ArrowRight" ? 10 : -10); return;
    }
    if (plain && e.code === "KeyM") { $k("#volBtn").click(); return; }
    if (plain && e.code === "KeyL") { likeKey(); return; }

    // назад
    if ((e.altKey && !mod && !e.shiftKey && e.key === "ArrowLeft") || (plain && e.key === "Backspace")) {
      if (goBack()) e.preventDefault();
      return;
    }

    // меню «⋯» у выбранного трека
    if ((e.key === "ContextMenu" || (e.shiftKey && !mod && !e.altKey && e.key === "F10")) && t?.tagName === "LI" && main.contains(t)) {
      if (openMenuFor(t)) { e.preventDefault(); kbOn(); }
      return;
    }

    // Enter по строке или карточке (кнопки и ссылки Enter нажимают сами)
    if (plain && e.key === "Enter" && t && zoneOf(t) === "main" && !t.matches("button, a, input")) {
      e.preventDefault(); kbOn(); t.click(); return;
    }

    // стрелки (фокус на кнопке внутри строки трека — после щелчка по ♥ или «⋯» — считаем, что выбрана сама строка)
    if (!plain || !NAV_KEYS.has(e.key) || ownKeys(t)) return;
    const row = t?.closest?.("li");
    const cur = row && main.contains(row) && !inSettings(row) ? row : t;
    const zone = zoneOf(cur);
    let done = false;
    if (zone === "main") done = moveMain(cur, e.key);
    else if (zone === "side") done = moveSide(cur, e.key);
    else if (!t || t === document.body || t === main || (main.contains(t) && !inSettings(t))) {
      // фокуса нигде нет: ↑/↓/→ — в список, ← — в меню слева; PgUp/PgDn/Home/End — обычная прокрутка
      if (e.key === "ArrowLeft") done = enterSide();
      else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowRight") done = enterMain() || enterSide();
    }
    if (done) { e.preventDefault(); kbOn(); }
  });

  // боковая кнопка мыши «назад»
  document.addEventListener("mouseup", (e) => { if (e.button === 3 && !blocked() && goBack()) e.preventDefault(); });
  document.addEventListener("auxclick", (e) => { if (e.button === 3) e.preventDefault(); });
})();
