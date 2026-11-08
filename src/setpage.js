"use strict";
// Страница настроек: поиск по всем вкладкам (Ctrl+F), переход к нужной настройке (window.openSetting) и место
// вкладок — сверху строкой или слева столбиком (Интерфейс → Расположение → «Вкладки настроек», localStorage ym_set_tabs).
// Вкладки и столбцы — main.js (setTab) и styles.css; здесь — только то, что поверх них.
(() => {
  const page = document.getElementById("settingsPage"), find = document.getElementById("setFind");
  const empty = document.getElementById("setFindEmpty"), top = document.getElementById("setTop");
  if (!page || !find || !top) return;
  const main = document.querySelector(".main");

  // ---------- поиск ----------
  // Ищем по заголовку карточки, подписям, подсказкам (title) и синонимам ниже — по ним находят то, что названо иначе.
  // Все слова запроса должны быть в карточке; подсвечиваются строки, где нашлось слово.
  const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  const SYN = {
    colorCard: "цвет акцент палитра тема font шрифт буквы текст", fxCard: "glow свечение неон анимация эффекты движение",
    bgCard: "обои wallpaper картинка видео гиф фон динамический обложка размытие blur стекло прозрачность панелей",
    styleCard: "стиль тема оформление скин интро заставка", layoutCard: "панель слева справа мини компактный закладки вкладки расположение",
    stuCard: "панели студия статистика кнопки меню боковая закреплённые закладки прятать", vizCard: "визуализация спектр анимация музыка",
    mascotCard: "кот котик cat питомец", langCard: "язык language английский english русский russian перевод", sleepCard: "таймер сна выключить компьютер ночь",
    dlCard: "скачать загрузки папка офлайн", cacheCard: "офлайн без интернета место диск память кэш",
    outCard: "наушники колонки динамики устройство звук", dpCard: "профиль наушники колонки громкость устройство",
    modeCard: "wasapi эксклюзивный битрейт flac mp3 320 качество поток трафик",
    normCard: "громкость loudness lufs выравнивание тише громче", fmtCard: "кодек битрейт частота формат",
    trayCard: "значок иконка tray мини-плеер", webCard: "браузер browser вкладка localhost сайт веб web", ntCard: "оповещения telegram звук всплывающие",
    hkCard: "сочетания shortcut клавиатура горячие клавиши", updCard: "версия обновить github",
    statCard: "статистика история прослушивания очистить", bkCard: "бэкап backup восстановить перенос копия",
    resetCard: "сброс по умолчанию начальные",
  };
  const UNITS = ".switch, .lyrow, .slide, .dcline, .fontcur, .swatch, .swcol > .nav, .updline, .dlpath, .drop, .stylecard, .vizopt, .palette, .outlist > *, .row > .nav";
  const words = (el) => norm([el.textContent, el.title, el.getAttribute("aria-label"), ...[...el.querySelectorAll("[title]")].map((x) => x.title)].join(" "));
  const TAB = {};
  document.querySelectorAll("#setTabs .chip").forEach((b) => { TAB[b.dataset.tab] = b.textContent.trim(); });

  function unmark() {
    page.querySelectorAll(".sfhit").forEach((e) => e.classList.remove("sfhit"));
    page.querySelectorAll(".sfcard").forEach((e) => e.classList.remove("sfcard"));
    page.querySelectorAll(".sftag").forEach((e) => e.remove());
  }
  function run() {
    const q = norm(find.value);
    unmark();
    page.classList.toggle("searching", !!q);
    if (!q) { empty.hidden = true; follow(); return; }
    const ws = q.split(" ");
    let n = 0;
    for (const card of page.children) {
      if (!card.classList.contains("card") || card.style.display === "none") continue;    // спрятана стилем — не показываем
      const all = norm((SYN[card.id] || "") + " " + words(card));
      if (!ws.every((w) => all.includes(w))) continue;
      card.classList.add("sfcard"); n++;
      const head = card.querySelector("h3");
      // совпал заголовок — карточка целиком по теме, подсвечивать строки незачем
      if (!head || !ws.some((w) => norm(head.textContent).includes(w))) {
        for (const u of card.querySelectorAll(UNITS)) {
          if (u.offsetParent === null || u.parentElement.closest(".sfhit")) continue;
          if (ws.some((w) => words(u).includes(w))) u.classList.add("sfhit");
        }
      }
      if (head && TAB[card.dataset.tab]) {
        const tag = document.createElement("button");
        tag.type = "button"; tag.className = "sftag"; tag.textContent = TAB[card.dataset.tab];
        tag.title = "Открыть на своей вкладке";
        tag.onclick = (e) => { e.stopPropagation(); window.openSetting(card); };
        head.append(tag);
      }
    }
    empty.hidden = n > 0;
    follow();
  }
  let t = 0;
  find.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 120); });
  find.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      if (find.value) { find.value = ""; run(); } else find.blur();
    } else if (e.key === "Enter") {
      e.preventDefault(); clearTimeout(t); run();
      (page.querySelector(".sfhit") || page.querySelector(".card.sfcard"))?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
  const clear = () => { if (find.value) { find.value = ""; run(); } };
  // щелчок по вкладке — выход из поиска; ушли со страницы настроек — тоже
  document.getElementById("setTabs")?.addEventListener("click", (e) => { if (e.target.closest(".chip")) clear(); });
  new MutationObserver(() => { if (page.hidden) clear(); follow(); }).observe(page, { attributes: true, attributeFilter: ["hidden"] });
  // Ctrl+F на странице настроек — свой поиск, а не поиск треков (keynav.js смотрит defaultPrevented)
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.code !== "KeyF") return;
    if (page.hidden || document.querySelector(".modal")) return;
    e.preventDefault(); e.stopPropagation();
    find.focus(); find.select();
  }, true);

  // ---------- открыть конкретную настройку: вкладка, прокрутка, короткая подсветка ----------
  // window.openSetting("#nmMode") — откроет «Звук», прокрутит к нормализации и подсветит её
  window.openSetting = (target) => {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    const card = el?.closest?.("#settingsPage > .card");
    if (!card) return false;
    if (page.hidden) document.getElementById("settingsBtn")?.click();
    clear();
    document.querySelector(`#setTabs .chip[data-tab="${card.dataset.tab}"]`)?.click();
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.remove("sfflash"); void el.offsetWidth; el.classList.add("sfflash");
      setTimeout(() => el.classList.remove("sfflash"), 1800);
    });
    return true;
  };

  // ---------- вкладки сверху или слева ----------
  const POS_KEY = "ym_set_tabs";
  let pos = (() => { try { return localStorage.getItem(POS_KEY) === "left" ? "left" : "top"; } catch { return "top"; } })();
  const wide = matchMedia("(min-width: 960px)");      // на узком окне столбику места нет — вкладки всегда сверху
  function applyPos() {
    page.dataset.tabs = pos;
    document.querySelectorAll("#setTabsPos .chip").forEach((c) => {
      const on = c.dataset.v === pos;
      c.classList.toggle("active", on); c.setAttribute("aria-pressed", on ? "true" : "false");
    });
    follow();
  }
  document.querySelectorAll("#setTabsPos .chip").forEach((c) => {
    c.type = "button";
    c.onclick = () => {
      if (pos === c.dataset.v) return;
      pos = c.dataset.v === "left" ? "left" : "top";
      try { localStorage.setItem(POS_KEY, pos); } catch {}
      applyPos();
    };
  });
  // Слева шапка едет вместе с прокруткой: она вне потока (absolute), а sticky внутри CSS-столбцов не работает.
  // Только transform — без пересчёта раскладки.
  let raf = 0;
  function follow() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (pos !== "left" || page.hidden || !wide.matches || !main) { top.style.transform = ""; return; }
      const mr = main.getBoundingClientRect(), pr = page.getBoundingClientRect();
      const d = Math.max(0, Math.min(mr.top + 8 - pr.top, pr.height - top.offsetHeight));
      top.style.transform = d > 0 ? `translateY(${Math.round(d)}px)` : "";
    });
  }
  main?.addEventListener("scroll", follow, { passive: true });
  window.addEventListener("resize", follow);
  wide.addEventListener?.("change", follow);
  applyPos();
})();
