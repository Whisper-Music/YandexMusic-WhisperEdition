// libsync.js — синхронизация своих треков через Whisper Archive: всё, что лежит в студии (по ссылке с YouTube,
// SoundCloud, из видео ВК, свои файлы, обрезки, замены треков Яндекса), уходит в библиотеку архива вместе с файлом,
// лайком и временем лайка — на телефоне и другом компьютере та же картина: те же треки на тех же местах в «Лайках».
// Сервер — /api/library (описание: docs/LIBRARY-SYNC.md в репозитории архива), Rust — whisper/library.rs (ядро:
// wa_lib_list, wa_lib_changes) и studio.rs (studio_lib_upload — файл версии в архив, studio_lib_restore — файл из
// архива в студию с тем же номером). Площадка — «yandex»: у клиента ВК своя библиотека.
//
// Порядок: забрать изменения (GET ?since=revision) → применить у себя (новое — скачать, удалённое — удалить, лайк и
// название — взять, если у себя их не меняли) → отправить своё (пачки по 100) → догрузить файлы, которых нет в архиве.
// Что уже отправлено — в localStorage ym_libsync { rev, sent: { id: { sig, file } }, bad: { id: 1 } }: sig — подпись
// полей записи (изменилась — отправить снова), file — размер отправленного файла, bad — файл, который архив не берёт.
// Запуск: через несколько секунд после старта, после изменений в студии (window.libsyncPoke) и раз в 5 минут.
// Выключатель — Настройки → Приложение → «Треки по ссылке» (#lsOn, ym_libsync_on, по умолчанию включено).
(() => {
  const W = window.Whisper;
  const $y = (id) => document.getElementById(id);
  const SERVICE = "yandex";
  const STATE = "ym_libsync";
  const ON_KEY = "ym_libsync_on";
  const ID = /^studio-[0-9a-f]{32}$/;
  const BATCH = 100;
  const PERIOD = 5 * 60 * 1000;
  const err = (e) => String(e?.message || e || "ошибка").replace(/^Error:\s*/, "");

  const on = () => { try { return localStorage.getItem(ON_KEY) !== "0"; } catch { return true; } };
  const connected = () => !!W?.modules?.archive?.connected?.();
  const load = () => {
    const v = lsJSON(STATE, null, (x) => x && typeof x === "object" && !Array.isArray(x));
    return {
      rev: Number.isSafeInteger(v?.rev) && v.rev > 0 ? v.rev : 0,
      sent: v?.sent && typeof v.sent === "object" ? v.sent : {},
      bad: v?.bad && typeof v.bad === "object" ? v.bad : {},
      rec: v?.rec && typeof v.rec === "object" ? v.rec : {},
      uid: typeof v?.uid === "string" ? v.uid : "",
    };
  };
  const save = (st) => { try { localStorage.setItem(STATE, JSON.stringify(st)); } catch {} };

  // ---------- запись архива ↔ версия студии ----------
  // версия студии → запись библиотеки (поля — как в docs/LIBRARY-SYNC.md)
  function toLib(it) {
    const m = it.meta && typeof it.meta === "object" && !Array.isArray(it.meta) ? it.meta : {};
    const meta = { ...m };
    if (it.origin === "cut") meta.cut = { startMs: it.startMs || 0, endMs: it.endMs || 0 };
    // обрезке и замене нужен номер трека Яндекса — без него (старые версии) это просто свой трек
    const kind = (it.origin === "cut" || it.origin === "replace") && it.srcId ? it.origin : "import";
    const src = it.source || (kind === "cut" ? { site: "yandex", id: it.srcId } : { site: "file" });
    const ms = (s) => Math.max(0, Math.round(Number(s) || 0)) * 1000;
    return {
      key: it.id, kind, app: "whisper-music",
      title: String(it.title || "Трек"),
      artists: (Array.isArray(m.artists) ? m.artists : []).map((a) => String(a?.name || "")).filter(Boolean).slice(0, 10),
      album: String((Array.isArray(m.albums) && m.albums[0]?.title) || ""),
      durationMs: Math.max(0, Math.round(it.durationMs || 0)),
      source: { site: String(src.site || "file"), url: src.url || null, id: src.id ? String(src.id) : null },
      replaces: kind === "import" ? "" : String(it.srcId || ""),
      meta: JSON.stringify(meta).length <= 4000 ? meta : null,
      liked: !!it.liked,
      // время лайка — как у «Лайков» (studio.js → studioLikedList): у старых версий без него — время сохранения
      likedAt: it.liked ? ms(it.likedAt || it.created) : 0,
      addedAt: ms(it.created),
    };
  }
  const sig = (it) => JSON.stringify(toLib(it));
  const sec = (ms) => Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  // запись библиотеки → то, что studio_lib_restore кладёт в студию
  const fromLib = (x) => ({
    id: x.key, title: x.title, meta: x.meta && typeof x.meta === "object" ? x.meta : {},
    origin: x.kind, srcId: x.replaces || "",
    liked: !!x.liked, likedAt: sec(x.likedAt), created: sec(x.addedAt),
    startMs: x.meta?.cut?.startMs || 0, endMs: x.meta?.cut?.endMs || 0, durationMs: x.durationMs || 0,
    source: x.source?.site ? { site: x.source.site, url: x.source.url || "", id: x.source.id || "" } : null,
  });

  // команда архива: { status, body } → тело JSON или ошибка понятными словами
  async function call(cmd, args) {
    const r = await invoke(cmd, args);
    let b = null;
    try { b = JSON.parse(r.body || "null"); } catch {}
    if (r.status >= 200 && r.status < 300) return b;
    if (r.status === 401) throw new Error("архив не принял вход — войди заново (Настройки → Интеграции)");
    if (r.status === 403) throw new Error(b?.message || "ключ архива только на чтение");
    const e = new Error(b?.message || `архив ответил ${r.status}`);
    e.status = r.status; e.type = b?.type;
    throw e;
  }
  const playingId = () => String(queue[current]?.id ?? "").split(":")[0];

  // ---------- синхронизация ----------
  let busy = false, again = false, timer = 0, note = "", noteErr = false, pendingFiles = 0;
  async function sync() {
    if (busy) { again = true; return; }
    if (!on() || !connected()) { paint(); return; }
    busy = true; note = "Треки синхронизируются…"; noteErr = false; paint();
    let st = load();
    let added = 0, changedLocal = false;
    try {
      // состояние — для одного аккаунта архива: вошли в другой — всё заново (иначе его файлы так и не загрузятся)
      const me = await call("wa_me", {});
      const uid = String(me?.id || "");
      if (!uid) throw new Error("архив не сказал, чей это вход");
      if (st.uid !== uid) { st = { rev: 0, sent: {}, bad: {}, rec: {}, uid }; save(st); }

      // 1. забрать
      const res = await call("wa_lib_list", { service: SERVICE, since: st.rev });
      const local = await invoke("studio_list");
      const byId = new Map(local.map((x) => [x.id, x]));
      let hold = false;                                   // что-то не вышло — этот номер изменений спросим ещё раз
      for (const x of res?.items || []) {
        if (!x || typeof x.key !== "string") continue;
        const it = byId.get(x.key), sent = st.sent[x.key];
        const dirty = !!it && (!sent || sent.sig !== sig(it));       // меняли у себя после прошлой синхронизации
        if (x.deleted) {
          if (!it) { delete st.sent[x.key]; continue; }
          if (dirty && sent) continue;                    // своё свежее изменение главнее — оно вернёт запись
          if (playingId() === it.id || (it.origin === "replace" && playingId() === it.srcId)) { hold = true; continue; }
          try { await invoke("studio_delete", { id: it.id }); byId.delete(it.id); delete st.sent[x.key]; changedLocal = true; }
          catch { hold = true; }
          continue;
        }
        if (!ID.test(x.key)) continue;                    // запись другого приложения: студия хранит только studio-…
        if (!it) {
          if (sent) continue;                             // удалён у себя — удаление уйдёт ниже
          if (!x.file) continue;                          // файл ещё загружают — придёт со следующим номером
          try {
            const n = await invoke("studio_lib_restore", { item: fromLib(x) });
            byId.set(n.id, n); st.sent[n.id] = { sig: sig(n), file: x.file.size || 1 };
            added++; changedLocal = true;
          } catch { hold = true; }
          continue;
        }
        if (!sent || !dirty) {
          // есть у себя и не меняли — взять название и лайк из архива
          const wantLiked = it.origin === "replace" ? false : !!x.liked;
          const wantAt = wantLiked ? sec(x.likedAt) : 0;
          const curAt = it.liked ? (it.likedAt || it.created || 0) : 0;
          const args = { id: it.id };
          if (x.title && x.title !== it.title) args.title = x.title;
          if (wantLiked !== !!it.liked) args.liked = wantLiked;
          if (wantLiked && wantAt && wantAt !== curAt) args.likedAt = wantAt;
          let cur = it;
          if (sent && Object.keys(args).length > 1) {
            try { cur = await invoke("studio_update", args); byId.set(cur.id, cur); changedLocal = true; }
            catch { hold = true; }
          }
          st.sent[it.id] = { sig: sent ? sig(cur) : "", file: x.file?.size || sent?.file || 0 };
        }
      }
      if (!hold && Number.isSafeInteger(res?.revision)) st.rev = res.revision;
      save(st);

      // 2. отправить своё
      const items = [];
      for (const it of byId.values()) { const g = sig(it); if (st.sent[it.id]?.sig !== g && st.rec[it.id] !== g) items.push(it); }
      let deleted = Object.keys(st.sent).filter((k) => !byId.has(k));
      // разом пропала большая часть треков — скорее папка студии потерялась (переустановка, чистка диска), чем их
      // удалили по одному: удаления не отправляем, а треки скачаем из архива заново
      if (deleted.length > 10 && deleted.length * 2 > Object.keys(st.sent).length) {
        for (const k of deleted) delete st.sent[k];
        deleted = [];
        st.rev = 0; again = true;
      }
      for (let i = 0; i < Math.max(items.length, deleted.length); i += BATCH) {
        let part = items.slice(i, i + BATCH);
        const gone = deleted.slice(i, i + BATCH);
        try {
          await call("wa_lib_changes", { service: SERVICE, changes: { items: part.map(toLib), deleted: gone } });
        } catch (e) {
          if (e.status !== 400) throw e;
          // сервер не принял пачку целиком (всё или ничего) — по одной, чтобы одна неудачная запись не держала остальные;
          // её не отправляем, пока она не изменится (rec: номер версии → подпись отклонённой записи)
          const ok = [];
          for (const it of part) {
            try { await call("wa_lib_changes", { service: SERVICE, changes: { items: [toLib(it)] } }); ok.push(it); delete st.rec[it.id]; }
            catch (x) { if (x.status !== 400) throw x; st.rec[it.id] = sig(it); }
          }
          if (gone.length) await call("wa_lib_changes", { service: SERVICE, changes: { deleted: gone } });
          part = ok;
        }
        for (const it of part) st.sent[it.id] = { sig: sig(it), file: st.sent[it.id]?.file || 0 };
        for (const k of gone) { delete st.sent[k]; delete st.bad[k]; delete st.rec[k]; }
        save(st);
      }

      // 3. файлы, которых в архиве ещё нет (по одному: у загрузок свой бюджет); запись должна быть уже в архиве
      const files = [...byId.values()].filter((it) => st.sent[it.id] && !st.sent[it.id].file && !st.bad[it.id]);
      pendingFiles = files.length;
      for (const it of files) {
        if (!on() || !connected()) break;
        try {
          const r = await invoke("studio_lib_upload", { id: it.id });
          let type = "";
          try { type = JSON.parse(r.body || "null")?.type || ""; } catch {}
          if (r.status >= 200 && r.status < 300) { st.sent[it.id] = { ...(st.sent[it.id] || { sig: sig(it) }), file: it.size || 1 }; pendingFiles--; }
          else if (type === "invalid_track") { st.bad[it.id] = 1; pendingFiles--; } // архив этот файл не берёт
          else if (type === "storage_quota_exceeded") { note = "В архиве кончилось место — файлы не загружаются"; noteErr = true; break; }
          else if (r.status === 404) { if (st.sent[it.id]) st.sent[it.id].sig = ""; } // записи нет — отправится заново
          else break;                                                             // 429, место, сеть — в другой раз
        } catch (e) {
          if (/Формат файла|больше 100 МБ/.test(err(e))) { st.bad[it.id] = 1; pendingFiles--; }
          else break;                                                             // бюджет загрузок, сеть — позже
        }
        save(st);
      }
      if (!noteErr) note = pendingFiles > 0 ? `Синхронизировано · файлов в очереди: ${pendingFiles}` : `Синхронизировано · ${new Date().toLocaleTimeString(document.documentElement.lang === "en" ? "en-GB" : "ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    } catch (e) {
      note = `Не удалось синхронизировать: ${err(e)}`; noteErr = true;
    } finally {
      save(st);
      busy = false;
      if (changedLocal) await window.studioReload?.();
      if (added) showToast(`Из архива добавлено треков: ${added}`, 4000, { kind: "ok" });
      paint();
      if (again) { again = false; poke(1000); }
      else if (pendingFiles > 0 && !noteErr) poke(60 * 1000);         // остаток файлов — через минуту
    }
  }

  // изменение в студии (лайк, новый трек, удаление, название) — синхронизировать чуть позже, одной пачкой
  function poke(ms = 4000) {
    clearTimeout(timer);
    timer = setTimeout(() => sync(), ms);
  }
  window.libsyncPoke = () => { if (on() && connected()) poke(); };
  window.libsyncNow = () => sync();
  window.libsyncActive = () => on() && connected();
  setInterval(() => { if (!busy && on() && connected() && !document.hidden) sync(); }, PERIOD);
  // первый раз — когда архив успел подключиться (core/archive.js проверяет вход при запуске)
  setTimeout(() => sync(), 8000);

  // ---------- Настройки → Приложение → «Треки по ссылке» ----------
  function paint() {
    const cb = $y("lsOn"), st = $y("lsState"), btn = $y("lsNow");
    if (!st) return;
    if (cb) cb.checked = on();
    const ready = on() && connected();
    if (btn) btn.disabled = busy || !ready;
    st.classList.toggle("err", noteErr && ready);
    st.textContent = !on() ? "Синхронизация выключена"
      : !connected() ? "Нужен вход в Whisper Archive — Настройки → Интеграции"
      : note || "Ещё не синхронизировалось";
  }
  $y("lsOn")?.addEventListener("change", (e) => {
    try { localStorage.setItem(ON_KEY, e.target.checked ? "1" : "0"); } catch {}
    note = ""; noteErr = false; paint();
    if (e.target.checked) poke(500);
  });
  if ($y("lsNow")) $y("lsNow").onclick = () => sync();
  if ($y("linkCard")) new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) paint(); }).observe($y("linkCard"));
  paint();
})();
