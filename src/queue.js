"use strict";
// Очередь и история прослушивания.
// Выезжающая справа панель: «Сейчас играет», «Далее» (следующие треки — можно убрать или перетащить)
// и «История» (всё, что играло, по дням). Открывается кнопкой в нижнем плеере (видна на любой странице),
// кнопкой «История» на странице Моей волны и клавишей Q.
// Работает поверх глобальных переменных плеера из main.js (queue, current, order, …).
(() => {
  const HIST_KEY = "ym_history";
  const HIST_MAX = 300;
  const NEXT_SHORT = 5, NEXT_LONG = 50;
  const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="${d}"/></svg>`;
  ICON.queue = svg("M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18A3 3 0 1 0 19 17V8h3V6h-5z");
  ICON.history = svg("M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z");
  ICON.playNext = svg("M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z");
  ICON.x = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // ---------- история ----------
  const hist = lsJSON(HIST_KEY, [], Array.isArray)
    .filter((h) => h && h.t && h.t.id != null && typeof h.t.title === "string" && Number.isFinite(h.at))
    .slice(0, HIST_MAX);
  let saveTimer = 0;
  const saveHist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch {} }, 300);
  };
  // Вызывается из play() в main.js при старте трека. Повтор того же трека подряд не дублируется.
  window.qOnPlay = (t) => {
    if (!t || t.id == null) return;
    const id = String(t.id), now = Date.now();
    if (hist[0] && String(hist[0].t.id) === id && now - hist[0].at < 30 * 60e3) hist[0].at = now;
    else hist.unshift({ t: trackMin(t), at: now });
    if (hist.length > HIST_MAX) hist.length = HIST_MAX;
    saveHist();
    refresh();
  };

  // ---------- очередь ----------
  const shuffled = () => modesActive() && shuffle;
  // Номера в queue для следующих треков — в том порядке, в каком они заиграют.
  function upcoming(max) {
    if (current < 0 || !queue.length) return [];
    const res = [];
    if (shuffled()) {
      if (orderFor !== queue || order.length !== queue.length || order[ordPos] !== current) buildOrder();
      for (let k = ordPos + 1; k < order.length && res.length < max; k++) res.push(order[k]);
    } else {
      for (let k = current + 1; k < queue.length && res.length < max; k++) res.push(k);
    }
    return res;
  }
  function upcomingCount() {
    if (current < 0) return 0;
    return shuffled() ? Math.max(0, order.length - ordPos - 1) : Math.max(0, queue.length - current - 1);
  }
  // Очередь часто — тот же массив, что список на экране или лайки. Перед правкой берём свою копию,
  // чтобы удаление из очереди не трогало сам список лайков/альбома.
  function own() {
    if (queue._own) return;
    const q = queue.slice(); q._own = true;
    if (orderFor === queue) orderFor = q;
    if (wave.queue === queue) wave.queue = q;
    queue = q;
  }
  function afterEdit() {
    if (wave.on) wave.pos = current;
    saveLast(audio && !needLoad ? audio.currentTime : 0);
    refresh();
  }
  function removeAt(idx) {
    if (idx === current || idx < 0 || idx >= queue.length) return;
    own();
    const [t] = queue.splice(idx, 1);
    if (idx < current) current--;
    if (orderFor === queue) {
      const p = order.indexOf(idx);
      if (p >= 0) { order.splice(p, 1); if (p < ordPos) ordPos--; }
      order = order.map((x) => (x > idx ? x - 1 : x));
    }
    afterEdit();
    showToast(`«${t.title}» убран из очереди`, 4000, {
      action: { label: "Вернуть", fn: () => insertNext(t, true) },
    });
  }
  // Перестановка внутри «Далее»: from/to — позиции в этом списке (0 — ближайший трек).
  function moveUpcoming(from, to) {
    if (from === to) return;
    if (shuffled()) {
      const a = ordPos + 1 + from, b = ordPos + 1 + to;
      const [x] = order.splice(a, 1); order.splice(b, 0, x);
    } else {
      own();
      const a = current + 1 + from, b = current + 1 + to;
      const [x] = queue.splice(a, 1); queue.splice(b, 0, x);
    }
    afterEdit();
  }
  // «Играть следующим»: трек встаёт сразу за текущим (и в случайном порядке тоже).
  function insertNext(t, quiet = false) {
    if (!t) return;
    if (current < 0 || !queue.length) {
      wave.on = false; queue = [t]; queue._own = true; playCtx = "other"; playAlbum = null;
      play(0); return;
    }
    own();
    if (shuffled()) {
      if (orderFor !== queue || order.length !== queue.length || order[ordPos] !== current) buildOrder();
      queue.push(t);
      order.splice(ordPos + 1, 0, queue.length - 1);
    } else {
      queue.splice(current + 1, 0, t);
    }
    afterEdit();
    if (!quiet) showToast(`«${t.title}» заиграет следующим`, 3000, { kind: "ok" });
  }
  window.playNext = insertNext;

  // ---------- панель ----------
  const panel = document.createElement("aside");
  panel.id = "qPanel"; panel.className = "panel qpanel"; panel.hidden = true;
  panel.setAttribute("aria-label", "Очередь и история прослушивания");
  panel.innerHTML = `
    <div class="qhead"><b>Очередь и история</b><button class="qclose" title="Закрыть (Esc)">${ICON.x}</button></div>
    <div class="qbody">
      <section class="qsec"><h4>Сейчас играет</h4><ul class="list qnow"></ul></section>
      <section class="qsec qnextsec"><h4><span>Далее</span><small class="qsrc"></small></h4>
        <ul class="list qnext"></ul><p class="qempty qnextempty"></p>
        <button class="qmore" hidden></button></section>
      <section class="qsec"><h4><span>История прослушивания</span><button class="qclear" title="Очистить историю">Очистить</button></h4>
        <div class="qhist"></div><p class="qempty qhistempty">Здесь появятся треки, которые ты слушал.</p></section>
    </div>`;
  document.body.append(panel);
  const el = (s) => panel.querySelector(s);
  let longNext = false, dragging = false, pending = false;

  function srcLabel() {
    if (wave.on) return wave.album ? `волна по «${wave.album.title}»` : wave.name ? `волна «${wave.name}»` : "Моя волна";
    if (shuffled()) return "случайный порядок";
    return { likes: "из лайков", album: "из альбома", playlist: "из плейлиста" }[playCtx] || "";
  }

  function row(t, { onClick, grip, remove, time, more = true } = {}) {
    const li = document.createElement("li");
    li.dataset.id = t.id;
    if (String(t.id) === String(playingId)) li.classList.add("playing");
    if (grip) li.append(grip);
    const body = document.createElement("div");
    body.innerHTML = '<span class="t"></span><span class="a"></span>';
    body.querySelector(".t").textContent = t.title + (t.version ? ` (${t.version})` : "");
    fillArtists(body.querySelector(".a"), t);
    li.append(mkImg(cover(t)), body);
    if (time) { const s = document.createElement("span"); s.className = "qtime"; s.textContent = time; li.append(s); }
    if (remove) {
      const x = document.createElement("button");
      x.className = "qx"; x.title = "Убрать из очереди"; x.innerHTML = ICON.x;
      x.onclick = (e) => { e.stopPropagation(); remove(); };
      li.append(x);
    }
    if (more) {
      const mb = document.createElement("button");
      mb.className = "morebtn"; mb.title = "Ещё"; mb.innerHTML = ICON.more;
      mb.onclick = (e) => { e.stopPropagation(); openTrackMenu(t, mb); };
      li.append(mb);
    }
    if (onClick) li.onclick = onClick;
    syncGotRow(li);
    const gm = li.querySelector(".gotmark");       // значок «скачан» — перед временем и кнопками, а не в самом конце
    if (gm) li.insertBefore(gm, li.querySelector(".qtime, .qx, .morebtn"));
    return li;
  }

  const dayKey = (ms) => { const d = new Date(ms); return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate(); };
  function dayLabel(ms) {
    const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (dayKey(ms) === dayKey(+now)) return "Сегодня";
    if (dayKey(ms) === dayKey(+y)) return "Вчера";
    const d = new Date(ms);
    return d.toLocaleDateString("ru-RU", d.getFullYear() === now.getFullYear() ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" });
  }
  const hhmm = (ms) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  function render() {
    if (panel.hidden) return;
    if (dragging) { pending = true; return; }
    const keepScroll = el(".qbody").scrollTop;
    // сейчас играет
    const now = el(".qnow"); now.innerHTML = "";
    const cur = queue[current];
    if (cur) now.append(row(cur, { onClick: () => togglePlay() }));
    // далее
    const list = el(".qnext"); list.innerHTML = "";
    const total = upcomingCount();
    const idxs = upcoming(longNext ? NEXT_LONG : NEXT_SHORT);
    idxs.forEach((qi, pos) => {
      const t = queue[qi];
      if (!t) return;
      list.append(row(t, {
        onClick: () => play(qi),
        grip: gripFor(pos),
        remove: () => removeAt(qi),
      }));
    });
    el(".qsrc").textContent = srcLabel();
    el(".qnextempty").hidden = idxs.length > 0;
    el(".qnextempty").textContent = !cur ? "Ничего не играет."
      : wave.on ? "Моя волна подбирает следующие треки…"
      : effRepeat() === 1 ? "Дальше список начнётся сначала."
      : "Это последний трек в очереди.";
    const mb = el(".qmore");
    mb.hidden = total <= NEXT_SHORT;
    mb.textContent = longNext ? "Свернуть" : `Показать ещё (${Math.min(total, NEXT_LONG) - NEXT_SHORT})`;
    // история
    const box = el(".qhist"); box.innerHTML = "";
    let ul = null, lastDay = -1;
    hist.forEach((h, i) => {
      const k = dayKey(h.at);
      if (k !== lastDay) {
        lastDay = k;
        const d = document.createElement("div"); d.className = "qday"; d.textContent = dayLabel(h.at);
        ul = document.createElement("ul"); ul.className = "list qhlist";
        box.append(d, ul);
      }
      ul.append(row(h.t, { time: hhmm(h.at), onClick: () => playFromHistory(i) }));
    });
    el(".qhistempty").hidden = hist.length > 0;
    el(".qclear").hidden = !hist.length;
    el(".qbody").scrollTop = keepScroll;
  }
  let rafId = 0;
  function refresh() {
    if (panel.hidden || rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; render(); });
  }
  window.qRefresh = refresh;

  // Трек из истории: играет он, а дальше — то, что слушалось до него.
  function playFromHistory(i) {
    const list = hist.slice(i).map((h) => h.t);
    wave.on = false; queue = list; queue._own = true; playCtx = "other"; playAlbum = null;
    play(0);
  }

  el(".qmore").onclick = () => { longNext = !longNext; render(); };
  el(".qclose").onclick = () => setOpen(false);
  el(".qclear").onclick = async () => {
    const ok = await modal({ title: "Очистить историю?", text: "Список прослушанных треков будет удалён. Очередь не изменится.", ok: "Очистить", danger: true });
    if (!ok) return;
    hist.length = 0; saveHist(); render();
  };

  // ---------- перетаскивание в «Далее» ----------
  function gripFor(pos) {
    const g = document.createElement("span");
    g.className = "grip"; g.title = "Перетащи, чтобы изменить порядок"; g.innerHTML = ICON.grip;
    g.onclick = (e) => e.stopPropagation();
    g.onpointerdown = (e) => dragStart(e, g.parentElement, pos);
    return g;
  }
  function dragStart(e, li, from) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    closeTrackMenu();
    const rows = [...el(".qnext").children], scroller = el(".qbody");
    let slot = from, lastY = e.clientY, raf = 0, done = false;
    dragging = true;
    li.classList.add("dragging"); document.body.classList.add("pl-drag");
    const mark = () => {
      rows.forEach((r) => r.classList.remove("drop-before", "drop-after"));
      if (slot === from || slot === from + 1) return;
      if (slot < rows.length) rows[slot].classList.add("drop-before"); else rows[rows.length - 1].classList.add("drop-after");
    };
    const compute = () => {
      slot = rows.length;
      for (let k = 0; k < rows.length; k++) { const r = rows[k].getBoundingClientRect(); if (lastY < r.top + r.height / 2) { slot = k; break; } }
      mark();
    };
    const tick = () => {
      const r = scroller.getBoundingClientRect(), edge = 40;
      const dy = lastY < r.top + edge ? -10 : lastY > r.bottom - edge ? 10 : 0;
      if (dy) { scroller.scrollTop += dy; compute(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move = (ev) => { lastY = ev.clientY; compute(); };
    const finish = (apply) => {
      if (done) return; done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", key, true);
      rows.forEach((r) => r.classList.remove("drop-before", "drop-after"));
      li.classList.remove("dragging"); document.body.classList.remove("pl-drag");
      dragging = false;
      const to = slot > from ? slot - 1 : slot;
      if (apply && to !== from) moveUpcoming(from, to);
      else if (pending) render();
      pending = false;
    };
    const up = () => finish(true), cancel = () => finish(false);
    const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); finish(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", key, true);
  }

  // ---------- открыть / закрыть ----------
  // Панель занимает правую часть между верхними вкладками и нижним плеером — плеер остаётся под рукой.
  function place() {
    const m = document.querySelector(".main").getBoundingClientRect();
    const p = document.querySelector(".player").getBoundingClientRect();
    panel.style.top = Math.round(m.top) + "px";
    panel.style.bottom = Math.round(innerHeight - p.top + 12) + "px";
    panel.style.right = Math.round(innerWidth - m.right) + "px";
  }
  function setOpen(on) {
    if (on === !panel.hidden) return;
    panel.hidden = !on;
    document.querySelectorAll(".qtoggle").forEach((b) => b.classList.toggle("on", on));
    if (on) { longNext = false; place(); render(); el(".qbody").scrollTop = 0; }
  }
  window.qToggle = () => setOpen(panel.hidden);
  window.addEventListener("resize", () => { if (!panel.hidden) place(); });

  // кнопка в нижнем плеере — рядом с громкостью, видна на любой странице
  const pBtn = document.createElement("button");
  pBtn.id = "qBtn"; pBtn.className = "qtoggle"; pBtn.title = "Очередь и история прослушивания (Q)";
  pBtn.setAttribute("aria-label", "Очередь и история прослушивания"); pBtn.innerHTML = ICON.queue;
  pBtn.onclick = (e) => { e.stopPropagation(); window.qToggle(); };
  $("#volWrap").before(pBtn);

  // подписанная кнопка на странице Моей волны — под «Жанрами и настроениями», в том же стиле (.nav);
  // видна только на странице волны (.main.wavemode), выпадающий список жанров открывается поверх неё
  const wBtn = document.createElement("button");
  wBtn.id = "waveQBtn"; wBtn.className = "nav qwavebtn qtoggle"; wBtn.title = "Очередь и история прослушивания (Q)";
  wBtn.innerHTML = ICON.history + "<span>История прослушивания</span>";
  wBtn.onclick = (e) => { e.stopPropagation(); window.qToggle(); };
  $("#stWrap").after(wBtn);

  // щелчок мимо панели закрывает её; плеер, меню трека, окна и подсказки — не считаются
  document.addEventListener("pointerdown", (e) => {
    if (panel.hidden) return;
    const t = e.target;
    if (panel.contains(t) || tmenu.contains(t) || t.closest?.(".qtoggle, .player, .modal, .toast, .titlebar")) return;
    setOpen(false);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, [contenteditable]")) return;
    if (e.key === "Escape" && !panel.hidden && !document.querySelector(".modal")) setOpen(false);
    else if (e.code === "KeyQ" && !e.ctrlKey && !e.metaKey && !e.altKey && $("#full").hidden && $("#vizFull").hidden) window.qToggle();
  });

  // режимы плеера меняют порядок «Далее»
  $("#shuffleBtn").addEventListener("click", refresh);
  $("#repeatBtn").addEventListener("click", refresh);
})();
