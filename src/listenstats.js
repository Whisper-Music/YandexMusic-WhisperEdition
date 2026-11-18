// Статистика прослушиваний (Настройки → Плеер → «Записывать статистику»).
//
// Пока галочка включена, раз в секунду считается, сколько реально играл текущий трек (пауза, буферизация
// и перемотка не в счёт), и всё складывается по дням: время, треки, исполнители, жанры, часы суток.
// Прослушиванием трек засчитывается после 30 секунд (или половины, если он короче).
// Хранится только на этом компьютере (IndexedDB), дни старше 400 дней удаляются.
// Страница «Статистика»: при включённой записи — прослушивания (и вкладка «Лайки» со старой статистикой),
// при выключенной — как раньше, только по лайкам.
(() => {
  const KEY = "lstats:v1", ON_KEY = "ym_lstats_on", KEEP_DAYS = 400;
  let on = false;
  try { on = localStorage.getItem(ON_KEY) === "1"; } catch {}
  let db = { v: 1, days: {}, tracks: {}, artists: {} };
  let ready = false, dirty = false;
  let sess = null;                 // { id, ms, counted, lastPos }
  let lastTick = 0;

  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const artistKey = (a) => (a?.id != null ? "i" + a.id : "n" + String(a?.name || "?"));

  async function load() {
    try {
      const v = await IDB.get(KEY);
      if (v && v.v === 1 && v.days) db = { v: 1, days: v.days || {}, tracks: v.tracks || {}, artists: v.artists || {} };
    } catch {}
    prune();
    ready = true;
  }
  function prune() {
    const cut = dayKey(new Date(Date.now() - KEEP_DAYS * 86400000));
    let changed = false;
    for (const k of Object.keys(db.days)) if (k < cut) { delete db.days[k]; changed = true; }
    if (!changed) return;
    const usedT = new Set(), usedA = new Set();
    for (const d of Object.values(db.days)) { Object.keys(d.t || {}).forEach((k) => usedT.add(k)); Object.keys(d.a || {}).forEach((k) => usedA.add(k)); }
    for (const k of Object.keys(db.tracks)) if (!usedT.has(k)) delete db.tracks[k];
    for (const k of Object.keys(db.artists)) if (!usedA.has(k)) delete db.artists[k];
    dirty = true;
  }
  async function save() {
    if (!dirty || !ready) return;
    dirty = false;
    try { await IDB.set(KEY, db); } catch { dirty = true; }
  }

  // ---------- запись ----------
  function credit(t, ms) {
    const id = String(t.id);
    const k = dayKey(), d = (db.days[k] ||= { ms: 0, h: new Array(24).fill(0), t: {}, p: {}, a: {}, g: {} });
    d.ms += ms;
    d.h[new Date().getHours()] += ms;
    d.t[id] = (d.t[id] || 0) + ms;
    for (const a of (t.artists || []).slice(0, 6)) {
      const ak = artistKey(a);
      d.a[ak] = (d.a[ak] || 0) + ms;
      if (!db.artists[ak]) db.artists[ak] = { id: a.id ?? null, name: String(a.name || "Неизвестный исполнитель") };
    }
    const genre = t.albums?.[0]?.genre;
    if (genre) d.g[genre] = (d.g[genre] || 0) + ms;
    if (!db.tracks[id] || !db.tracks[id].title) {
      db.tracks[id] = {
        title: String(t.title || "Без названия"),
        artists: (t.artists || []).slice(0, 6).map((a) => ({ id: a.id ?? null, name: String(a.name || "") })),
        coverUri: t.coverUri || "", albumId: t.albums?.[0]?.id ?? null, genre: genre || "", durationMs: t.durationMs || 0,
      };
    }
    dirty = true;
  }
  function countPlay(id) {
    const d = db.days[dayKey()];
    if (d) { d.p[id] = (d.p[id] || 0) + 1; dirty = true; }
  }
  function tick() {
    const now = Date.now(), dt = Math.min(2500, now - (lastTick || now));
    lastTick = now;
    if (!on || !ready) return;
    const t = typeof current === "number" && current >= 0 ? queue?.[current] : null;
    if (!t || !audio || audio.paused || needLoad) return;
    const pos = audio.currentTime || 0;
    const id = String(t.id);
    // новый трек или тот же заново с начала (повтор) — новое прослушивание
    if (!sess || sess.id !== id || (sess.lastPos > 10 && pos < 3)) sess = { id, ms: 0, counted: false, lastPos: pos };
    const moved = pos - sess.lastPos;
    sess.lastPos = pos;
    if (moved <= 0) return;                                 // стоит на месте: грузится или застрял
    const ms = Math.min(dt, moved * 1000 / Math.max(0.25, audio.playbackRate || 1) + 250);
    if (ms <= 0) return;
    credit(t, ms);
    sess.ms += ms;
    const need = Math.min(30000, (t.durationMs || 60000) / 2);
    if (!sess.counted && sess.ms >= need) { sess.counted = true; countPlay(id); }
  }
  setInterval(tick, 1000);
  setInterval(save, 20000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
  window.addEventListener("beforeunload", () => { save(); });
  window.__TAURI__?.event?.listen("power-save", () => save());

  // ---------- подсчёт за период ----------
  function aggregate(days) {
    const from = days ? dayKey(new Date(Date.now() - (days - 1) * 86400000)) : "";
    const r = { ms: 0, t: {}, p: {}, a: {}, g: {}, h: new Array(24).fill(0), byDay: {}, activeDays: 0 };
    for (const [k, d] of Object.entries(db.days)) {
      if (k < from) continue;
      r.ms += d.ms; r.byDay[k] = d.ms; if (d.ms > 60000) r.activeDays++;
      (d.h || []).forEach((v, i) => { r.h[i] += v || 0; });
      for (const [x, v] of Object.entries(d.t || {})) r.t[x] = (r.t[x] || 0) + v;
      for (const [x, v] of Object.entries(d.p || {})) r.p[x] = (r.p[x] || 0) + v;
      for (const [x, v] of Object.entries(d.a || {})) r.a[x] = (r.a[x] || 0) + v;
      for (const [x, v] of Object.entries(d.g || {})) r.g[x] = (r.g[x] || 0) + v;
    }
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
    // любимый трек: больше всего прослушиваний, при равенстве — дольше играл
    r.topTracks = Object.keys(r.t)
      .map((id) => ({ id, ms: r.t[id], plays: r.p[id] || 0, m: db.tracks[id] }))
      .filter((x) => x.m)
      .sort((a, b) => b.plays - a.plays || b.ms - a.ms)
      .slice(0, 10);
    r.topArtists = top(r.a, 10).map(([k, ms]) => ({ k, ms, m: db.artists[k] })).filter((x) => x.m);
    r.topGenres = top(r.g, 6);
    r.uniqTracks = Object.keys(r.t).length;
    r.uniqArtists = Object.keys(r.a).length;
    return r;
  }

  // ---------- страница ----------
  const PERIODS = [["7", "7 дней"], ["30", "30 дней"], ["365", "Год"], ["0", "Всё время"]];
  let period = "30", view = "listen";
  try { period = localStorage.getItem("ym_lstats_period") || "30"; } catch {}

  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const trackObj = (id, m) => ({ id, title: m.title, coverUri: m.coverUri, durationMs: m.durationMs, artists: m.artists.map((a) => ({ id: a.id ?? undefined, name: a.name })), albums: m.albumId != null ? [{ id: m.albumId, genre: m.genre }] : [] });
  const artistLine = (m) => m.artists.map((a) => a.name).filter(Boolean).join(", ");
  const pct = (part, all) => (all ? Math.max(1, Math.round((part / all) * 100)) : 0);

  function box(title, cls = "") { const b = h("div", "card stbox lsbox " + cls); b.append(h("h3", "", title)); return b; }

  async function render(host, my) {
    host.textContent = "";
    save();             // всё уже в памяти (db) — сохраняем в фоне, страницу рисуем не дожидаясь записи в IndexedDB
    const days = +period || 0, r = aggregate(days);
    const label = PERIODS.find((p) => p[0] === period)?.[1] || "";

    // период
    const seg = h("div", "lsperiod");
    for (const [v, t] of PERIODS) {
      const b = h("button", "chip" + (v === period ? " active" : ""), t);
      b.type = "button";
      b.onclick = () => { period = v; try { localStorage.setItem("ym_lstats_period", v); } catch {} render(host, my); };
      seg.append(b);
    }
    host.append(seg);
    // «Скачать PDF» — в ряду периодов справа (когда есть что выгружать)
    if (r.ms >= 60000) {
      const ex = h("button", "chip lsexport", "⤓ Скачать PDF");
      ex.type = "button"; ex.title = "Открытка со статистикой за этот период: время, любимые трек, исполнители и жанры";
      ex.onclick = () => exportPdf(ex);
      seg.append(ex);
    }

    if (r.ms < 60000) {
      const e = h("div", "card lsempty");
      e.append(h("b", "", Object.keys(db.days).length ? `За ${label.toLowerCase()} почти ничего не слушалось` : "Статистика только начала записываться"),
        h("span", "", "Включи музыку — время, исполнители, треки и жанры появятся здесь."));
      host.append(e);
      return;
    }

    // главное
    const cards = h("div", "statcards lscards");
    cards.append(
      statCard(ICONS.clock, "Прослушано", fmtHM(r.ms)),
      statCard(ICONS.heart, "Разных треков", fmtInt(r.uniqTracks)),
      statCard(ICONS.star, days ? "В среднем за день" : "Дней с музыкой", days ? fmtHM(r.ms / Math.max(1, Math.min(days, Object.keys(r.byDay).length || 1))) : fmtInt(r.activeDays)),
    );
    host.append(cards);

    // любимое: трек, исполнитель, жанр
    const fav = h("div", "lsfav");
    const ft = r.topTracks[0];
    if (ft) {
      const c = h("div", "card lshero");
      const img = mkImg(cover(trackObj(ft.id, ft.m), "200x200"));
      const tx = h("div", "lshtx");
      tx.append(h("small", "", "Любимый трек"), h("b", "", ft.m.title), h("span", "", artistLine(ft.m)),
        h("em", "", `${fmtInt(ft.plays)} ${plRu(ft.plays, "прослушивание", "прослушивания", "прослушиваний")} · ${fmtHours(ft.ms)}`));
      const pl = h("button", "lsplay"); pl.type = "button"; pl.title = "Включить";
      pl.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
      pl.onclick = () => { wave.on = false; queue = [trackObj(ft.id, ft.m)]; playCtx = "other"; play(0); };
      c.append(img, tx, pl);
      fav.append(c);
    }
    const fa = r.topArtists[0];
    if (fa) {
      const c = h("div", "card lsmini");
      // аватар исполнителя: сохранённый → пока грузится, обложка его трека → настоящий из artist_brief
      const art = r.topTracks.find((x) => x.m.artists.some((a) => artistKey(a) === fa.k));
      const av = mkImg(fa.m.cover ? cover({ coverUri: fa.m.cover }, "200x200") : art ? cover(trackObj(art.id, art.m), "200x200") : "", "rnd");
      c.append(av);
      if (fa.m.id != null && typeof loadArtist === "function" && !offline) {
        loadArtist(fa.m.id).then(({ info }) => {
          const u = info?.artist?.cover?.uri || info?.artist?.ogImage;
          if (!u) return;
          if (my === nav) av.src = cover({ coverUri: u }, "200x200");
          if (db.artists[fa.k] && db.artists[fa.k].cover !== u) { db.artists[fa.k].cover = u; dirty = true; }
        }).catch(() => {});
      }
      const tx = h("div", "lshtx");
      tx.append(h("small", "", "Любимый исполнитель"), h("b", "", fa.m.name), h("em", "", `${fmtHours(fa.ms)} · ${pct(fa.ms, r.ms)}% времени`));
      c.append(tx);
      if (fa.m.id != null) { c.classList.add("click"); c.onclick = () => navigate(() => showArtist(fa.m.id)); }
      fav.append(c);
    }
    // жанр — всегда за последние 30 дней (если выбран другой период — подпись это говорит)
    const g30 = days === 30 ? r : aggregate(30);
    const fg = Object.entries(g30.g).sort((a, b) => b[1] - a[1])[0];
    if (fg) {
      const c = h("div", "card lsmini lsgenre");
      const tx = h("div", "lshtx");
      const name = h("b", "", fg[0]);
      tx.append(h("small", "", "Любимый жанр за месяц"), name, h("em", "", `${fmtHours(fg[1])} · ${pct(fg[1], g30.ms)}% времени`));
      c.append(h("i", "lsgicon", "♪"), tx);
      fav.append(c);
      genreTitle(fg[0]).then((t) => { if (my === nav) name.textContent = t; });
    }
    host.append(fav);

    const grid = h("div", "statgrid lsgrid");
    // исполнители — плотным списком: обложка его самого слушаемого трека, сколько разных треков и прослушиваний,
    // время и доля от всего времени; полоска — относительно первого места
    if (r.topArtists.length) {
      const b = box("Исполнители");
      const asum = Object.values(r.a).reduce((s, v) => s + v, 0) || 1, max = r.topArtists[0].ms;
      const per = {};          // ключ исполнителя → { tracks, plays, best: [id, ms] }
      for (const [id, ms] of Object.entries(r.t)) {
        const m = db.tracks[id]; if (!m) continue;
        for (const a of m.artists) {
          const x = (per[artistKey(a)] ||= { tracks: 0, plays: 0, best: null });
          x.tracks++; x.plays += r.p[id] || 0;
          if (!x.best || ms > x.best[1]) x.best = [id, ms];
        }
      }
      r.topArtists.forEach((x, i) => {
        const s = per[x.k] || { tracks: 0, plays: 0, best: null }, bm = s.best && db.tracks[s.best[0]];
        const row = h("div", "lsrow lsartist");
        row.append(h("span", "lsn", String(i + 1)), mkImg(bm ? cover(trackObj(s.best[0], bm), "100x100") : "", "rnd"));
        const mid = h("div", "lsmid");
        const meta = [`${fmtInt(s.tracks)} ${plRu(s.tracks, "трек", "трека", "треков")}`];
        if (s.plays) meta.push(`${fmtInt(s.plays)} ${plRu(s.plays, "прослушивание", "прослушивания", "прослушиваний")}`);
        const bar = h("div", "lsbar"); const fill = h("i"); fill.style.width = (x.ms / max) * 100 + "%"; bar.append(fill);
        mid.append(h("b", "", x.m.name), h("span", "", meta.join(" · ")), bar);
        const val = h("div", "lsval lsval2");
        val.append(h("b", "", fmtHours(x.ms)), h("small", "", pct(x.ms, asum) + "%"));
        row.append(mid, val);
        if (x.m.id != null) { row.classList.add("click"); row.onclick = () => navigate(() => showArtist(x.m.id)); }
        b.append(row);
      });
      grid.append(b);
    }
    // треки
    if (r.topTracks.length) {
      const b = box("Треки");
      r.topTracks.forEach((x, i) => {
        const row = h("div", "lsrow lstrack click");
        row.append(h("span", "lsn", String(i + 1)), mkImg(cover(trackObj(x.id, x.m), "100x100")));
        const mid = h("div", "lsmid");
        mid.append(h("b", "", x.m.title), h("span", "", artistLine(x.m)));
        row.append(mid, h("span", "lsval", `${fmtInt(x.plays)} ${plRu(x.plays, "раз", "раза", "раз")}`));
        row.title = fmtHours(x.ms);
        row.onclick = () => { wave.on = false; queue = r.topTracks.map((y) => trackObj(y.id, y.m)); playCtx = "other"; play(i); };
        b.append(row);
      });
      grid.append(b);
    }
    host.append(grid);

    const grid2 = h("div", "statgrid lsgrid");
    // жанры за период — кольцом; над ним — «кто ты по жанрам» (по всей истории, открывается с 40 часов музыки)
    if (r.topGenres.length) {
      const b = box("Жанры");
      b.append(whoCard(my));
      const top = r.topGenres.slice(0, 5), gsum = Object.values(r.g).reduce((s, v) => s + v, 0), n = Object.keys(r.g).length;
      const parts = top.map(([g, ms]) => ({ label: g, ms, slug: g }));
      const rest = gsum - top.reduce((s, x) => s + x[1], 0);
      if (rest > 0) parts.push({ label: "Остальные", ms: rest, color: REST });
      b.append(donut(parts, fmtInt(n), plRu(n, "жанр", "жанра", "жанров")));
      for (const p of parts) if (p.slug) genreTitle(p.slug).then((t) => { p.nameEl.textContent = t; p.titleEl.textContent = `${t} — ${fmtHours(p.ms)}`; });
      grid2.append(b);
    }
    // когда слушаешь — кольцо по времени суток, в середине — самый «музыкальный» час
    {
      const b = box("Когда слушаешь");
      const span = (a, z) => r.h.slice(a, z).reduce((s, v) => s + (v || 0), 0);
      const parts = [["Утро · 6–12", 6, 12], ["День · 12–18", 12, 18], ["Вечер · 18–24", 18, 24], ["Ночь · 0–6", 0, 6]]
        .map(([label, a, z]) => ({ label, ms: span(a, z) })).filter((p) => p.ms > 0);
      const peak = r.h.indexOf(Math.max(...r.h));
      b.append(donut(parts, `${peak}:00`, "чаще всего"));
      grid2.append(b);
    }
    host.append(grid2);

    // по дням (до 30 последних) или по месяцам (год, всё время): плитки, на каждой — время цифрами,
    // чем больше слушалось, тем плитка ярче
    {
      const monthly = !days || days > 31;
      const b = box(monthly ? "По месяцам" : "По дням", "lsactivity");
      const buckets = [];
      if (monthly) {
        const m = {};
        for (const [k, v] of Object.entries(r.byDay)) m[k.slice(0, 7)] = (m[k.slice(0, 7)] || 0) + v;
        const keys = Object.keys(m).sort().slice(-12);
        for (const k of keys) buckets.push([new Date(k + "-01").toLocaleDateString("ru-RU", { month: "short" }), m[k], k]);
      } else {
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000), k = dayKey(d);
          buckets.push([days <= 7 ? `${d.toLocaleDateString("ru-RU", { weekday: "short" })} ${d.getDate()}` : String(d.getDate()), r.byDay[k] || 0, k]);
        }
      }
      const max = Math.max(...buckets.map((x) => x[1]), 1);
      const tiles = h("div", "lstiles" + (monthly ? " months" : days <= 7 ? " week" : ""));
      for (const [lbl, v, k] of buckets) {
        const none = v < 60000;
        const t = h("div", "lstile" + (none ? " zero" : ""));
        t.style.setProperty("--k", none ? "0" : (v / max).toFixed(3));
        t.title = `${k}: ${fmtHM(v)}`;
        t.append(h("small", "", lbl), h("b", "", none ? "—" : tileNum(v, monthly)));
        tiles.append(t);
      }
      b.append(tiles, h("p", "lscap", monthly ? "На плитке — сколько часов набралось за месяц" : "На плитке — часы:минуты за день"));
      host.append(b);
    }
  }

  // ---------- кольца ----------
  const REST = "rgba(255,255,255,.22)";
  const PIE = ["var(--accent)", "var(--accent2)", "color-mix(in srgb, var(--accent) 50%, var(--accent2))",
    "color-mix(in srgb, var(--accent) 55%, #fff)", "color-mix(in srgb, var(--accent2) 55%, #fff)", "color-mix(in srgb, var(--accent) 60%, #000)"];
  const svgEl = (tag, attrs) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };
  // время на плитке: за день — «1:25», за месяц — «37 ч»
  const tileNum = (ms, monthly) => {
    const m = Math.round(ms / 60000);
    if (!monthly) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
    return m < 60 ? `${m} м` : `${Math.round(m / 60)} ч`;
  };
  // parts: [{ label, ms, color?, onClick? }] — кольцо с подписью в середине и легенда справа (время и доля).
  // Каждой части дописывает nameEl (подпись в легенде) и titleEl (подсказка сектора): название жанра приходит позже.
  // Окружность r = 15.9155 — длиной ровно 100, поэтому длина сектора равна его доле в процентах.
  function donut(parts, center, sub) {
    const sum = parts.reduce((s, p) => s + p.ms, 0) || 1;
    const wrap = h("div", "lspie"), ring = h("div", "lsring"), legend = h("div", "lslegend lspielegend");
    const svg = svgEl("svg", { viewBox: "0 0 42 42", "aria-hidden": "true" });
    svg.append(svgEl("circle", { class: "lsringbg", cx: 21, cy: 21, r: 15.9155, fill: "none", "stroke-width": 5 }));
    let done = 0;
    parts.forEach((p, i) => {
      const share = (p.ms / sum) * 100, len = Math.max(0.4, share - (parts.length > 1 ? 0.7 : 0)), color = p.color || PIE[i % PIE.length];
      const c = svgEl("circle", { cx: 21, cy: 21, r: 15.9155, fill: "none", "stroke-width": 5, "stroke-dasharray": `${len} ${100 - len}`, "stroke-dashoffset": 25 - done });
      c.style.stroke = color;                        // начало — сверху (смещение 25), дальше по часовой
      p.titleEl = svgEl("title"); p.titleEl.textContent = `${p.label} — ${fmtHours(p.ms)}`; c.append(p.titleEl);
      svg.append(c);
      done += share;
      const li = h("div", "lsleg" + (p.onClick ? " click" : "")), dot = h("i"); dot.style.background = color;
      p.nameEl = h("span", "", p.label);
      li.append(dot, p.nameEl, h("small", "", `${fmtHours(p.ms)} · ${pct(p.ms, sum)}%`));
      if (p.onClick) li.onclick = p.onClick;
      legend.append(li);
    });
    const mid = h("div", "lsringmid"); mid.append(h("b", "", center), h("small", "", sub));
    ring.append(svg, mid); wrap.append(ring, legend);
    return wrap;
  }

  // ---------- «кто ты по жанрам» ----------
  // Звание — по самому слушаемому жанру за всю историю; открывается, когда набралось 40 часов музыки.
  // Таблица — по названию жанра у Яндекса (rusrap, local-indie, phonkgenre…); порядок важен: частное выше общего.
  const WHO_MS = 40 * 3600000;
  const WHO = [
    [/phonk/, "Фонкер", "бас качает, дрифт в голове"],
    [/hyperpop/, "Гиперпоп-кид", "быстрее, громче, ярче"],
    [/metal|hardcore|gothic|industrial/, "Металлист", "чем тяжелее, тем лучше"],
    [/punk|emo|ska/, "Панк", "три аккорда и правда"],
    [/rap|hip|trap/, "Рэп-голова", "бит, панчи и ничего лишнего"],
    [/indie/, "Инди-кид", "знаешь группы, о которых ещё не слышали"],
    [/altern|grunge|postrock|stoner/, "Альтернативщик", "мимо главной дороги"],
    [/rock|rnr|prog/, "Рокер", "гитары решают"],
    [/techno|house|trance|dnb|dubstep|dance|electr|edm|breakbeat|bass|triphop/, "Рейвер", "танцпол всегда с тобой"],
    [/jazz|blues|swing/, "Джазмен", "импровизация — твой язык"],
    [/classic|opera|vocal/, "Ценитель классики", "музыка, проверенная веками"],
    [/relax|lounge|ambient|newage|meditat|lo-?fi/, "Мастер чилла", "спокойствие, только спокойствие"],
    [/soundtrack|films|tvseries|videogame|animated|musical/, "Саундтрек-маньяк", "у твоей жизни есть музыка за кадром"],
    [/rnb|soul|funk|disco/, "Душа соула", "грув в крови"],
    [/reggae|dub|latin|african|caucasian|eastern|world/, "Гражданин мира", "музыка без границ"],
    [/folk|bard|shanson|country|estrada/, "Душа компании", "песни, которые знают все"],
    [/k-?pop|j-?pop|asia/, "Кей-поп стэн", "биас выбран, альбомы собраны"],
    [/pop/, "Поп-душа", "хиты — это про тебя"],
  ];
  function whoOf(g) {
    const list = Object.entries(g).sort((a, b) => b[1] - a[1]), sum = list.reduce((s, x) => s + x[1], 0);
    if (!list.length || !sum) return null;
    const [slug, ms] = list[0], share = ms / sum;
    // ни один жанр не набрал и трети — не «рокер», а всеядный
    if (share < 0.3 && list.length >= 4) return { title: "Всеядный меломан", line: "слушаешь всё подряд — и это прекрасно", slug, share };
    const hit = WHO.find(([re]) => re.test(slug));
    return { title: hit ? hit[1] : "Меломан", line: hit ? hit[2] : "музыка — твоя стихия", slug, share };
  }
  function whoCard(my) {
    const all = aggregate(0), c = h("div", "lswho");
    c.append(h("small", "", "Кто ты по жанрам"));
    if (all.ms < WHO_MS) {
      c.classList.add("locked");
      const bar = h("div", "lsbar"), fill = h("i"); fill.style.width = Math.max(2, (all.ms / WHO_MS) * 100) + "%"; bar.append(fill);
      c.append(h("b", "", "Откроется на 40 часах музыки"), bar, h("em", "", `Осталось ${fmtHM(WHO_MS - all.ms)}`));
      return c;
    }
    const w = whoOf(all.g);
    if (!w) { c.hidden = true; return c; }
    const em = h("em", "", w.line);
    c.append(h("b", "", w.title), em);
    genreTitle(w.slug).then((t) => { if (my === nav) em.textContent = `${w.line} · ${Math.round(w.share * 100)}% времени — ${t}`; });
    return c;
  }

  // ---------- выгрузка в PDF ----------
  // Открытка со статистикой за выбранный период: рисуется на холсте (фон — размытая обложка любимого трека или
  // фото любимого исполнителя), сжимается в JPEG и заворачивается в одностраничный PDF формата A4.
  // Картинки качает Rust (fetch_bytes) — так холст остаётся «своим» и его можно сохранить. Файл пишет Rust export_save (export.rs).
  async function loadPic(url) {
    if (!url || offline) return null;
    try { return await createImageBitmap(new Blob([await invoke("fetch_bytes", { url })])); } catch { return null; }
  }
  async function poster(r, label) {
    const W = 1240, H = 1754, P = 88, CW = W - 2 * P;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    const cs = getComputedStyle(document.documentElement);
    const A = cs.getPropertyValue("--accent").trim() || "#a66bff", B = cs.getPropertyValue("--accent2").trim() || "#e060ff";
    const face = getComputedStyle(document.body).fontFamily || "sans-serif";
    const ft = r.topTracks[0], fa = r.topArtists[0];
    const [pic, apic, gnames] = await Promise.all([
      loadPic(ft ? cover(trackObj(ft.id, ft.m), "1000x1000") : ""),
      loadPic(fa?.m.cover ? cover({ coverUri: fa.m.cover }, "400x400") : ""),
      Promise.all(r.topGenres.slice(0, 5).map(([g]) => genreTitle(g))),
    ]);
    // фон: обложка во весь лист, размыта и затемнена книзу — текст читается на любой картинке
    x.fillStyle = "#0d0b14"; x.fillRect(0, 0, W, H);
    const bgp = pic || apic;
    if (bgp) {
      const k = Math.max(W / bgp.width, H / bgp.height) * 1.18, w = bgp.width * k, hh = bgp.height * k;
      x.filter = "blur(38px) saturate(1.25)"; x.drawImage(bgp, (W - w) / 2, (H - hh) / 2, w, hh); x.filter = "none";
    } else {
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, A); g.addColorStop(1, B);
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
    const sh = x.createLinearGradient(0, 0, 0, H);
    sh.addColorStop(0, "rgba(8,6,14,.5)"); sh.addColorStop(0.42, "rgba(8,6,14,.72)"); sh.addColorStop(1, "rgba(8,6,14,.92)");
    x.fillStyle = sh; x.fillRect(0, 0, W, H);

    const MUTED = "rgba(255,255,255,.66)";
    const fit = (s, max) => { s = String(s); if (x.measureText(s).width <= max) return s; while (s.length > 1 && x.measureText(s + "…").width > max) s = s.slice(0, -1); return s + "…"; };
    const text = (s, px, X, Y, { w = 600, color = "#fff", max = CW, align = "left" } = {}) => {
      x.font = `${w} ${px}px ${face}`; x.fillStyle = color; x.textAlign = align; x.fillText(fit(s, max), X, Y);
    };
    const plate = (X, Y, w, hh, rad = 28) => { x.beginPath(); x.roundRect(X, Y, w, hh, rad); x.fillStyle = "rgba(255,255,255,.085)"; x.fill(); };
    const T = (s) => window.i18n?.t?.(s) ?? s;

    // шапка
    text("WHISPER MUSIC", 24, P, 128, { w: 700, color: B });
    text(new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }), 24, W - P, 128, { color: MUTED, align: "right" });
    text(T("Моя музыка"), 86, P, 246, { w: 800 });
    text(`${T("за")} ${label.toLowerCase()}`, 34, P, 304, { color: MUTED });
    // главное число
    text(fmtHM(r.ms), 124, P, 480, { w: 800 });
    text(T("прослушано"), 30, P, 532, { color: MUTED });
    // три числа в ряд
    const trio = [[fmtInt(r.uniqTracks), plRu(r.uniqTracks, "трек", "трека", "треков")], [fmtInt(r.uniqArtists), plRu(r.uniqArtists, "исполнитель", "исполнителя", "исполнителей")],
      [fmtInt(r.activeDays), plRu(r.activeDays, "день с музыкой", "дня с музыкой", "дней с музыкой")]];
    trio.forEach(([n, cap], i) => {
      const X = P + (CW / 3) * i;
      text(n, 60, X, 660, { w: 800, max: CW / 3 - 20 }); text(cap, 24, X, 698, { color: MUTED, max: CW / 3 - 20 });
    });
    // кто ты по жанрам — если уже открылось
    let y = 760;
    const all = aggregate(0), who = all.ms >= WHO_MS ? whoOf(all.g) : null;
    if (who) {
      x.font = `800 34px ${face}`;
      const tw = x.measureText(who.title).width + 56;
      x.beginPath(); x.roundRect(P, y, tw, 62, 31); x.fillStyle = A; x.globalAlpha = 0.9; x.fill(); x.globalAlpha = 1;
      text(who.title, 34, P + 28, y + 43, { w: 800 });
      text(who.line, 26, P + tw + 22, y + 41, { color: MUTED, max: CW - tw - 22 });
      y += 96;
    }
    // любимый трек
    if (ft) {
      plate(P, y, CW, 196);
      const S = 148, cx = P + 24, cy = y + 24;
      if (pic) { x.save(); x.beginPath(); x.roundRect(cx, cy, S, S, 20); x.clip(); x.drawImage(pic, cx, cy, S, S); x.restore(); }
      else { x.beginPath(); x.roundRect(cx, cy, S, S, 20); x.fillStyle = A; x.fill(); }
      const tx = cx + S + 30, tm = CW - S - 84;
      text(T("Любимый трек"), 22, tx, y + 54, { color: MUTED, max: tm });
      text(ft.m.title, 40, tx, y + 104, { w: 800, max: tm });
      text(artistLine(ft.m), 28, tx, y + 142, { color: MUTED, max: tm });
      text(`${fmtInt(ft.plays)} ${plRu(ft.plays, "прослушивание", "прослушивания", "прослушиваний")} · ${fmtHours(ft.ms)}`, 22, tx, y + 176, { color: B, max: tm });
      y += 196 + 34;
    }
    // две колонки: исполнители и жанры
    const colW = (CW - 34) / 2, rows = 5, rowH = 58, boxH = 84 + rows * rowH;
    const gsum = Object.values(r.g).reduce((s, v) => s + v, 0);
    const col = (X, title, list) => {
      plate(X, y, colW, boxH);
      text(title, 28, X + 28, y + 52, { w: 800 });
      list.forEach(([name, val], i) => {
        const yy = y + 108 + i * rowH;
        text(String(i + 1), 24, X + 28, yy, { color: MUTED });
        x.font = `600 24px ${face}`; const vw = x.measureText(val).width;
        text(name, 26, X + 66, yy, { max: colW - 66 - 28 - vw - 18 });
        text(val, 24, X + colW - 28, yy, { color: MUTED, align: "right" });
      });
    };
    col(P, T("Исполнители"), r.topArtists.slice(0, rows).map((a) => [a.m.name, fmtHours(a.ms)]));
    col(P + colW + 34, T("Жанры"), r.topGenres.slice(0, rows).map(([, ms], i) => [gnames[i], pct(ms, gsum) + "%"]));
    y += boxH + 34;
    // ещё треки и «когда слушаешь» — если осталось место
    const more = r.topTracks.slice(1, 4);
    if (more.length && y + 84 + more.length * rowH < H - 150) {
      const bh = 84 + more.length * rowH;
      plate(P, y, CW, bh);
      text(T("Ещё любимые треки"), 28, P + 28, y + 52, { w: 800 });
      more.forEach((t, i) => {
        const yy = y + 108 + i * rowH, val = `${fmtInt(t.plays)} ${plRu(t.plays, "раз", "раза", "раз")}`;
        text(String(i + 2), 24, P + 28, yy, { color: MUTED });
        x.font = `600 24px ${face}`; const vw = x.measureText(val).width;
        text(`${t.m.title} — ${artistLine(t.m)}`, 26, P + 66, yy, { max: CW - 66 - 28 - vw - 18 });
        text(val, 24, W - P - 28, yy, { color: MUTED, align: "right" });
      });
      y += bh + 34;
    }
    const peak = r.h.indexOf(Math.max(...r.h));
    if (y < H - 150) text(`${T("Чаще всего музыка играет около")} ${peak}:00`, 26, P, y + 30, { color: MUTED });
    text(T("Собрано в Whisper Music"), 22, P, H - 64, { color: "rgba(255,255,255,.5)" });
    return c;
  }
  // PDF из одной картинки JPEG: страница A4, картинка во весь лист. Название файла — в сведениях документа (UTF-16).
  function pdfFromJpeg(jpg, wpx, hpx, title) {
    const enc = new TextEncoder(), parts = [], offs = [];
    let len = 0;
    const put = (v) => { const b = typeof v === "string" ? enc.encode(v) : v; parts.push(b); len += b.length; };
    const obj = (n, body) => { offs[n] = len; put(`${n} 0 obj\n${body}\nendobj\n`); };
    const PW = 595.28, PH = 841.89;
    put("%PDF-1.4\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    offs[4] = len;
    put(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${wpx} /Height ${hpx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    put(jpg); put("\nendstream\nendobj\n");
    const draw = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    obj(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    const hex = "FEFF" + [...title].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase();
    obj(6, `<< /Title <${hex}> /Creator (Whisper Music) >>`);
    const xref = len;
    put("xref\n0 7\n0000000000 65535 f \n" + [1, 2, 3, 4, 5, 6].map((n) => String(offs[n]).padStart(10, "0") + " 00000 n \n").join(""));
    put(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len);
    let o = 0;
    for (const b of parts) { out.set(b, o); o += b.length; }
    return out;
  }
  let exporting = false;
  // btn — кнопка «⤓ Скачать PDF» (из меню по правому щелчку зовут без неё: берём ту, что на странице, если есть)
  async function exportPdf(btn = document.querySelector("#lsBody .lsexport")) {
    if (exporting) return;
    exporting = true;
    const old = btn?.textContent;
    if (btn) { btn.textContent = "Готовится…"; btn.disabled = true; }
    else showToast("Статистика готовится…", 2500);
    try {
      const days = +period || 0, r = aggregate(days), label = PERIODS.find((p) => p[0] === period)?.[1] || "";
      const cv = await poster(r, label);
      const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.92));
      if (!blob) throw new Error("не получилось собрать картинку");
      const name = `Whisper Music — статистика, ${label.toLowerCase()} (${dayKey()})`;
      const pdf = pdfFromJpeg(new Uint8Array(await blob.arrayBuffer()), cv.width, cv.height, name);
      if (window.__WEB__) {
        // браузерная версия: обычное скачивание файла вкладкой
        const a = document.createElement("a"), url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
        a.href = url; a.download = name + ".pdf"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else {
        const path = await window.__TAURI__.core.invoke("export_save", pdf, { headers: { "x-file-name": encodeURIComponent(name), "x-file-ext": "pdf" } });
        if (path) showToast("Статистика сохранена: " + path, 5000, { kind: "ok" });
      }
    } catch (e) { showToast("Не удалось сохранить статистику: " + (e?.message || e), 6000, { kind: "err" }); }
    finally { exporting = false; if (btn) { btn.textContent = old; btn.disabled = false; } }
  }
  // меню по правому щелчку (tmenu.js → pageMenu): первым пунктом на странице прослушиваний, когда есть что выгружать
  window.lstatsPdf = {
    ready: () => { const b = document.getElementById("lsBody"); return !!b && !b.hidden && !!b.offsetParent && !!b.querySelector(".lsexport"); },
    save: () => exportPdf(),
  };

  // для консоли (cli.js): включена ли запись и данные за период
  window.lstatsApi = { on: () => on, data: async (days) => { if (!ready) await load(); await save(); return aggregate(days); } };

  // вызывается из showStats (main.js): true — страницу нарисовали здесь
  window.lstatsShow = async (my) => {
    if (!on) return false;
    if (!ready) await load();
    if (my !== nav) return true;
    setChips([["listen", "Прослушивания"], ["likes", "Лайки"]], view, (v) => { view = v; showStats(); });
    if (view === "likes") return false;          // старая статистика по лайкам
    const host = $("#lsBody");
    host.hidden = false;
    $("#stNote").textContent = "";
    await render(host, my);
    return true;
  };

  // ---------- настройки ----------
  // #lstOn, а не #lsOn: тот же id был у выключателя синхронизации (libsync.js) — запись статистики цеплялась к нему,
  // и «Записывать статистику» не сохранялась
  const sw = document.getElementById("lstOn"), clr = document.getElementById("lsClear");
  if (sw) {
    sw.checked = on;
    sw.onchange = () => {
      on = sw.checked;
      try { localStorage.setItem(ON_KEY, on ? "1" : "0"); } catch {}
      if (on && !ready) load();
      if (!on) save();
    };
  }
  // кнопка «Статистика» в боковой панели (Настройки → Интерфейс → «Панели»); записывать можно и без неё
  const BTN_KEY = "ym_stats_btn";
  let btnOn = (() => { try { return localStorage.getItem(BTN_KEY) !== "0"; } catch { return true; } })();
  const sbtn = document.getElementById("statsBtnOn");
  function applyBtn() {
    document.documentElement.classList.toggle("no-statsbtn", !btnOn);
    if (sbtn) sbtn.checked = btnOn;
    // открыта сама статистика — уходим в лайки, иначе страница осталась бы без своей кнопки
    if (!btnOn && document.querySelector(".main")?.dataset.page === "statsBtn") document.getElementById("likes")?.click();
  }
  if (sbtn) sbtn.onchange = () => {
    btnOn = sbtn.checked;
    try { localStorage.setItem(BTN_KEY, btnOn ? "1" : "0"); } catch {}
    applyBtn();
  };
  applyBtn();
  if (clr) clr.onclick = async () => {
    const ok = await modal({ title: "Очистить статистику?", text: "Вся записанная история прослушиваний будет удалена. Это нельзя отменить.", ok: "Очистить", danger: true });
    if (!ok) return;
    db = { v: 1, days: {}, tracks: {}, artists: {} }; sess = null; dirty = true; await save();
    showToast("Статистика очищена", 2500, { kind: "ok" });
  };
  if (on) load();
})();
