// Настройки → Интерфейс → «Панели»: список кнопок боковой панели. ≡ — перетащить (порядок), глазик — показать/скрыть.
// Порядок и скрытые — localStorage ym_side { order: [id], hide: [id] }. «Статистика» и «Студия» включаются своими
// модулями (listenstats.js — #statsBtnOn, studio.js — #stuOn): глазик просто переключает их флажки, хранят они сами.
// «Настройки» скрыть нельзя — иначе до них не добраться (themeguard ждёт их в обязательном минимуме).
(() => {
  const $p = (id) => document.getElementById(id);
  const side = document.querySelector(".app > .side");
  const box = $p("sideList");
  if (!side || !box) return;
  const KEY = "ym_side";
  // id элемента в боковой панели → подпись; flag — флажок модуля вместо своего «скрыто»
  const ITEMS = [
    { id: "search", label: "Поиск" },
    { id: "wave", label: "Моя волна" },
    { id: "likes", label: "Лайки" },
    { id: "statsBtn", label: "Статистика", flag: "statsBtnOn" },
    { id: "settingsBtn", label: "Настройки", lock: true },
    { id: "studioBtn", label: "Студия", flag: "stuOn" },
    { id: "friendsBtn", label: "Друзья" },
  ];
  const byId = Object.fromEntries(ITEMS.map((it) => [it.id, it]));
  // Стартовая страница — галочка в строке кнопки (одна на весь список). localStorage ym_start: wave | likes | stats |
  // studio | friends (main.js → startPage). Кнопку спрятали — при запуске откроется «Моя волна».
  const START = "ym_start";
  const START_OF = { wave: "wave", likes: "likes", statsBtn: "stats", studioBtn: "studio", friendsBtn: "friends" };
  const startNow = () => { let v = "wave"; try { v = localStorage.getItem(START) || "wave"; } catch {} return Object.values(START_OF).includes(v) ? v : "wave"; };
  const setStart = (v) => { try { localStorage.setItem(START, v); } catch {} };
  let st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
  const order = () => {
    const o = (Array.isArray(st.order) ? st.order : []).filter((id) => byId[id]);
    for (const it of ITEMS) if (!o.includes(it.id)) o.splice(ITEMS.indexOf(it), 0, it.id);      // новые кнопки — на своё место
    return [...new Set(o)];
  };
  const hidden = new Set(Array.isArray(st.hide) ? st.hide.filter((id) => byId[id] && !byId[id].lock && !byId[id].flag) : []);
  const save = () => { st = { order: order(), hide: [...hidden] }; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const shown = (it) => it.lock || (it.flag ? !!$p(it.flag)?.checked : !hidden.has(it.id));
  // что лежит прямо в .side: поиск layout.js кладёт в обёртку .sbox (кружок в мини-панели, перетаскивание поля)
  const node = (id) => { const el = $p(id); return id === "search" ? el?.closest(".sbox") || el : el; };

  // боковая панель: кнопки по порядку перед .spacer (профиль и «Вернуться в приложение» — всегда внизу)
  function applySide() {
    const sp = side.querySelector(":scope > .spacer");
    for (const id of order()) { const el = node(id); if (el && el.parentElement === side) side.insertBefore(el, sp); }
    for (const it of ITEMS) if (!it.flag) node(it.id)?.classList.toggle("sidehide", !it.lock && hidden.has(it.id));
  }

  const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function paintEye(row) {
    const it = byId[row.dataset.id], on = shown(it), b = row.querySelector(".sbleye");
    row.classList.toggle("off", !on);
    b.innerHTML = on ? EYE : EYE_OFF;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.title = it.lock ? "Настройки нельзя скрыть" : on ? "Скрыть кнопку" : "Показать кнопку";
  }
  function render() {
    box.textContent = "";
    for (const id of order()) {
      const it = byId[id];
      const row = document.createElement("div");
      row.className = "sblrow"; row.dataset.id = id;
      row.title = "Перетащи, чтобы поменять порядок";
      const h = document.createElement("button");
      h.type = "button"; h.className = "sblgrip"; h.textContent = "≡";
      h.title = "Перетащи, чтобы поменять порядок (или Alt+↑ / Alt+↓)";
      const l = document.createElement("span");
      l.className = "sbllabel"; l.textContent = it.label;
      const e = document.createElement("button");
      e.type = "button"; e.className = "sbleye"; e.disabled = !!it.lock;
      // галочка стартовой страницы — только у разделов (у поиска и настроек её нет)
      const s = document.createElement("span");
      s.className = "sblstart";
      if (START_OF[id]) {
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.className = "sblstartcb";
        cb.title = "Стартовая страница — откроется при запуске приложения. Выбрать можно только одну";
        cb.setAttribute("aria-label", `Стартовая страница: ${it.label}`);
        s.append(cb);
      }
      row.append(h, l, s, e);
      if (it.lock) row.classList.add("lock");
      box.append(row);
      paintEye(row);
    }
    paintStart();
  }
  const paintStart = () => {
    const v = startNow();
    box.querySelectorAll(".sblrow").forEach((row) => {
      const cb = row.querySelector(".sblstartcb");
      if (cb) cb.checked = START_OF[row.dataset.id] === v;
    });
  };
  const repaint = () => { box.querySelectorAll(".sblrow").forEach(paintEye); paintStart(); };
  // одна галочка на список: отметил другую — прежняя снимается; сняли единственную — стартует «Моя волна»
  box.addEventListener("change", (e) => {
    const cb = e.target.closest(".sblstartcb"); if (!cb) return;
    setStart(cb.checked ? START_OF[cb.closest(".sblrow").dataset.id] : "wave");
    paintStart();
  });

  box.addEventListener("click", (e) => {
    const b = e.target.closest(".sbleye"); if (!b || b.disabled) return;
    const it = byId[b.closest(".sblrow").dataset.id];
    if (it.flag) {
      const cb = $p(it.flag); if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));      // модуль сохранит и применит сам
    } else {
      if (hidden.has(it.id)) hidden.delete(it.id); else hidden.add(it.id);
      save(); applySide();
    }
    repaint();
  });
  // флажки модулей могли поменяться не отсюда (консоль, другое окно, восстановление копии)
  for (const it of ITEMS) if (it.flag) $p(it.flag)?.addEventListener("change", repaint);

  // ---------- перетаскивание за любое место карточки (кроме глазика) ----------
  // Тянуть начинаем, когда курсор сдвинулся на 4 px: простой щелчок по карточке ничего не делает.
  const commit = () => { st.order = [...box.querySelectorAll(".sblrow")].map((r) => r.dataset.id); save(); applySide(); };
  let drag = null;
  box.addEventListener("pointerdown", (e) => {
    const row = e.target.closest(".sblrow");
    if (!row || e.button !== 0 || e.target.closest(".sbleye, .sblstart")) return;
    e.preventDefault();
    drag = { row, id: e.pointerId, y: e.clientY, y0: e.clientY, on: false, moved: false };
    row.setPointerCapture(e.pointerId);
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { row } = drag;
    if (!drag.on) {
      if (Math.abs(e.clientY - drag.y0) < 4) return;
      drag.on = true; row.classList.add("drag"); box.classList.add("dragging");
    }
    row.style.transform = `translateY(${e.clientY - drag.y}px)`;
    // перескок через соседа, когда курсор прошёл его середину
    const prev = row.previousElementSibling, next = row.nextElementSibling;
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    let jump = null;
    if (next && e.clientY > mid(next)) { jump = next.offsetHeight + parseFloat(getComputedStyle(box).rowGap || 0); box.insertBefore(next, row); }
    else if (prev && e.clientY < mid(prev)) { jump = -(prev.offsetHeight + parseFloat(getComputedStyle(box).rowGap || 0)); box.insertBefore(row, prev); }
    if (jump !== null) { drag.y += jump; drag.moved = true; row.style.transform = `translateY(${e.clientY - drag.y}px)`; }
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.row.classList.remove("drag"); drag.row.style.transform = ""; box.classList.remove("dragging");
    const moved = drag.moved; drag = null;
    if (moved) commit();
  };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
  // с клавиатуры: фокус на ≡, Alt+↑ / Alt+↓
  box.addEventListener("keydown", (e) => {
    const g = e.target.closest(".sblgrip"); if (!g || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault(); e.stopPropagation();
    const row = g.closest(".sblrow");
    if (e.key === "ArrowUp" && row.previousElementSibling) box.insertBefore(row, row.previousElementSibling);
    else if (e.key === "ArrowDown" && row.nextElementSibling) box.insertBefore(row.nextElementSibling, row);
    else return;
    g.focus(); commit();
  }, true);

  window.addEventListener("storage", (e) => {
    if (e.key === START) return paintStart();
    if (e.key !== KEY) return;
    try { st = JSON.parse(e.newValue) || {}; } catch { st = {}; }
    hidden.clear(); for (const id of st.hide || []) if (byId[id] && !byId[id].lock && !byId[id].flag) hidden.add(id);
    applySide(); render();
  });

  applySide(); render();

  // ---------- режим перестановки прямо в боковой панели (правый щелчок по ней → «Переставить кнопки», tmenu.js) ----------
  // Кнопки тянутся мышью вверх-вниз; щелчки по ним в это время ничего не открывают. Выход — «Готово», Esc
  // или щелчок мимо панели. Порядок тот же, что в списке «Панелей» (ym_side).
  // Двигаются только кнопки верхней группы (ITEMS); «Профиль», «Свернуть» и всё под .spacer — на месте.
  // Раньше порядок брался из сохранённого списка, а не из того, как кнопки стоят сейчас, — и кнопка улетала:
  // теперь место считается по живому порядку в панели, по серединам видимых соседей.
  let editing = false, done = null, sdrag = null;
  const idOf = (el) => ITEMS.find((it) => node(it.id) === el)?.id;
  const movable = () => [...side.children].filter((el) => idOf(el));
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
  const domOrder = () => movable().map(idOf);
  function sideEdit(on) {
    if (on === editing) return;
    editing = on;
    document.documentElement.classList.toggle("side-edit", on);
    for (const el of movable()) el.classList.toggle("sideedit-it", on);
    if (on) {
      window.closeTrackMenu?.();
      done = document.createElement("button");
      done.type = "button"; done.className = "nav active sideeditdone"; done.textContent = "Готово";
      done.title = "Тяни кнопки, чтобы поменять порядок. Esc — закончить";
      done.onclick = (e) => { e.stopPropagation(); sideEdit(false); };
      // под кнопками, которые переставляют, — там, где заканчивается работа
      side.insertBefore(done, side.querySelector(":scope > .spacer"));
    } else {
      done?.remove(); done = null;
      st.order = domOrder(); save(); applySide(); render();
    }
  }
  window.sideEdit = sideEdit;
  // щелчки по кнопкам панели в режиме перестановки — не переходы
  side.addEventListener("click", (e) => { if (editing && !done?.contains(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener("keydown", (e) => { if (editing && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); sideEdit(false); } }, true);
  document.addEventListener("pointerdown", (e) => { if (editing && !side.contains(e.target)) sideEdit(false); }, true);
  side.addEventListener("pointerdown", (e) => {
    if (!editing || e.button !== 0 || done?.contains(e.target)) return;
    const el = movable().find((c) => c.contains(e.target));
    if (!el) return;
    e.preventDefault();
    // Всё меряется один раз — при захвате. Пока тянут, разметка не меняется вовсе: соседи только съезжают
    // transform-ом (переход — в panels.css), а порядок в панели переставляется один раз — когда отпустили.
    // Раньше каждая перестановка двигала узел, перемеряла раскладку и запускала анимации всех соседей — отсюда просадки.
    const vis = movable().filter(visible);
    const tops = vis.map(layoutTop), hs = vis.map((n) => n.offsetHeight);
    const at = vis.indexOf(el);
    // шаг сдвига соседа = высота кнопки + зазор между кнопками (по соседней паре; одна кнопка — без зазора)
    const gap = vis.length > 1 ? Math.max(0, (at > 0 ? tops[at] - tops[at - 1] - hs[at - 1] : tops[at + 1] - tops[at] - hs[at])) : 0;
    const others = vis.filter((n) => n !== el);
    sdrag = {
      el, id: e.pointerId, y: e.clientY, raf: 0, at, k: at, others,
      grab: e.clientY - tops[at], top: tops[at], h: hs[at], step: hs[at] + gap,
      mids: others.map((n) => tops[vis.indexOf(n)] + hs[vis.indexOf(n)] / 2),
      lo: Math.min(...tops), hi: Math.max(...tops.map((t, i) => t + hs[i])) - hs[at],
      shift: others.map(() => 0),
    };
    el.setPointerCapture(e.pointerId);
    el.classList.add("sidedrag"); side.classList.add("sidedragging");
  }, true);
  // положение без transform: offsetTop от общего offsetParent
  const layoutTop = (n) => { const p = n.offsetParent; return (p ? p.getBoundingClientRect().top + p.clientTop - p.scrollTop : 0) + n.offsetTop; };
  // кадр перетаскивания: не чаще раза за кадр экрана; только числа и transform
  function frame() {
    const d = sdrag;
    if (!d) return;
    d.raf = 0;
    const y = Math.max(d.lo, Math.min(d.hi, d.y - d.grab));
    d.el.style.transform = `translate3d(0, ${y - d.top}px, 0)`;
    // новое место — сколько соседей (по их исходным серединам) выше середины кнопки. Середину берём по курсору, а не по
    // прижатой к краю кнопке: у края она встаёт ровно на середину последнего соседа, и на последнее место было не попасть
    const c = d.y - d.grab + d.h / 2;
    let k = 0; while (k < d.mids.length && d.mids[k] < c) k++;
    if (k === d.k) return;
    d.k = k;
    // соседи между старым и новым местом уступают: выше исходного — вниз, ниже — вверх
    d.others.forEach((n, i) => {
      const s = i < d.at && i >= k ? d.step : i >= d.at && i < k ? -d.step : 0;
      if (s !== d.shift[i]) { d.shift[i] = s; n.style.transform = s ? `translate3d(0, ${s}px, 0)` : ""; }
    });
  }
  side.addEventListener("pointermove", (e) => {
    if (!sdrag || e.pointerId !== sdrag.id) return;
    sdrag.y = e.clientY;
    if (!sdrag.raf) sdrag.raf = requestAnimationFrame(frame);
  });
  const sEnd = (e) => {
    if (!sdrag || e.pointerId !== sdrag.id) return;
    const d = sdrag; sdrag = null;
    cancelAnimationFrame(d.raf);
    // один раз: без переходов снять сдвиги и поставить кнопку на новое место
    side.classList.add("sidecommit");
    for (const n of [d.el, ...d.others]) n.style.transform = "";
    if (d.k !== d.at) side.insertBefore(d.el, d.k < d.others.length ? d.others[d.k] : d.others[d.others.length - 1].nextSibling);
    d.el.classList.remove("sidedrag"); side.classList.remove("sidedragging");
    void side.offsetHeight;                 // применить без анимации, потом вернуть переходы
    requestAnimationFrame(() => side.classList.remove("sidecommit"));
    if (d.k !== d.at) { st.order = domOrder(); save(); render(); }
  };
  side.addEventListener("pointerup", sEnd);
  side.addEventListener("pointercancel", sEnd);

  // для меню правого щелчка (tmenu.js): стартовая страница
  window.sidePanel = {
    pages: () => order().filter((id) => START_OF[id]).map((id) => ({ v: START_OF[id], label: byId[id].label, shown: shown(byId[id]) })),
    start: startNow,
    setStart: (v) => { setStart(v); paintStart(); },
  };

  // раздел боковой панели, открытый последним (ym_start_last) — для ym_start = "last" (main.js → startPage)
  side.addEventListener("click", (e) => {
    const b = e.target.closest(".nav"); const p = b && START_OF[b.id];
    if (p) try { localStorage.setItem("ym_start_last", p); } catch {}
  });
})();
