// plays.js — отчёты Яндексу о прослушиваниях (POST /play-audio, операция play_audio в net.rs).
// Отчёт уходит, откуда бы ни шёл звук: с Яндекса, из Whisper Archive, со скачанного файла, у гостя и у ведущего
// «Слушать вместе». Так прослушивание засчитывается автору, как в официальном клиенте: архив и офлайн никого не обделяют.
// На каждый включённый трек — два отчёта с одним play-id: «начал» (0 с) и «закончил» (сколько реально слушал
// и где остановился). Не отправилось (нет сети, Яндекс не ответил) — отчёт ждёт в localStorage и уходит позже;
// client-now ставится в момент отправки, чтобы Яндекс понимал, что отчёт запоздал.
// uid в форму подставляет Rust. Работает только через Whisper.on / Whisper.player — без переменных main.js.
(() => {
  const W = window.Whisper;
  if (!W) return;
  const PEND_KEY = "ym_plays_pending", CUR_KEY = "ym_plays_cur";
  const MAX_PEND = 300, MAX_AGE = 7 * 864e5;           // старше недели Яндекс всё равно вряд ли примет
  // откуда трек (контекст плеера) → поле from в духе официального настольного клиента
  const FROM = { radio: "radio", album: "album", playlist: "playlist", likes: "own_tracks", room: "track", other: "track" };
  const fromOf = (ctx) => `desktop_win-${FROM[ctx?.type] || "track"}-track-default`;
  const sec = (x) => String(Math.round(Math.max(0, +x || 0) * 100) / 100);
  // своя версия из «Студии» (studio.js) — это кусок трека Яндекса: прослушивание засчитывается исходнику
  const ymId = (t) => String(t?.raw?.studio?.src ?? t?.raw?.id ?? t?.id ?? "").split(":")[0];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16) + Math.random().toString(16).slice(2));

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
  let pend = Array.isArray(load(PEND_KEY, [])) ? load(PEND_KEY, []) : [];
  const savePend = () => { try { localStorage.setItem(PEND_KEY, JSON.stringify(pend)); } catch {} };
  let cur = null;                                      // текущее прослушивание
  const saveCur = () => { try { cur ? localStorage.setItem(CUR_KEY, JSON.stringify(cur)) : localStorage.removeItem(CUR_KEY); } catch {} };

  const form = (s, final) => {
    const f = {
      "track-id": s.trackId, "from": s.from, "from-cache": String(!!s.cache), "play-id": s.playId,
      "timestamp": final ? new Date().toISOString() : s.at,
      "track-length-seconds": sec(s.len),
      "total-played-seconds": final ? sec(s.played) : "0",
      "end-position-seconds": final ? sec(Math.min(s.pos, s.len || s.pos)) : "0",
    };
    if (s.albumId) f["album-id"] = s.albumId;
    return f;
  };
  function queueReport(f) {
    pend.push({ f, t: Date.now() });
    if (pend.length > MAX_PEND) pend.splice(0, pend.length - MAX_PEND);
    savePend();
    flush();
  }

  let busy = false;
  async function flush() {
    if (busy || !pend.length || !navigator.onLine) return;
    busy = true;
    try {
      while (pend.length) {
        const it = pend[0];
        if (!it?.f || Date.now() - it.t > MAX_AGE) { pend.shift(); savePend(); continue; }
        try {
          await invoke("ym_write", { op: "play_audio", id: null, query: null, form: { ...it.f, "client-now": new Date().toISOString() }, json: null });
        } catch (e) {
          // Яндекс отверг сам отчёт — повторять бесполезно; сеть, вход, 5xx — попробуем позже
          if (/^HTTP (400|404|422)\b/.test(String(e))) { pend.shift(); savePend(); continue; }
          break;
        }
        pend.shift(); savePend();
      }
    } finally { busy = false; }
  }

  function finish() {
    if (!cur) return;
    const s = cur; cur = null; saveCur();
    if (s.wait) { s.done = true; return; }             // ещё не ясно, есть ли трек на Яндексе: итог отправит проверка
    queueReport(form(s, true));
  }

  // прошлый запуск закрылся посреди трека — его итог ещё не отправлен (если «начал» вообще уходил)
  const left = load(CUR_KEY, null);
  if (left?.playId && left.trackId && !left.wait) queueReport(form(left, true));
  try { localStorage.removeItem(CUR_KEY); } catch {}

  // ---------- трек из архива ведущего «Слушать вместе» ----------
  // Гостю приходит номер трека с Яндекса ведущего и файл из его архива (waShared, core/together.js). Если у гостя этого
  // трека на Яндексе нет (недоступен в его стране, удалён, ведущий слушает другой сервис и номер чужой), звук идёт
  // только из архива — и Яндексу о таком прослушивании не сообщаем: засчитывать нечего (или засчитался бы чужой трек).
  const shared = (t) => !!(t?.waShared || t?.raw?.waShared);
  const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const onYandex = new Map();                          // номер трека → Promise<boolean> (на время запуска)
  function checkOnYandex(id, t) {
    if (onYandex.has(id)) return onYandex.get(id);
    const p = (async () => {
      try {
        const [y] = await W.provider().tracks([id]);
        if (!y?.id || y.available === false) return false;
        // номер тот же, а трек другой (номер из другого сервиса) — не он
        const same = norm(y.title) === norm(t.title) || (t.artists || []).some((a) => (y.artists || []).some((b) => norm(a?.name) && norm(a.name) === norm(b?.name)));
        return same;
      } catch (e) {
        // Яндекс ответил, что такого трека нет, — нет; сеть и прочее — не знаем, отчёт подождёт в очереди как обычно
        return !/^HTTP (400|404)\b/.test(String(e?.message || e));
      }
    })();
    onYandex.set(id, p);
    if (onYandex.size > 200) onYandex.delete(onYandex.keys().next().value);
    return p;
  }

  W.on("start", ({ track: t }) => {
    const id = ymId(t);
    // тот же трек включается заново, а слушать его ещё не начали (гость «Слушать вместе» догоняет ведущего,
    // повтор загрузки) — это то же прослушивание, а не новое
    if (cur && cur.trackId === id && cur.played < 1) return;
    finish();
    if (!/^\d{1,20}$/.test(id)) return;                // не трек Яндекса — засчитывать нечего
    const r = t.raw || {};
    const s = cur = {
      playId: uuid(), trackId: id, albumId: r.albums?.[0]?.id != null ? String(r.albums[0].id) : "",
      from: fromOf(W.player.state().context), len: (t.durationMs || r.durationMs || 0) / 1000,
      played: 0, pos: 0, cache: false, at: new Date().toISOString(),
    };
    if (!shared(t)) { saveCur(); queueReport(form(s, false)); return; }
    // трек из архива ведущего: сначала узнаём, есть ли он у гостя на Яндексе; пока не ясно, «начал» не отправляется
    s.wait = true;
    checkOnYandex(id, t).then((ok) => {
      if (!ok) {
        s.skip = true;
        if (cur === s) { cur = null; saveCur(); }      // звучит только из архива — прослушивание не считаем
        return;
      }
      s.wait = false;
      queueReport(form(s, false));
      if (s.done) queueReport(form(s, true));          // трек успел закончиться, пока шла проверка
      else if (cur === s) saveCur();
    });
  });
  // скачанный файл — from-cache, как у официального клиента в офлайне
  W.on("source", ({ source }) => { if (cur) { cur.cache = source === "local" || source === "cache"; saveCur(); } });

  // Сколько реально звучало: считаем по секундам, только пока трек играет (не пауза, не загрузка, не буферизация).
  let last = performance.now(), n = 0;
  setInterval(() => {
    const now = performance.now(), dt = Math.min((now - last) / 1000, 2);
    last = now;
    if (!cur) return;
    const s = W.player.state(), m = W.player.media();
    if (ymId(s.track) !== cur.trackId) return;
    if (m.loading || m.pending) return;                 // старый файл ещё на месте — его позиция и «конец» не про этот трек
    if (s.playing && !m.paused && !m.buffering) cur.played += dt * (m.rate || 1);
    if (m.duration && !cur.len) cur.len = m.duration;
    // «Повтор одного трека» перематывает в начало без нового включения: из конца в начало — это новое прослушивание
    if (cur.len && cur.pos > cur.len - 3 && s.position < 2 && cur.played > cur.len / 2) {
      const again = { ...cur, playId: uuid(), played: 0, pos: 0, at: new Date().toISOString() };
      cur.pos = cur.len; finish();
      cur = again; saveCur();
      return queueReport(form(cur, false));
    }
    cur.pos = m.ended ? cur.len || s.position : s.position;
    if (m.ended && cur.played > 0) return finish();     // дослушали, а дальше ничего нет (иначе итог закроет следующий «start»)
    if (++n % 10 === 0) saveCur();                      // на случай закрытия — итог уйдёт при следующем запуске
  }, 1000);

  window.addEventListener("pagehide", saveCur);
  window.addEventListener("online", () => setTimeout(flush, 3000));
  setTimeout(flush, 5000);
  setInterval(flush, 5 * 60 * 1000);
})();
