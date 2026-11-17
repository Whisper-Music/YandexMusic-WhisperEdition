// Перетаскивание в окно на любой странице (Моя волна, Лайки…). Файлы приходят из Rust (bg.rs → main.js, событие bg-drop):
// тема .wmt — theme.js, картинка или видео — фон (main.js), а трек — сюда: окно «Что сделать с треком».
//   * «В «Лайки»» и «Просто сохранить» — файл ложится на этот компьютер (studio.rs, drop_audio_local). Если выбран трек
//     Яндекса, файл становится его ЗАМЕНОЙ: трек остаётся тем же (лайк — ему самому, без второй копии в «Лайках»), а
//     играет вместо него твой файл (main.js → studioReplacement). Без трека — свой трек в «Моих версиях» (с лайком или без);
//   * «В Whisper Archive» — в свой альбом или в новый (drop_audio_archive). Если выбран похожий трек Яндекса
//     (подбирается поиском по тегам и имени файла), файл называется «Исполнитель - Название» как у него — и с включённой
//     «Играть треки из архива» вместо версии Яндекса играет твой файл (core/archive.js сопоставляет по названию).
// Файл интерфейс не читает целиком: Rust берёт его по номеру из списка перетаскивания. Сюда — только чтобы послушать.
(() => {
  const W = window.Whisper;
  const $d = (s, el = document) => el.querySelector(s);
  const AUDIO = /\.(mp3|flac|m4a|aac|ogg|oga|opus|wav)$/i;
  const MAX = 100 * 1048576;
  const err = (e) => String(e?.message || e || "ошибка");
  const toast = (t, ms, o) => showToast(t, ms, o);

  // ---------- подсказка поверх окна, пока файл тащат ----------
  const hint = document.createElement("div");
  hint.className = "drophint";
  hint.hidden = true;
  hint.setAttribute("aria-hidden", "true");
  hint.innerHTML = '<div class="drophint-box"><b>Отпусти файл</b><span>Картинка или видео — на фон, трек — выбери, что с ним сделать</span></div>';
  document.body.append(hint);
  // открыто окно «Добавить трек» (linkadd.js) — у него своя зона для файла, общая подсказка не нужна
  window.dropHint = (on) => { hint.hidden = !on || !!document.querySelector(".dropdlg, .addtrack"); };

  // ---------- что за трек: имя файла и теги → запрос в поиск ----------
  function guess(info) {
    let stem = String(info.name || "").replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();
    stem = stem.replace(/^\s*\d{1,3}\s*[.)\-–—]\s*/, "");                 // «01 - …», «01. …»
    const dash = stem.split(/\s+[-–—]\s+/);
    let artist = info.artist || (dash.length >= 2 ? dash[0] : "");
    let title = info.title || (dash.length >= 2 ? dash.slice(1).join(" - ") : stem);
    return { artist: artist.trim(), title: title.trim() || stem || "Трек", album: info.album || "" };
  }
  const nrm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/ё/g, "е")
    .replace(/[(\[]\s*(?:feat|ft|featuring)\.?\s[^)\]]*[)\]]/giu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const arts = (list) => new Set((list || []).flatMap((a) => String(a?.name || a || "").split(/\s*(?:[,;&/+]|\s(?:feat|ft|x|х|vs)\.?\s)\s*/iu)).map(nrm).filter(Boolean));
  // насколько трек Яндекса похож на файл: название, исполнитель, длина (0…1)
  function score(t, g, durMs) {
    const a = nrm(t.title), b = nrm(g.title);
    if (!a || !b) return 0;
    let s = a === b ? 0.6 : a.includes(b) || b.includes(a) ? 0.35 : 0;
    if (!s) {
      const wa = new Set(a.split(" ")), wb = b.split(" ");
      const common = wb.filter((w) => wa.has(w)).length;
      s = (common / Math.max(wa.size, wb.length)) * 0.3;
    }
    const A = arts(t.artists), B = arts(g.artist ? [g.artist] : []);
    if (B.size) s += [...B].some((x) => A.has(x)) ? 0.3 : 0;
    else s += 0.1;
    if (durMs && t.durationMs) {
      const d = Math.abs(durMs - t.durationMs);
      s += d < 3000 ? 0.1 : d < 15000 ? 0.05 : -0.1;
    }
    return Math.max(0, Math.min(1, s));
  }
  const nameOf = (t) => {
    const who = (t.artists || []).map((a) => a?.name).filter(Boolean).join(", ");
    const title = t.version ? `${t.title} (${t.version})` : String(t.title || "");
    return who ? `${who} - ${title}` : title;
  };
  const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const mbOf = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " МБ" : Math.max(1, Math.round(n / 1024)) + " КБ");

  // обложка нового альбома, если у трека её нет: заливка цветами стиля с названием (как в студии)
  async function plainCover(title) {
    const S = 600, c = document.createElement("canvas"); c.width = c.height = S;
    const g = c.getContext("2d"), cs = getComputedStyle(document.documentElement);
    const gr = g.createLinearGradient(0, 0, S, S);
    gr.addColorStop(0, cs.getPropertyValue("--accent").trim() || "#a66bff"); gr.addColorStop(1, cs.getPropertyValue("--accent2").trim() || "#e060ff");
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = "#fff"; g.font = "600 40px system-ui, sans-serif"; g.textBaseline = "middle";
    let t = String(title || "Трек");
    while (t.length > 1 && g.measureText(t).width > S - 80) t = t.slice(0, -2).trimEnd() + "…";
    g.fillText(t, 40, S * 0.83);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
    return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : null;
  }

  // ---------- очередь перетащенных треков: по одному окну на трек ----------
  const pending = [];
  let busy = false;
  window.dropAudio = (files) => {
    files = Array.isArray(files) ? files : [];
    // папка обоев Wallpaper Engine (project.json) или видео рядом со звуком — это фон, а не треки
    if (files.some((f) => /^project\.json$/i.test(String(f?.name || "")) || /\.(mp4|webm|m4v|mov|mkv)$/i.test(String(f?.name || "")))) return false;
    const list = files.filter((f) => AUDIO.test(String(f?.name || "")) && Number.isInteger(f?.id));
    if (!list.length) return false;
    const big = list.filter((f) => f.size > MAX);
    if (big.length) toast(`«${big[0].name}» больше 100 МБ — такие треки не берём`, 6000, { kind: "err" });
    pending.push(...list.filter((f) => f.size <= MAX).map((f, i, all) => ({ ...f, n: i + 1, of: all.length })));
    next();
    return true;
  };
  async function next() {
    if (busy || !pending.length) return;
    busy = true;
    const f = pending.shift();
    try { await dialog(f); } catch (e) { toast("Не получилось открыть трек: " + err(e), 6000, { kind: "err" }); }
    busy = false;
    next();
  }

  // ---------- окно выбора ----------
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  async function dialog(f) {
    const info = await invoke("drop_audio_info", { pick: f.id });
    const g = guess(info);
    let durMs = info.durationMs || 0;
    let blobUrl = "", audioEl = null;
    // файл целиком — только если попросили послушать (или нужна длина не-mp3 для «Лайков»)
    const blob = async () => {
      if (blobUrl) return blobUrl;
      const buf = await invoke("bg_read", { id: f.id, kind: "audio" });
      blobUrl = URL.createObjectURL(new Blob([buf]));
      return blobUrl;
    };
    const measure = async () => {
      if (durMs) return durMs;
      const a = new Audio(await blob());
      await new Promise((ok) => { a.onloadedmetadata = ok; a.onerror = ok; setTimeout(ok, 5000); });
      if (isFinite(a.duration) && a.duration > 0) durMs = Math.round(a.duration * 1000);
      return durMs;
    };

    return new Promise((resolve) => {
      const wrap = el("div", "login modal dropdlg");
      const box = el("form", "panel login-box modalbox dropbox");
      box.noValidate = true;
      const h = el("h2", "", f.of > 1 ? `Трек ${f.n} из ${f.of}` : "Что сделать с треком?");
      const file = el("div", "dropfile");
      const fname = el("b", "", info.name);
      const fmeta = el("span", "", [String(info.ext || "").toUpperCase(), mbOf(info.size), durMs ? fmtDur(durMs) : ""].filter(Boolean).join(" · "));
      const play = el("button", "nav dropplay", "▶ Послушать");
      play.type = "button";
      play.onclick = async () => {
        if (audioEl && !audioEl.paused) { audioEl.pause(); play.textContent = "▶ Послушать"; return; }
        try {
          if (!audioEl) { audioEl = new Audio(await blob()); audioEl.onended = () => { play.textContent = "▶ Послушать"; }; }
          if (window.Whisper?.player.state().playing) W.player.pause();
          await audioEl.play(); play.textContent = "■ Стоп";
          if (!durMs && isFinite(audioEl.duration)) durMs = Math.round(audioEl.duration * 1000);
        } catch (e) { toast("Не получилось включить: " + err(e), 5000, { kind: "err" }); }
      };
      const ft = el("div", "dropft"); ft.append(fname, fmeta);
      file.append(ft, play);

      // — что это за трек
      const h1 = el("h4", "", "Что это за трек");
      const q = el("input", "field dropq");
      q.type = "search"; q.placeholder = "Поиск на Яндекс Музыке"; q.value = [g.artist, g.title].filter(Boolean).join(" ");
      q.spellcheck = false;
      const cands = el("div", "dropcands");
      const qnote = el("p", "status dropnote");
      let picked = null;                       // трек Яндекса или null — «не связывать»
      let lastQ = "";
      const paintCands = (list) => {
        cands.textContent = "";
        const mk = (t) => {
          const b = el("button", "dropcand" + (picked === t ? " on" : ""));
          b.type = "button";
          if (t) {
            b.append(kitImage(t));
            const tx = el("span", "dctx");
            tx.append(el("b", "", t.version ? `${t.title} (${t.version})` : t.title), el("small", "", [(t.artists || []).map((a) => a.name).join(", "), t.album?.title].filter(Boolean).join(" · ")));
            b.append(tx, el("span", "dcdur", t.durationMs ? fmtDur(t.durationMs) : ""));
          } else {
            b.classList.add("none");
            b.append(el("span", "dctx", "Не связывать с Яндексом — свой трек"));
          }
          b.onclick = () => { picked = t; paintCands(list); paintWhere(); };
          return b;
        };
        for (const t of list) cands.append(mk(t));
        cands.append(mk(null));
      };
      let found = [];
      const search = async () => {
        const text = q.value.trim();
        if (!text || text === lastQ) return;
        lastQ = text;
        qnote.textContent = "Ищу…";
        try {
          const r = await W.provider().search(text, "track");
          if (lastQ !== text) return;
          found = (r?.tracks || []).filter((t) => t?.id && t.available !== false).slice(0, 12)
            .map((t) => ({ t, s: score(t, g, durMs) })).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.t);
          // лучший — выбран сразу, если он и правда похож (название и исполнитель)
          const best = found[0];
          picked = best && score(best, g, durMs) >= 0.75 ? best : null;
          qnote.textContent = found.length ? (picked ? "Похожий трек выбран — проверь, тот ли это" : "Выбери подходящий трек или оставь «Не связывать»") : "Ничего похожего не нашлось";
          paintCands(found); paintWhere();
        } catch (e) { qnote.textContent = "Поиск не ответил: " + err(e); paintCands([]); }
      };
      q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lastQ = ""; search(); } });
      q.addEventListener("search", () => { lastQ = ""; search(); });

      // — куда
      const h2 = el("h4", "", "Куда добавить");
      const where = el("div", "dropwhere");
      const opt = (title) => { const b = el("button", "dropopt"); b.type = "button"; const sm = el("small"); b.append(el("b", "", title), sm); b._note = sm; return b; };
      const optLike = opt("В «Лайки»"), optLocal = opt("Просто сохранить"), optArch = opt("В Whisper Archive");
      optArch._note.textContent = "В свой альбом или в новый — слушать с любого устройства и делиться";
      where.append(optLike, optLocal, optArch);
      let dest = "like";
      const archBox = el("div", "droparch");
      archBox.hidden = true;
      const albSel = el("select", "field dropalb");
      const albNew = el("input", "field dropalbnew");
      albNew.placeholder = "Название нового альбома"; albNew.maxLength = 75; albNew.spellcheck = false;
      const archNote = el("p", "status dropnote");
      // в архив — и лайкнуть сам трек Яндекса (если выбран)
      const likeRow = el("label", "switch droplike");
      const likeCb = el("input"); likeCb.type = "checkbox";
      const likeTx = el("span");
      likeRow.append(likeCb, el("i"), likeTx);
      archBox.append(albSel, albNew, archNote, likeRow);
      let albums = null;
      const loadAlbums = async () => {
        if (albums) return;
        albSel.textContent = "";
        albSel.append(new Option("Новый альбом", "new"));
        albums = [];
        try { albums = await W.modules.archive.albums(); } catch (e) { archNote.textContent = "Не удалось загрузить альбомы: " + err(e); }
        for (const a of albums) {
          const o = new Option(`${a.title} · ${a.count}`, a.id);
          if (a.count >= 50) { o.disabled = true; o.textContent = `${a.title} — заполнен`; }
          albSel.append(o);
        }
        paintWhere();
      };
      albSel.onchange = () => paintWhere();
      const titleOf = () => (picked ? (picked.version ? `${picked.title} (${picked.version})` : picked.title) : g.title);
      function paintWhere() {
        optLike.classList.toggle("on", dest === "like");
        optLocal.classList.toggle("on", dest === "local");
        optArch.classList.toggle("on", dest === "archive");
        const pt = picked ? titleOf() : "";
        // синхронизация через архив (libsync.js) включена — трек будет и на других устройствах
        // (строки целиком, а не склейкой: так их переводит i18n.js)
        const all = !!window.libsyncActive?.();
        optLike._note.textContent = picked
          ? (all ? `Вместо «${pt}» будет играть твой файл, а сам трек лайкнется. На всех устройствах — через Whisper Archive`
            : `Вместо «${pt}» будет играть твой файл, а сам трек лайкнется. Только на этом компьютере`)
          : (all ? "Появится в «Лайках» и в «Моих версиях» студии. На всех устройствах — через Whisper Archive"
            : "Появится в «Лайках» и в «Моих версиях» студии. Только на этом компьютере");
        optLocal._note.textContent = picked
          ? (all ? `Вместо «${pt}» будет играть твой файл, без лайка. На всех устройствах — через Whisper Archive`
            : `Вместо «${pt}» будет играть твой файл, без лайка. Только на этом компьютере`)
          : "Только в «Моих версиях» студии, без лайка";
        likeRow.hidden = !picked;
        if (picked) likeTx.textContent = `Лайкнуть «${pt}»`;
        archBox.hidden = dest !== "archive";
        if (dest !== "archive") return;
        albNew.hidden = albSel.value !== "new";
        if (!albNew.value || albNew.dataset.auto === "1") { albNew.value = (picked?.album?.title || titleOf()).slice(0, 75); albNew.dataset.auto = "1"; }
        const arch = W.modules.archive;
        const n = picked ? nameOf(picked) : [g.artist, g.title].filter(Boolean).join(" - ");
        archNote.textContent = !picked ? `Файл будет называться «${n}».`
          : arch?.playing?.() ? `Файл будет называться «${n}» — вместо версии Яндекса заиграет он.`
          : `Файл будет называться «${n}». Чтобы он играл вместо версии Яндекса, включи «Играть треки из архива» в Настройках → Интеграции.`;
      }
      albNew.addEventListener("input", () => { albNew.dataset.auto = "0"; });
      optLike.onclick = () => { dest = "like"; paintWhere(); };
      optLocal.onclick = () => { dest = "local"; paintWhere(); };
      optArch.onclick = async () => {
        if (!W.modules.archive?.connected?.()) {
          const ok = await W.modules.archive?.login?.("Чтобы сохранить трек в архив, войди.");
          if (!ok) return;
        }
        dest = "archive"; paintWhere(); loadAlbums();
      };

      const errp = el("p", "status");
      const row = el("div", "row");
      const no = el("button", "nav", "Отмена"); no.type = "button";
      const yes = el("button", "nav active", "Готово"); yes.type = "submit";
      row.append(no, yes);
      box.append(h, file, h1, q, cands, qnote, h2, where, archBox, errp, row);
      wrap.append(box);
      document.body.append(wrap);
      hint.hidden = true;

      const done = (v) => {
        document.removeEventListener("keydown", onKey, true);
        if (audioEl) { audioEl.pause(); audioEl.src = ""; }
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        wrap.remove(); resolve(v);
      };
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
      document.addEventListener("keydown", onKey, true);
      no.onclick = () => done(null);
      wrap.onpointerdown = (e) => { if (e.target === wrap) done(null); };
      box.onsubmit = async (e) => {
        e.preventDefault();
        yes.disabled = true; errp.textContent = "";
        try {
          if (dest === "archive") await toArchive(); else await toLocal(dest === "like");
          done(true);
        } catch (er) { errp.textContent = err(er); yes.disabled = false; }
      };

      // лайк самому треку Яндекса (если ещё не стоит)
      const likeTrack = (t) => { const raw = t.raw || t; if (!isLiked(String(raw.id))) return toggleLike(raw); };
      async function toLocal(like) {
        const t = picked;
        const meta = t
          ? { srcTitle: t.title, artists: (t.raw?.artists || t.artists || []).slice(0, 6).map((a) => ({ id: a.id != null ? String(a.id).slice(0, 30) : undefined, name: String(a.name || "").slice(0, 120) })).filter((a) => a.name),
              coverUri: t.raw?.coverUri ? String(t.raw.coverUri).slice(0, 300) : undefined,
              albums: t.raw?.albums?.[0] ? [{ id: t.raw.albums[0].id != null ? String(t.raw.albums[0].id).slice(0, 30) : undefined, title: String(t.raw.albums[0].title || "").slice(0, 200) }] : [] }
          : { artists: g.artist ? [{ name: g.artist.slice(0, 120) }] : [], albums: g.album ? [{ title: g.album.slice(0, 200) }] : [] };
        const duration = info.ext === "mp3" ? null : await measure().catch(() => 0);
        const replaces = t ? String(t.id).split(":")[0] : null;
        const it = await invoke("drop_audio_local", { pick: f.id, title: titleOf(), meta, duration: duration || null, replaces, liked: like, link: typeof f.link === "string" ? f.link : null });
        window.studioAdd?.(it);
        if (t) {
          if (like) await likeTrack(t);
          const play = { label: "Слушать", fn: () => W.queue.play([t.raw || t]) };
          toast(like ? `Вместо «${it.title}» теперь играет твой файл, трек в «Лайках»` : `Вместо «${it.title}» теперь играет твой файл`, 5000, { kind: "ok", action: play });
        } else {
          const play = { label: "Слушать", fn: () => window.studioPlay?.(it.id) };
          const here = window.libsyncActive?.() ? `«${it.title}» — в «Лайках»` : `«${it.title}» — в «Лайках», только на этом компьютере`;
          toast(like ? here : `«${it.title}» сохранён в «Моих версиях» студии`, 4500, { kind: "ok", action: play });
        }
      }
      async function toArchive() {
        const arch = W.modules.archive;
        if (!arch?.connected?.()) throw new Error("Нужен вход в Whisper Archive");
        const albumId = albSel.value && albSel.value !== "new" ? albSel.value : null;
        const args = { pick: f.id, fileName: picked ? nameOf(picked) : [g.artist, g.title].filter(Boolean).join(" - "), albumId, albumTitle: null, coverUrl: null, coverBytes: null };
        if (!albumId) {
          args.albumTitle = albNew.value.trim().slice(0, 75);
          if (!args.albumTitle) throw new Error("Дай альбому название");
          const cu = picked ? W.cover(picked, 800) : "";
          if (cu) args.coverUrl = cu; else args.coverBytes = await plainCover(args.albumTitle);
        }
        yes.textContent = "Загружаю…";
        const r = await invoke("drop_audio_archive", args);
        if (r.status < 200 || r.status >= 300) {
          let m = ""; try { const b = JSON.parse(r.body || "null"); m = b?.message || b?.title || ""; } catch {}
          throw new Error(r.status === 401 || r.status === 403 ? "Архив не принял вход — войди заново (Настройки → Интеграции)" : `Архив ответил ${r.status}${m ? ": " + m : ""}`);
        }
        await arch.remember(picked ? (picked.raw || picked) : null, r).catch(() => {});
        if (picked && likeCb.checked) await likeTrack(picked);
        const where = albumId ? `в альбом «${albums.find((a) => a.id === albumId)?.title || ""}»` : `в новый альбом «${args.albumTitle}»`;
        toast(picked && arch.playing?.() ? `Сохранено ${where} — теперь вместо версии Яндекса играет твой файл` : `Сохранено ${where}`, 5000, { kind: "ok" });
      }

      const kitImage = (t) => (W.ui.kit?.image ? W.ui.kit.image(W.cover(t, 100), "dcart") : el("span", "dcart"));
      paintCands([]);
      paintWhere();
      search();
      q.focus();
    });
  }
})();
