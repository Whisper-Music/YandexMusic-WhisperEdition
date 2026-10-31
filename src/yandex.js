"use strict";
// Яндекс Музыка в ядре Whisper (core/whisper-core.js, docs/CORE.md):
// * какие элементы этого приложения какую роль играют — для общих тем (секция «@@ css whisper-core»);
// * провайдер «yandex»: данные Яндекса в общих сущностях ядра и список возможностей;
// * привязка плеера и очереди main.js к Whisper.player / Whisper.queue.
// Подключается сразу после main.js и ДО theme.js: темы при запуске уже должны знать роли.
// Пока main.js сам ходит в API Яндекса напрямую (ym()) — провайдер нужен модулям и другим приложениям
// как пример контракта; переводить на него main.js можно по кусочку, ничего не ломая.
(() => {
  const W = window.Whisper;
  if (!W) { console.error("yandex.js: нет ядра Whisper — подключи core/whisper-core.js раньше"); return; }
  W.setApp({ id: "whisper-music", name: "Whisper Yandex", version: "", storage: "ym_" });

  // ---------- роли интерфейса ----------
  // Словарь ролей — в ядре (Whisper.ui.vocabulary()), здесь — что им соответствует в этой разметке.
  // Разновидность через «:» (search:global), часть через «.» (player.volume). Новый элемент интерфейса,
  // похожий на существующий (ещё один поиск, ещё одна кнопка плеера), — добавь его селектор в нужную роль.
  const NAV_BTN = ".main .nav:not(.danger), .modalbox .nav:not(.danger), .login-box .nav:not(.danger)";
  W.ui.define({
    "titlebar": ".titlebar",
    "titlebar.button": ".tbctl button",
    "tabs": ".tabs",
    "tab": ".tabs .tab:not(.active)",
    "tab:active": ".tabs .tab.active",
    "sidebar": ".side",
    "nav": ".side .nav:not(.active)",
    "nav:active": ".side .nav.active",
    "search:global": "#search",
    "search:library": "#lkFindIn",
    "search:settings": "#fontFind, .tlfind",
    "main": ".main",
    "page.title": "#title",
    "page.subtitle": "#sub",
    "page.cover": "#headImg",
    "button": NAV_BTN.replaceAll(".nav:", ".nav:not(.active):"),
    "button:active": ".main .nav.active:not(.danger), .modalbox .nav.active:not(.danger), .login-box .nav.active:not(.danger)",
    "button:danger": ".nav.danger",
    "chip": ".chip:not(.active)",
    "chip:active": ".chip.active",
    "tracklist": ".list",
    "track": ".list li[data-id]:not(.playing)",
    "track:playing": ".list li[data-id].playing",
    "track.cover": ".list li[data-id] > img",
    "track.title": ".list li[data-id] .t",
    "track.artist": ".list li[data-id] .a",
    "track.like": ".list .likebtn",
    "track.more": ".list .morebtn",
    "card": ".settings > .card, .stats .card",
    "tile": ".simcard, .lastAlbum, .stperson, .stalbum",
    "player": ".player",
    "player.cover": "#cover",
    "player.info": ".player .meta",
    "player.title": "#pTitle",
    "player.artist": "#pArtist",
    "player.like": "#likeBtn",
    "player.dislike": "#disBtn",
    "player.controls": ".player .ctrls",
    "player.play": "#play",
    "player.prev": "#prev",
    "player.next": "#next",
    "player.mode": ".player .modebtn:not(.on)",
    "player.mode:on": ".player .modebtn.on",
    "player.seek": "#seek",
    "player.time": ".player .time",
    "player.actions": ".player .pright",
    "player.extra": "#togetherBtn, #sleepBtn",
    "player.volume": "#volWrap",
    "player.volume.button": "#volBtn",
    "player.volume.slider": "#vol",
    "player.more": "#pMore",
    "radio": ".wavebtn",
    "radio.stations": "#stWrap",
    "visualizer": ".stage",
    "visualizer:fullscreen": "#vizFull",
    "menu": ".tmenu",
    "menu.item": ".tmenu .mi",
    "toast": ".toast",
    "dialog": ".modalbox, .login-box",
    "dialog.backdrop": ".modal",
    "queue": ".qpanel",
    "fullplayer": "#full",
    "fullplayer.seek": "#fSeek",
    "fullplayer.prev": "#fPrev",
    "fullplayer.next": "#fNext",
    "lyrics": "#fLyrics",
    "lyrics.line": "#fLyrics .ln:not(.on)",
    "lyrics.line:active": "#fLyrics .ln.on",
  });
  // Почему у «обычных» ролей стоит :not(.active)/:not(.on): роль совпадает со всеми своими разновидностями,
  // и [data-w="tab"] и так включает tab:active. А вот правило только для обычной вкладки ([data-w="tab"] без
  // разновидности поверх) не должно перекрашивать открытую — это и разделяют селекторы выше.

  // ---------- провайдер ----------
  const P = "yandex";
  const tpl = (uri) => (uri ? "https://" + String(uri).replace("%%", "{size}") : "");
  const trackRef = (t) => { const id = String(t.id), al = t.raw?.albums?.[0]?.id ?? t.album?.id; return al ? `${id}:${al}` : id; };
  const toTrack = (r) => ({
    provider: P, id: r.id, title: r.title, version: r.version,
    artists: (r.artists || []).map((a) => ({ id: a.id, name: a.name })),
    album: r.albums?.[0] ? { id: r.albums[0].id, title: r.albums[0].title } : null,
    cover: tpl(r.coverUri || r.albums?.[0]?.coverUri), durationMs: r.durationMs,
    explicit: r.contentWarning === "explicit" || r.explicit === true, available: r.available !== false, raw: r,
  });
  const toArtist = (r) => ({ provider: P, id: r.id, name: r.name, cover: tpl(r.cover?.uri || r.ogImage), description: r.description?.text, raw: r });
  const toAlbum = (r) => ({
    provider: P, id: r.id, title: r.title, artists: (r.artists || []).map((a) => ({ id: a.id, name: a.name })),
    cover: tpl(r.coverUri), year: r.year, trackCount: r.trackCount, raw: r,
    tracks: Array.isArray(r.volumes) ? r.volumes.flat().map((t) => W.to("track", t.coverUri ? t : { ...t, coverUri: r.coverUri })) : null,
  });
  const toPlaylist = (r) => ({
    provider: P, id: r.kind, title: r.title, owner: r.owner ? { id: r.owner.uid, name: r.owner.name || r.owner.login } : null,
    cover: tpl((r.cover?.type === "pic" && r.cover.uri) || r.cover?.itemsUri?.[0] || r.cover?.uri || r.ogImage), trackCount: r.trackCount,
    editable: true, raw: r,
    tracks: Array.isArray(r.tracks) ? r.tracks.map((x) => x.track).filter(Boolean).map((t) => W.to("track", t)) : null,
  });
  const ents = (kind, list) => (Array.isArray(list) ? list.map((x) => W.to(kind, x)) : []);
  const form = (t) => ({ form: { "track-ids": trackRef(t) } });

  W.registerProvider({
    id: P, name: "Яндекс Музыка",
    caps: {
      playback: "local", queue: true, like: true, dislike: true, library: false,
      playlists: { read: true, create: true, edit: true, reorder: true, delete: true },
      radio: true, radioSeeds: ["user", "track", "artist", "album", "genre", "mood", "activity", "era", "language"],
      lyrics: "synced", search: ["track", "artist", "album", "playlist"], download: true, quality: ["low", "high"],
      social: ["listen-together"],          // «Слушать вместе» — через Whisper Archive (together.js)
    },
    toTrack, toArtist, toAlbum, toPlaylist,
    store: (raw) => trackMin(raw),       // что сохранять о треке на диск (история) — без лишнего
    // Whisper.cover(x, 200): без сети — пусто (интерфейс покажет заглушку), адрес — только с доменов Яндекса (safeUrl, CSP)
    coverUrl: (x, px) => { const c = x?.cover || ""; return !c || offline ? "" : safeUrl(c.replaceAll("{size}", `${px}x${px}`)); },

    // данные (функции main.js — ym(), directLink(), fetchLyrics() — вызываются в момент запроса)
    async search(text, type = "track", page = 0) {
      const r = await ym("search", { query: { text, type, page } });
      const best = r?.best?.result ? { type: r.best.type, item: W.to(r.best.type === "artist" ? "artist" : r.best.type === "album" ? "album" : "track", r.best.result) } : null;
      return { tracks: ents("track", r?.tracks?.results), artists: ents("artist", r?.artists?.results), albums: ents("album", r?.albums?.results), playlists: ents("playlist", r?.playlists?.results), best };
    },
    async tracks(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 100) out.push(...ents("track", await ym("tracks", { form: { "track-ids": ids.slice(i, i + 100).join(",") } })));
      return out;
    },
    album: async (id) => W.to("album", await ym("album", { id })),
    artist: async (id) => { const r = await ym("artist_brief", { id }); return { ...W.to("artist", r?.artist || {}), similar: ents("artist", r?.similarArtists) }; },
    artistTracks: async (id, page = 0) => { const r = await ym("artist_tracks", { id, query: { page, "page-size": 50 } }); return { tracks: ents("track", r?.tracks), total: r?.pager?.total ?? null }; },
    artistAlbums: async (id, page = 0) => { const r = await ym("artist_albums", { id, query: { page, "page-size": 100, "sort-by": "year" } }); return { albums: ents("album", r?.albums), total: r?.pager?.total ?? null }; },
    likes: async () => ((await ym("likes"))?.library?.tracks || []).map((t) => String(t.id)),
    like: (t, on = true) => ym(on ? "like_add" : "like_remove", form(t)),
    dislike: (t, on = true) => ym(on ? "dislike_add" : "dislike_remove", form(t)),
    playlists: async () => ents("playlist", await ym("playlists")),
    playlist: async (id) => W.to("playlist", await ym("playlist", { id })),
    radio: {
      async start(seed) {
        const r = await ym("rotor_new", { json: { seeds: [seed], includeTracksInResponse: true } });
        return { session: r.radioSessionId, batch: r.batchId, tracks: ents("track", (r.sequence || []).map((s) => s.track).filter(Boolean)) };
      },
      async more(session, last) {
        const r = await ym("rotor_tracks", { id: session, json: { queue: [String(last?.id ?? last)] } });
        return { batch: r.batchId, tracks: ents("track", (r.sequence || []).map((s) => s.track).filter(Boolean)) };
      },
    },
    async lyrics(t) {
      const r = await fetchLyrics(String(t.id));
      return r.type === "lrc" ? { type: "synced", lines: r.lines } : r.type === "text" ? { type: "plain", text: r.text } : { type: "none" };
    },
    stream: async (t) => ({ kind: "url", url: await directLink(String(t.id)), mime: "audio/mpeg" }),
    // «Сохранить в архив» (core/archive.js): mp3 и обложку Rust скачивает с Яндекса сам по номеру трека (whisper_yandex.rs)
    archiveSave: (t, args) => invoke("wa_save_track", { trackId: String(t.id), ...args }),
    // «Слушать вместе» (core/together.js): трек в формате сервера комнат и обратно (сервер хранит поля Яндекса)
    toRoom: (t) => { const r = t.raw || {}; return {
      id: String(t.id),
      albumId: r.albums?.[0]?.id != null ? String(r.albums[0].id) : null,
      title: String(t.title || "Без названия").slice(0, 300),
      version: t.version ? String(t.version).slice(0, 200) : null,
      artists: (r.artists || []).slice(0, 10).filter((a) => a?.name).map((a) => ({ id: a.id != null ? String(a.id) : null, name: String(a.name).slice(0, 200) })),
      coverUri: r.coverUri ? String(r.coverUri).slice(0, 300) : null,
      durationMs: Math.max(0, Math.round(t.durationMs || 0)),
    }; },
    fromRoom: (x) => ({
      id: x.id, title: x.title, version: x.version || undefined, coverUri: x.coverUri || undefined, durationMs: x.durationMs,
      artists: (x.artists || []).map((a) => ({ id: a.id || undefined, name: a.name })),
      albums: x.albumId ? [{ id: x.albumId }] : [],
    }),
    accountLabel: "аккаунта Яндекса",       // «каждый слушает со своего аккаунта Яндекса»
  });

  // ---------- плеер и очередь main.js ----------
  // Только обёртки над тем, что уже есть: кнопки нажимаются так же, как мышью, — поэтому сохраняется вся логика
  // main.js (волна, повтор, перемешивание, «Слушать вместе», сторож воспроизведения).
  const $y = (s) => document.querySelector(s);
  const ready = () => !!audio && !needLoad;
  W.player.bind({
    position: () => (needLoad ? resumePos : audio?.currentTime || 0),
    duration: () => (audio && isFinite(audio.duration) ? audio.duration : 0),
    context: () => (wave.on ? { type: "radio", id: wave.seed, title: wave.name || wave.album?.title || "Моя волна" }
      : playAlbum ? { type: "album", id: String(playAlbum.id), title: playAlbum.title || "" }
      : { type: playCtx || "other", id: "", title: "" }),
    play: () => { if (needLoad || !audio) return togglePlay(); if (audio.paused) return audio.play().catch(() => {}); },
    pause: () => { if (ready() && !audio.paused) audio.pause(); },
    setRate: (r) => setSpeed(r),
    playTrack: (t, { at, hold, context }) => { wave.on = false; queue = [t.raw || t]; playCtx = context || "other"; playAlbum = null; return play(0, at, false, hold); },
    reload: (at, hold) => play(current, at, false, hold),
    // loadAt / loadPos — main.js: момент начала загрузки трека и позиция, с которой он стартует
    media: () => {
      const loading = !needLoad && typeof loadAt === "number" && loadAt > 0;
      return {
        paused: !audio || audio.paused, ended: !!audio?.ended,
        duration: audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0,
        pending: !!needLoad, loading, startAt: needLoad ? resumePos : loading ? (typeof loadPos === "number" ? loadPos : 0) : null,
        // сам элемент плеера: Discord по ним понимает, идёт ли звук на самом деле (не завис ли на загрузке)
        has: !!audio, time: audio?.currentTime || 0, rate: audio?.playbackRate > 0 ? audio.playbackRate : 1,
        buffering: !!audio && audio.readyState < 3, error: !!audio?.error,
      };
    },
    toggle: () => togglePlay(),
    next: () => $y("#next").click(),
    prev: () => $y("#prev").click(),
    // длина ещё неизвестна (трек только что загружен без звука) — ставим как есть, браузер дотянет сам
    seek: (s) => { if (!ready()) return; audio.currentTime = isFinite(audio.duration) ? Math.min(s, Math.max(0, audio.duration - 0.25)) : s; },
    setVolume: (v) => setVol(v),
    like: (t) => toggleLike(t?.raw || queue[current]),
    dislike: (t) => toggleDislike(t?.raw || queue[current]),
  });
  // ---------- очередь ----------
  // Порядок «что дальше» — свой у этого приложения (main.js: queue, current, order/ordPos при перемешивании, волна),
  // поэтому операции с очередью живут здесь, а общая панель очереди (core/queue.js) только спрашивает и просит.
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
    W.player.report({ queue: true });
  }
  function removeAt(idx) {
    if (idx === current || idx < 0 || idx >= queue.length) return null;
    own();
    const [t] = queue.splice(idx, 1);
    if (idx < current) current--;
    if (orderFor === queue) {
      const p = order.indexOf(idx);
      if (p >= 0) { order.splice(p, 1); if (p < ordPos) ordPos--; }
      order = order.map((x) => (x > idx ? x - 1 : x));
    }
    afterEdit();
    return t;
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
  // меню «⋯» (main.js), консоль (cli.js) и «Слушать вместе» (together.js) зовут это с треком Яндекса — как раньше
  window.playNext = insertNext;
  function label() {
    if (wave.on) return wave.album ? `волна по «${wave.album.title}»` : wave.name ? `волна «${wave.name}»` : "Моя волна";
    if (shuffled()) return "случайный порядок";
    return { likes: "из лайков", album: "из альбома", playlist: "из плейлиста" }[playCtx] || "";
  }
  W.queue.bind({
    list: () => queue,
    index: () => current,
    upcoming: (max) => upcoming(max).map((i) => ({ index: i, track: queue[i] })).filter((x) => x.track),
    upcomingCount,
    label,
    playAt: (i) => { if (Number.isInteger(i) && i >= 0 && i < queue.length) play(i); },
    playNext: (t, o) => insertNext(t.raw || t, !!o?.quiet),
    add: (t) => { if (!queue.length) return insertNext(t.raw || t, true); own(); queue.push(t.raw || t); afterEdit(); },
    remove: (i) => removeAt(i),
    move: (from, to) => moveUpcoming(from, to),
    // свой список (из истории, из модуля): дальше играет он, а не открытая страница
    play: (tracks, start = 0) => {
      const raws = tracks.map((t) => t.raw || t).filter(Boolean);
      if (!raws.length) return;
      raws._own = true;
      wave.on = false; queue = raws; playCtx = "other"; playAlbum = null; play(Math.max(0, Math.min(start, raws.length - 1)));
    },
  });

  // ---------- набор интерфейса для общих модулей (core/queue.js …) ----------
  W.ui.provide({
    toast: (text, ms, o) => showToast(text, ms, o),
    confirm: (o) => modal(o),
    trackMenu: (t, btn) => openTrackMenu(t.raw || t, btn),
    closeMenu: () => closeTrackMenu(),
    artists: (el, t) => fillArtists(el, t.raw || t),        // исполнители — ссылки на страницы артистов
    image: (src, cls) => mkImg(src, cls),                   // ленивая загрузка и заглушка «W»
    // значок «скачан» — перед временем и кнопками строки, а не в самом конце
    decorateRow: (li, t, before) => { syncGotRow(li); const gm = li.querySelector(".gotmark"); if (gm && before) li.insertBefore(gm, before); },
    icon: (name) => ICON[name] || "",
    // виджет OBS (core/obs.js): цвета стиля — при динамическом фоне из обложки (getComputedStyle не годится:
    // --accent зарегистрирован как <color> и читается как rgb(), а виджету нужен #rrggbb); оформление — секции
    // whisper-obs своего стиля (theme.js → wmtObs); заливка ползунков рисуется main.js (fill)
    accentColors: () => { const p = cfg.dyn === true && dynPal ? dynPal : sty(); return { accent: p.accent, accent2: p.accent2 }; },
    obsTheme: () => ({ key: cfg.style, ...(window.wmtObs?.(cfg.style) || {}) }),
    rangeFill: (el) => fill(el),
    secretSaved: () => window.warnPlainSecrets?.(),         // main.js: предупредить, если ключ лёг в незащищённое хранилище
    // карточка общего модуля в настройках; «integrations» — вкладка «Интеграции» (first — первой, в левый столбец:
    // Whisper Archive; Discord и OBS — правый, Discord с colbreak — с него начинается правый столбец)
    settingsCard: (card, { section, first, colbreak } = {}) => {
      const page = document.getElementById("settingsPage");
      if (!page) return false;
      card.classList.add("card");
      if (colbreak) card.classList.add("colbreak");
      card.dataset.tab = { integrations: "int", playback: "play", sound: "out", look: "look", interface: "ui", app: "app" }[section] || "int";
      const firstOf = page.querySelector(`:scope > .card[data-tab="${card.dataset.tab}"]`);
      if (first && firstOf) firstOf.before(card); else page.append(card);
      return true;
    },
    // меню «⋯» трека (main.js) для пунктов общих модулей (Whisper.ui.trackMenu): то же, чем пользуется само меню
    menu: (raw, ctx) => ({
      item: (icon, text, fn, o) => menuItem(icon, text, fn, o),
      note: (text, to) => menuNote(text, to),
      head: (text) => menuHead(text, () => trackMenuMain(raw, ctx)),      // «←» — обратно в главное меню трека
      scroll: () => { const b = document.createElement("div"); b.className = "mscroll"; tmenu.append(b); return b; },
      place: () => placeMenu(),
      reset: () => menuReset(),
      alive: (seq) => menuAlive(seq),
      anchor: () => tmenuBtn,
      reopen: (anchor, build) => openMenu(anchor, build),
      close: () => closeTrackMenu(),
      append: (el) => tmenu.append(el),                                  // свой блок целиком (например, «Слушать вместе»)
    }),
  });

  // «Слушать вместе» (core/together.js) сообщает о комнате событием «room»: страница Моей волны у гостя показывает
  // трек комнаты, а режимы повтора/перемешивания у гостя недоступны
  W.on("room", (r) => { window.waveRefresh?.(); if (r?.roleChanged) window.updateModes?.(); });

  // то, что main.js успел показать до подключения этого файла (громкость, скорость, режимы, восстановленный трек)
  W.player.report({ volume, rate: speed, track: queue[current] || null, playing: !!audio && !audio.paused });
  try { const on = modesActive(); W.player.report({ modes: { available: on, shuffle: on && shuffle, repeat: effRepeat() } }); } catch {}
})();
