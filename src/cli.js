// Консоль: интерфейс приложения в виде командной строки.
// Включается темой: в .wmt — «@@ settings whisper-music» → { "console": true } или
// { "console": { "prompt": "user@whisper:~$", "banner": "текст приветствия" } } (theme.js → hook("console")).
// Тема задаёт только вид (CSS для #cli); сами команды — здесь, в приложении: тема не может добавить свои
// или выполнить что-то, чего нет в списке. Цвет текста консоли — основной цвет стиля (var(--accent)).
// Кроме обычных команд есть скрытые (visual, cat, vinyl, piano…): их нет в help и в Tab, список — в docs/THEMES.md.
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
      if (c.hidden) continue;
      if (c.group !== g) { g = c.group; line(g, "hd"); }
      line(`  ${(c.names[0] + " " + c.args).padEnd(38)} ${c.help}`);
    }
    dim("↑/↓ — история, Tab — дополнить команду, Ctrl+L — очистить экран. Аварийный выход из консоли — Ctrl+Shift+Backspace.");
  });
  def("clear cls", "", "очистить экран", "Консоль", () => { liveStop(); out.textContent = ""; });
  def("history", "", "история команд", "Консоль", () => hist.slice(-30).forEach((h, i, arr) => line(`${String(hist.length - arr.length + i + 1).padStart(4)}  ${h}`)));
  def("about", "", "о программе", "Консоль", () => { line("Whisper Edition — клиент Яндекс Музыки. Консоль — режим стиля «Терминал».", "hl"); dim("Цвет текста: color, фон: bg, обычный интерфейс: gui."); });


  // ---------- скрытые команды (пасхалки) ----------
  // Работают в любой консольной теме, но не видны в help и в дополнении по Tab — их находят сами
  // или читают в docs/THEMES.md («Консоль → Скрытые команды»). help <имя> по ним всё же отвечает.
  const egg = (names, args, help, fn) => CMDS.push({ names: names.split(" "), args, help, group: "Скрытые", hidden: true, fn });
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const art = (text, cls = "") => line(text, "art" + (cls ? " " + cls : ""));
  const isPlaying = () => !!(audio && !audio.paused && curT());
  const userName = () => (ps?.textContent.split("@")[0] || "user").replace(/[^\p{L}\p{N}_.-]/gu, "") || "user";
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Живой блок — одна анимация за раз. Останавливается новой командой, Esc, Ctrl+C, очисткой экрана
  // и выходом из консоли. frame(n, t) возвращает текст кадра; false — анимация закончилась сама.
  let live = null;
  function liveStop(msg) {
    if (!live) return;
    const l = live; live = null;
    clearInterval(l.timer);
    try { l.onStop?.(); } catch {}
    if (msg) dim(msg);
  }
  function liveStart(fps, frame, extra = {}) {
    liveStop();
    const d = line("", "art live");
    const l = { d, n: 0, t0: performance.now(), ...extra };
    const tick = () => {
      if (live !== l) return;
      if (!mounted || !d.isConnected) return liveStop();
      if (document.hidden) return;
      const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 60;
      const r = frame(l.n++, (performance.now() - l.t0) / 1000);
      if (r === false) return liveStop();
      if (typeof r === "string" && d.textContent !== r) d.textContent = r;
      if (atBottom) out.scrollTop = out.scrollHeight;
    };
    live = l;
    l.timer = setInterval(tick, 1000 / fps);
    tick();
    return l;
  }
  // сколько символов помещается в строку консоли
  function cols() {
    const p = document.createElement("span");
    p.className = "cli-probe"; p.textContent = "0".repeat(20);
    out.append(p);
    const w = p.getBoundingClientRect().width / 20;
    p.remove();
    return Math.max(24, Math.floor((out.clientWidth - 12) / (w || 8.4)));
  }

  // --- звук для piano / metro: свой маленький AudioContext, музыку приложения не трогает ---
  let pctx = null;
  function synth() { pctx ||= new AudioContext(); if (pctx.state === "suspended") pctx.resume(); return pctx; }
  function tone(f, t0, dur, type = "triangle", amp = 1) {
    const c = synth(), o = c.createOscillator(), g = c.createGain();
    const peak = 0.2 * amp * clamp(typeof volume === "number" ? volume : 0.8, 0.15, 1);
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // visual — аудиовизуализатор из символов
  const BLK = " ▁▂▃▄▅▆▇█";
  let tbuf = null;
  egg("visual vis", "[bars|wave|line|off]", "аудиовизуализатор из символов: столбики, осциллограф или одна строка", (a) => {
    const mode = String(a[0] || "bars").toLowerCase();
    if (mode === "off" || mode === "stop") return liveStop();
    if (!["bars", "wave", "line"].includes(mode)) return err("Варианты: visual bars | visual wave | visual line");
    if (!isPlaying()) dim("Сейчас тишина — включи трек, и столбики оживут.");
    dim("Esc или Ctrl+C — остановить.");
    const H = mode === "line" ? 1 : 8;
    const cw = mode === "bars" ? 3 : 1;                          // столбик — «██ »
    const W = clamp(Math.floor((cols() * 0.92) / cw), 12, mode === "bars" ? 40 : 110);
    const lvl = new Float32Array(W), peak = new Float32Array(W);
    liveStart(30, (n, t) => {
      const on = !!(audioViz && analyser && freq && audio && !audio.paused);
      if (mode === "wave") {
        const rows = Array.from({ length: H }, () => Array(W).fill(" "));
        let get;
        if (on) {
          if (!tbuf || tbuf.length !== analyser.fftSize) tbuf = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(tbuf);
          const span = tbuf.length / 2;
          get = (x) => (tbuf[Math.floor((x / W) * span)] - 128) / 128;
        } else get = (x) => Math.sin((x / W) * Math.PI * 4 + t * 2) * 0.12;
        let prev = null;
        for (let x = 0; x < W; x++) {
          const v = clamp(get(x) * 1.8, -1, 1);
          const y = Math.round(((1 - v) / 2) * (H - 1));
          if (prev !== null) for (let yy = Math.min(prev, y) + 1; yy < Math.max(prev, y); yy++) rows[yy][x] = "│";
          rows[y][x] = "•"; prev = y;
        }
        return rows.map((r) => r.join("")).join("\n");
      }
      if (on) analyser.getByteFrequencyData(freq);
      const maxBin = Math.min(freq?.length || 512, 360);          // примерно до 15 кГц
      for (let x = 0; x < W; x++) {
        let v;
        if (on) {
          // квадратичная шкала: басам и серединке достаётся больше столбиков, чем верхам
          const b0 = Math.floor(2 + (maxBin - 2) * (x / W) ** 2), b1 = Math.max(b0 + 1, Math.floor(2 + (maxBin - 2) * ((x + 1) / W) ** 2));
          let s = 0;
          for (let b = b0; b < b1; b++) s = Math.max(s, freq[b]);
          v = clamp((s / 255) ** 1.6 * (0.9 + 0.6 * (x / W)), 0, 1);  // верхи тише — чуть подтягиваем
        } else v = 0.05 + 0.04 * Math.sin(x * 0.45 + t * 2.5);
        lvl[x] = v > lvl[x] ? v : lvl[x] * 0.8 + v * 0.2;            // быстрый подъём, плавное падение
        peak[x] = Math.max(lvl[x], peak[x] - 0.01);
      }
      if (mode === "line") return Array.from(lvl, (v) => BLK[clamp(Math.round(v * 8), 1, 8)]).join("");
      const rows = [];
      for (let r = 0; r < H; r++) {
        let s = "";
        for (let x = 0; x < W; x++) {
          const u = lvl[x] * H * 8 - (H - 1 - r) * 8;
          let ch = u >= 8 ? "█" : u <= 0 ? " " : BLK[clamp(Math.round(u), 1, 8)];
          if (ch === " " && peak[x] > 0.06 && Math.min(H - 1, Math.floor(peak[x] * H)) === H - 1 - r) ch = "▔";
          s += ch + ch + " ";
        }
        rows.push(s.trimEnd());
      }
      return rows.join("\n");
    }, { onStop: () => { window.cliVizOn = false; } });
    // анализ звука нужен и консоли: main.js → vizWanted() смотрит на cliVizOn и переводит трек на анализируемый плеер
    window.cliVizOn = true;
    try { if (typeof ensureVizAudio === "function") ensureVizAudio(); } catch {}
  });

  // cat — котик
  const CATS = [
    " /\\_/\\\n( o.o )\n > ^ <",
    "   /\\_/\\\n  ( o o )\n  (  =  )___\n   (\")(\")___)~",
    "      z\n    z\n  /\\_/\\\n ( -.- )\n /     \\\n(_)---(_)",
    "  /\\_/\\  \n ( =^.^= )\n  )     (  //\n (__\\_/__)//",
    "  /\\_/\\\n ( ^.^ )\n  \\ ~ /\n  /   \\\n (_| |_)",
  ];
  const CAT_PHONES = "    /\\_/\\    ♪\n ◖ ( ^ω^ ) ◗\n    (\") (\")   ♫";
  egg("cat meow мяу", "[имя|vibe]", "котик; cat vibe — котик качается под музыку", (a) => {
    const arg = String(a[0] || "").toLowerCase();
    if (arg === "vibe" || arg === "dance") {
      const F = [
        "   /\\_/\\  ♪\n  ( ^.^ )\n  />   <\\",
        "    /\\_/\\\n   ( ^o^ )  ♫\n   \\>   </",
        "   /\\_/\\\n  ( ^.^ )  ♪\n  />   <\\",
        "  /\\_/\\\n ( ^o^ )   ♫\n \\>   </",
      ];
      const SLEEP = ["  /\\_/\\   z\n ( -.- )\n (\")(\")", "  /\\_/\\    Z\n ( -.- )  z\n (\")(\")"];
      dim("Esc — котик отдыхает.");
      let step = 0, lastHit = 0, avg = 0;
      liveStart(20, (n, t) => {
        if (!isPlaying()) return SLEEP[Math.floor(t) % 2];
        let hit = false;
        if (audioViz && analyser && freq) {
          analyser.getByteFrequencyData(freq);
          const bass = (freq[1] + freq[2] + freq[3] + freq[4]) / 4;
          avg = avg * 0.92 + bass * 0.08;
          hit = bass > avg * 1.15 && bass > 90 && t - lastHit > 0.25;
        } else hit = t - lastHit > 0.5;                             // звук не анализируется — просто в ритме 120
        if (hit) { lastHit = t; step++; }
        return F[step % F.length];
      }, { onStop: () => { window.cliVizOn = false; } });
      window.cliVizOn = true;
      try { if (typeof ensureVizAudio === "function") ensureVizAudio(); } catch {}
      return;
    }
    if (a[0]) dim(`cat: ${a[0]}: нет такого файла. Держи котика вместо него:`);
    art(isPlaying() && Math.random() < 0.5 ? CAT_PHONES : pick(CATS), "hl");
    dim(pick(["мяу", "мрр", "мяу?", "*мурчит*", "мяу. play?", "*требует лайк треку*"]));
  });

  // cowsay — говорит, правда, кот
  function bubble(text, w = 40) {
    const words = String(text).replace(/\s+/g, " ").trim().split(" ");
    const rows = [];
    let cur = "";
    for (const wd of words) {
      if (!cur) cur = wd.slice(0, w);
      else if ((cur + " " + wd).length <= w) cur += " " + wd;
      else { rows.push(cur); cur = wd.slice(0, w); }
    }
    if (cur) rows.push(cur);
    const m = Math.max(...rows.map((r) => r.length));
    const body = rows.length === 1 ? [`< ${rows[0]} >`] : rows.map((r, i) => (i === 0 ? "/ " : i === rows.length - 1 ? "\\ " : "| ") + r.padEnd(m) + (i === 0 ? " \\" : i === rows.length - 1 ? " /" : " |"));
    return [" " + "_".repeat(m + 2), ...body, " " + "-".repeat(m + 2)].join("\n");
  }
  egg("cowsay catsay", "[текст]", "кот (да, кот) говорит текст; без текста — что играет", (a) => {
    const t = curT();
    const text = a.join(" ").trim() || (t ? `Сейчас играет: ${t.title} — ${artistsOf(t)}` : pick(FORTUNES));
    art(bubble(text) + "\n      \\\n       \\   /\\_/\\\n          ( o.o )\n           > ^ <   мууу? то есть мяу.");
  });

  // fortune — случайный музыкальный факт
  const FORTUNES = [
    "Ля первой октавы = 440 Гц. Этот стандарт настройки закреплён в ISO 16.",
    "Октава — это ровно вдвое большая частота.",
    "В равномерной темперации соседние полутоны отличаются в ¹²√2 ≈ 1,0595 раза.",
    "На стандартном фортепиано 88 клавиш: 52 белые и 36 чёрных.",
    "Pianoforte — «тихо-громко»: так назвали инструмент, который умел и то и другое.",
    "Скрипичный ключ — это ключ соль: его завиток обводит линейку с соль первой октавы.",
    "У до мажора и ля минора нет знаков при ключе.",
    "Одна и та же нота у скрипки и флейты звучит по-разному из-за обертонов.",
    "120 BPM — ровно две доли в секунду.",
    "Компакт-диск хранит звук как 44 100 отсчётов в секунду по 16 бит.",
    "Чтобы записать звук до 20 кГц, частота дискретизации должна быть больше 40 кГц (теорема Котельникова).",
    "Человек слышит примерно от 20 Гц до 20 кГц, а с возрастом верхняя граница опускается.",
    "Метроном с привычной шкалой ударов в минуту запатентовал Иоганн Мельцель в 1815 году.",
    "Tab дополняет команды. Но не все.",
    "Если долго слушать тишину, тишина начинает слушать тебя. Включи что-нибудь: wave.",
    "Лайк — лучший способ сказать треку «спасибо». Команда like.",
  ];
  egg("fortune", "", "случайный музыкальный факт", () => line("» " + pick(FORTUNES), "hl"));

  // vinyl — крутящаяся пластинка
  egg("vinyl spin", "", "пластинка крутится, пока играет трек", () => {
    const R = 5;
    dim("Esc — снять иглу.");
    let ang = 0, last = 0;
    liveStart(24, (n, t) => {
      const on = isPlaying();
      ang += on ? (t - last) * 3.5 : 0;                            // 33⅓ об/мин ≈ 3,5 рад/с
      last = t;
      const rows = [];
      for (let y = -R; y <= R; y++) {
        let s = "";
        for (let x = -2 * R - 1; x <= 2 * R + 1; x++) {
          const dx = x / 2, d = Math.hypot(dx, y);
          if (d > R + 0.35) { s += " "; continue; }
          if (d < 0.7) { s += "●"; continue; }
          if (d < 1.9) { s += "o"; continue; }
          const sec = (((Math.atan2(y, dx) - ang) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          s += sec < 0.45 ? "▓" : sec < 0.9 ? "▒" : d > R - 0.4 ? "█" : "░";
        }
        rows.push(s.trimEnd());
      }
      const tr = curT();
      rows.push("", tr ? `${on ? "♪" : "⏸"} ${cut(tr.title, 30)} — ${cut(artistsOf(tr), 24)}  ·  33⅓` : "⏸ пластинка пуста — включи трек");
      return rows.join("\n");
    });
  });

  // matrix — «цифровой дождь», только из нот
  egg("matrix", "", "цифровой дождь из нот и нулей", () => {
    dim("Esc — проснуться.");
    const W = clamp(cols() - 2, 20, 120), H = 14, CH = "01♪♫♩♯♭ABCDEFG";
    const head = Array.from({ length: W }, () => -Math.random() * H * 2);
    const len = Array.from({ length: W }, () => 4 + Math.floor(Math.random() * 9));
    const sp = Array.from({ length: W }, () => 0.25 + Math.random() * 0.6);
    const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => pick(CH)));
    liveStart(20, () => {
      const rows = [];
      for (let x = 0; x < W; x++) {
        head[x] += sp[x];
        if (head[x] - len[x] > H) { head[x] = -Math.random() * H; len[x] = 4 + Math.floor(Math.random() * 9); sp[x] = 0.25 + Math.random() * 0.6; }
        if (Math.random() < 0.08) grid[Math.floor(Math.random() * H)][x] = pick(CH);
      }
      for (let y = 0; y < H; y++) {
        let s = "";
        for (let x = 0; x < W; x++) { const k = head[x] - y; s += k >= 0 && k < len[x] ? grid[y][x] : " "; }
        rows.push(s);
      }
      return rows.join("\n");
    });
  });

  // party — радужная консоль
  let partyTimer = 0;
  egg("party", "[off]", "радужная консоль на 30 секунд", (a) => {
    clearTimeout(partyTimer);
    if (/^(off|stop|0)$/i.test(a[0] || "")) { el.classList.remove("party"); return dim("Вечеринка окончена."); }
    el.classList.add("party");
    ok(pick(["★ ПАТИ ★", "♪ ♫ ♪ ♫", "Громче!", "Танцуют все!"]));
    partyTimer = setTimeout(() => el.classList.remove("party"), 30000);
  });

  // piano — сыграть ноты
  const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11, h: 11, до: 0, ре: 2, ми: 4, фа: 5, соль: 7, ля: 9, си: 11 };
  function parseNote(tok, oct) {
    const m = /^(до|ре|ми|фа|соль|ля|си|[a-h])(#|♯|диез|b|♭|бемоль)?(\d)?$/i.exec(tok);
    if (!m) return null;
    const acc = m[2] ? (/^(#|♯|диез)$/i.test(m[2]) ? 1 : -1) : 0;
    const o = m[3] != null ? +m[3] : oct;
    const name = m[1].toLowerCase();
    return { midi: 12 * (o + 1) + SEMI[name] + acc, oct: o, label: m[1].toUpperCase() + (acc > 0 ? "♯" : acc < 0 ? "♭" : "") + o };
  }
  egg("piano", "[темп] <ноты>", "сыграть ноты: piano c e g c5 · piano до ми соль · piano 200 c d e - e d c", (a) => {
    let bpm = 180, toks = a.slice();
    if (toks[0] && /^\d+$/.test(toks[0])) bpm = clamp(+toks.shift(), 40, 600);
    if (!toks.length) toks = "c4 e4 g4 c5 - g4 e4 c4".split(" ");
    if (toks.length > 64) return err("Не больше 64 нот за раз.");
    const c = synth(), beat = 60 / bpm;
    let t = c.currentTime + 0.05, oct = 4;
    const shown = [];
    for (const tok of toks.flatMap((x) => x.split(","))) {
      if (!tok) continue;
      if (/^(-|\.|_|пауза)$/i.test(tok)) { shown.push("·"); t += beat; continue; }
      const nt = parseNote(tok, oct);
      if (!nt) return err(`piano: не понял ноту «${tok}». Пример: c d e f# g a bb c5 или до ре ми.`);
      oct = nt.oct;
      tone(440 * 2 ** ((nt.midi - 69) / 12), t, Math.max(0.25, beat * 1.6));
      shown.push(nt.label);
      t += beat;
    }
    ok("♪ " + shown.join(" "));
  });

  // metro — метроном
  egg("metro metronome", "[bpm] [доли]", "метроном: metro 120 · metro 90 3 · metro off", (a) => {
    if (/^(off|stop)$/i.test(a[0] || "")) return liveStop();
    const bpm = clamp(parseInt(a[0] || "100", 10) || 100, 30, 300), beats = clamp(parseInt(a[1] || "4", 10) || 4, 1, 12);
    const c = synth();
    let next = c.currentTime + 0.1, k = 0;
    const times = [];
    dim("Esc — стоп.");
    liveStart(30, () => {
      while (next < c.currentTime + 0.12) {
        const down = k % beats === 0;
        tone(down ? 1760 : 1100, next, 0.05, "square", down ? 0.55 : 0.35);
        times.push([next, k % beats]); next += 60 / bpm; k++;
      }
      while (times.length > 1 && times[1][0] <= c.currentTime) times.shift();
      const cur = times[0] && times[0][0] <= c.currentTime ? times[0][1] : -1;
      return Array.from({ length: beats }, (_, i) => (i === cur ? "●" : "○")).join(" ") + `   ${bpm} BPM · ${beats}/4`;
    });
  });

  // tap — узнать темп, отстукивая пробелом
  egg("tap bpm", "", "отстучи такт пробелом или Enter — консоль посчитает BPM", () => {
    const taps = [];
    let bpmNow = 0, flash = 0;
    dim("Стучи пробелом или Enter в такт. Esc — готово.");
    liveStart(20, () => {
      const t = performance.now();
      const mark = t - flash < 120 ? "●" : "○";
      return taps.length < 2 ? `${mark}  жду ударов…` : `${mark}  ${bpmNow} BPM  (${taps.length} ударов)`;
    }, {
      onKey: (e) => {
        if ((e.key !== " " && e.key !== "Enter") || inp.value.trim()) return false;
        const t = performance.now();
        if (taps.length && t - taps[taps.length - 1] > 2500) taps.length = 0;   // долгая пауза — считаем заново
        taps.push(t); if (taps.length > 12) taps.shift();
        flash = t;
        if (taps.length >= 2) bpmNow = Math.round((60000 * (taps.length - 1)) / (taps[taps.length - 1] - taps[0]));
        return true;
      },
      onStop: () => { if (bpmNow) ok(`Темп: ${bpmNow} BPM. metro ${bpmNow} — метроном в этом темпе.`); },
    });
  });

  // coffee / tea — 418
  egg("coffee tea кофе чай", "", "перерыв на чашку", () => {
    const S = ["   (  )   (\n    )  (   )\n   (  )  (", "    )  (   (\n   (  )   )\n    )  (  )", "   (   )  )\n    ) (  (\n   (   )  )"];
    const CUP = "\n  .---------.\n  |         |]\n  \\         /\n   `-------'";
    ok("418: я чайник. Но чашку налью.");
    liveStart(4, (n) => (n > 16 ? false : S[n % S.length] + CUP));
  });

  // vim / nano / emacs
  egg("vim vi nano emacs", "", "редактор", () => dim("Выходить из vim не придётся — его здесь нет. А из консоли выходят командой gui."));

  // rm — нельзя
  egg("rm del format", "", "ничего не удаляет", (a) => {
    if (a.join(" ").includes("/") || a.some((x) => /^-\w*r/.test(x))) { err("Хорошая попытка. Вместо этого — котик:"); return art(pick(CATS), "hl"); }
    err("rm: отказано в доступе. Музыку здесь только слушают.");
  });

  // sudo — с правами суперпользователя (нет)
  egg("sudo", "<команда>", "выполнить команду «от имени администратора»", async (a) => {
    if (!a.length) return dim("usage: sudo <команда>");
    dim(`[sudo] пароль для ${userName()}: ********`);
    if (/^(rm|del|format)$/i.test(a[0])) return err(`${userName()} нет в файле sudoers. Об этом инциденте будет доложено котику.`);
    if (a[0].toLowerCase() === "sudo") return err("sudo sudo? Ты и так главный.");
    const c = find(a[0]);
    if (!c) return err(`sudo: ${a[0]}: команда не найдена`);
    dim(pick(["Ладно, на этот раз без пароля.", "Принято, шеф.", "С правами суперпользователя!"]));
    await c.fn(a.slice(1));
  });

  // привет
  egg("hello hi привет", "", "поздороваться", () => {
    const h = new Date().getHours();
    ok(`${h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер"}, ${userName()}!`);
    dim(isPlaying() ? "Хороший трек, кстати." : pick(["Может, wave?", "Включим что-нибудь? search <запрос>", "Котик тоже здоровается: cat"]));
  });

  async function accountName() {
    try { const st = await ym("account_status"); return st?.account?.login || st?.account?.displayName || st?.account?.uid || null; } catch { return null; }
  }
  const sessionTime = () => fmtHM(Date.now() - performance.timeOrigin);

  egg("whoami", "", "кто я", async () => {
    const n = await accountName();
    line(n || userName(), "hl");
    dim(`${likedIds.size} ${plRu(likedIds.size, "трек", "трека", "треков")} в лайках`);
  });
  egg("uptime", "", "сколько открыт клиент", () => line(`up ${sessionTime()} · в очереди ${queue?.length || 0} · сейчас ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`));
  egg("ping", "", "проверить связь с Яндекс Музыкой", async () => {
    const t0 = performance.now();
    try { await ym("account_status"); ok(`pong · ${Math.round(performance.now() - t0)} мс`); }
    catch (e) { err("ping: нет ответа (" + (e?.message || e) + ")"); }
  });

  // fetch — карточка в духе neofetch
  egg("fetch neofetch", "", "карточка клиента в духе neofetch", async () => {
    const logo = [
      " __        __ ",
      " \\ \\      / / ",
      "  \\ \\ /\\ / /  ",
      "   \\ V  V /   ",
      "    \\_/\\_/    ",
      "              ",
      "  ~ whisper ~ ",
      "              ",
      "              ",
      "              ",
    ];
    const n = (await accountName()) || userName();
    const t = curT();
    let ver = "";
    try { ver = (await window.__TAURI__?.app?.getVersion?.()) || ""; } catch {}
    const styleName = (cfg.themes || []).find((x) => x.id === cfg.style)?.name || cfg.style;
    const info = [
      `${n}@whisper`,
      "-".repeat(n.length + 8),
      `Клиент: Whisper Edition${ver ? " " + ver : ""}`,
      `Стиль: ${styleName}`,
      `Трек: ${t ? cut(t.title + " — " + artistsOf(t), 44) : "—"}`,
      `Громкость: ${Math.round(volume * 100)}% · ${speed}×`,
      `Лайков: ${likedIds.size}`,
      `Очередь: ${queue?.length || 0}`,
      `Сессия: ${sessionTime()}`,
      "",
    ];
    art(logo.map((l, i) => l + "  " + (info[i] ?? "")).join("\n"), "fetch");
    const sw = line("", "art");
    sw.append(" ".repeat(16));
    for (const c of ["sw1", "sw2", "sw3", "sw4"]) { const s = document.createElement("span"); s.className = c; s.textContent = "███"; sw.append(s); }
  });

  const find = (name) => CMDS.find((c) => c.names.includes(String(name).toLowerCase()));

  function splitArgs(s) {
    const out2 = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
    while ((m = re.exec(s))) out2.push(m[1] ?? m[2] ?? m[3]);
    return out2;
  }
  async function run(raw) {
    const text = raw.trim();
    liveStop();
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
      if (live?.onKey?.(e)) { e.preventDefault(); return; }
      if (e.key === "Escape" && live) { e.preventDefault(); liveStop(); return; }
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
        const hits = [...new Set(CMDS.filter((c) => !c.hidden).flatMap((c) => c.names).filter((n) => n.startsWith(w.toLowerCase())))];
        if (hits.length === 1) inp.value = hits[0] + " ";
        else if (hits.length > 1) dim(hits.join("  "));
      } else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); liveStop(); out.textContent = ""; }
      else if (e.key === "c" && e.ctrlKey && inp.selectionStart === inp.selectionEnd) { e.preventDefault(); liveStop(); line(`${ps.textContent} ${inp.value}^C`, "cmd"); inp.value = ""; hpos = -1; }
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
      liveStop(); clearTimeout(partyTimer); el.classList.remove("party");
      document.body.classList.remove("cli-on");
    }
  };
  // запоминаем последний обычный стиль, чтобы «gui» возвращал к нему
  setInterval(() => { try { if (typeof cfg !== "undefined" && !hook("console")) localStorage.setItem(PREV_KEY, cfg.style); } catch {} }, 2000);
  try { window.cliMount(hook("console") || null); } catch {}
})();
