// Меню трека (Настройки → Интерфейс → «Меню трека»):
//   * правый щелчок по треку в списке, очереди, истории открывает то же меню, что «⋯» (можно выключить);
//   * какие действия в меню показывать — окно «Настроить…», глазик у каждого пункта.
// Пункты скрываются по подписи: main.js → menuItem спрашивает window.tmenuHidden(подпись), пока строит главное меню
// (вложенные списки — плейлисты, устройства — не трогаются). localStorage ym_tmenu { right: bool, hide: [ключ] }.
(() => {
  const KEY = "ym_tmenu";
  const $t = (id) => document.getElementById(id);
  // ключ → подпись в настройках и подписи пунктов в меню (у некоторых их несколько: «Скачать трек» / «Уже скачан»)
  const ITEMS = [
    { k: "next", label: "Играть следующим", texts: ["Играть следующим"] },
    { k: "playlist", label: "Добавить в плейлист", texts: ["Добавить в плейлист"] },
    { k: "archive", label: "Сохранить в архив", texts: ["Сохранить в архив", "Сохраняется в архив…"] },
    { k: "share", label: "Поделиться", texts: ["Поделиться"] },
    { k: "studio", label: "Обрезать в студии", texts: ["Обрезать в студии"] },
    { k: "room", label: "Предложить в комнату", texts: ["Предложить в комнату"] },
    { k: "move", label: "Переместить в начало / в конец", texts: ["Переместить в начало", "Переместить в конец"] },
    { k: "cover", label: "Сделать обложкой плейлиста", texts: ["Сделать обложкой плейлиста"] },
    { k: "plremove", label: "Удалить из плейлиста", texts: ["Удалить из плейлиста"] },
    { k: "artistban", label: "Не рекомендовать автора", texts: ["Не рекомендовать автора", "Снова рекомендовать автора"] },
    { k: "eq", label: "Эквалайзер", texts: ["Эквалайзер"] },
    { k: "download", label: "Скачать трек", texts: ["Скачать трек", "Уже скачан"] },
    { k: "delete", label: "Удалить с диска", texts: ["Удалить с диска"] },
    { k: "colors", label: "Цвета этого места (по правому щелчку)", texts: [] },
  ];
  const byText = new Map(ITEMS.flatMap((it) => it.texts.map((t) => [t, it.k])));
  let st = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return { right: v.right !== false, hide: new Set(Array.isArray(v.hide) ? v.hide : []) }; } catch { return { right: true, hide: new Set() }; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ right: st.right, hide: [...st.hide] })); } catch {} };

  window.tmenuHidden = (text) => { const k = byText.get(text); return !!k && st.hide.has(k); };

  // ---------- «Цвета этого места…» ----------
  // Пункт есть в каждом меню по правому щелчку: «Тонкая настройка цветов» (main.js → openColorEditor) открывается
  // сразу на строке того, по чему щёлкнули. Таблица — от селектора к ключу CC_GROUPS; выигрывает первое совпадение,
  // поэтому частное стоит выше общего. Ничего не подошло — «Основной текст».
  const CC_AT = [
    [".tab.active", "tabActBg"], [".tab", "tabBg"], [".titlebar", "titleBarBg"], [".tabs", "tabBorder"],
    [".side .nav.active", "navActBg"], [".side .nav", "navBg"], [".sbox, .side .search", "searchBg"], [".side", "sideBg"],
    ["#pTitle", "plTitle"], ["#pArtist, .player .time", "plArtist"], [".seekrow", "seekFill"], [".volwrap", "volFill"],
    [".player .playbtn, .wavebtn", "playBg"], [".modebtn", "plModeOn"], [".likebtn", "like"], [".player button", "plIcons"], [".player", "plBg"],
    [".list .t", "rowTitle"], [".list .a", "rowArtist"], [".list li", "rowHover"], [".list", "listBg"],
    ["#title, .head h2", "heading"], [".chip.active, .pill.active, .main .nav.active", "btnActBg"], [".chip, .pill, .round, .main .nav", "btnBg"],
    [".switch, .settings input[type=range]", "ctl"], [".card h3, .main h3", "heading"], [".card, .lastAlbum, .simcard, .stylecard", "cardBg"],
    [".stage, canvas", "vizA"], [".sub, .status, .muted, .swatch", "muted"], [".main", "mainBg"],
  ];
  const ccKeyAt = (t) => { for (const [sel, k] of CC_AT) { try { if (t?.closest(sel)) return k; } catch {} } return "text"; };
  const PAL = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.9-.9 1.9-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.9 1.9-1.9H17a4 4 0 0 0 4-4c0-4.3-4-7.700-9-7.700z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7.6" cy="11.5" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.6" r="1.2" fill="currentColor"/><circle cx="15" cy="7.8" r="1.2" fill="currentColor"/></svg>';
  function colorsItem(t) {
    if (typeof openColorEditor !== "function" || !$t("ccBtn")) return;
    const k = ccKeyAt(t);
    menuItem(PAL, "Цвета этого места…", () => openColorEditor(k));
  }

  // ---------- правый щелчок ----------
  // Системное меню WebView («Назад», «Обновить», «Печать»…) не показываем нигде — только своё. Исключения: поля
  // ввода и выделенный текст (там системное меню — это «Вырезать / Копировать / Вставить»).
  //   * строка с кнопкой «⋯» и нижняя панель (#pMore) — меню трека у курсора (можно выключить: #tmRight);
  //   * пустое место «Лайков», настроек, «Моей волны», боковая панель — свои меню;
  //   * всё остальное в окне — общее меню (pageMenu): «Назад», настройки, последние стили.
  // Модуль, который рисует своё меню по правому щелчку (studio.js), зовёт preventDefault — сюда он уже не доходит.
  const EDIT = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, [contenteditable]';
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    const t = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!t) return;
    if (t.closest(EDIT) || String(window.getSelection?.() || "").trim()) return;
    e.preventDefault();
    if (t.closest(".tmenu, .modal")) return;
    const x = e.clientX, y = e.clientY;
    if (st.right) {
      let more = t.closest("li")?.querySelector(":scope .morebtn");
      if (!more && t.closest(".player")) more = $t("pMore");
      if (more && !more.disabled && more.offsetParent) {
        // меню — у курсора (main.js → openMenu забирает window.menuPoint); уже открыто у этой строки — переедет
        if (more.classList.contains("open")) closeTrackMenu();
        window.menuPoint = { x, y };
        more.click();
        window.menuPoint = null;         // меню могло не открыться (трек недоступен) — точка не должна достаться другому
        // меню трека открылось — внизу тот же пункт про цвета (прячется вместе с остальными: «Настроить…»)
        if (more.classList.contains("open") && !st.hide.has("colors")) { colorsItem(t); placeMenu(); }
        return;
      }
    }
    const inMain = !!t.closest(".main");
    // «Лайки» — вся страница, кроме строк треков (у них своё меню выше)
    if (inMain && typeof likesOpen === "function" && likesOpen() && !t.closest("li")) return likesMenu(x, y, t);
    // настройки — вся страница: заголовок, оба столбца, карточки, поля вокруг
    const sp = $t("settingsPage");
    if (inMain && sp && !sp.hidden) return settingsMenu(x, y, t);
    const wp = $t("wavePage");
    if (wp && !wp.hidden && wp.contains(t) && !t.closest("button, a, .chip, .list, .stwrap")) return waveMenu(x, y, t);
    if (t.closest(".app > .side") && !document.documentElement.classList.contains("side-edit")) return sideMenu(x, y, t);
    if (t.closest(".app") && !document.documentElement.classList.contains("side-edit")) pageMenu(x, y, t);
  });

  // общее меню для остального окна (шапка, поиск, альбомы, артисты, статистика, студия, нижняя панель без «⋯»)
  const BACK = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 12H5m0 0 6-6m-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const GEAR = '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const OPEN = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
  const PDF = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5M12 11v6m0 0-2.5-2.5M12 17l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // «Экспорт ›» — подменю с форматами (listexport.js). back — построить предыдущее меню заново (кнопка «←»)
  const EXP = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 4v11m0-11L7.5 8.5M12 4l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  const FILE = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function exportItem(what, back) {
    if (!window.listExport) return;
    menuItem(EXP, "Экспорт", () => {
      menuReset();
      menuHead("Экспорт", back);
      for (const [fmt, f] of Object.entries(window.listExport.formats)) menuItem(FILE, f.label, () => window.listExport.run(what, fmt)).title = f.hint;
      placeMenu();
    }, { keep: true, arrow: true });
  }
  function pageMenu(x, y, at) {
    if (tmenuBtn === anchor) closeTrackMenu();
    anchor.style.left = x + "px"; anchor.style.top = y + "px";
    openMenu(anchor, function build() {
      menuReset();
      if (window.lstatsPdf?.ready()) menuItem(PDF, "Скачать статистику (PDF)", () => window.lstatsPdf.save());
      // карточка в «Моих плейлистах» — открыть и выгрузить именно её; открытая страница плейлиста — её
      const card = at?.closest?.(".plcard[data-kind]");
      if (card) { menuItem(OPEN, "Открыть плейлист", () => card.click()); exportItem({ type: "playlist", kind: card.dataset.kind }, build); }
      else if (typeof curPl !== "undefined" && curPl && $t("plBar") && !$t("plBar").hidden) exportItem({ type: "playlist", kind: curPl }, build);
      const back = $t("back");
      if (back && !back.hidden && back.offsetParent) menuItem(BACK, "Назад", () => back.click());
      const set = $t("settingsBtn");
      if (set && set.offsetParent) menuItem(GEAR, "Настройки", () => set.click());
      colorsItem(at);
      recentRow();
      // нечего показать (нет «Назад», настройки скрыты темой, стиль один) — меню не открываем
      if (!tmenu.children.length) return closeTrackMenu();
      placeMenu();
    });
  }

  // ---------- меню пустого места «Моей волны» ----------
  // Якорь — точка под курсором: меню приложения (main.js → openMenu/placeMenu) встаёт рядом с элементом-кнопкой.
  const anchor = document.createElement("i");
  anchor.className = "ctxanchor";
  document.body.append(anchor);
  const IC = {
    img: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m4 17 5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="16" cy="9" r="1.6" fill="currentColor"/></svg>',
    off: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    viz: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 10h2v4H4zM8 6h2v12H8zM12 3h2v18h-2zM16 7h2v10h-2zM20 10h1.5v4H20z" fill="currentColor"/></svg>',
  };
  // ---------- меню боковой панели: перестановка, стартовая страница, последние стили ----------
  // последние включённые стили — кружочками внизу меню (localStorage ym_recent_styles, до 6, новый — первым)
  const RECENT = "ym_recent_styles";
  const recent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
  let lastStyle = "";
  function noteStyle() {
    const s = typeof cfg !== "undefined" ? cfg.style : "";
    if (!s || s === lastStyle || !document.querySelector(`.stylecard[data-style="${CSS.escape(s)}"]`)) return;
    lastStyle = s;
    const list = [s, ...recent().filter((x) => x !== s)].slice(0, 6);
    try { localStorage.setItem(RECENT, JSON.stringify(list)); } catch {}
  }
  new MutationObserver(noteStyle).observe(document.documentElement, { attributes: true, attributeFilter: ["data-style"] });
  setTimeout(noteStyle, 1500);       // стиль прошлого запуска (свои темы подключаются не сразу)
  const colorsOf = (id) => {
    const s = cfg.s?.[id] || {}, d = (typeof themeColors === "function" && themeColors(id)) || {};
    return [s.accent || d.accent || "#888888", s.accent2 || d.accent2 || s.accent || d.accent || "#555555"];
  };
  const CHECK = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const NOCHECK = '<i class="moempty"></i>';
  const MOVE = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3v18M12 3l-3.5 3.5M12 3l3.5 3.5M12 21l-3.5-3.5M12 21l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function sideMenu(x, y, at) {
    if (tmenuBtn === anchor) closeTrackMenu();
    anchor.style.left = x + "px"; anchor.style.top = y + "px";
    openMenu(anchor, () => {
      menuReset();
      if (window.sideEdit) menuItem(MOVE, "Переставить кнопки", () => window.sideEdit(true));
      const sp = window.sidePanel;
      if (sp) {
        menuNote("Открывать при запуске");
        const cur = sp.start();
        for (const p of sp.pages()) {
          const b = menuItem(p.v === cur ? CHECK : NOCHECK, p.label, () => sp.setStart(p.v));
          if (!p.shown) b.title = "Кнопка скрыта — при запуске откроется «Моя волна»";
        }
      }
      colorsItem(at);
      recentRow();
      placeMenu();
    });
  }
  // «Последние стили» внизу меню — кружочки с обложками стилей (боковая панель, «Лайки»)
  function recentRow() {
    const cards = recent().map((id) => [id, document.querySelector(`.stylecard[data-style="${CSS.escape(id)}"]`)]).filter(([, c]) => c);
    if (cards.length < 2) return;
    menuNote("Последние стили");
    const row = document.createElement("div"); row.className = "mthemes";
    for (const [id, card] of cards) {
      const b = document.createElement("button"); b.type = "button"; b.className = "mtheme" + (id === cfg.style ? " on" : "");
      // обложка стиля — та же, что у его карточки в настройках (.sprev: фон темы или превью встроенного стиля)
      const pv = card.querySelector(".sprev");
      if (pv) { const c = pv.cloneNode(true); c.classList.add("mthemeprev"); b.append(c); }
      else { const [a, a2] = colorsOf(id); b.style.setProperty("--a", a); b.style.setProperty("--b", a2); b.classList.add("nocover"); }
      const name = card.querySelector(".scname")?.textContent || id;
      b.title = name; b.setAttribute("aria-label", name);
      b.onclick = (e) => { e.stopPropagation(); closeTrackMenu(); if (id !== cfg.style) card.click(); };
      row.append(b);
    }
    tmenu.append(row);
  }

  // ---------- меню пустого места «Лайков» ----------
  const DL = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ADD = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M17 14v6M14 17h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  // «Добавить трек…» — одно окно (linkadd.js → addTrack): поле для ссылки и зона «перетащи файл или выбери»
  function addTrackItem() {
    if (window.addTrack) menuItem(ADD, "Добавить трек…", () => window.addTrack());
  }
  function likesMenu(x, y, at) {
    if (tmenuBtn === anchor) closeTrackMenu();
    anchor.style.left = x + "px"; anchor.style.top = y + "px";
    openMenu(anchor, function build() {
      menuReset();
      // та же кнопка, что справа от вкладок: она знает, что уже скачано, и умеет остановить скачивание
      const dl = $t("dlAllBtn");
      if (dl && !dl.hidden) {
        const busy = dl.classList.contains("busy"), all = dl.classList.contains("done");
        const b = menuItem(DL, busy ? "Остановить скачивание" : all ? "Лайки уже скачаны" : "Скачать лайки", () => dl.click());
        if (all && !busy) b.disabled = true;
      }
      addTrackItem();
      exportItem({ type: "likes" }, build);
      colorsItem(at);
      recentRow();
      placeMenu();
    });
  }

  // ---------- меню пустого места в настройках ----------
  // Всё — кнопками приложения: «Восстановить из файла…» и «Автокопии…» (backup.js, карточка #bkCard),
  // язык — чип #langSeg (i18n.js сохраняет и переводит сам)
  const IMP = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 15V4m0 11-4.5-4.5M12 15l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  const AUTO = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4.5l3 2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  function settingsMenu(x, y, at) {
    if (tmenuBtn === anchor) closeTrackMenu();
    anchor.style.left = x + "px"; anchor.style.top = y + "px";
    openMenu(anchor, () => {
      menuReset();
      const load = $t("bkLoad"), auto = $t("bkAutoBtn");
      if (load || auto) {
        menuNote("Импорт настроек");
        if (load) menuItem(IMP, "Из файла…", () => load.click());
        if (auto) menuItem(AUTO, "Из автокопий…", () => auto.click());
      }
      const chips = [...document.querySelectorAll("#langSeg .chip[data-v]")];
      if (chips.length) {
        menuNote("Язык / Language");
        for (const c of chips) {
          const on = c.classList.contains("active");
          const b = menuItem(on ? CHECK : NOCHECK, c.textContent, () => { if (!on) c.click(); });
          b.dataset.noi18n = "";           // «Русский» / «English» — всегда на своём языке
        }
      }
      colorsItem(at);
      recentRow();
      placeMenu();
    });
  }

  function waveMenu(x, y, at) {
    if (tmenuBtn === anchor) closeTrackMenu();
    anchor.style.left = x + "px"; anchor.style.top = y + "px";
    openMenu(anchor, () => {
      menuReset();
      menuItem(IC.img, "Выбрать обои…", () => $t("bgFile")?.click());
      const hasBg = (() => { try { return !!(curBg() || curBgVideo()); } catch { return false; } })();
      if (hasBg) menuItem(IC.off, "Убрать обои", () => $t("bgReset")?.click());
      const v = $t("cViz");
      if (v) menuItem(IC.viz, v.checked ? "Выключить аудиовизуализатор" : "Включить аудиовизуализатор", () => {
        v.checked = !v.checked;
        v.dispatchEvent(new Event("change", { bubbles: true }));
      });
      colorsItem(at);
      placeMenu();
    });
  }

  // ---------- настройки ----------
  const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function note() {
    const n = $t("tmNote"); if (!n) return;
    const off = ITEMS.filter((it) => st.hide.has(it.k)).length;
    n.textContent = off ? `Скрыто действий: ${off} из ${ITEMS.length}` : "Показаны все действия";
  }
  function paintRow(row) {
    const on = !st.hide.has(row.dataset.k), b = row.querySelector(".sbleye");
    row.classList.toggle("off", !on);
    b.innerHTML = on ? EYE : EYE_OFF;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.title = on ? "Скрыть из меню" : "Показать в меню";
  }
  function openSetup() {
    const list = document.createElement("div");
    list.className = "sbl tml";
    for (const it of ITEMS) {
      const row = document.createElement("div"); row.className = "sblrow tmrow"; row.dataset.k = it.k;
      const l = document.createElement("span"); l.className = "sbllabel"; l.textContent = it.label;
      const e = document.createElement("button"); e.type = "button"; e.className = "sbleye";
      row.append(l, e); list.append(row); paintRow(row);
    }
    list.addEventListener("click", (ev) => {
      const row = ev.target.closest(".tmrow"); if (!row) return;
      const k = row.dataset.k;
      if (st.hide.has(k)) st.hide.delete(k); else st.hide.add(k);
      save(); paintRow(row); note();
    });
    const reset = document.createElement("button"); reset.type = "button"; reset.className = "nav"; reset.textContent = "Показать все";
    reset.onclick = () => { st.hide.clear(); save(); list.querySelectorAll(".tmrow").forEach(paintRow); note(); };
    window.openDetails?.({
      title: "Меню трека",
      sub: "Какие действия показывать в меню «⋯»",
      body: list,
      foot: [reset],
    });
  }
  const right = $t("tmRight");
  if (right) {
    right.checked = st.right;
    right.addEventListener("change", () => { st.right = right.checked; save(); });
  }
  $t("tmSetup")?.addEventListener("click", openSetup);
  note();
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    try { const v = JSON.parse(e.newValue || "{}"); st = { right: v.right !== false, hide: new Set(Array.isArray(v.hide) ? v.hide : []) }; } catch {}
    if (right) right.checked = st.right;
    note();
  });
})();
