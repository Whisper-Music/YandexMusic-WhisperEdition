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
    await save();
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
      const art = r.topTracks.find((x) => x.m.artists.some((a) => artistKey(a) === fa.k));
      c.append(mkImg(art ? cover(trackObj(art.id, art.m), "200x200") : "", "rnd"));
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
    // исполнители
    if (r.topArtists.length) {
      const b = box("Исполнители");
      const max = r.topArtists[0].ms;
      r.topArtists.forEach((x, i) => {
        const row = h("div", "lsrow");
        row.append(h("span", "lsn", String(i + 1)));
        const mid = h("div", "lsmid");
        mid.append(h("b", "", x.m.name));
        const bar = h("div", "lsbar"); const fill = h("i"); fill.style.width = (x.ms / max) * 100 + "%"; bar.append(fill);
        mid.append(bar);
        row.append(mid, h("span", "lsval", fmtHours(x.ms)));
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
    // жанры за период
    if (r.topGenres.length) {
      const b = box("Жанры");
      const stack = h("div", "lsstack"), legend = h("div", "lslegend");
      const colors = ["var(--accent)", "var(--accent2)", "color-mix(in srgb, var(--accent) 50%, var(--accent2))", "color-mix(in srgb, var(--accent) 55%, #fff)", "color-mix(in srgb, var(--accent2) 55%, #fff)", "rgba(255,255,255,.35)"];
      const gsum = Object.values(r.g).reduce((s, v) => s + v, 0);
      r.topGenres.forEach(([g, ms], i) => {
        const seg2 = h("i"); seg2.style.flex = String(ms); seg2.style.background = colors[i]; stack.append(seg2);
        const li = h("div", "lsleg"); const dot = h("i"); dot.style.background = colors[i];
        const nm = h("span", "", g); genreTitle(g).then((t) => { nm.textContent = t; seg2.title = t; });
        li.append(dot, nm, h("small", "", pct(ms, gsum) + "%"));
        legend.append(li);
      });
      b.append(stack, legend);
      grid2.append(b);
    }
    // когда слушаешь
    {
      const b = box("Когда слушаешь");
      const max = Math.max(...r.h, 1);
      const bars = h("div", "lshours");
      r.h.forEach((v, i) => { const c = h("i"); c.style.height = Math.max(3, (v / max) * 100) + "%"; c.title = `${i}:00 — ${fmtHM(v)}`; bars.append(c); });
      const axis = h("div", "lsaxis"); ["0", "6", "12", "18", "24"].forEach((x) => axis.append(h("span", "", x)));
      const peak = r.h.indexOf(Math.max(...r.h));
      b.append(bars, axis, h("p", "lscap", `Чаще всего — около ${peak}:00`));
      grid2.append(b);
    }
    host.append(grid2);

    // по дням (до 30 последних) или по месяцам (год, всё время)
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
        for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000), k = dayKey(d); buckets.push([String(d.getDate()), r.byDay[k] || 0, k]); }
      }
      const max = Math.max(...buckets.map((x) => x[1]), 1);
      const bars = h("div", "lsdays");
      for (const [lbl, v, k] of buckets) {
        const col = h("div", "lsday"); const bar = h("i"); bar.style.height = Math.max(2, (v / max) * 100) + "%";
        col.title = `${k}: ${fmtHM(v)}`; col.append(bar, h("small", "", lbl)); bars.append(col);
      }
      b.append(bars);
      host.append(b);
    }
  }

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
  const sw = document.getElementById("lsOn"), clr = document.getElementById("lsClear");
  if (sw) {
    sw.checked = on;
    sw.onchange = () => {
      on = sw.checked;
      try { localStorage.setItem(ON_KEY, on ? "1" : "0"); } catch {}
      if (on && !ready) load();
      if (!on) save();
    };
  }
  if (clr) clr.onclick = async () => {
    const ok = await modal({ title: "Очистить статистику?", text: "Вся записанная история прослушиваний будет удалена. Это нельзя отменить.", ok: "Очистить", danger: true });
    if (!ok) return;
    db = { v: 1, days: {}, tracks: {}, artists: {} }; sess = null; dirty = true; await save();
    showToast("Статистика очищена", 2500, { kind: "ok" });
  };
  if (on) load();
})();
