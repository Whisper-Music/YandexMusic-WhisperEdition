// Телефон (Android; iOS — позже). Подключён без defer, сразу после boot.js: класс html.mobile должен стоять
// до первой отрисовки (раскладку под телефон делает mobile.css), а подмена invoke — до main.js.
// На компьютере файл ничего не делает. Признак для остального кода — window.isMobile.
(() => {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") && !window.__WEB__;
  window.isMobile = mobile;
  if (!mobile) return;
  const root = document.documentElement;
  root.classList.add("mobile");

  // Команд только для компьютера (трей, кнопки окна, WASAPI, мини-плеер…) в мобильной сборке нет (lib.rs, cfg(desktop)).
  // Тех, что страница зовёт сама при запуске и не ждёт ответа, — тихо «выполняем» здесь, чтобы не сыпались ошибки.
  // Остальные отвечают ошибкой, как и раньше, — их кнопки на телефоне спрятаны (mobile.css).
  const QUIET = {
    app_ready: null, engine_available: false, win_is_max: false, web_active: false,
    tray_playing: null, tray_lang: null, tray_icon: null, tray_mode: null, thumbbar_state: null,
    mini_state: null, obs_state: null, obs_theme: null, discord_update: null, hotkeys_set: null,
    audio_devices_unlock: null, audio_endpoints: [], system_fonts: [],
  };
  // Свойства window.__TAURI__.core — только для чтения (геттеры), поэтому подменяем сам объект __TAURI__ копией,
  // в которой core.invoke — наш. Не вышло (объект закрыт) — ничего страшного: те команды просто ответят ошибкой.
  try {
    const T = window.__TAURI__;
    const real = T?.core?.invoke;
    if (real) {
      const invoke = (cmd, args, opts) => (cmd in QUIET ? Promise.resolve(QUIET[cmd]) : real(cmd, args, opts));
      window.__TAURI__ = { ...T, core: { ...T.core, invoke } };
    }
  } catch {}

  // Отступы от строки состояния и полоски жестов. Приложение рисуется под ними (edge-to-edge), а старые WebView
  // в env(safe-area-inset-*) отдают 0 — размеры сообщает сама Android-часть (MainActivity.kt): "top,right,bottom,left"
  // в CSS-пикселях. Нет её (другая сборка) — запас под обычную строку состояния.
  const insets = (s) => {
    const [t, r, b, l] = String(s || "").split(",").map((n) => Math.max(0, Math.min(200, +n || 0)));
    root.style.setProperty("--sys-top", t + "px");
    root.style.setProperty("--sys-right", r + "px");
    root.style.setProperty("--sys-bottom", b + "px");
    root.style.setProperty("--sys-left", l + "px");
  };
  window.whisperInsets = insets;
  const askInsets = () => { try { if (window.WhisperAndroid) insets(window.WhisperAndroid.insets()); } catch {} };
  if (window.WhisperAndroid) askInsets(); else insets("24,0,0,0");
  window.addEventListener("resize", askInsets);

  // Кнопка «Назад» телефона: Android-часть (MainActivity.kt) спрашивает window.whisperBack(). Своей истории
  // у страницы нет (navigate() в main.js ведёт свою): закрываем то, что открыто поверх (как Esc), или идём на
  // предыдущую страницу приложения (#back) — "true"; ничего такого нет — "bg", приложение уходит в фон
  // (музыка играет дальше, а не закрывается вместе с ним).
  const opened = () =>
    document.querySelector("#full:not([hidden]), #vizFull:not([hidden]), .tmenu:not([hidden]), .modal:not(.hidden), .login.modal:not(.hidden)");
  window.whisperBack = () => {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) { a.blur(); return true; }
    if (opened()) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    }
    const back = document.getElementById("back");
    if (back && !back.hidden) { back.click(); return true; }
    // настройки открываются из профиля — «Назад» возвращает в профиль
    if (document.querySelector(".main")?.dataset.page === "settingsBtn") { openProfile(); return true; }
    return "bg";
  };

  // ---------- надписи «как на компьютере» ----------
  // Код и разметка общие с компьютером: «удалить с диска», «правый щелчок», «Ctrl+Shift+M». На телефоне
  // такие куски подменяются на лету (текст и подсказки), и в русском, и в английском словаре — так что и
  // i18n.js, переводя уже подменённую строку, находит перевод. Порядок важен: сначала длинные куски.
  const RU = [
    [/ ?\((?:или )?(?:Esc|Ctrl\+[^)]*|Alt\+[^)]*)\)/g, ""],
    [/Ctrl\+Shift\+M или д(войной щелчок)/g, "Д$1"],
    [/\. Esc — закончить/g, ""],
    [/Esc — выйти · Пробел — пауза/g, "«Назад» — выйти"],
    [/Esc или щелчок — закрыть/g, "Нажми, чтобы закрыть"],
    [/Ctrl\+Shift\+Backspace вернёт/g, "зажми экран тремя пальцами на 2 секунды — вернётся"],
    [/— Ctrl\+Shift\+Backspace/g, "— зажми экран тремя пальцами на 2 секунды"],
    [/Тяни границы мышью; колесо — точнее \(с Shift — по секунде\)/g, "Тяни границы пальцем"],
    [/Перетащи файл сюда или выбери/g, "Нажми, чтобы выбрать файл"],
    [/ — или перетащи файл ниже/g, " — или выбери файл ниже"],
    [/ или перетащи (?:файл \/ папку Wallpaper Engine|сюда всю папку обоев|сам файл \(не ссылку и не текст\))/g, ""],
    [/Щелчок или любая клавиша пропускают/g, "Нажатие пропускает"],
    [/щелчок или клавиша пропускают/g, "нажатие пропускает"],
    [/Правый щелчок/g, "Долгое нажатие"], [/правым щелчком/g, "долгим нажатием"], [/по правому щелчку/g, "по долгому нажатию"],
    [/Двойной щелчок/g, "Двойное нажатие"], [/двойной щелчок/g, "двойное нажатие"],
    [/Щелчок/g, "Нажатие"], [/щелчок/g, "нажатие"], [/Щёлкни/g, "Нажми"],
    [/при наведении/g, "при касании"], [/При наведении/g, "При касании"],
    [/(?:этом|другом) компьютере/g, (m) => (m.startsWith("эт") ? "этом телефоне" : "другом устройстве")],
    // \b в JS не видит границу у кириллицы — поэтому «дальше не буква»
    [/компьютер(е|а|ом|у)?(?![а-яё])/g, "телефон$1"],
    [/Обновить и перезапустить/g, "Скачать и установить"],
    [/с диска/g, "с телефона"], [/на диске/g, "на телефоне"], [/на диск(?![а-яё])/g, "на телефон"],
  ];
  const EN = [
    [/ ?\((?:or )?(?:Esc|Ctrl\+[^)]*|Alt\+[^)]*)\)/g, ""],
    [/Ctrl\+Shift\+M or d(ouble-click)/g, "D$1"],
    [/\. Esc - finish/g, ""],
    [/Ctrl\+Shift\+Backspace/g, "hold three fingers on the screen for 2 seconds"],
    [/(?:a click|A click) or (?:any )?key skips/g, (m) => (m[0] === "A" ? "A tap skips" : "a tap skips")],
    [/Right-click(ing)?/g, (m, g) => (g ? "Long-pressing" : "Long-press")], [/right-click/g, "long-press"],
    [/Double-click/g, "Double-tap"], [/double-click/g, "double-tap"],
    [/\bClick(ing)?\b/g, (m, g) => (g ? "Tapping" : "Tap")], [/\bclick(ing)?\b/g, (m, g) => (g ? "tapping" : "tap")],
    [/on hover/gi, (m) => (m[0] === "O" ? "On touch" : "on touch")],
    [/(?:this|your) computer/g, "this phone"], [/(?:another|other) computers?/g, (m) => (m.endsWith("s") ? "other devices" : "another device")],
    [/disk space/g, "storage space"], [/from disk/g, "from the phone"], [/on disk/g, "on the phone"],
  ];
  const fix = (rules, s) => rules.reduce((a, [re, to]) => a.replace(re, to), s);
  const fixRu = (s) => fix(RU, s), fixEn = (s) => fix(EN, s);
  window.mobileText = fixRu;
  // словарь en.js ещё не загружен (mobile.js — раньше него): ловим каждую запись, подменяем английский текст
  // и кладём перевод и под «телефонную» русскую строку
  {
    const wrap = (v) => (typeof v === "string" ? fixEn(v) : typeof v === "function" ? (...a) => { const r = v(...a); return typeof r === "string" ? fixEn(r) : r; } : v);
    const d = {};
    window.I18N_EN = new Proxy(d, {
      set(t, k, v) {
        const w = wrap(v);
        t[k] = w;
        if (typeof k === "string") { const m = fixRu(k); if (m !== k && !(m in t)) t[m] = w; }
        return true;
      },
    });
  }
  // страница: текст и подсказки (кроме названий треков, текста песни и полей ввода — как у i18n.js)
  function mobileWords() {
    const SKIP = "script, style, textarea, input, [contenteditable], [data-noi18n], #cli, .list li .t, .list li .a, .tartists, #fLyrics, .qpanel li .t, .qpanel li .a";
    const ATTRS = ["title", "placeholder", "aria-label"];
    const HIT = /диск|компьютер|щелч|Щелч|Щёлкни|Ctrl\+|Alt\+|Esc|наведени|перетащи|мышью|перезапустить/i;
    const doText = (n) => { const s = n.data; if (HIT.test(s) && !n.parentElement?.closest(SKIP)) { const v = fixRu(s); if (v !== s) n.data = v; } };
    const doAttr = (el, a) => { const s = el.getAttribute(a); if (s && HIT.test(s)) { const v = fixRu(s); if (v !== s) el.setAttribute(a, v); } };
    const walk = (root) => {
      if (root.nodeType === 3) return doText(root);
      if (root.nodeType !== 1 || root.matches(SKIP)) return;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n = w.currentNode; n; n = w.nextNode()) {
        if (n.nodeType === 3) doText(n);
        else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a);
      }
    };
    walk(document.body);
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === "childList") r.addedNodes.forEach(walk);
        else if (r.type === "characterData") doText(r.target);
        else if (r.type === "attributes") doAttr(r.target, r.attributeName);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // ---------- аварийный выход из сломанного стиля ----------
  // На компьютере — Ctrl+Shift+Backspace (theme.js). Здесь клавиатуры нет: три пальца на экране 2 секунды
  // отправляют то же сочетание.
  function styleRescue() {
    let t = 0;
    const stop = () => { clearTimeout(t); t = 0; };
    document.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 3) return stop();
      stop();
      t = setTimeout(() => {
        t = 0;
        navigator.vibrate?.(40);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true, shiftKey: true, bubbles: true }));
      }, 2000);
    }, { passive: true, capture: true });
    for (const ev of ["touchend", "touchcancel"]) document.addEventListener(ev, (e) => { if (e.touches.length < 3) stop(); }, { passive: true, capture: true });
  }

  // ---------- мини-плеер — сам линия трека ----------
  // Как мини-вид на компьютере (layout.css, data-ly-ui="super"): заполнение идёт по всей панели. Нажатия по панели
  // остаются кнопкам и открытию плеера, а перематывать — тянуть за верхний край (полоса .mgrab над панелью).
  function seekBar() {
    const player = document.querySelector(".app > .player"), seek = document.getElementById("seek");
    if (!player || !seek) return;
    const grab = document.createElement("div");
    grab.className = "mgrab";
    const tip = document.createElement("b");
    grab.append(tip);
    player.append(grab);
    const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
    let on = false;
    const at = (e) => {
      const r = player.getBoundingClientRect();
      const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      seek.value = Math.round(+seek.min + k * (seek.max - seek.min));
      seek.style.setProperty("--p", k * 100 + "%");
      tip.textContent = mmss(k * (audio?.duration || 0));
      tip.style.left = k * 100 + "%";
      seek.dispatchEvent(new Event("input", { bubbles: true }));
    };
    grab.addEventListener("pointerdown", (e) => {
      if (seek.disabled || !audio?.duration) return;
      on = true; try { seekDrag = true; } catch {}
      grab.setPointerCapture?.(e.pointerId);
      player.classList.add("m-seeking");
      at(e);
      e.preventDefault();
    });
    grab.addEventListener("pointermove", (e) => { if (on) at(e); });
    const end = () => {
      if (!on) return;
      on = false; try { seekDrag = false; } catch {}
      player.classList.remove("m-seeking");
      seek.dispatchEvent(new Event("change", { bubbles: true }));
    };
    grab.addEventListener("pointerup", end);
    grab.addEventListener("pointercancel", end);
    // свайп по плееру (следующий/предыдущий трек) и открытие плеера на весь экран — не отсюда
    for (const ev of ["touchstart", "touchend", "click"]) grab.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev !== "click" });
  }

  document.addEventListener("DOMContentLoaded", () => {
    askInsets();
    // плеер внизу маленький: по названию трека, как и по обложке, открывается плеер на весь экран
    document.querySelector(".player .meta")?.addEventListener("click", () => document.getElementById("cover")?.click());
    // окно входа: на телефоне страница Яндекса открывается прямо здесь, а не в отдельном окне
    const p = document.querySelector("#login .login-box > p");
    if (p) p.textContent = "Нажми кнопку и войди в аккаунт Яндекса. После входа приложение откроется само, копировать ничего не нужно.";
    // карточки Discord и OBS модули ядра вставляют сами и позже; :has() в CSS старые WebView не понимают —
    // прячем по выключателю внутри
    const settings = document.querySelector(".settings");
    const hideDesk = () => ["dcOn", "obsOn"].forEach((id) => document.getElementById(id)?.closest(".card")?.classList.add("m-hide"));
    hideDesk();
    if (settings) new MutationObserver(hideDesk).observe(settings, { childList: true });
    oldWebView();
    // настройки: вкладки всегда сверху; «Приложения» на телефоне нет — была открыта она, переходим на первую
    const sp = document.getElementById("settingsPage");
    if (sp) sp.dataset.tabs = "top";
    // «Обновления» живут во вкладке «Приложение», которой на телефоне нет, — переносим в «Данные»
    const upd = document.getElementById("updCard");
    if (upd) { upd.dataset.tab = "data"; upd.classList.remove("colbreak"); }
    const appTab = document.querySelector('#setTabs .chip[data-tab="app"]');
    if (appTab?.classList.contains("active")) document.querySelector("#setTabs .chip:not([data-tab=\"app\"])")?.click();
    navBar();
    profilePage();
    wavePage();
    fullActions();
    swipes();
    playerSwipes();
    waveHere();
    incoming();                             // приложение открыли файлом темы (из Telegram и т. п.)
    rowTap();
    fullModes();
    stallGuard();
    autoDl();
    toastSpot();
    backToFull();
    seekBar();
    styleRescue();
    mobileWords();
    // «Моя волна по артисту» — на странице автора короткой кнопкой со значком (mobile.css), подпись покороче
    const aw = document.getElementById("artistWaveBtn");
    if (aw) { aw.textContent = "Моя волна"; aw.title = "Моя волна по артисту"; }
    // режим сна: выключить телефон приложение не может — по истечении времени только останавливаем музыку
    // (строку выбора прячем, по умолчанию там «Выключить компьютер»)
    const slAct = document.getElementById("slAct");
    if (slAct) {
      const r = slAct.closest(".lyrow") || slAct; r.style.display = "none";
      if (slAct.querySelector('.chip.active[data-v="off"]')) slAct.querySelector('.chip[data-v="stop"]')?.click();
    }
  });

  // ---------- нижняя панель: четыре раздела с подписями ----------
  // Волна, Коллекция (лайки, плейлисты, авторы), Друзья, Профиль. Настройки — внутри профиля (кнопка #settingsBtn
  // остаётся в разметке, её просто не видно), статистика и студия — тоже оттуда.
  function navBar() {
    const lk = document.getElementById("likes");
    if (lk) lk.textContent = "Коллекция";
    // настройки и статистика — части профиля: пока открыты они, подсвечен «Профиль»
    const main = document.querySelector(".app > .main"), pr = document.getElementById("profile");
    if (!main || !pr) return;
    const mark = () => {
      const p = main.dataset.page;
      root.classList.toggle("m-inprofile", p === "settingsBtn" || p === "statsBtn" || p === "studioBtn" || p === "mprofile");
    };
    new MutationObserver(mark).observe(main, { attributes: true, attributeFilter: ["data-page"] });
    mark();
  }

  // ---------- «Профиль»: аккаунт, статистика и все настройки по разделам ----------
  // На компьютере «Профиль» — окошко выбора (Whisper Archive / Яндекс / выйти, main.js). Здесь это страница раздела:
  // строится один раз (section.kitpage — resetView в main.js сам прячет её при переходе на другую страницу).
  const SET_TABS = [
    ["look", "Оформление", "Стиль, цвета, фон, темы, эффекты"],
    ["ui", "Интерфейс", "Язык, визуализатор, маскот, меню трека"],
    ["play", "Воспроизведение", "Переходы, режим сна, кэш"],
    ["out", "Звук", "Качество, нормализация, формат"],
    ["int", "Интеграции", "Whisper Archive"],
    ["data", "Данные", "Статистика, резервная копия, сброс"],
  ];
  let profSec = null;
  function profilePage() {
    const btn = document.getElementById("profile");
    const main = document.querySelector(".app > .main");
    if (!btn || !main) return;
    // перехватываем щелчок раньше обработчика main.js (тот открыл бы окошко выбора)
    btn.addEventListener("click", (e) => { e.stopImmediatePropagation(); e.preventDefault(); openProfile(); }, true);
  }
  function openProfile() {
    const main = document.querySelector(".app > .main");
    if (!main || typeof goTop !== "function") return;
    goTop(() => {
      setHead({ title: "Профиль" }); setActive("profile", "mprofile"); renderTabs(false); resetView();
      document.getElementById("list").hidden = true;
      if (!profSec) profSec = buildProfile(main);
      profSec.hidden = false;
      fillHero();
    });
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function row(icon, title, sub, fn, danger) {
    const b = el("button", "mprow" + (danger ? " danger" : "")); b.type = "button";
    if (icon) b.append(el("span", "mpico " + icon));
    const tx = el("span", "mptx"); tx.append(el("b", "", title)); if (sub) tx.append(el("small", "", sub));
    b.append(tx);
    if (!danger) b.append(el("span", "mpgo"));
    b.onclick = fn;
    return b;
  }
  function openSettings(tab, find) {
    document.getElementById("settingsBtn")?.click();
    requestAnimationFrame(() => {
      if (tab) document.querySelector(`#setTabs .chip[data-tab="${tab}"]`)?.click();
      if (find != null) { const f = document.getElementById("setFind"); if (f) { f.value = find; f.dispatchEvent(new Event("input", { bubbles: true })); } }
    });
  }
  function buildProfile(main) {
    const sec = el("section", "kitpage mprofile"); sec.id = "mProfilePage"; sec.hidden = true;
    const W = window.Whisper;
    // шапка: аватар и ник из Whisper Archive, карандаш — страница профиля архива (там и меняются ник и аватар)
    const hero = el("div", "mphero");
    const av = el("span", "mpav"), nm = el("b", "mpnick"), sb = el("small", "mpsub");
    const tx = el("span", "mptx"); tx.append(nm, sb);
    const pen = el("button", "mppen"); pen.type = "button"; pen.title = "Изменить профиль"; pen.setAttribute("aria-label", "Изменить профиль");
    pen.append(el("span", "mpico i-pen"));
    hero.append(av, tx, pen);
    hero.onclick = () => waOpen();          // и карандаш, и вся шапка — щелчок всплывает сюда
    sec.mpHero = { av, nm, sb };
    // плитки: статистика, архив, студия (если включена)
    const tiles = el("div", "mptiles");
    const tile = (id, icon, title) => {
      const src = document.getElementById(id);
      if (!src) return;
      const b = el("button", "card mptile"); b.type = "button"; b.dataset.src = id;
      b.append(el("span", "mpico " + icon), el("b", "", title));
      b.onclick = () => src.click();
      tiles.append(b);
    };
    tile("statsBtn", "i-stats", "Статистика");
    if (W?.modules?.waprofile) {
      const b = el("button", "card mptile"); b.type = "button"; b.dataset.src = "wa";
      b.append(el("span", "mpico i-wa"), el("b", "", "Мой архив"));
      b.onclick = () => waOpen();
      tiles.append(b);
    }
    tile("studioBtn", "i-studio", "Студия");
    // настройки: поиск (тот же, что на странице настроек) и разделы
    const h = el("h3", "mphead", "Настройки");
    const find = el("label", "mpfind");
    const inp = el("input"); inp.type = "search"; inp.placeholder = "Найти настройку"; inp.autocomplete = "off";
    inp.setAttribute("aria-label", "Найти настройку");
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && inp.value.trim()) { openSettings(null, inp.value.trim()); inp.value = ""; } });
    find.append(el("span", "mpico i-find"), inp);
    const sets = el("div", "card mpgroup");
    for (const [tab, title, sub] of SET_TABS) {
      if (!document.querySelector(`#setTabs .chip[data-tab="${tab}"]`)) continue;
      sets.append(row("i-" + tab, title, sub, () => openSettings(tab)));
    }
    sets.append(row("i-ya", "Яндекс ID", "Аккаунт Яндекса — откроется сайт", () => { try { window.__TAURI__.opener.openUrl("https://id.yandex.ru/"); } catch {} }));
    const out = row(null, "Выйти из Яндекса", null, () => { if (typeof logoutYandex === "function") logoutYandex(); }, true);
    sec.append(hero, tiles, h, find, sets, out);
    main.append(sec);
    return sec;
  }
  // архив подключён — его страница профиля; нет — окно входа (после входа шапка заполнится)
  async function waOpen() {
    const W = window.Whisper;
    if (W?.modules?.archive?.connected?.() === false && typeof W.modules.archive.login === "function") {
      try { await W.modules.archive.login("Чтобы открыть профиль"); } catch {}
      fillHero(true);
      return;
    }
    W?.modules?.waprofile?.open();
  }
  // ник и аватар — те же команды, что у страницы профиля ядра (whisper/profile.rs); без архива поля пустые
  let heroMe = null, heroAt = 0, heroAv = "";
  async function fillHero(force) {
    const h = profSec?.mpHero;
    if (!h) return;
    const paint = (me) => {
      h.nm.textContent = me?.nickname || "";
      h.sb.textContent = me ? "Whisper Archive · Яндекс Музыка" : "Войди в Whisper Archive";
      h.av.textContent = "";
      h.av.classList.toggle("empty", !me);
      if (me) h.av.append(el("b", "", (String(me.nickname || "?").trim()[0] || "?").toUpperCase()));
      if (heroAv) { const i = el("img"); i.alt = ""; i.src = heroAv; h.av.append(i); }
    };
    paint(heroMe);
    if (!force && Date.now() - heroAt < 60000) return;
    heroAt = Date.now();
    const inv = window.__TAURI__.core.invoke;
    let me = null;
    try {
      if (await inv("wa_token_exists")) {
        const r = await inv("wa_my_profile");
        if (r.status >= 200 && r.status < 300) me = JSON.parse(r.body || "null");
      }
    } catch {}
    if ((me?.avatar || "") !== (heroMe?.avatar || "") || !me) {
      if (heroAv) { URL.revokeObjectURL(heroAv); heroAv = ""; }
      const m = /^\/api\/users\/([0-9a-f-]{36})\/avatar(?:\?v=([0-9a-f]{1,16}))?$/i.exec(String(me?.avatar || ""));
      if (m) { try { heroAv = URL.createObjectURL(new Blob([await inv("wa_image", { kind: "avatar", id: m[1], v: m[2] || null })])); } catch {} }
    }
    heroMe = me;
    paint(me);
  }

  // ---------- «Моя волна»: одна главная кнопка, остальное — коротко ----------
  // «Жанры и настроения» — кнопка «Настроить волну» (лист снизу, mobile.css), «История прослушивания» — ссылкой
  function wavePage() {
    // main.js возвращает надпись «Жанры и настроения», когда закрывают список или сбрасывают станцию, — меняем каждый раз
    const st = document.getElementById("stBtn");
    const name = () => { if (st && st.textContent.trim() === "Жанры и настроения") st.textContent = "Настроить волну"; };
    if (st) { name(); new MutationObserver(name).observe(st, { childList: true, characterData: true, subtree: true }); }
    const fix = () => { const s = document.querySelector("#waveQBtn span"); if (s && s.textContent !== "История") s.textContent = "История"; };
    fix(); setTimeout(fix, 1500);           // кнопку очереди модуль ядра ставит сам — может появиться позже
  }

  // ---------- тема из другого приложения ----------
  // «Открыть с помощью → Whisper» или «Поделиться» на файле .wmt: MainActivity.kt копирует его в кэш и зовёт
  // window.whisperIncoming() (или страница сама спрашивает при запуске). Файл забираем кусками по 1 МБ и ставим
  // как «Загрузить тему…» (theme.js → window.wmtImport: тот же вопрос «Заменить стиль?», тот же тост)
  let inBusy = false, inAgain = false;
  async function incoming() {
    const A = window.WhisperAndroid;
    if (!A?.incoming || document.readyState === "loading") return;      // до загрузки страницы — позовёт DOMContentLoaded
    if (inBusy) { inAgain = true; return; }
    let info = null;
    try { info = JSON.parse(A.incoming() || "null"); } catch {}
    if (!info) return;
    inBusy = true;
    try {
      const name = String(info.name || "файл");
      if (info.error === "big") { showToast("Файл темы больше 64 МБ — такую тему не открыть", 5000); return; }
      if (info.error) { showToast(`Не удалось открыть «${name}»: ${info.error}`, 5000); return; }
      const size = Number(info.size) || 0, buf = new Uint8Array(size), STEP = 1 << 20;
      for (let o = 0; o < size; o += STEP) {
        const s = atob(A.incomingRead(o, STEP));
        if (!s) throw new Error("файл пропал из кэша");
        for (let k = 0; k < s.length; k++) buf[o + k] = s.charCodeAt(k);
      }
      // тема — текст с «#WMT» в начале или zip-архив (theme.wmt внутри проверит сам разбор)
      let head = new TextDecoder().decode(buf.subarray(0, 64));
      if (head.charCodeAt(0) === 0xfeff) head = head.slice(1);        // метка UTF-8 в начале файла
      head = head.trimStart();
      const zip = buf[0] === 0x50 && buf[1] === 0x4b;
      if (!/^#WMT\b/.test(head) && !zip) { showToast(`«${name}» — не тема Whisper (.wmt)`, 5000); return; }
      if (typeof window.wmtImport !== "function") throw new Error("темы ещё не загрузились");
      await window.wmtImport(buf);
    } catch (e) {
      showToast("Не удалось открыть тему: " + (e?.message || e), 5000);
    } finally {
      try { A.incomingDone(); } catch {}
      inBusy = false;
      if (inAgain) { inAgain = false; incoming(); }
    }
  }
  window.whisperIncoming = incoming;

  // Приложение ушло в фон / вернулось (MainActivity.kt). В фоне страница для Chromium остаётся «видимой» — иначе он
  // не грузит следующий трек, — поэтому видеообои останавливаем сами: в фоне их всё равно не видно.
  window.whisperBg = (bg) => {
    const v = document.getElementById("bgVideo");
    if (bg) { if (v && !v.paused) v.pause(); }
    else { try { syncBgVideo(); } catch {} }
  };

  // ---------- тосты: над мини-плеером, во всю ширину (mobile.css) ----------
  // Высота — по верху мини-плеера (или нижней панели, если плеер скрыт) в момент показа: у тем и на разных
  // телефонах она разная. Нажатие по плашке (не по кнопке действия) — скрыть её сразу.
  function toastSpot() {
    const t = document.querySelector("body > .toast") || document.querySelector(".toast");
    if (!t) return;
    const place = () => {
      if (t.hidden) return;
      const pl = document.querySelector(".app > .player"), nav = document.querySelector(".app > .side");
      const vis = (e) => { const r = e?.getBoundingClientRect(); return r && r.height > 20 && r.top < innerHeight ? r : null; };
      // открыт плеер на весь экран — внизу его кнопки: тост сверху, под строкой состояния
      const full = document.getElementById("full");
      if (full && !full.hidden) {
        const top = parseFloat(getComputedStyle(root).getPropertyValue("--sys-top")) || 0;
        t.style.setProperty("--m-toast-b", Math.round(innerHeight - top - 60 - t.offsetHeight) + "px");
        return;
      }
      const r = vis(pl) || vis(nav);
      if (r) t.style.setProperty("--m-toast-b", Math.round(innerHeight - r.top + 8) + "px");
    };
    new MutationObserver(place).observe(t, { attributes: true, attributeFilter: ["hidden"] });
    t.addEventListener("click", (e) => { if (!e.target.closest(".tact")) t.hidden = true; });
  }

  // ---------- из плеера на весь экран к альбому или автору — и обратно ----------
  // Название и исполнитель в плеере на весь экран — ссылки (main.js: закрыть плеер → navigate к альбому/автору).
  // «Назад» на открытой так странице возвращает не на прошлую страницу приложения, а в тот же плеер — в том же
  // виде (обложка или текст песни). Страницу узнаём по номеру перехода main.js (nav): ушли дальше — уже не она.
  function backToFull() {
    const full = document.getElementById("full");
    if (!full) return;
    let from = null;          // { mode, nav } — откуда и на какой странице
    full.addEventListener("click", (e) => {
      if (!e.target.closest("#fTitle, #fArtist .art")) return;
      const mode = full.dataset.mode || "cover";
      from = { mode, nav: -1 };
      setTimeout(() => { try { if (from) from.nav = nav; } catch { from = null; } }, 0);   // navigate() уже прошёл
    }, true);
    document.getElementById("back")?.addEventListener("click", () => {
      let cur = -2;
      try { cur = nav; } catch {}
      if (!from || from.nav !== cur) { from = null; return; }
      const mode = from.mode; from = null;
      setTimeout(() => {
        try { openFull(); if (mode !== (full.dataset.mode || "cover")) setFullMode(mode); } catch {}
      }, 0);
    }, true);                 // до обработчика main.js: он сразу сменит номер перехода
  }

  // ---------- строка трека: нажатие — играть ----------
  // На компьютере название в строке ведёт в альбом, имя исполнителя — к исполнителю. На телефоне по строке целиком
  // попадают пальцем, и вместо музыки открывалась чужая страница. Здесь любое место строки (кроме ♡ и «⋯») играет
  // тот список, где строка: лайки, плейлист, альбом — с этого трека (li.onclick из main.js → renderList).
  // К альбому и исполнителю — из плеера на весь экран (название и исполнитель там — ссылки).
  function rowTap() {
    document.addEventListener("click", (e) => {
      const x = e.target.closest?.(".list li .t, .list li .a");
      if (!x) return;
      const li = x.closest("li");
      if (typeof li?.onclick !== "function") return;     // у строки нет «играть по нажатию» — как было
      e.stopPropagation(); e.preventDefault();
      li.click();
    }, true);
  }

  // ---------- «Случайный порядок» и «Повтор» в плеере на весь экран ----------
  // Это те же кнопки нижней панели (#shuffleBtn, #repeatBtn — в мини-плеере их не видно): копия повторяет их вид
  // и состояние (включена, недоступна в волне) и нажимает оригинал. ♡ переезжает к названию — справа от него.
  function fullModes() {
    const box = document.querySelector("#full .fbtns"), sh = document.getElementById("shuffleBtn"), rp = document.getElementById("repeatBtn");
    if (!box || !sh || !rp || box.querySelector(".mfmode")) return;
    const mk = (src, id) => {
      const b = el("button", "modebtn mfmode"); b.type = "button"; b.id = id;
      const sync = () => {
        b.innerHTML = src.innerHTML; b.disabled = src.disabled; b.title = src.title;
        b.classList.toggle("on", src.classList.contains("on"));
      };
      sync();
      new MutationObserver(sync).observe(src, { attributes: true, childList: true, subtree: true });
      b.onclick = (e) => { e.stopPropagation(); src.click(); };
      return b;
    };
    box.prepend(mk(sh, "fShuffle"));
    box.append(mk(rp, "fRepeat"));
    const like = document.getElementById("fLike"), titles = document.getElementById("fTitles");
    if (like && titles) titles.append(like);
  }

  // ---------- связь пропала посреди трека ----------
  // Трек из сети (Яндекс, архив) при обрыве не выдаёт ошибку — плеер просто ждёт данных, и волна молча стоит.
  // Если позиция не двигается 10 с, а плеер не на паузе, проверяем связь (main.js suspectOffline): её нет —
  // переходим на скачанное и кэш (offlineFallback: следующий такой трек в очереди или все скачанные).
  function stallGuard() {
    let lastT = -1, since = 0, busy = false;
    setInterval(async () => {
      let a = null, local = false, loading = false;
      try { a = audio; local = curLocal; loading = !!loadAt; } catch { return; }
      if (!a || a.paused || a._native || local || loading || busy) { since = 0; lastT = -1; return; }
      if (a.currentTime !== lastT) { lastT = a.currentTime; since = 0; return; }
      since += 2000;
      if (since < 10000) return;
      busy = true; since = 0;
      try {
        const seq = playSeq;
        if (await suspectOffline() && seq === playSeq) await offlineFallback(current, seq);
      } catch {} finally { busy = false; }
    }, 2000);
  }

  // ---------- автоскачивание лайков (только телефон) ----------
  // Выключатель в «Воспроизведение → Кэш»: все лайки сами скачиваются на телефон — без сети играют они (и «Моя волна»
  // переходит на них). По умолчанию только по Wi-Fi (navigator.connection; тип не известен — не мешаем).
  // Качает по одному треку тем же dlOne, что «Скачать лайки»; уже скачанные пропускает; новые лайки — через минуту.
  const ADL_KEY = "ym_m_autodl";
  let adl = { on: false, wifi: true };
  try { adl = { ...adl, ...JSON.parse(localStorage.getItem(ADL_KEY) || "{}") }; } catch {}
  let adlBusy = false, adlTimer = 0, adlNote = null;
  const adlSave = () => { try { localStorage.setItem(ADL_KEY, JSON.stringify(adl)); } catch {} };
  const adlNoWifi = () => {
    const c = navigator.connection;
    return adl.wifi && !!c?.type && !["wifi", "ethernet", "none", "unknown"].includes(c.type);
  };
  const adlSay = (s) => { if (adlNote) adlNote.textContent = s; };
  async function adlRun() {
    if (!adl.on || adlBusy) return;
    try { if (offline || !navigator.onLine || bulk) return; } catch { return; }
    if (adlNoWifi()) { adlSay("Ждёт Wi-Fi — по мобильной сети лайки не скачиваются"); return; }
    adlBusy = true;
    let done = 0;
    try {
      const all = await loadAllLikes(() => {});
      if (!all) return;
      const todo = all.filter((t) => dlOk(t) && !got.has(String(t.id)) && !downloading.has(String(t.id)));
      if (!todo.length) { adlSay(`Все лайки скачаны (${all.length})`); return; }
      for (const t of todo) {
        if (!adl.on || offline || adlNoWifi() || bulk) break;
        adlSay(`Скачивается: ${done} из ${todo.length}`);
        try { await dlOne(t); done++; syncGot(); }
        catch (e) { if (isNetErr(e)) break; }
      }
      const left = all.filter((t) => dlOk(t) && !got.has(String(t.id))).length;
      adlSay(left ? `Скачано ${all.length - left} из ${all.length} — остальные докачаются позже` : `Все лайки скачаны (${all.length})`);
    } catch {} finally { adlBusy = false; }
  }
  const adlLater = (ms) => { clearTimeout(adlTimer); adlTimer = setTimeout(adlRun, ms); };
  function autoDl() {
    const card = document.getElementById("cacheCard");
    if (card && !document.getElementById("mAutoDl")) {
      const sw = (id, text, on) => {
        const l = el("label", "switch"), i = el("input"); i.type = "checkbox"; i.id = id; i.checked = on;
        l.append(i, el("i"), el("span", "", text));
        return [l, i];
      };
      const [l1, c1] = sw("mAutoDl", "Автоскачивание лайков", adl.on);
      const [l2, c2] = sw("mAutoDlWifi", "Только по Wi-Fi", adl.wifi);
      l1.title = "Все лайки сами скачиваются на телефон — без интернета играют они. Займёт место в памяти";
      adlNote = el("p", "status");
      const paint = () => { l2.hidden = !adl.on; adlNote.hidden = !adl.on; };
      c1.onchange = () => { adl.on = c1.checked; adlSave(); paint(); if (adl.on) { adlSay("Скоро начнётся…"); adlLater(500); } };
      c2.onchange = () => { adl.wifi = c2.checked; adlSave(); adlLater(500); };
      paint();
      card.append(l1, l2, adlNote);
    }
    adlLater(15000);                                   // после запуска — когда лайки уже подгрузились
    setInterval(adlRun, 10 * 60000);
    window.addEventListener("online", () => adlLater(5000));
    navigator.connection?.addEventListener?.("change", () => adlLater(5000));
    window.Whisper?.on?.("like", () => adlLater(60000));   // новый лайк — скачается через минуту
  }

  // ---------- мини-плеер на «Моей волне» ----------
  // открыта «Моя волна» и играет она — пуск/пауза уже есть большой кнопкой на экране, в мини-плеере её прячем
  // (html.m-wavehere, mobile.css). wave — переменная main.js; #waveBtn меняется при каждой смене состояния
  function waveHere() {
    const main = document.querySelector(".app > .main"), wb = document.getElementById("waveBtn");
    if (!main) return;
    const upd = () => {
      let on = false;
      try { on = typeof wave === "object" && !!wave?.on; } catch {}
      root.classList.toggle("m-wavehere", main.dataset.page === "wave" && on);
    };
    new MutationObserver(upd).observe(main, { attributes: true, attributeFilter: ["data-page"] });
    if (wb) new MutationObserver(upd).observe(wb, { attributes: true, childList: true });
    upd();
    // невидимые «назад» и «вперёд»: нажатие слева от большой кнопки — предыдущий трек, справа — следующий
    // (те же #prev / #next мини-плеера: нет предыдущего — кнопка выключена, и ничего не происходит)
    const stage = wb?.closest(".stage");
    if (!stage) return;
    stage.addEventListener("click", (e) => {
      if (main.dataset.page !== "wave" || wb.contains(e.target) || e.target.closest("button, a, input, label, .stwrap, .stations")) return;
      const r = wb.getBoundingClientRect(), pad = r.height * 0.6;
      if (e.clientY < r.top - pad || e.clientY > r.bottom + pad) return;     // только на уровне кнопки, не по всему экрану
      const b = document.getElementById(e.clientX < r.left ? "prev" : e.clientX > r.right ? "next" : "");
      if (b && !b.disabled) b.click();
    });
  }

  // ---------- плеер на весь экран: подписанные кнопки внизу ----------
  // Очередь, Караоке (текст песни), Слушать вместе, Сон, «Ещё» — те же кнопки приложения, только крупно и с подписью;
  // в мини-плеере их нет (там — лайк, пуск и следующий)
  function fullActions() {
    const wrap = document.querySelector("#full .fwrap");
    if (!wrap || wrap.querySelector(".mfacts")) return;
    const box = el("div", "mfacts");
    const act = (icon, title, fn) => {
      const b = el("button", "mfact"); b.type = "button";
      b.append(el("span", "mpico " + icon), el("span", "", title));
      b.onclick = (e) => { e.stopPropagation(); fn(b); };
      box.append(b);
      return b;
    };
    act("i-queue", "Очередь", () => { closeFullSafe(); window.qToggle?.(); });
    const kar = act("i-lyrics", "Караоке", lyricsToggle);
    // текст на экране — кнопка подсвечена (режим меняют и сама кнопка, и щелчок по обложке, и main.js при смене трека)
    const full = document.getElementById("full");
    const mark = () => { const on = full?.dataset.mode === "lyrics"; kar.classList.toggle("on", on); kar.setAttribute("aria-pressed", on ? "true" : "false"); };
    if (full) { mark(); new MutationObserver(mark).observe(full, { attributes: true, attributeFilter: ["data-mode"] }); }
    act("i-together", "Вместе", () => { closeFullSafe(); document.getElementById("togetherBtn")?.click(); });
    act("i-sleep", "Сон", () => { closeFullSafe(); document.getElementById("sleepBtn")?.click(); });
    act("i-more", "Ещё", (b) => {
      const m = document.getElementById("pMore");
      if (!m || m.disabled) return;
      closeFullSafe(); m.click();
    });
    wrap.append(box);
  }
  const closeFullSafe = () => { try { if (typeof closeFull === "function") closeFull(); } catch {} };
  // текст песни ⇄ обложка. Текста нет — так и говорим (щелчок по обложке тогда открыл бы картинку на весь экран)
  function lyricsToggle() {
    const f = document.getElementById("full"), box = document.getElementById("fLyrics");
    if (!f) return;
    try {
      if (f.dataset.mode === "lyrics") { fPeek = true; setFullMode("cover"); return; }
      if (box && box.childElementCount) { fPeek = false; setFullMode("lyrics"); return; }
    } catch {}
    try { showToast("У этой песни нет текста", 2500); } catch {}
  }

  // ---------- жесты плеера ----------
  // мини-плеер: влево — следующий, вправо — предыдущий; плеер на весь экран: вниз — свернуть. Кнопки остаются.
  function playerSwipes() {
    const swipe = (node, fn) => {
      if (!node) return;
      let s = null;
      node.addEventListener("touchstart", (e) => {
        const t = e.touches[0];
        s = e.touches.length === 1 && !e.target.closest("input, button, .flyrics.synced, .flyrics.plain") ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
      }, { passive: true });
      node.addEventListener("touchend", (e) => {
        if (!s) return;
        const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, dt = Date.now() - s.at;
        s = null;
        if (dt < 700) fn(dx, dy);
      }, { passive: true });
    };
    swipe(document.querySelector(".app > .player"), (dx, dy) => {
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
      document.getElementById(dx < 0 ? "next" : "prev")?.click();
    });
    swipe(document.getElementById("full"), (dx, dy) => {
      if (dy > 90 && dy > Math.abs(dx) * 2) closeFullSafe();
    });
  }

  // Свайп влево-вправо по странице — соседний раздел нижней панели (Волна ↔ Коллекция ↔ Друзья ↔ Профиль).
  // Не мешаем тому, что листается вбок само (ленты вкладок, ползунки, поля ввода), окнам и плееру на весь экран.
  function swipes() {
    const ORDER = ["wave", "likes", "friendsBtn", "profile"];
    const main = document.querySelector(".app > .main");
    if (!main) return;
    let s = null;
    const sideways = (el) => {
      for (let n = el; n && n !== main; n = n.parentElement) {
        if (n.matches?.("input, textarea, select, [contenteditable], .chips, .lyseg, .plbar, .settabs, .eqpresets, .stations")) return true;
        if (n.scrollWidth > n.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
      }
      return false;
    };
    main.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      s = e.touches.length === 1 && !sideways(e.target) && !opened() ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
    }, { passive: true });
    main.addEventListener("touchend", (e) => {
      if (!s) return;
      const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, dt = Date.now() - s.at;
      s = null;
      if (dt > 700 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      let cur = ORDER.findIndex((id) => document.getElementById(id)?.classList.contains("active"));
      if (cur < 0 && root.classList.contains("m-inprofile")) cur = ORDER.indexOf("profile");   // настройки, статистика
      if (cur < 0) return;                           // открыт не раздел, а страница внутри (альбом, артист) — свайпом не уходим
      const next = ORDER[cur + (dx < 0 ? 1 : -1)];
      if (next) document.getElementById(next)?.click();
    }, { passive: true });
  }

  // Интерфейс рисует встроенный браузер Android (Android System WebView), и он обновляется отдельно от приложения.
  // Слишком старый (до Chrome 111) не понимает color-mix() — на нём пропадают яркие кнопки, «Играть» и т. п.
  // Тогда сверху — подсказка обновить его в Google Play (закрыл — не показываем до следующей версии WebView).
  function oldWebView() {
    if (CSS.supports?.("color", "color-mix(in srgb, red 50%, blue)")) return;
    const ver = (/Chrome\/(\d+)/.exec(navigator.userAgent) || [])[1] || "?";
    try { if (localStorage.getItem("ym_m_oldwv") === ver) return; } catch {}
    const bar = document.createElement("div");
    bar.className = "m-oldwv";
    const txt = document.createElement("span");
    txt.textContent = `Встроенный браузер Android устарел (версия ${ver}), поэтому часть кнопок не видна. Обнови «Android System WebView» в Google Play.`;
    const go = document.createElement("button");
    go.className = "nav active"; go.textContent = "Обновить";
    go.onclick = () => window.__TAURI__.core.invoke("plugin:opener|open_url", { url: "https://play.google.com/store/apps/details?id=com.google.android.webview" }).catch(() => {});
    const x = document.createElement("button");
    x.className = "nav"; x.textContent = "✕"; x.title = "Скрыть";
    x.onclick = () => { bar.remove(); try { localStorage.setItem("ym_m_oldwv", ver); } catch {} };
    bar.append(txt, go, x);
    document.body.append(bar);
  }
})();
