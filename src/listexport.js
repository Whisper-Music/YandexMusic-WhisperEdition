"use strict";
// Экспорт лайков и плейлистов в файл (правый щелчок → «Экспорт» → TXT / CSV / JSON, tmenu.js).
//   * TXT  — «Исполнитель - Название» по строке: так список принимают ручной импорт Яндекс Музыки
//            (music.yandex.ru/import), TuneMyMusic и Soundiiz («Из текста» / «Из файла»);
//   * CSV  — колонки TuneMyMusic: Track name, Artist name, Album, Playlist name, Type, ISRC (ISRC Яндекс не отдаёт —
//            пусто). Тот же файл понимают Soundiiz и другие переносчики; без BOM — с ним часть импортёров ломается;
//   * JSON — всё, что знаем о треке (номера Яндекса, альбом, год, длительность, ссылки) — для резервной копии и скриптов.
// Файл пишет Rust (export.rs → export_save, диалог «Сохранить как»); во вкладке браузера — обычное скачивание.
(() => {
  const FORMATS = {
    txt: { label: "Текст .txt", hint: "«Исполнитель - Название» по строке — для импорта в Яндекс Музыку, TuneMyMusic, Soundiiz" },
    csv: { label: "Таблица .csv", hint: "Колонки TuneMyMusic (название, исполнитель, альбом) — для TuneMyMusic, Soundiiz и Excel" },
    json: { label: "Данные .json", hint: "Все сведения о треках: номера Яндекса, альбом, год, длительность, ссылки" },
  };
  const isYa = (id) => /^\d+$/.test(String(id ?? ""));
  const artistsOf = (t) => (t.artists || []).map((a) => a?.name).filter(Boolean);
  const titleOf = (t) => (t.title || "") + (t.version ? ` (${t.version})` : "");
  const albumOf2 = (t) => (t.albums || [])[0] || null;
  // заглушка плейлиста «Трек недоступен» (plFetch) и пустые записи — не треки
  const real = (t) => t && t.title && !(t.title === "Трек недоступен" && !artistsOf(t).length);

  function txt(list) {
    return list.map((t) => { const a = artistsOf(t).join(", "); return a ? `${a} - ${titleOf(t)}` : titleOf(t); }).join("\n") + "\n";
  }
  const cell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function csv(list, meta) {
    const rows = [["Track name", "Artist name", "Album", "Playlist name", "Type", "ISRC"]];
    const type = meta.type === "likes" ? "Favorite" : "Playlist";
    for (const t of list) rows.push([titleOf(t), artistsOf(t).join(", "), albumOf2(t)?.title || "", meta.title, type, t.isrc || ""]);
    return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  }
  function json(list, meta) {
    const tracks = list.map((t) => {
      const al = albumOf2(t), id = isYa(t.id) ? String(t.id) : null, alId = al && isYa(al.id) ? String(al.id) : null;
      const o = { title: t.title || "", artists: artistsOf(t) };
      if (t.version) o.version = t.version;
      if (al?.title) o.album = al.title;
      if (al?.year) o.year = al.year;
      if (Number.isFinite(t.durationMs)) o.durationMs = t.durationMs;
      if (id) o.yandex = { trackId: id, albumId: alId, artistIds: (t.artists || []).map((a) => a?.id).filter(isYa).map(String) };
      if (id && alId) o.url = `https://music.yandex.ru/album/${alId}/track/${id}`;
      return o;
    });
    return JSON.stringify({
      format: "whisper-music-tracklist", version: 1, source: "yandex-music",
      type: meta.type, title: meta.title, exported: new Date().toISOString(), count: tracks.length, tracks,
    }, null, 2) + "\n";
  }

  // что выгружаем: { type: "likes" } или { type: "playlist", kind }
  async function load(what) {
    if (what.type === "likes") {
      const list = await loadAllLikes((n, total) => showToast(`Лайки загружаются: ${n} из ${total}…`, 0), () => false);
      if (!list) throw new Error("лайки не загрузились");
      return { title: "Мне нравится", type: "likes", list };
    }
    const kind = String(what.kind);
    const p = PL.full.get(kind) || (await plFetch(kind));
    return { title: p.title || "Плейлист", type: "playlist", list: p.list || [] };
  }
  let busy = false;
  async function run(what, fmt) {
    if (busy || !FORMATS[fmt]) return;
    busy = true;
    try {
      showToast("Список готовится…", 0);
      const meta = await load(what);
      const list = meta.list.filter(real);
      if (!list.length) { showToast("Выгружать нечего — в списке нет треков", 4000); return; }
      const text = fmt === "txt" ? txt(list) : fmt === "csv" ? csv(list, meta) : json(list, meta);
      const bytes = new TextEncoder().encode(text);
      const name = `${meta.title} — ${list.length} ${plural(list.length, ["трек", "трека", "треков"])}`;
      if (window.__WEB__) {
        const type = { txt: "text/plain", csv: "text/csv", json: "application/json" }[fmt] + ";charset=utf-8";
        const a = document.createElement("a"), url = URL.createObjectURL(new Blob([bytes], { type }));
        a.href = url; a.download = `${name}.${fmt}`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        hideToast();
        return;
      }
      const path = await window.__TAURI__.core.invoke("export_save", bytes, { headers: { "x-file-name": encodeURIComponent(name), "x-file-ext": fmt } });
      if (path) showToast(`Сохранено: ${path}`, 5000, { kind: "ok" }); else hideToast();
    } catch (e) {
      showToast("Не удалось выгрузить список: " + (e?.message || e), 6000, { kind: "err" });
    } finally { busy = false; }
  }
  window.listExport = { formats: FORMATS, run, _build: { txt, csv, json } };
})();
