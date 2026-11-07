// share.js — «Поделиться» треком и ссылки, которые открываются здесь, а не в браузере.
//
// Что копируется (меню «⋯» трека → «Поделиться»):
//   * ссылка Whisper — https://origin.whisper-archive.ru/s/track/ТРЕК:АЛЬБОМ. В мессенджерах кликабельна, страница архива
//     открывает whisper://track/… (у кого стоит приложение), а у кого нет — даёт кнопку «Открыть в Яндекс Музыке»;
//   * ссылка Яндекс Музыки — для тех, кто сидит в официальном клиенте;
//   * «Исполнитель — Название» — просто текстом.
//
// Что открывается внутри приложения:
//   * whisper://track|album|artist/… — система передаёт ссылку в Rust (deeplink.rs), он — сюда событием open-link;
//   * ссылка Whisper или music.yandex.* (трек, альбом, артист), вставленная в поиск или просто Ctrl+V в окне.
// Трек по ссылке сразу играет, и открывается его альбом; альбом и артист — открываются страницы.
(() => {
  const W = window.Whisper;
  const SHARE_BASE = "https://origin.whisper-archive.ru/s/";
  const YA_BASE = "https://music.yandex.ru/";
  const num = (x) => (/^\d{1,15}$/.test(String(x ?? "")) ? String(x) : "");

  // ---------- ссылки ----------
  const albumOf = (t) => num(t?.raw?.albums?.[0]?.id ?? t?.album?.id ?? t?.albums?.[0]?.id);
  const trackOf = (t) => num(String(t?.id ?? "").split(":")[0]);
  // at — «с этого момента», секунды (?t=83): страница архива передаёт его в whisper://, приложение перематывает
  const whisperUrl = (t, at = 0) => {
    const id = trackOf(t), al = albumOf(t);
    return id ? `${SHARE_BASE}track/${id}${al ? ":" + al : ""}${at > 0 ? "?t=" + at : ""}` : "";
  };
  const MAX_AT = 86400;
  const okAt = (v) => (/^\d{1,6}$/.test(String(v ?? "")) && +v >= 1 && +v <= MAX_AT ? +v : 0);
  const mmss = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
  const yandexUrl = (t) => { const id = trackOf(t), al = albumOf(t); return id ? (al ? `${YA_BASE}album/${al}/track/${id}` : `${YA_BASE}track/${id}`) : ""; };
  const nameLine = (t) => {
    const a = (t?.artists || []).map((x) => x?.name).filter(Boolean).join(", ");
    const ttl = t?.version ? `${t.title} (${t.version})` : String(t?.title || "");
    return a ? `${a} — ${ttl}` : ttl;
  };

  // Ссылка → { kind, id, album, at }. Понимает whisper://, страницу архива /s/… и music.yandex.(ru|com|by|kz|uz).
  // Только номера: всё лишнее (?utm, #, хвосты) отбрасывается.
  // Своя версия трека из Студии (через Whisper Archive): whisper://wa/{альбом}?k={ключ} и страница /s/v/{альбом}#k={ключ}
  // → { kind: "wa", id: альбом, key }.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const KEY_RE = /^[A-Za-z0-9_-]{20,200}$/;
  function parseLink(text) {
    const s = String(text || "").trim();
    if (!s || s.length > 500) return null;
    const m = s.match(/(?:whisper:\/{0,2}|https?:\/\/[^\s/]+\/)[^\s]*/i);
    if (!m) return null;
    let u;
    try { u = new URL(m[0]); } catch { return null; }
    const proto = u.protocol.toLowerCase();
    let path;
    if (proto === "whisper:") {
      // whisper://track/1 → host «track», путь «/1»; whisper:/track/1 → весь путь
      path = (u.host + u.pathname).replace(/^\/+/, "");
      const w = path.match(/^wa\/([0-9a-f-]{36})\/?$/i), key = u.searchParams.get("k") || "";
      if (w) return UUID_RE.test(w[1]) && KEY_RE.test(key) ? { kind: "wa", id: w[1].toLowerCase(), key } : null;
    } else if (proto === "https:" || proto === "http:") {
      const h = u.hostname.toLowerCase().replace(/^www\./, "");
      if (/^(origin\.)?whisper-archive\.ru$/.test(h)) {
        const v = u.pathname.match(/^\/s\/v\/([0-9a-f-]{36})\/?$/i);
        if (v) {
          const key = new URLSearchParams(u.hash.replace(/^#/, "")).get("k") || "";
          return UUID_RE.test(v[1]) && KEY_RE.test(key) ? { kind: "wa", id: v[1].toLowerCase(), key } : null;
        }
        const p = u.pathname.match(/^\/s\/(.+)$/);
        if (!p) return null;
        path = p[1];
      } else if (/^music\.yandex\.(ru|com|by|kz|uz)$/.test(h)) {
        // у Яндекса после номера бывают хвосты: /artist/1/tracks, /album/2/similar
        const y = u.pathname.replace(/^\/+/, "");
        const at = y.match(/^album\/(\d{1,15})\/track\/(\d{1,15})(?:\/|$)/i);
        if (at) return { kind: "track", id: at[2], album: at[1] };
        const one = y.match(/^(track|album|artist)\/(\d{1,15})(?:\/|$)/i);
        return one ? { kind: one[1].toLowerCase(), id: one[2], album: "" } : null;
      } else return null;
    } else return null;
    path = decodeURIComponent(path).replace(/\/+$/, "");
    const p = path.match(/^(track|album|artist)\/(\d{1,15})(?::(\d{1,15}))?$/i);
    if (!p) return null;
    const kind = p[1].toLowerCase();
    if (p[3] && kind !== "track") return null;
    // ?t=СЕКУНДЫ — только у трека (ссылка «с этого момента»)
    const at = kind === "track" ? okAt(u.searchParams.get("t")) : 0;
    return { kind, id: p[2], album: p[3] || "", at };
  }

  // ---------- буфер обмена ----------
  async function copy(text, what) {
    if (!text) return;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      // запасной путь (старый WebKitGTK без Clipboard API)
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.pointerEvents = "none";
      document.body.append(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch {}
      ta.remove();
    }
    if (ok) showToast(`${what} скопирована`, 2500, { kind: "ok" });
    else showToast(text, 8000);         // совсем не вышло — показываем, чтобы скопировать руками
  }

  // ---------- меню «⋯» ----------
  const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M12 3.5v11M7.5 8 12 3.5 16.5 8M5 12.5v6.2c0 .7.6 1.3 1.3 1.3h11.4c.7 0 1.3-.6 1.3-1.3v-6.2"/></svg>';
  const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/></svg>';
  const TEXT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M5 7h14M5 12h14M5 17h9"/></svg>';

  const BOX_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
  const BOX_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3.5" fill="currentColor" opacity=".22"/><rect x="4.5" y="4.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m8.3 12.3 2.6 2.6 5-5.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // «С этого момента»: галочка запоминается до перезапуска; момент — где сейчас играет этот трек, когда открыли меню
  let fromHere = false;
  function nowAt(t) {
    try {
      const st = W.player.state();
      if (!st?.track || trackOf(st.track) !== trackOf(t)) return 0;      // делимся не тем, что играет, — момента нет
      const s = Math.floor(+st.position || 0);
      return s >= 1 && s <= MAX_AT ? s : 0;
    } catch { return 0; }
  }

  function shareMenu(t, m, at = nowAt(t)) {
    m.reset();
    m.head("Поделиться");
    const use = fromHere && at > 0;
    if (at > 0) {
      const b0 = m.item(use ? BOX_ON : BOX_OFF, `С ${mmss(at)} — где ты сейчас`, () => { fromHere = !fromHere; shareMenu(t, m, at); }, { keep: true });
      b0.title = "Ссылка Whisper откроет трек с этого места. Яндекс Музыка так не умеет — её ссылка всегда с начала";
      b0.setAttribute("role", "menuitemcheckbox"); b0.setAttribute("aria-checked", String(use));
    }
    const b1 = m.item(LINK_ICON, use ? `Копировать ссылку (с ${mmss(at)})` : "Копировать ссылку", () => copy(whisperUrl(t, use ? at : 0), "Ссылка"));
    b1.title = "Ссылка откроется в Whisper Music, а у кого его нет — в Яндекс Музыке";
    const b2 = m.item(LINK_ICON, "Ссылка на Яндекс Музыку", () => copy(yandexUrl(t), "Ссылка"));
    b2.title = "Для официального клиента и браузера" + (use ? " — откроется с начала трека" : "");
    m.item(TEXT_ICON, "Копировать название", () => copy(nameLine(t) + (use ? ` (с ${mmss(at)})` : ""), "Строка"));
    if (albumOf(t)) m.item(LINK_ICON, "Ссылка на альбом", () => copy(`${SHARE_BASE}album/${albumOf(t)}`, "Ссылка"));
    m.place();
  }
  W?.ui.trackMenu.add({
    id: "share",
    build(t, m) {
      if (!trackOf(t)) return false;         // не трек Яндекса (например, из комнаты с другим сервисом) — делиться нечем
      m.item(SHARE_ICON, "Поделиться", () => shareMenu(t, m), { keep: true, arrow: true });
    },
  });

  // ---------- открыть ссылку здесь ----------
  let opening = 0;
  async function openTarget(L) {
    if (!L) return false;
    if (L.kind === "wa") { window.studioOpenShared?.(L.id, L.key); return true; }     // studio.js
    if (L.kind === "album") { navigate(() => showAlbum(L.id)); return true; }
    if (L.kind === "artist") { navigate(() => showArtist(L.id)); return true; }
    const my = ++opening;
    let t = null;
    try { [t] = await W.provider().tracks([L.album ? `${L.id}:${L.album}` : L.id]); }
    catch (e) {
      if (my === opening) showToast(isNetErr(e) ? "Нет связи — трек по ссылке не открылся" : "Не удалось открыть трек по ссылке", 4000, { kind: "err" });
      return true;
    }
    if (my !== opening) return true;
    if (!t?.id) { showToast("Трек по ссылке не найден", 4000, { kind: "err" }); return true; }
    if (t.available === false) showToast(`«${t.title}» недоступен на Яндекс Музыке`, 4000, { kind: "err" });
    else {
      W.queue.play([t]);
      showToast(`По ссылке: «${t.title}»` + (L.at ? ` с ${mmss(L.at)}` : ""), 2500, { kind: "ok" });
      if (L.at) seekWhenReady(t, L.at, my);
    }
    const al = num(t.album?.id) || L.album;
    if (al) navigate(() => showAlbum(al));
    return true;
  }
  window.openShareLink = (text) => openTarget(parseLink(text));     // консоль, другие модули

  // ссылка «с момента»: перемотать, как только этот трек загрузился и известна длина (не дольше 15 с;
  // момент дальше конца трека — с начала). Открыли другую ссылку или включили другой трек — не трогаем.
  function seekWhenReady(t, at, my) {
    const t0 = Date.now();
    const tick = () => {
      if (my !== opening || Date.now() - t0 > 15000) return;
      let st = null;
      try { st = W.player.state(); } catch {}
      if (!st?.track || trackOf(st.track) !== trackOf(t)) return void setTimeout(tick, 250);
      // ждём, пока трек действительно заиграл: иначе начало воспроизведения перебило бы позицию
      const dur = +st.duration || 0, md = W.player.media?.() || {};
      if (!(dur > 0) || md.loading || md.pending || !st.playing) return void setTimeout(tick, 250);
      if (at < dur - 1) W.player.seek(at);
    };
    setTimeout(tick, 300);
  }

  // ссылка из системы (whisper://…, deeplink.rs): при запуске по ссылке — забираем, когда окно готово
  async function takeLink() {
    let v = null;
    try { v = await invoke("open_link_take"); } catch {}
    if (v) openTarget(parseLink("whisper://" + v));
  }
  window.__TAURI__?.event?.listen("open-link", () => takeLink());
  setTimeout(takeLink, 1500);

  // ссылка, вставленная в поиск (или набранная и Enter), — открыть, а не искать
  const search = document.getElementById("search");
  if (search) {
    search.addEventListener("paste", (e) => {
      const L = parseLink(e.clipboardData?.getData("text") || "");
      if (!L) return;
      e.preventDefault();
      search.value = "";
      search.blur();
      openTarget(L);
    });
    // в фазе захвата на document — раньше обработчика поиска в main.js
    document.addEventListener("keydown", (e) => {
      if (e.target !== search || e.key !== "Enter") return;
      const L = parseLink(search.value);
      if (!L) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (typeof searchTimer !== "undefined") clearTimeout(searchTimer);     // main.js: поиск «на лету» по набранному
      search.value = ""; search.blur();
      openTarget(L);
    }, true);
  }
  // Ctrl+V в окне (не в поле ввода и не в открытом окне-диалоге) со ссылкой в буфере
  document.addEventListener("paste", (e) => {
    const el = e.target;
    if (el?.closest?.("input, textarea, [contenteditable]") || document.querySelector(".modal")) return;
    const L = parseLink(e.clipboardData?.getData("text") || "");
    if (!L) return;
    e.preventDefault();
    openTarget(L);
  });
})();
