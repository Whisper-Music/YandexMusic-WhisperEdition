// Консоль: интерфейс приложения в виде командной строки.
// Включается темой: в .wmt — «@@ settings whisper-music» → { "console": true } или
// { "console": { "prompt": "user@whisper:~$", "banner": "текст приветствия" } } (theme.js → hook("console")).
// Тема задаёт только вид (CSS для #cli); сами команды — здесь, в приложении: тема не может добавить свои
// или выполнить что-то, чего нет в списке. Цвет текста консоли — основной цвет стиля (var(--accent)).
(() => {
  const HIST_KEY = "ym_cli_hist", PREV_KEY = "ym_cli_prev_style";
  const PROMPT_DEF = "user@whisper:~$";
  let el = null, out, inp, ps, status, mounted = false, opts = null;
  let hist = [], hpos = -1, draft = "";
  let lastList = [];               // последний нумерованный список: [{ kind, data }]
  let stationsList = [];
  try { hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]").filter((x) => typeof x === "string").slice(-200); } catch {}

  // ---------- вывод ----------
  function line(text = "", cls = "") {
    const d = document.createElement("div");
    d.className = "cl" + (cls ? " " + cls : "");
    d.textContent = text;
    out.append(d);
    while (out.childElementCount > 1500) out.firstElementChild.remove();
    out.scrollTop = out.scrollHeight;
    return d;
  }
  const err = (t) => line(t, "err");
  const dim = (t) => line(t, "dim");
  const ok = (t) => line(t, "ok");
  function table(rows) {          // [[колонка1, колонка2, …]] — выравнивание пробелами
    const w = [];
    for (const r of rows) r.forEach((c, i) => { w[i] = Math.max(w[i] || 0, String(c).length); });
    for (const r of rows) line(r.map((c, i) => (i === r.length - 1 ? String(c) : String(c).padEnd(w[i] + 2))).join(""));
  }
  const cut = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const artistsOf = (t) => (t?.artists || []).map((a) => a?.name).filter(Boolean).join(", ") || "—";
  const curT = () => (typeof current === "number" && current >= 0 ? queue?.[current] : null);
  const trackRow = (i, t) => [String(i + 1).padStart(3), cut(t.title + (t.version ? ` (${t.version})` : ""), 46), cut(artistsOf(t), 32), fmtTime((t.durationMs || 0) / 1000)];
  function listTracks(tracks, from = 0) {
    lastList = tracks.map((t) => ({ kind: "track", data: t, all: tracks }));
    if (!tracks.length) return dim("(пусто)");
    table(tracks.slice(from, from + 50).map((t, i) => trackRow(from + i, t)));
    if (tracks.length > from + 50) dim(`… и ещё ${tracks.length - from - 50}. play <номер> — включить.`);
    else dim("play <номер> — включить, add <номер> — следующим.");
  }

  // ---------- общее ----------
  const onOff = (a) => (/^(on|1|вкл|да|true)$/i.test(a || "") ? true : /^(off|0|выкл|нет|false)$/i.test(a || "") ? false : null);
  function setCheck(id, val) {
    const c = document.getElementById(id);
    if (!c) return false;
    const want = val === null ? !c.checked : val;
    if (c.checked !== want) { c.checked = want; c.dispatchEvent(new Event("change", { bubbles: true })); }
    return c.checked;
  }
  function setSlider(id, v) {
    const r = document.getElementById(id);
    if (!r) return null;
    const n = Math.max(+r.min, Math.min(+r.max, Math.round(+v)));
    r.value = n; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true }));
    return n;
  }
  const clickEl = (sel) => { const b = document.querySelector(sel); if (b && !b.disabled) { b.click(); return true; } return false; };
  function parseTime(s) {
    const m = /^(\d+):(\d{1,2})$/.exec(s); if (m) return +m[1] * 60 + +m[2];
    return isFinite(+s) ? +s : NaN;
  }
  function playList(list, i) {
    wave.on = false; queue = list; playCtx = "other"; playAlbum = null; play(i);
  }
  async function searchApi(q, type) { return ym("search", { query: { text: q, type, page: 0 } }); }

  // ---------- команды ----------
  // [имена, аргументы, описание, группа, функция]
  const CMDS = [];
  const def = (names, args, help, group, fn) => CMDS.push({ names: names.split(" "), args, help, group, fn });

  // Воспроизведение
  def("play p", "[номер]", "без номера — пауза/пуск; с номером — включить пункт из последнего списка", "Воспроизведение", async (a) => {
    if (!a[0]) { togglePlay(); return; }
    const n = parseInt(a[0], 10) - 1, it = lastList[n];
    if (!it) return err("Нет такого номера в последнем списке.");
    if (it.kind === "track") { const all = it.all.filter((x) => x); playList(all, all.indexOf(it.data)); ok("▶ " + it.data.title + " — " + artistsOf(it.data)); }
    else if (it.kind === "album") { await openAlbum(it.data.id, true); }
    else if (it.kind === "artist") { await openArtist(it.data.id, true); }
    else if (it.kind === "playlist") { await openPlaylist(it.data.kind, true); }
    else if (it.kind === "station") { ok("Моя волна: " + it.data.name); await pickStation(it.data.seed, it.data.name); }
  });
  def("pause", "", "пауза", "Воспроизведение", () => { if (audio && !audio.paused) audio.pause(); });
  def("resume", "", "продолжить", "Воспроизведение", () => { if (!audio || audio.paused) togglePlay(); });
  def("next n", "", "следующий трек", "Воспроизведение", () => { clickEl("#next") || err("Сейчас нельзя."); });
  def("prev b", "", "предыдущий трек", "Воспроизведение", () => { clickEl("#prev") || err("Сейчас нельзя."); });
  def("seek", "<м:сс | сек | +сек | -сек>", "перемотать", "Воспроизведение", (a) => {
    if (!audio || needLoad || !isFinite(audio.duration)) return err("Трек ещё не загружен.");
    const s = a[0] || "";
    const v = /^[+-]/.test(s) ? audio.currentTime + parseTime(s.slice(1)) * (s[0] === "-" ? -1 : 1) : parseTime(s);
    if (!isFinite(v)) return err("Пример: seek 1:30, seek 90, seek +10");
    audio.currentTime = Math.max(0, Math.min(audio.duration - 0.5, v));
    dim("→ " + fmtTime(audio.currentTime));
  });
  def("vol volume", "[0–100 | +N | -N]", "громкость", "Воспроизведение", (a) => {
    if (!a[0]) return line(`Громкость: ${Math.round(volume * 100)}%`);
    const s = a[0], n = parseFloat(s);
    if (!isFinite(n)) return err("Пример: vol 60, vol +10");
    setVol(/^[+-]/.test(s) ? volume + n / 100 : n / 100);
    dim(`Громкость: ${Math.round(volume * 100)}%`);
  });
  def("mute", "", "выключить/включить звук", "Воспроизведение", () => clickEl("#volBtn"));
  def("speed", "[0.5–2]", "скорость воспроизведения", "Воспроизведение", (a) => {
    if (!a[0]) return line(`Скорость: ${speed}×`);
    const v = parseFloat(String(a[0]).replace(",", "."));
    if (!isFinite(v)) return err("Пример: speed 1.25");
    setSpeed(v); dim(`Скорость: ${speed}×`);
  });
  def("shuffle", "[on|off]", "случайный порядок", "Воспроизведение", (a) => {
    const want = onOff(a[0]);
    if (want === null || want !== shuffle) clickEl("#shuffleBtn");
    dim("Случайный порядок: " + (shuffle ? "вкл" : "выкл"));
  });
  def("repeat", "[off|all|one]", "повтор", "Воспроизведение", (a) => {
    const want = { off: 0, all: 1, one: 2 }[String(a[0] || "").toLowerCase()];
    if (want === undefined) clickEl("#repeatBtn");
    else for (let k = 0; k < 3 && repeat !== want; k++) clickEl("#repeatBtn");
    dim("Повтор: " + ["выкл", "весь список", "один трек"][repeat]);
  });
  def("like", "", "лайк текущему (повторно — убрать)", "Воспроизведение", async () => { const t = curT(); if (!t) return err("Ничего не играет."); await toggleLike(t); dim(likedIds.has(String(t.id)) ? "♥ в лайках" : "♡ убран из лайков"); });
  def("dislike", "", "«не нравится» текущему", "Воспроизведение", async () => { const t = curT(); if (!t) return err("Ничего не играет."); await toggleDislike(t); });
  def("now np", "", "что играет", "Воспроизведение", () => {
    const t = curT();
    if (!t) return dim("Ничего не играет.");
    line(`${audio && !audio.paused ? "▶" : "⏸"} ${t.title}${t.version ? ` (${t.version})` : ""}`, "hl");
    line(`  ${artistsOf(t)}${t.albums?.[0]?.title ? " · " + t.albums[0].title : ""}`);
    if (audio) line(`  ${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration || (t.durationMs || 0) / 1000)}  ·  ${speed}×  ·  ${likedIds.has(String(t.id)) ? "♥" : "♡"}`);
  });
  def("queue q", "", "очередь (следующие треки)", "Воспроизведение", () => {
    if (!queue?.length) return dim("Очередь пуста.");
    const from = Math.max(0, current);
    lastList = queue.map((t) => ({ kind: "track", data: t, all: queue }));
    table(queue.slice(from, from + 20).map((t, i) => [(from + i === current ? " ▶" : "  ") + String(from + i + 1).padStart(3), cut(t.title, 46), cut(artistsOf(t), 32)]));
    if (queue.length > from + 20) dim(`… всего ${queue.length}`);
  });
  def("add", "<номер>", "поставить пункт из последнего списка следующим", "Воспроизведение", (a) => {
    const it = lastList[parseInt(a[0], 10) - 1];
    if (!it || it.kind !== "track") return err("Укажи номер трека из последнего списка.");
    if (!window.playNext) return err("Очередь недоступна.");
    window.playNext(it.data); ok("Следующим: " + it.data.title);
  });
  def("lyrics", "", "текст песни (полноэкранный плеер, Esc — назад)", "Воспроизведение", () => { if (!curT()) return err("Ничего не играет."); openFull(); });

  // Музыка
  def("search s", "<запрос>", "поиск: треки, альбомы, исполнители", "Музыка", async (a) => {
    const q = a.join(" ").trim();
    if (!q) return err("Пример: search космос");
    dim("Ищу…");
    const r = await searchApi(q, "all");
    const tracks = (r?.tracks?.results || []).slice(0, 10), albums = (r?.albums?.results || []).slice(0, 5), artists = (r?.artists?.results || []).slice(0, 5);
    lastList = [];
    let n = 0;
    if (tracks.length) { line("Треки", "hd"); for (const t of tracks) { lastList.push({ kind: "track", data: t, all: tracks }); table([trackRow(n++, t)]); } }
    if (albums.length) { line("Альбомы", "hd"); for (const al of albums) { lastList.push({ kind: "album", data: al }); table([[String(++n).padStart(3), cut(al.title, 46), cut(artistsOf(al), 32), al.year || ""]]); } }
    if (artists.length) { line("Исполнители", "hd"); for (const ar of artists) { lastList.push({ kind: "artist", data: ar }); table([[String(++n).padStart(3), cut(ar.name, 46)]]); } }
    if (!n) return dim("Ничего не нашлось.");
    dim("play <номер> — включить, open <номер> — показать треки альбома/исполнителя.");
  });
  def("open o", "<номер>", "открыть альбом, исполнителя или плейлист из списка", "Музыка", async (a) => {
    const it = lastList[parseInt(a[0], 10) - 1];
    if (!it) return err("Нет такого номера.");
    if (it.kind === "album") return openAlbum(it.data.id);
    if (it.kind === "artist") return openArtist(it.data.id);
    if (it.kind === "playlist") return openPlaylist(it.data.kind);
    if (it.kind === "track" && it.data.albums?.[0]?.id) return openAlbum(it.data.albums[0].id);
    err("Этот пункт нечего открывать.");
  });
  async function openAlbum(id, autoplay) {
    const r = await ym("album", { id });
    const tracks = (r?.volumes || []).flat();
    line(`${r?.title || "Альбом"} — ${artistsOf(r)}${r?.year ? ` (${r.year})` : ""}`, "hd");
    listTracks(tracks);
    if (autoplay && tracks.length) playList(tracks, 0);
  }
  async function openArtist(id, autoplay) {
    const r = await ym("artist_brief", { id });
    const tracks = r?.popularTracks || [];
    line(`${r?.artist?.name || "Исполнитель"} — популярные треки`, "hd");
    listTracks(tracks);
    if (autoplay && tracks.length) playList(tracks, 0);
  }
  async function openPlaylist(kind, autoplay) {
    const p = await plFetch(kind);
    line(`${p.title} — ${p.list.length} ${plRu(p.list.length, "трек", "трека", "треков")}`, "hd");
    listTracks(p.list);
    if (autoplay && p.list.length) playList(p.list, 0);
  }
  def("likes", "[страница]", "понравившиеся треки (по 50)", "Музыка", async (a) => {
    dim("Загружаю лайки…");
    const t = await loadAllLikes(() => {}, () => false);
    if (!t) return;
    const page = Math.max(1, parseInt(a[0] || "1", 10) || 1);
    line(`Лайки: ${t.length}`, "hd");
    listTracks(t, (page - 1) * 50);
    if (t.length > page * 50) dim(`likes ${page + 1} — следующая страница`);
  });
  def("playlists pl", "[номер]", "мои плейлисты; с номером — треки плейлиста", "Музыка", async (a) => {
    const list = await plLoadList();
    if (a[0]) { const p = list[parseInt(a[0], 10) - 1]; if (!p) return err("Нет такого плейлиста."); return openPlaylist(p.kind); }
    if (!list.length) return dim("Плейлистов нет.");
    lastList = list.map((p) => ({ kind: "playlist", data: p }));
    table(list.map((p, i) => [String(i + 1).padStart(3), cut(p.title, 46), `${p.trackCount || 0} тр.`]));
    dim("pl <номер> — треки, play <номер> — включить.");
  });
  def("wave w", "[номер станции]", "Моя волна; с номером — станция из списка stations", "Музыка", async (a) => {
    if (a[0]) {
      const st = stationsList[parseInt(a[0], 10) - 1];
      if (!st) return err("Сначала: stations — список станций.");
      ok("Моя волна: " + st.name); return pickStation(st.seed, st.name);
    }
    $("#waveBtn").click(); ok("Моя волна" + (wave.name ? ": " + wave.name : ""));
  });
  def("stations", "[фильтр]", "станции Моей волны: жанры, настроения, языки", "Музыка", async (a) => {
    await loadStations();
    const f = a.join(" ").toLowerCase();
    const all = [];
    for (const [type, title] of GROUPS) for (const s of stations.groups[type] || []) if (!f || s.name.toLowerCase().includes(f)) all.push({ ...s, title });
    stationsList = all.slice(0, 80);
    lastList = stationsList.map((s) => ({ kind: "station", data: s }));
    if (!stationsList.length) return dim("Не нашлось.");
    let g = "";
    stationsList.forEach((s, i) => { if (s.title !== g) { g = s.title; line(g, "hd"); } line(`${String(i + 1).padStart(3)}  ${s.name}`); });
    if (all.length > 80) dim("Показаны первые 80 — уточни: stations рок");
    dim("wave <номер> — включить станцию.");
  });
  def("download dl", "", "скачать текущий трек", "Музыка", async () => { const t = curT(); if (!t) return err("Ничего не играет."); await downloadTrack(t); });

  // Оформление
  def("style theme", "[id]", "список стилей или переключить стиль", "Оформление", (a) => {
    const all = [["neon", "Неон"], ["royal", "Королевский"], ["steam", "Стимпанк"], ["lolitta", "Lolitta"], ...cfg.themes.map((t) => [t.id, t.name])];
    if (!a[0]) { all.forEach(([id, nm]) => line(`${id === cfg.style ? "*" : " "} ${id.padEnd(20)} ${nm}`)); return dim("style <id> — переключить. Вернуться к обычному интерфейсу: gui"); }
    const hit = all.find(([id]) => id === a[0]);
    if (!hit) return err("Нет такого стиля.");
    cfg.style = hit[0]; applyCfg(); saveCfg(); syncControls();
  });
  def("gui exit", "", "вернуться к обычному интерфейсу (прошлый стиль)", "Оформление", () => {
    let prev = "royal"; try { prev = localStorage.getItem(PREV_KEY) || "royal"; } catch {}
    if (!cfg.s[prev] || hook("console", prev)) prev = "royal";
    cfg.style = prev; applyCfg(); saveCfg(); syncControls();
  });
  const hexOk = (v) => /^#?[0-9a-f]{6}$/i.test(v || "");
  def("color", "<#rrggbb>", "цвет текста (основной цвет стиля)", "Оформление", (a) => {
    if (!hexOk(a[0])) return line(`Сейчас: ${sty().accent}. Пример: color #33ff66`);
    if (cfg.dyn === true) setCheck("cDyn", false);
    sty().accent = "#" + a[0].replace("#", "").toLowerCase(); applyCfg(); saveCfg(); syncControls();
  });
  def("color2", "<#rrggbb>", "второй цвет (подсветка, приглашение)", "Оформление", (a) => {
    if (!hexOk(a[0])) return line(`Сейчас: ${sty().accent2}. Пример: color2 #1f9e45`);
    sty().accent2 = "#" + a[0].replace("#", "").toLowerCase(); applyCfg(); saveCfg(); syncControls();
  });
  def("bg", "[file|desktop|clear|cover on|off]", "фон: выбрать файл, обои рабочего стола, убрать, обложка трека", "Оформление", (a) => {
    const s = String(a[0] || "").toLowerCase();
    if (s === "file" || s === "") { $("#bgFile").click(); return dim("Выбери картинку, гиф или видео (или перетащи файл в окно)."); }
    if (s === "desktop") return clickEl("#deskBtn");
    if (s === "clear") return clickEl("#bgReset");
    if (s === "cover") return dim("Фон по обложке: " + (setCheck("cDyn", onOff(a[1])) ? "вкл" : "выкл"));
    err("Варианты: bg file | bg desktop | bg clear | bg cover on|off");
  });
  def("blur", "<0–40>", "размытие фона", "Оформление", (a) => { const v = setSlider("cBlur", a[0]); v === null || !isFinite(+a[0]) ? err("Пример: blur 8") : dim("Размытие: " + v); });
  def("dim", "<0–85>", "затемнение фона", "Оформление", (a) => { const v = setSlider("cDim", a[0]); v === null || !isFinite(+a[0]) ? err("Пример: dim 40") : dim("Затемнение: " + v); });
  def("glow", "<0–48>", "свечение текста", "Оформление", (a) => { const v = setSlider("cGlow", a[0]); v === null || !isFinite(+a[0]) ? err("Пример: glow 8") : dim("Свечение: " + v); });
  def("panel", "<20–100>", "непрозрачность консоли", "Оформление", (a) => { const v = setSlider("cPanel", a[0]); v === null || !isFinite(+a[0]) ? err("Пример: panel 80") : dim("Непрозрачность: " + v); });
  def("anim", "[on|off]", "анимации", "Оформление", (a) => dim("Анимации: " + (setCheck("cAnim", onOff(a[0])) ? "вкл" : "выкл")));

  // Сервисы и настройки
  def("stats", "[7|30|365|all|on|off]", "статистика прослушиваний (по умолчанию за 30 дней)", "Сервисы", async (a) => {
    const s = String(a[0] || "30").toLowerCase();
    if (onOff(s) !== null) return dim("Запись статистики: " + (setCheck("lsOn", onOff(s)) ? "вкл" : "выкл"));
    const L = window.lstatsApi;
    if (!L?.on()) return dim("Запись статистики выключена: stats on");
    const days = s === "all" ? 0 : parseInt(s, 10) || 30;
    const r = await L.data(days);
    if (!r || r.ms < 60000) return dim("Пока почти ничего не записано.");
    line(`Статистика за ${days ? days + " дн." : "всё время"}`, "hd");
    line(`Прослушано: ${fmtHM(r.ms)} · разных треков: ${r.uniqTracks} · исполнителей: ${r.uniqArtists}`);
    if (r.topTracks[0]) line(`Любимый трек: ${r.topTracks[0].m.title} — ${r.topTracks[0].m.artists.map((x) => x.name).join(", ")} (${r.topTracks[0].plays} раз)`);
    if (r.topGenres[0]) line(`Любимый жанр: ${await genreTitle(r.topGenres[0][0])}`);
    line("Исполнители", "hd");
    const max = r.topArtists[0]?.ms || 1;
    for (const x of r.topArtists.slice(0, 8)) line(`  ${cut(x.m.name, 24).padEnd(25)} ${"█".repeat(Math.max(1, Math.round((x.ms / max) * 24))).padEnd(25)} ${fmtHours(x.ms)}`);
    line("Треки", "hd");
    lastList = r.topTracks.map((x) => ({ kind: "track", data: { id: x.id, title: x.m.title, coverUri: x.m.coverUri, durationMs: x.m.durationMs, artists: x.m.artists, albums: x.m.albumId != null ? [{ id: x.m.albumId }] : [] } }));
    lastList.forEach((it) => { it.all = lastList.map((y) => y.data); });
    r.topTracks.forEach((x, i) => line(`${String(i + 1).padStart(3)}  ${cut(x.m.title, 40).padEnd(41)} ${String(x.plays).padStart(4)} раз`));
  });
  def("sleep", "[минуты|off]", "режим сна: Моя волна и выключение через N минут", "Сервисы", (a) => {
    const s = String(a[0] || "");
    const running = $("#slStart")?.textContent.includes("Выключить");
    if (/^off$/i.test(s)) { if (running) clickEl("#slStart"); return dim("Режим сна выключен."); }
    if (s) { const chip = document.querySelector(`#slTime .chip[data-v="${parseInt(s, 10)}"]`); if (!chip) return err("Можно: 15, 30, 45, 60, 90, 120, 180"); chip.click(); }
    if (!running) clickEl("#slStart");
    dim("Режим сна включён.");
  });
  def("eq", "", "эквалайзер", "Сервисы", () => (window.eqOpen ? window.eqOpen() : err("Эквалайзер недоступен.")));
  def("discord", "[on|off]", "статус в Discord", "Сервисы", (a) => dim("Discord: " + (setCheck("dcOn", onOff(a[0])) ? "вкл" : "выкл")));
  def("obs", "[on|off]", "виджет для OBS и его адрес", "Сервисы", (a) => {
    const v = setCheck("obsOn", onOff(a[0]));
    dim("OBS-виджет: " + (v ? "вкл" : "выкл"));
    if (v) setTimeout(() => { const u = $("#obsUrl")?.value; if (u) line("Адрес для OBS (Браузер): " + u, "hl"); }, 400);
  });
  def("hotkeys", "[on|off]", "глобальные горячие клавиши", "Сервисы", (a) => dim("Горячие клавиши: " + (setCheck("hkOn", onOff(a[0])) ? "вкл" : "выкл")));
  def("viz", "[on|off]", "аудиовизуализатор (Моя волна в обычном интерфейсе)", "Сервисы", (a) => dim("Визуализатор: " + (setCheck("cViz", onOff(a[0])) ? "вкл" : "выкл")));
  def("archive", "[on|off]", "играть треки из Whisper Archive", "Сервисы", (a) => dim("Треки из архива: " + (setCheck("waOn", onOff(a[0])) ? "вкл" : "выкл")));
  def("room", "[create|join КОД|leave|suggest]", "«Слушать вместе»", "Сервисы", async (a) => {
    const R = window.roomCli;
    if (!R) return err("«Слушать вместе» недоступно.");
    const sub = String(a[0] || "").toLowerCase();
    if (sub === "create") return R.create();
    if (sub === "join") return a[1] ? R.join(a[1]) : err("Пример: room join ABC234");
    if (sub === "leave") return R.leave();
    if (sub === "suggest") { const t = curT(); return t ? R.suggest(t) : err("Ничего не играет."); }
    const i = R.info();
    if (!i) return dim("Ты не в комнате. room create — создать, room join КОД — войти.");
    line(`Комната ${i.code} · ${i.isHost ? "ты ведущий" : "ты гость"} · слушают: ${i.members.length}`, "hl");
    line("  " + i.members.map((m) => (m.isHost ? "★" : "") + m.nickname).join(", "));
    if (i.playback) line(`  ${i.playback.playing ? "▶" : "⏸"} ${i.playback.track.title} — ${(i.playback.track.artists || []).map((x) => x.name).join(", ")}`);
  });

  // Консоль
  def("help h ?", "[команда]", "список команд или справка по одной", "Консоль", (a) => {
    if (a[0]) {
      const c = find(a[0]);
      if (!c) return err("Нет такой команды: " + a[0]);
      line(`${c.names[0]} ${c.args}`.trim(), "hl");
      line("  " + c.help);
      if (c.names.length > 1) dim("  Также: " + c.names.slice(1).join(", "));
      return;
    }
    let g = "";
    for (const c of CMDS) {
      if (c.group !== g) { g = c.group; line(g, "hd"); }
      line(`  ${(c.names[0] + " " + c.args).padEnd(38)} ${c.help}`);
    }
    dim("↑/↓ — история, Tab — дополнить команду, Ctrl+L — очистить экран. Аварийный выход из консоли — Ctrl+Shift+Backspace.");
  });
  def("clear cls", "", "очистить экран", "Консоль", () => { out.textContent = ""; });
  def("history", "", "история команд", "Консоль", () => hist.slice(-30).forEach((h, i, arr) => line(`${String(hist.length - arr.length + i + 1).padStart(4)}  ${h}`)));
  def("about", "", "о программе", "Консоль", () => { line("Whisper Edition — клиент Яндекс Музыки. Консоль — режим стиля «Терминал».", "hl"); dim("Цвет текста: color, фон: bg, обычный интерфейс: gui."); });

  const find = (name) => CMDS.find((c) => c.names.includes(String(name).toLowerCase()));

  function splitArgs(s) {
    const out2 = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
    while ((m = re.exec(s))) out2.push(m[1] ?? m[2] ?? m[3]);
    return out2;
  }
  async function run(raw) {
    const text = raw.trim();
    line(`${ps.textContent} ${raw}`, "cmd");
    if (!text) return;
    if (hist[hist.length - 1] !== text) { hist.push(text); hist = hist.slice(-200); try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch {} }
    const [name, ...args] = splitArgs(text);
    const c = find(name);
    if (!c) return err(`${name}: команда не найдена. help — список команд.`);
    try { await c.fn(args); }
    catch (e) { err("Ошибка: " + (e?.message || e)); }
  }

  // ---------- строка состояния ----------
  function bar(p, w = 24) { const n = Math.round(Math.max(0, Math.min(1, p)) * w); return "[" + "#".repeat(n) + "-".repeat(w - n) + "]"; }
  function paintStatus() {
    if (!mounted) return;
    const t = curT();
    if (!t) { status.textContent = "■ ничего не играет · help — команды"; return; }
    const cur = needLoad ? resumePos : audio?.currentTime || 0, dur = (audio && isFinite(audio.duration) && audio.duration) || (t.durationMs || 0) / 1000;
    const flags = [shuffle ? "shuffle" : "", repeat ? "repeat:" + (repeat === 2 ? "one" : "all") : "", speed !== 1 ? speed + "×" : "", likedIds.has(String(t.id)) ? "♥" : "", window.roomInfo?.() ? "room" : ""].filter(Boolean).join(" ");
    status.textContent = `${audio && !audio.paused ? "▶" : "⏸"} ${cut(t.title, 40)} — ${cut(artistsOf(t), 28)}  ${bar(dur ? cur / dur : 0)} ${fmtTime(cur)}/${fmtTime(dur)}  vol ${Math.round(volume * 100)}%${flags ? "  " + flags : ""}`;
  }
  setInterval(paintStatus, 500);

  // ---------- сборка ----------
  function build() {
    el = document.createElement("div");
    el.id = "cli"; el.className = "cli";
    el.innerHTML = '<div class="cli-out" id="cliOut" role="log" aria-live="polite"></div><div class="cli-status" id="cliStatus"></div><form class="cli-in" autocomplete="off"><span class="cli-ps"></span><input id="cliIn" spellcheck="false" autocomplete="off" aria-label="Команда" /></form>';
    document.body.append(el);
    out = el.querySelector(".cli-out"); inp = el.querySelector("#cliIn"); ps = el.querySelector(".cli-ps"); status = el.querySelector(".cli-status");
    el.querySelector("form").onsubmit = (e) => { e.preventDefault(); const v = inp.value; inp.value = ""; hpos = -1; run(v); };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        if (!hist.length) return;
        if (hpos === -1) { draft = inp.value; hpos = hist.length; }
        hpos = Math.max(0, Math.min(hist.length, hpos + (e.key === "ArrowUp" ? -1 : 1)));
        inp.value = hpos === hist.length ? draft : hist[hpos];
        if (hpos === hist.length) hpos = -1;
      } else if (e.key === "Tab") {
        e.preventDefault();
        const w = inp.value.trimStart();
        if (w.includes(" ")) return;
        const hits = [...new Set(CMDS.flatMap((c) => c.names).filter((n) => n.startsWith(w.toLowerCase())))];
        if (hits.length === 1) inp.value = hits[0] + " ";
        else if (hits.length > 1) dim(hits.join("  "));
      } else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); out.textContent = ""; }
      else if (e.key === "c" && e.ctrlKey && inp.selectionStart === inp.selectionEnd) { e.preventDefault(); line(`${ps.textContent} ${inp.value}^C`, "cmd"); inp.value = ""; hpos = -1; }
    });
    el.addEventListener("mouseup", () => { if (!getSelection().toString()) inp.focus(); });
  }
  window.cliMount = (o) => {
    const want = !!o;
    if (want && !el) build();
    if (want) {
      opts = o;
      ps.textContent = (o.prompt || PROMPT_DEF).slice(0, 40);
      if (!mounted) {
        mounted = true;
        document.body.classList.add("cli-on");
        if (!out.childElementCount) {
          for (const l of String(o.banner || "Whisper Edition · терминал").split("\n").slice(0, 20)) line(l, "banner");
          dim("help — список команд. gui — обычный интерфейс.");
        }
        paintStatus();
        setTimeout(() => inp.focus(), 50);
      }
    } else if (mounted) {
      mounted = false;
      document.body.classList.remove("cli-on");
    }
  };
  // запоминаем последний обычный стиль, чтобы «gui» возвращал к нему
  setInterval(() => { try { if (typeof cfg !== "undefined" && !hook("console")) localStorage.setItem(PREV_KEY, cfg.style); } catch {} }, 2000);
  try { window.cliMount(hook("console") || null); } catch {}
})();
