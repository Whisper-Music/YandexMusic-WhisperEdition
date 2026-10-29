// Звук: нормализация громкости, качество потока, режим вывода и сведения о формате.
// Вкладка настроек «Звук» и пункт «Звук и формат» в меню «⋯» нижней панели. Устройство вывода — output.js.
//
// Нормализация. Яндекс отдаёт у трека громкость по EBU R128: r128.i — интегральная громкость (LUFS),
// r128.tp — истинный пик (dBTP). Усиление = целевая громкость − громкость трека (или альбома), но не выше,
// чем позволяет пик (после усиления пик не громче −1 dBTP) — без ограничителя и без хрипа.
// * «По альбому»: одно усиление на весь альбом (громкость альбома — энергетическое среднее треков с учётом длины),
//   поэтому тихие и громкие треки внутри альбома остаются такими, как задумал автор.
// * «Авто»: альбом, который играет по порядку, — по альбому; волна, лайки, плейлисты, перемешивание — по трекам.
// Как применяется:
// * только приглушение — через громкость плеера (audio.volume), без звукового графа и без нагрузки на процессор;
// * «Поднимать тихие треки» — нужен GainNode, поэтому трек идёт через звуковой граф, как с эквалайзером.
(() => {
  const KEY = "ym_sound";
  const MODES = ["off", "track", "album", "auto"], TARGETS = [-11, -14, -16, -18];
  const s0 = lsJSON(KEY, {}, (v) => v && typeof v === "object");
  const cfgS = {
    mode: MODES.includes(s0.mode) ? s0.mode : "off",
    target: TARGETS.includes(s0.target) ? s0.target : -14,
    boost: !!s0.boost,
    quality: s0.quality === "low" ? "low" : "high",
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfgS)); } catch {} };
  const lin = (db) => Math.pow(10, db / 20);
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const fmtDb = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d).replace(".", ",");
  const MODE_NAME = { off: "Выключена", track: "По трекам", album: "По альбому", auto: "Авто" };

  // ---------- нормализация ----------
  const loud = (t) => { const r = t?.r128; return r && num(r.i) !== null ? { i: r.i, tp: num(r.tp) ?? 0 } : null; };
  const albumCtx = () => playCtx === "album" && queue.length > 1;
  function scope() {
    if (cfgS.mode === "album") return albumCtx() ? "album" : "track";
    if (cfgS.mode === "auto") return albumCtx() && !shuffle ? "album" : "track";
    return cfgS.mode === "track" ? "track" : "off";
  }
  // громкость альбома: энергетическое среднее по трекам с известной громкостью (вес — длительность), пик — наибольший
  let albCache = { q: null, len: 0, v: null };
  function albumLoud() {
    if (albCache.q === queue && albCache.len === queue.length) return albCache.v;
    let e = 0, w = 0, tp = -Infinity;
    for (const t of queue) {
      const l = loud(t);
      if (!l) continue;
      const d = Math.max(1, (t.durationMs || 180000) / 1000);
      e += d * Math.pow(10, l.i / 10); w += d; tp = Math.max(tp, l.tp);
    }
    const v = w ? { i: 10 * Math.log10(e / w), tp } : null;
    albCache = { q: queue, len: queue.length, v };
    return v;
  }
  // текущее усиление в дБ и откуда оно: { db, scope, src: {i, tp} | null }
  function gainNow() {
    const sc = scope(), t = queue[current];
    if (sc === "off" || !t) return { db: 0, scope: sc, src: null };
    const src = sc === "album" ? albumLoud() || loud(t) : loud(t);
    if (!src) return { db: 0, scope: sc, src: null };
    let db = cfgS.target - src.i;
    if (db > 0) db = cfgS.boost ? Math.min(db, -1 - src.tp, 12) : 0;   // подъём — только в запас до пика
    db = Math.max(-24, Math.min(12, db));
    return { db: Math.round(db * 10) / 10, scope: sc, src };
  }
  const inGraph = (a = audio) => !!(a && a._src && actx);
  // main.js: громкость плеера = громкость пользователя × это (приглушение без графа; с графом всё делает GainNode)
  // свой движок (эксклюзивный режим) — цифровая громкость: и приглушение, и подъём делает он сам
  window.normElK = (a = audio) => (a?._native ? lin(gainNow().db) : inGraph(a) ? 1 : Math.min(1, lin(gainNow().db)));
  // main.js: vizWanted — подъём тихих треков требует звукового графа (кроме своего движка)
  window.normWantsGraph = () => cfgS.mode !== "off" && cfgS.boost && !window.engine?.on();
  // main.js: makeAudio подключает анализатор не к динамикам, а к этому узлу усиления
  let node = null;
  window.normNode = () => {
    if (!node || node.context !== actx) { node = actx.createGain(); node.connect(actx.destination); }
    return node;
  };
  // пересчитать и применить (новый трек, смена настроек, новый плеер)
  function apply() {
    if (!audio) return;
    const g = gainNow();
    if (node && node.context === actx) {
      const v = inGraph() ? lin(g.db) : 1;
      try { node.gain.setTargetAtTime(v, actx.currentTime, 0.05); } catch { node.gain.value = v; }
    }
    audio.volume = outVol();
    paintFmt();
  }
  window.normApply = apply;

  function setNorm(patch) {
    Object.assign(cfgS, patch); save();
    apply();
    // подъём включили — переводим играющий трек на звуковой граф (как эквалайзер), с той же позиции
    if (window.normWantsGraph() && !audioViz && audio && audio.src && !needLoad) Promise.resolve(ensureVizAudio()).finally(apply);
    paintNorm();
  }

  // ---------- качество ----------
  window.ymQuality = () => cfgS.quality;
  function setQuality(q) {
    cfgS.quality = q === "low" ? "low" : "high"; save(); paintQual();
    showToast(q === "low" ? "Экономное качество — со следующего трека" : "Лучшее качество — со следующего трека", 3000, { kind: "ok" });
  }

  // ---------- сведения о формате ----------
  let eps = [], epsAt = 0;
  async function loadEndpoints(force = false) {
    if (!force && Date.now() - epsAt < 15000) return eps;
    try { eps = await invoke("audio_endpoints"); } catch { eps = []; }
    epsAt = Date.now();
    return eps;
  }
  const fmtWave = (f) => {
    if (!f) return "";
    const ch = f.channels === 1 ? "моно" : f.channels === 2 ? "стерео" : `${f.channels} кан.`;
    return `${f.bits} бит${f.float ? " (float)" : ""} · ${(f.rate / 1000).toLocaleString("ru-RU")} кГц · ${ch}`;
  };
  // текущее устройство: выбранное в output.js; сопоставляем с Windows по названию, иначе — устройство по умолчанию
  function endpointNow() {
    const o = window.outInfo?.() || { label: "", isDefault: true };
    const norm = (x) => String(x || "").trim().toLowerCase();
    return (!o.isDefault && eps.find((e) => norm(e.name) === norm(o.label))) || eps.find((e) => e.default) || null;
  }
  let trackFmt = { id: null, v: null };
  async function info() {
    const t = queue[current];
    const rows = [];
    if (!t) return [["Сейчас", "ничего не играет"]];
    const ei = audio?._native ? window.engine?.info() : null;   // эксклюзивный режим: формат знает движок
    const khz = (r) => (r / 1000).toLocaleString("ru-RU") + " кГц";
    // источник
    if (ei) {
      const where = curLocal ? "Скачанный файл" : curFromWa ? "Whisper Archive" : "Яндекс Музыка";
      const fmt = [String(ei.codec || "").toUpperCase(), ei.src_bits ? `${ei.src_bits} бит` : "", khz(ei.src_rate)].filter(Boolean).join(" · ");
      rows.push(["Источник", `${where} · ${fmt}`]);
    } else if (curLocal) rows.push(["Источник", "Скачанный файл (MP3), с диска"]);
    else if (curFromWa) rows.push(["Источник", "Whisper Archive"]);
    else {
      if (trackFmt.id !== t.id) { trackFmt = { id: t.id, v: await invoke("ym_track_format", { id: String(t.id) }).catch(() => null) }; }
      const f = trackFmt.v;
      rows.push(["Источник", f ? `Яндекс Музыка · ${String(f.codec).toUpperCase()} ${f.bitrate} кбит/с` : "Яндекс Музыка"]);
      if (f?.options?.length > 1) rows.push(["Доступно", f.options.map((k) => `${k}`).join(" / ") + " кбит/с"]);
    }
    // громкость и нормализация
    const l = loud(t), g = gainNow();
    rows.push(["Громкость трека", l ? `${fmtDb(l.i)} LUFS · пик ${fmtDb(l.tp)} dBTP` : "нет данных"]);
    if (g.scope === "album" && g.src) rows.push(["Громкость альбома", `${fmtDb(g.src.i)} LUFS`]);
    rows.push(["Нормализация", cfgS.mode === "off" ? "выключена"
      : !g.src ? "нет данных о громкости — без изменений"
      : `${fmtDb(g.db)} дБ · ${g.scope === "album" ? "по альбому" : "по треку"}${g.db > 0 ? "" : g.db === 0 && !cfgS.boost && cfgS.target > g.src.i ? " (трек тише цели, подъём выключен)" : ""}`]);
    if (ei) {
      // эксклюзивный режим: что именно уходит на устройство и меняется ли звук по дороге
      const g = audio.volume;
      const proc = [];
      if (ei.resampled) proc.push(`пересчёт частоты ${khz(ei.src_rate)} → ${khz(ei.out_rate)}`);
      if (g !== 1) proc.push(`громкость ${fmtDb(20 * Math.log10(Math.max(g, 1e-4)))} дБ`);
      rows.push(["Обработка", proc.length ? proc.join(" · ") : "нет — бит-в-бит"]);
      await loadEndpoints();
      const ep = endpointNow();
      rows.push(["Устройство", ep?.name || window.outInfo?.()?.label || "системное по умолчанию"]);
      const bits = ei.out_float ? "32 бит float" : ei.out_container !== ei.out_bits ? `${ei.out_bits} бит (в ${ei.out_container})` : `${ei.out_bits} бит`;
      rows.push(["Вывод", `${bits} · ${khz(ei.out_rate)} · стерео`]);
      rows.push(["Режим вывода", `эксклюзивный (WASAPI), буфер ${Math.round(ei.period_ms)} мс`]);
      return rows;
    }
    // обработка
    const chain = [];
    if (window.eqActive?.()) chain.push("эквалайзер");
    if (cfg.viz && (wave.on || !$("#wavePage").hidden)) chain.push("визуализатор");
    if (window.normWantsGraph()) chain.push("подъём громкости");
    rows.push(["Обработка", inGraph() ? `звуковой граф ${(actx.sampleRate / 1000).toLocaleString("ru-RU")} кГц, 32 бит float${chain.length ? " · " + chain.join(", ") : ""}` : "без обработки, напрямую"]);
    // устройство
    await loadEndpoints();
    const ep = endpointNow(), o = window.outInfo?.();
    rows.push(["Устройство", ep?.name || o?.label || "системное по умолчанию"]);
    if (ep?.device) rows.push(["Формат устройства", fmtWave(ep.device)]);
    if (ep?.mix) rows.push(["Микшер Windows", fmtWave(ep.mix)]);
    rows.push(["Режим вывода", window.engine?.wanted?.() ? "общий (эксклюзивный не удался)" : "общий (через микшер Windows)"]);
    return rows;
  }

  // ---------- вкладка «Звук» ----------
  const $s = (id) => document.getElementById(id);
  const segPaint = (box, v) => box?.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.v === String(v)));
  function paintNorm() {
    segPaint($s("nmMode"), cfgS.mode);
    segPaint($s("nmTarget"), cfgS.target);
    const b = $s("nmBoost"); if (b) b.checked = cfgS.boost;
    $s("nmBox")?.classList.toggle("off", cfgS.mode === "off");
    const n = $s("nmNote");
    if (n) n.textContent = cfgS.mode === "off" ? ""
      : cfgS.boost ? "Тихие треки поднимаются через звуковую цепочку (как с эквалайзером): трек загружается целиком перед началом, чуть больше нагрузка."
      : "Громкие треки приглушаются до целевой громкости. Тихие остаются как есть — включи подъём, если нужно.";
  }
  function paintQual() { segPaint($s("qlSeg"), cfgS.quality); }
  let fmtBusy = false;
  async function paintFmt(force = false) {
    const box = $s("fmtList");
    if (!box || fmtBusy) return;
    const page = $s("settingsPage");
    if (!force && (page?.hidden || page?.dataset.tab !== "out")) return;
    fmtBusy = true;
    try {
      if (force) await loadEndpoints(true);
      const rows = await info();
      box.textContent = "";
      for (const [k, v] of rows) {
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd"); dd.textContent = v;
        box.append(dt, dd);
      }
    } finally { fmtBusy = false; }
  }
  window.soundRefresh = () => paintFmt();

  $s("nmMode")?.addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c) setNorm({ mode: c.dataset.v }); });
  $s("nmTarget")?.addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c) setNorm({ target: Number(c.dataset.v) }); });
  $s("nmBoost")?.addEventListener("change", (e) => setNorm({ boost: e.target.checked }));
  $s("qlSeg")?.addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c && c.dataset.v !== cfgS.quality) setQuality(c.dataset.v); });
  $s("fmtRefresh")?.addEventListener("click", () => paintFmt(true));
  const page = $s("settingsPage");
  if (page) new MutationObserver(() => paintFmt(true)).observe(page, { attributes: true, attributeFilter: ["hidden", "data-tab"] });
  navigator.mediaDevices?.addEventListener?.("devicechange", () => { epsAt = 0; paintFmt(); });
  paintNorm(); paintQual();

  // ---------- меню «⋯» нижней панели ----------
  window.soundMenu = (t, ctx) => {
    const it = menuItem(ICON.high, "Звук и формат", () => subMenu(t, ctx), { keep: true, arrow: true });
    const s = document.createElement("small"); s.className = "mosub";
    s.textContent = cfgS.mode === "off" ? "" : `норм.: ${MODE_NAME[cfgS.mode].toLowerCase()}`;
    it.querySelector(".mt")?.after(s);
  };
  async function subMenu(t, ctx) {
    const seq = menuReset();
    menuHead("Звук и формат", () => trackMenuMain(t, ctx));
    const wait = menuNote("Сведения собираются…");
    placeMenu();
    const rows = await info();
    if (!menuAlive(seq)) return;
    wait.remove();
    const dl = document.createElement("dl"); dl.className = "mfmt";
    for (const [k, v] of rows) {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v;
      dl.append(dt, dd);
    }
    tmenu.append(dl);
    menuSep();
    menuNote("Нормализация громкости");
    for (const m of MODES) {
      const b = menuItem(cfgS.mode === m ? ICON.outOk : "<i class='moempty'></i>", MODE_NAME[m], () => { setNorm({ mode: m }); subMenu(t, ctx); }, { keep: true });
      b.classList.toggle("on", cfgS.mode === m);
    }
    menuSep();
    menuNote("Качество потока");
    for (const [q, name] of [["high", "Лучшее (MP3 320)"], ["low", "Экономное"]]) {
      const b = menuItem(cfgS.quality === q ? ICON.outOk : "<i class='moempty'></i>", name, () => { if (cfgS.quality !== q) setQuality(q); subMenu(t, ctx); }, { keep: true });
      b.classList.toggle("on", cfgS.quality === q);
    }
    menuSep();
    menuItem(ICON.eq || "", "Настройки звука…", () => {
      $("#settingsBtn")?.click();
      document.querySelector('#settingsPage .chip[data-tab="out"]')?.click();
    });
    placeMenu();
  }
})();
