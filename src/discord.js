// Discord Rich Presence: показывает в профиле Discord, что сейчас играет.
// Подключением занимается Rust (src-tauri/src/discord.rs): сам находит запущенный Discord,
// переподключается после его перезапуска и следит за лимитами. Здесь — переключатель в настройках,
// окно «Discord» (статус подключения, превью, параметры отображения) и «что играет».
(() => {
  const KEY = "ym_discord";
  const $d = (id) => document.getElementById(id);
  const DEF = { enabled: false, cover: true, button: true, showPaused: true, titleStatus: true };
  let dc = { ...DEF };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "1") dc.enabled = true;                                   // старый формат — просто «вкл»
    else if (raw) { const v = JSON.parse(raw); for (const k of Object.keys(DEF)) if (typeof v?.[k] === typeof DEF[k]) dc[k] = v[k]; }
  } catch {}
  let st = { state: "off", user: null };
  let started = false, last = "";

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(dc)); } catch {} };
  const call = (cmd, args) => Promise.resolve(invoke(cmd, args));

  // ---------- что играет ----------
  function snapshot() {
    const t = typeof current === "number" && current >= 0 ? queue?.[current] : null;
    if (!t || !started || !audio) return null;
    const al = t.albums?.[0];
    // Discord отсчитывает время по обычным часам, поэтому при скорости ≠ 1× длительность и позиция
    // пересчитываются в «настоящие» секунды: полоска и время окончания совпадают с тем, что слышно.
    const r = audio.playbackRate > 0 ? audio.playbackRate : 1;
    const dur = audio.duration > 0 && isFinite(audio.duration) ? audio.duration * 1000 : t.durationMs || 0;
    return {
      id: String(t.id ?? ""),
      title: String(t.title || "Без названия"),
      artist: (t.artists || []).map((a) => a?.name).filter(Boolean).join(", "),
      album: String(al?.title || ""),
      albumId: al?.id != null ? String(al.id) : "",
      cover: cover(t, "400x400") || "",
      durationMs: Math.round(dur / r),
      positionMs: Math.round(((audio.currentTime || 0) * 1000) / r),
      playing: !audio.paused,
    };
  }
  // вызывается из main.js при смене трека, паузе/воспроизведении и перемотке
  window.discordPush = (force) => {
    if (audio && !audio.paused) started = true;
    if (!dc.enabled) return;
    const s = snapshot();
    const key = s ? JSON.stringify({ ...s, positionMs: 0 }) : "";       // позиция меняется всегда — сравниваем без неё
    if (!force && key === last) return;
    last = key;
    call("discord_update", { track: s }).catch(() => {});
  };

  // ---------- подключение ----------
  async function apply() {
    try { st = await call("discord_config", { cfg: dc }); } catch {}
    paint();
    if (dc.enabled) { last = ""; window.discordPush(true); }
  }
  function set(patch) { Object.assign(dc, patch); save(); apply(); }

  const TEXT = {
    off:   ["Выключено", ""],
    on:    ["Подключено", "Статус обновляется сам"],
    wait:  ["Discord не запущен", "Подключение произойдёт автоматически, когда Discord откроется"],
    badid: ["Discord не принял подключение", "Попробуй перезапустить Discord"],
  };
  const label = () => (st.state === "on" && st.user?.name ? `Подключено: ${st.user.name}` : TEXT[st.state]?.[0] || "");

  function paint() {
    const sw = $d("dcOn"); if (sw) sw.checked = dc.enabled;
    const dot = $d("dcDot"); if (dot) dot.dataset.s = dc.enabled ? st.state : "off";
    const n = $d("dcNote"); if (n) n.textContent = dc.enabled ? label() : "Выключено";
    paintModal();
  }

  window.__TAURI__.event?.listen("discord-status", (e) => { if (e.payload && typeof e.payload === "object") { st = e.payload; paint(); } });

  // ---------- окно ----------
  let m = null, tick = 0;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function sw(text, tip, key) {
    const l = el("label", "switch"); l.title = tip;
    const i = el("input"); i.type = "checkbox"; i.checked = !!dc[key];
    i.onchange = () => set({ [key]: i.checked });
    l.append(i, el("i"), el("span", "", text));
    return l;
  }

  function openModal() {
    if (m) return;
    const wrap = el("div", "login modal");
    const box = el("div", "panel login-box modalbox dcmodal");

    // шапка: аккаунт и состояние
    const acc = el("div", "dcacc");
    const ava = el("div", "dcava"); const img = el("img"); img.alt = ""; ava.append(img);
    const who = el("div", "dcwho"); const wt = el("b"), ws = el("small"); who.append(wt, ws);
    const retry = el("button", "nav", "Повторить"); retry.type = "button";
    retry.onclick = () => { call("discord_retry").catch(() => {}); retry.disabled = true; setTimeout(() => (retry.disabled = false), 2000); };
    const main = el("label", "switch dcmain"); const mi = el("input"); mi.type = "checkbox";
    mi.onchange = () => set({ enabled: mi.checked });
    main.title = "Использовать Discord RPC"; main.append(mi, el("i"));
    acc.append(ava, who, retry, main);

    // превью — как это увидят в Discord
    const prev = el("div", "dcprev");
    const ph = el("small", "dcph", "Слушает");
    const pr = el("div", "dcprow");
    const pc = el("img", "dcpcov"); pc.alt = "";
    const pt = el("div", "dcptxt"); const p1 = el("b"), p2 = el("span"), p3 = el("span", "dcpalb"); pt.append(p1, p2, p3);
    pr.append(pc, pt);
    const bar = el("div", "dcbar"); const t1 = el("small"), tr = el("div", "dctrack"), fillEl = el("i"), t2 = el("small"); tr.append(fillEl); bar.append(t1, tr, t2);
    const pbtn = el("div", "dcpbtn", "Слушать в Яндекс Музыке");
    const empty = el("p", "dcempty", "Включи любой трек — здесь появится превью");
    prev.append(ph, pr, bar, pbtn, empty);

    // параметры
    const opts = el("div", "dcopts");
    opts.append(
      sw("Обложка трека", "Обложка альбома рядом со статусом", "cover"),
      sw("Кнопка «Слушать в Яндекс Музыке»", "Другие смогут открыть трек по кнопке в профиле", "button"),
      sw("Показывать на паузе", "Иначе статус пропадает, пока музыка на паузе", "showPaused"),
      sw("Название трека в списке участников", "Вместо названия приложения рядом с ником будет название трека", "titleStatus"),
    );

    const foot = el("div", "row");
    const done = el("button", "nav active", "Готово"); done.type = "button";
    foot.append(done);

    box.append(el("h2", "", "Discord"), acc, prev, opts, foot);
    wrap.append(box); document.body.append(wrap);

    const close = () => { document.removeEventListener("keydown", onKey, true); clearInterval(tick); wrap.remove(); m = null; };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    done.onclick = close;
    wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };

    m = { img, ava, wt, ws, retry, mi, prev, pc, p1, p2, p3, bar, t1, t2, fillEl, pbtn, empty, opts };
    paintModal();
    tick = setInterval(paintPreview, 1000);
  }

  function paintModal() {
    if (!m) return;
    const s = dc.enabled ? st.state : "off";
    m.mi.checked = dc.enabled;
    m.ava.dataset.s = s;
    const av = s === "on" && st.user?.avatar ? st.user.avatar : "";
    if (m.img.getAttribute("src") !== av) { if (av) m.img.src = av; else m.img.removeAttribute("src"); }
    m.wt.textContent = dc.enabled ? label() : "Выключено";
    m.ws.textContent = dc.enabled ? TEXT[s]?.[1] || "" : "Включи переключатель справа";
    m.retry.hidden = !(dc.enabled && (s === "wait" || s === "badid"));
    m.opts.classList.toggle("dim", !dc.enabled);
    paintPreview();
  }

  function paintPreview() {
    if (!m) return;
    const t = typeof current === "number" && current >= 0 ? queue?.[current] : null;
    const show = !!t;
    for (const x of [m.prev.querySelector(".dcph"), m.prev.querySelector(".dcprow"), m.bar, m.pbtn]) x.hidden = !show;
    m.empty.hidden = show;
    if (!show) return;
    const playing = audio && !audio.paused;
    const hiddenOnPause = !playing && !dc.showPaused;
    m.prev.classList.toggle("off", hiddenOnPause || !dc.enabled);
    m.prev.title = hiddenOnPause ? "На паузе статус не показывается" : "";
    const c = dc.cover ? cover(t, "200x200") : "";
    m.pc.hidden = !c;
    if (c && m.pc.getAttribute("src") !== c) m.pc.src = c;
    m.p1.textContent = t.title || "Без названия";
    const artist = (t.artists || []).map((a) => a?.name).filter(Boolean).join(", ") || "Неизвестный исполнитель";
    m.p2.textContent = playing ? artist : "⏸ " + artist;
    m.p3.textContent = t.albums?.[0]?.title || "";
    m.p3.hidden = !dc.cover || !m.p3.textContent;
    const dur = audio?.duration > 0 && isFinite(audio.duration) ? audio.duration * 1000 : t.durationMs || 0;
    const pos = (audio?.currentTime || 0) * 1000;
    m.bar.hidden = !playing || !dur;
    m.t1.textContent = fmt(pos); m.t2.textContent = fmt(dur);
    m.fillEl.style.width = dur ? Math.min(100, (pos / dur) * 100) + "%" : "0";
    m.pbtn.hidden = !dc.button;
  }

  // ---------- карточка в настройках ----------
  const swEl = $d("dcOn");
  if (swEl) swEl.onchange = (e) => set({ enabled: e.target.checked });
  const setup = $d("dcSetup"); if (setup) setup.onclick = openModal;

  call("discord_status").then((s) => { if (s) st = s; paint(); }).catch(() => paint());
  if (dc.enabled) apply();
})();
