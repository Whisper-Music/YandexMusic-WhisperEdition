// «Слушать вместе»: комнаты совместного прослушивания через сервер Whisper Archive (/api/rooms, Rust: whisper::wa_room).
//
// * Ведущий создаёт комнату и даёт друзьям код. Что у него играет (трек, позиция, пауза, скорость), уходит на сервер.
// * Гости ждут изменений (long-poll) и включают тот же трек у себя — каждый со своего аккаунта Яндекса,
//   звук никуда не передаётся. Позиция выравнивается по времени сервера; расхождение больше 1,5 с — перемотка.
// * Гость может отойти: поставить паузу или включить своё — тогда он перестаёт следовать за ведущим,
//   пока не нажмёт «Вернуться к ведущему». Перемотка и «вперёд/назад» у гостя отключены.
// * Гости предлагают треки (меню «⋯» → «Предложить в комнату»), ведущий включает их сразу, ставит следующими или убирает.
(() => {
  const $t = (s, el = document) => el.querySelector(s);
  // Каждое действие с комнатой — своя команда Rust (whisper.rs: wa_room_*); путь к API собирает Rust из кода комнаты.
  const ROOM_RE = /^\/api\/rooms(?:\/([A-Z0-9]{4,12})(?:\/(join|leave|state|suggest)|\/suggestions\/([A-Za-z0-9]{1,32})\/dismiss)?)?$/;
  function call(method, path, body, since) {
    const m = ROOM_RE.exec(path);
    if (!m) return Promise.reject(new Error("Недопустимый запрос к комнате"));
    const [, code, act, sid] = m;
    let p;
    if (!code) p = method === "POST" ? invoke("wa_room_create") : null;
    else if (sid) p = method === "POST" ? invoke("wa_room_dismiss", { code, id: sid }) : null;
    else if (!act) p = method === "GET" ? invoke("wa_room_get", { code, since: since ?? null }) : null;
    else if (method === "POST") {
      p = act === "state" ? invoke("wa_room_state", { code, state: body ?? {} })
        : act === "suggest" ? invoke("wa_room_suggest", { code, track: body ?? {} })
        : invoke(act === "join" ? "wa_room_join" : "wa_room_leave", { code });
    }
    return p ? Promise.resolve(p) : Promise.reject(new Error("Недопустимый запрос к комнате"));
  }
  const SYNC_TOL = 1500;          // мс расхождения с ведущим, после которых гость перематывается

  let room = null;                // последний снимок комнаты с сервера
  let code = "";
  let offset = 0;                 // серверное время − локальное, мс
  let pollGen = 0;
  let follow = true;              // гость следует за ведущим
  let syncing = 0;                // сколько действий над плеером сейчас делает сама синхронизация
  let mySpeed = null;             // скорость гостя до входа — вернём при выходе
  let hostLast = "", hostTimer = 0, hostSentAt = 0;
  let panel = null;

  const isHost = () => !!room?.isHost;
  const inRoom = () => !!room && !room.closed;
  const nowSrv = () => Date.now() + offset;

  async function req(method, path, body, since) {
    const r = await call(method, path, body, since);
    let data = null;
    try { data = r.body ? JSON.parse(r.body) : null; } catch {}
    if (r.status >= 200 && r.status < 300) return data;
    const e = new Error(data?.message || `Сервер ответил HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }

  // ---------- трек ↔ формат сервера ----------
  const toRoomTrack = (t) => ({
    id: String(t.id),
    albumId: t.albums?.[0]?.id != null ? String(t.albums[0].id) : null,
    title: String(t.title || "Без названия").slice(0, 300),
    version: t.version ? String(t.version).slice(0, 200) : null,
    artists: (t.artists || []).slice(0, 10).filter((a) => a?.name).map((a) => ({ id: a.id != null ? String(a.id) : null, name: String(a.name).slice(0, 200) })),
    coverUri: t.coverUri ? String(t.coverUri).slice(0, 300) : null,
    durationMs: Math.max(0, Math.round(t.durationMs || 0)),
  });
  const fromRoomTrack = (r) => ({
    id: r.id, title: r.title, version: r.version || undefined, coverUri: r.coverUri || undefined, durationMs: r.durationMs,
    artists: (r.artists || []).map((a) => ({ id: a.id || undefined, name: a.name })),
    albums: r.albumId ? [{ id: r.albumId }] : [],
  });
  const curTrack = () => (typeof current === "number" && current >= 0 ? queue?.[current] : null);

  // ---------- ведущий: что играет → на сервер ----------
  function hostState() {
    const t = curTrack();
    if (!t || !audio) return null;
    return {
      track: toRoomTrack(t),
      positionMs: Math.max(0, (needLoad ? resumePos : audio.currentTime || 0) * 1000),
      playing: !audio.paused,
      rate: audio.playbackRate > 0 ? audio.playbackRate : 1,
    };
  }
  function hostPush(force) {
    if (!inRoom() || !isHost()) return;
    const s = hostState();
    if (!s) return;
    const key = JSON.stringify({ ...s, positionMs: 0 });
    if (!force && key === hostLast) return;
    hostLast = key;
    // не чаще ~3 раз в секунду: подряд идущие изменения (перемотка ползунком) сливаются в одно
    clearTimeout(hostTimer);
    const wait = Math.max(0, 350 - (Date.now() - hostSentAt));
    hostTimer = setTimeout(() => {
      hostSentAt = Date.now();
      const st = hostState();
      if (st) req("POST", `/api/rooms/${code}/state`, st).catch((e) => { if (e.status === 404) gone("Комната закрыта"); });
    }, wait);
  }
  // раз в 10 с — позиция заново (на случай расхождения часов и как знак «ведущий на месте»)
  setInterval(() => { if (inRoom() && isHost()) hostPush(true); }, 10000);

  // ---------- гость: включить то же, что у ведущего ----------
  function expectedMs(pb) {
    return pb.positionMs + (pb.playing ? (nowSrv() - pb.at) * (pb.rate || 1) : 0);
  }
  async function guestApply() {
    if (!inRoom() || isHost() || !follow) return;
    const pb = room.playback;
    if (!pb) return;
    syncing++;
    try {
      if (Math.abs((audio?.playbackRate || 1) - (pb.rate || 1)) > 0.001 && typeof setSpeed === "function") setSpeed(pb.rate || 1);
      const t = curTrack();
      if (!t || String(t.id) !== String(pb.track.id)) {
        wave.on = false;
        queue = [fromRoomTrack(pb.track)]; playCtx = "room"; playAlbum = null;
        await play(0, Math.max(0, expectedMs(pb) / 1000));
        if (!pb.playing && audio && !audio.paused) audio.pause();
        return;
      }
      if (needLoad) { await play(current, Math.max(0, expectedMs(pb) / 1000)); return; }
      if (!audio) return;
      const want = expectedMs(pb);
      if (isFinite(audio.duration) && Math.abs(audio.currentTime * 1000 - want) > SYNC_TOL) {
        audio.currentTime = Math.min(Math.max(0, want / 1000), Math.max(0, audio.duration - 0.25));
      }
      if (pb.playing && audio.paused) await audio.play().catch(() => {});
      else if (!pb.playing && !audio.paused) audio.pause();
    } finally {
      setTimeout(() => { syncing = Math.max(0, syncing - 1); }, 400);   // события pause/play от синхронизации ещё долетают
    }
  }
  setInterval(() => { if (inRoom() && !isHost() && follow && !syncing) guestApply(); }, 3000);

  // гость сам поставил паузу или включил другой трек — перестаём тянуть его за ведущим
  function detach(why) {
    if (!inRoom() || isHost() || !follow || syncing) return;
    follow = false;
    showToast(why + " — нажми «Вернуться к ведущему», чтобы снова слушать вместе", 4500);
    paint();
  }
  function rejoin() { follow = true; paint(); guestApply(); }

  // ---------- связь с сервером ----------
  async function pollLoop(gen) {
    let fails = 0;
    while (gen === pollGen && room && !room.closed) {
      try {
        const snap = await req("GET", `/api/rooms/${code}`, null, room.version);
        if (gen !== pollGen) return;
        fails = 0;
        // сервер ставит serverNow в момент ответа (а не начала ожидания) — сравниваем с моментом получения
        offset = snap.serverNow - Date.now();
        accept(snap);
      } catch (e) {
        if (gen !== pollGen) return;
        if (e.status === 404 || e.status === 403) return gone(e.status === 404 ? "Комната закрыта" : e.message);
        if (++fails >= 2) setStatus("Нет связи с сервером, переподключаюсь…");
        await new Promise((r) => setTimeout(r, Math.min(15000, 1500 * fails)));
      }
    }
  }
  function accept(snap) {
    const prevPb = JSON.stringify(room?.playback || null);
    room = snap; code = snap.code;
    if (snap.closed) return gone("Ведущий закрыл комнату");
    setStatus("");
    if (!isHost() && JSON.stringify(snap.playback || null) !== prevPb) guestApply();
    paint();
  }
  function start(snap) {
    room = snap; code = snap.code; follow = true; hostLast = "";
    offset = (snap.serverNow || Date.now()) - Date.now();
    if (!isHost()) mySpeed = typeof speed === "number" ? speed : null;
    document.body.classList.add("in-room");
    document.body.classList.toggle("room-guest", !isHost());
    const gen = ++pollGen;
    pollLoop(gen);
    if (isHost()) hostPush(true); else guestApply();
    paint();
  }
  function gone(msg) {
    pollGen++;
    const wasGuest = room && !room.isHost;
    room = null; code = ""; follow = true;
    document.body.classList.remove("in-room", "room-guest");
    if (wasGuest && mySpeed != null && typeof setSpeed === "function") setSpeed(mySpeed);
    mySpeed = null;
    if (msg) showToast(msg, 3500);
    paint();
  }

  async function create() {
    try { start(await req("POST", "/api/rooms")); showToast(`Комната ${code} создана — отправь код друзьям`, 4000, { kind: "ok" }); }
    catch (e) { setStatus(e.message); }
  }
  async function join(c) {
    const norm = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (norm.length < 4) return setStatus("Введи код комнаты");
    try { start(await req("POST", `/api/rooms/${norm}/join`)); showToast(`Ты в комнате ${norm}`, 3000, { kind: "ok" }); }
    catch (e) { setStatus(e.message); }
  }
  async function leave() {
    const c = code;
    gone(isHost() ? "Комната закрыта" : "Ты вышел из комнаты");
    req("POST", `/api/rooms/${c}/leave`).catch(() => {});
  }
  async function suggest(t) {
    if (!inRoom()) return;
    try { await req("POST", `/api/rooms/${code}/suggest`, toRoomTrack(t)); showToast("Трек предложен ведущему", 2500, { kind: "ok" }); }
    catch (e) { showToast(e.message, 3500); }
  }
  async function dismiss(id) {
    try { await req("POST", `/api/rooms/${code}/suggestions/${id}/dismiss`); } catch {}
  }

  // ---------- кнопки плеера у гостя ----------
  // «Вперёд», «назад», перемотка и режимы у гостя не работают: музыкой управляет ведущий
  const guestBlocked = () => inRoom() && !isHost();
  document.addEventListener("click", (e) => {
    if (!guestBlocked()) return;
    if (e.target.closest?.("#next, #prev, #fNext, #fPrev, #shuffleBtn, #repeatBtn")) {
      e.stopImmediatePropagation(); e.preventDefault();
      showToast("Музыкой в комнате управляет ведущий — предложи трек через «⋯»", 3000);
    }
  }, true);
  for (const id of ["#seek", "#fSeek"]) {
    const el = $t(id);
    el?.addEventListener("input", (e) => { if (guestBlocked() && follow) { e.stopImmediatePropagation(); guestApply(); } }, true);
  }
  window.__TAURI__.event?.listen("tray-ctl", (e) => {
    if (guestBlocked() && ["seek_fwd", "seek_back"].includes(e.payload)) setTimeout(guestApply, 50);
  });

  // ---------- события плеера ----------
  const prevPush = window.miniPush;
  window.miniPush = (force) => {
    prevPush?.(force);
    if (!inRoom()) return;
    if (isHost()) return hostPush(force);
    // гость: сам включил другой трек или поставил паузу
    const t = curTrack(), pb = room.playback;
    if (!follow || syncing || !pb) return;
    if (t && String(t.id) !== String(pb.track.id)) detach("Ты включил свой трек");
    else if (audio && audio.paused && pb.playing && !needLoad) {
      // трек просто доиграл раньше, чем пришёл следующий от ведущего, — это не пауза
      const nearEnd = audio.ended || (isFinite(audio.duration) && audio.duration - audio.currentTime < 2);
      if (!nearEnd) detach("Пауза у тебя");
    }
  };

  // пункт меню трека «⋯»: гость — предложить, ведущий — ничего (он и так управляет)
  window.roomTrackMenu = (t) => {
    if (!inRoom() || isHost()) return;
    menuItem(ICON.playNext || "", "Предложить в комнату", () => suggest(t));
  };

  // ---------- окно «Слушать вместе» ----------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function setStatus(t) { const s = panel && $t(".rmstatus", panel.box); if (s) s.textContent = t || ""; }

  function open() {
    if (panel) return close();
    const wrap = el("div", "login modal");
    const box = el("div", "panel login-box modalbox rmbox");
    wrap.append(box); document.body.append(wrap);
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
    panel = { wrap, box, onKey };
    paint();
  }
  function close() {
    if (!panel) return;
    document.removeEventListener("keydown", panel.onKey, true);
    panel.wrap.remove(); panel = null;
  }

  async function paintSetup(box) {
    box.append(el("h2", "", "Слушать вместе"));
    box.append(el("p", "rmlead", "Одна и та же музыка у всех в комнате в один и тот же момент. Каждый слушает со своего аккаунта Яндекса, ведущий управляет, остальные могут предлагать треки."));
    let hasKey = false;
    try { hasKey = await invoke("wa_token_exists"); } catch {}
    if (!panel || panel.box !== box) return;
    if (!hasKey) {
      box.append(el("p", "rmwarn", "Комнаты работают через Whisper Archive. Войди в архив: Настройки → «Для разработчиков» → Whisper Archive — у всех участников."));
    }
    const mk = el("button", "nav active rmcreate", "Создать комнату");
    mk.type = "button"; mk.disabled = !hasKey; mk.onclick = create;
    const row = el("form", "rmjoin");
    const inp = el("input", "field rmcode"); inp.placeholder = "Код комнаты"; inp.maxLength = 12; inp.autocomplete = "off"; inp.spellcheck = false;
    inp.oninput = () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };
    const go = el("button", "nav", "Войти"); go.type = "submit"; go.disabled = !hasKey;
    row.onsubmit = (e) => { e.preventDefault(); join(inp.value); };
    row.append(inp, go);
    box.append(mk, el("div", "rmor", "или"), row, el("p", "status rmstatus"));
    const done = el("button", "nav", "Закрыть"); done.type = "button"; done.onclick = close;
    const r = el("div", "row"); r.append(done); box.append(r);
    if (hasKey) inp.focus();
  }

  function trackLine(t) {
    const d = el("div", "rmtrack");
    const img = el("img"); img.alt = ""; const src = cover(fromRoomTrack(t), "100x100"); if (src) img.src = src;
    const tx = el("div", "rmtx");
    tx.append(el("b", "", t.title), el("span", "", (t.artists || []).map((a) => a.name).join(", ")));
    d.append(img, tx);
    return d;
  }

  function paintRoom(box) {
    const h = el("div", "rmhead");
    h.append(el("h2", "", "Слушать вместе"), el("span", "rmrole", isHost() ? "ты ведущий" : "ты гость"));
    box.append(h);
    // код
    const c = el("div", "rmcodebox");
    const big = el("b", "rmbig", code);
    const cp = el("button", "nav", "Копировать код"); cp.type = "button";
    cp.onclick = async () => { try { await navigator.clipboard.writeText(code); showToast("Код скопирован", 2000, { kind: "ok" }); } catch {} };
    c.append(el("span", "", "Код комнаты"), big, cp);
    box.append(c);
    // что играет
    const pb = room.playback;
    if (pb) {
      const np = el("div", "rmnow");
      np.append(el("small", "", pb.playing ? "Сейчас играет" : "На паузе"), trackLine(pb.track));
      box.append(np);
    }
    if (!isHost()) {
      const st = el("div", "rmsync" + (follow ? " on" : ""));
      st.append(el("span", "", follow ? "Синхронно с ведущим" : "Ты слушаешь своё"));
      if (!follow) { const b = el("button", "nav active", "Вернуться к ведущему"); b.type = "button"; b.onclick = rejoin; st.append(b); }
      box.append(st);
    }
    // участники
    const ms = el("div", "rmmembers");
    ms.append(el("small", "", `Слушают: ${room.members.length}`));
    const ul = el("div", "rmchips");
    for (const m of room.members) ul.append(el("span", "rmchip" + (m.isHost ? " host" : "") + (m.isMe ? " me" : ""), (m.isHost ? "★ " : "") + m.nickname + (m.isMe ? " (ты)" : "")));
    ms.append(ul); box.append(ms);
    // предложения
    const sg = room.suggestions || [];
    const sb = el("div", "rmsugs");
    sb.append(el("small", "", isHost() ? (sg.length ? "Предлагают" : "Предложений пока нет — гости предлагают треки через «⋯»") : (sg.length ? "Твои предложения" : "Предложить трек: «⋯» у трека → «Предложить в комнату»")));
    for (const s of sg) {
      const row = el("div", "rmsug");
      row.append(trackLine(s.track));
      if (isHost()) row.append(el("span", "rmfrom", s.from));
      const acts = el("div", "rmacts");
      const btn = (label, title, fn) => { const b = el("button", "rmact", label); b.type = "button"; b.title = title; b.onclick = fn; acts.append(b); };
      if (isHost()) {
        btn("▶", "Включить сейчас", () => { wave.on = false; queue = [fromRoomTrack(s.track)]; playCtx = "room"; playAlbum = null; play(0); dismiss(s.id); });
        if (window.playNext) btn("＋", "Играть следующим", () => { window.playNext(fromRoomTrack(s.track)); dismiss(s.id); showToast("Поставлен следующим", 2000, { kind: "ok" }); });
      }
      btn("✕", isHost() ? "Убрать" : "Отозвать", () => dismiss(s.id));
      row.append(acts); sb.append(row);
    }
    box.append(sb, el("p", "status rmstatus"));
    const r = el("div", "row");
    const lv = el("button", "nav danger", isHost() ? "Закрыть комнату" : "Выйти"); lv.type = "button"; lv.onclick = () => { leave(); };
    const done = el("button", "nav active", "Готово"); done.type = "button"; done.onclick = close;
    r.append(lv, done); box.append(r);
  }

  function paint() {
    // кнопка в плеере: подсвечена в комнате, на ней — сколько слушают
    const b = $t("#togetherBtn");
    if (b) {
      b.classList.toggle("on", inRoom());
      b.classList.toggle("detached", inRoom() && !isHost() && !follow);
      b.dataset.n = inRoom() ? String(room.members.length) : "";
      b.title = inRoom() ? `Слушать вместе · комната ${code} · ${room.members.length} чел.` : "Слушать вместе";
    }
    if (!panel) return;
    const keepStatus = $t(".rmstatus", panel.box)?.textContent || "";
    panel.box.textContent = "";
    if (inRoom()) paintRoom(panel.box); else paintSetup(panel.box);
    if (keepStatus) setStatus(keepStatus);
  }

  const btn = $t("#togetherBtn");
  if (btn) {
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.5 5.3a3 3 0 0 1 0 5.4M18 13.6c1.6.7 2.7 2.4 3 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    btn.onclick = open;
  }
  // окно закрывается — комнату не бросаем: ведущий продолжает раздавать, гость — слушать
  window.addEventListener("beforeunload", () => { if (inRoom()) call("POST", `/api/rooms/${code}/leave`).catch(() => {}); });
  window.roomInfo = () => (inRoom() ? { code, host: isHost(), follow } : null);
  // для консоли (cli.js)
  window.roomCli = { create, join, leave, suggest, info: () => (inRoom() ? room : null) };
})();
