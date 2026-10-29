// Свой звуковой движок (Rust, engine.rs): эксклюзивный WASAPI — звук идёт на устройство напрямую, мимо микшера Windows.
//
// Здесь «плеер» с теми же свойствами и событиями, что у <audio> (paused, currentTime, duration, volume, play(), pause(),
// onplay/onpause/onplaying/onended/ontimeupdate/onseeked, addEventListener…): main.js (makeAudio) создаёт его вместо
// Audio, когда включён эксклюзивный режим, и дальше работает с ним как с обычным плеером. Трек задаётся не адресом,
// а источником и номером (setTrack) — файл Rust берёт сам.
//
// Устройство отказало (занято, запрещён монопольный режим, не тот формат) — до следующего включения режима
// играем в общем режиме, а трек сразу перезапускается обычным путём (main.js: EngineFallback).
(() => {
  const KEY = "ym_engine";
  let want = lsJSON(KEY, false, (v) => typeof v === "boolean");
  let avail = false, fallback = false;
  let info = null;                 // формат последнего трека в движке (LoadInfo из engine.rs)
  let active = null;               // плеер, который сейчас загружен в движок
  let rateWarned = false;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(want)); } catch {} };
  const on = () => want && avail && !fallback;

  // устройство для движка: выбранное в «Устройстве вывода» (output.js), сопоставленное по названию; иначе — по умолчанию
  async function deviceId() {
    const o = window.outInfo?.();
    if (!o || o.isDefault) return null;
    let eps = [];
    try { eps = await invoke("audio_endpoints"); } catch {}
    const n = (x) => String(x || "").trim().toLowerCase();
    return eps.find((e) => n(e.name) === n(o.label))?.id || null;
  }

  function goFallback(msg) {
    fallback = true; info = null;
    showToast(`Эксклюзивный режим недоступен: ${msg}. звук идёт в общем режиме`, 8000, { kind: "err", action: { label: "Настройки", fn: openOut } });
    paint();
  }
  // ошибки Rust: «WASAPI: …» — устройство или формат (возврат в общий режим), «LOCAL: …» — скачанный файл пропал
  function toErr(e) {
    const m = String(e?.message || e);
    const err = new Error(m.replace(/^(WASAPI|LOCAL):\s*/, ""));
    err.name = /^WASAPI:/.test(m) ? "EngineFallback" : /^LOCAL:/.test(m) ? "NotSupportedError" : "Error";
    if (err.name === "EngineFallback") goFallback(err.message);
    return err;
  }

  class NativeAudio extends EventTarget {
    constructor() {
      super();
      this._native = true; this._track = null; this._loaded = false; this._gen = 0; this._req = 0;
      this._pos = 0; this._start = 0; this._vol = 1; this._dur = NaN; this._rate = 1;
      this.paused = true; this.ended = false; this.seeking = false; this.readyState = 0; this.error = null;
      this.crossOrigin = null; this.preservesPitch = true; this.defaultPlaybackRate = 1; this.sinkId = "";
      this.onplay = this.onpause = this.onplaying = this.onended = this.ontimeupdate = this.onseeked = null;
    }
    _emit(type) {
      try { this["on" + type]?.call(this, new Event(type)); } catch (e) { console.error(e); }
      this.dispatchEvent(new Event(type));
    }
    get src() { return this._track ? `engine:${this._track.kind}/${this._track.id}` : ""; }
    set src(v) { if (!v) this._unload(); }          // адресов движок не принимает — трек задаётся setTrack()
    get currentSrc() { return this.src; }
    get duration() { return this._dur; }
    get currentTime() { return this._pos; }
    set currentTime(t) {
      t = Math.max(0, Number(t) || 0);
      if (!this._loaded) { this._start = t; this._pos = t; return; }
      if (Math.abs(t - this._pos) < 0.05) return;
      this._pos = t; this.seeking = true; this.ended = false;
      invoke("engine_seek", { pos: t }).catch(() => { this.seeking = false; });
    }
    get volume() { return this._vol; }
    set volume(v) {
      this._vol = Math.max(0, Math.min(4, Number(v) || 0));
      if (active === this && this._loaded) invoke("engine_gain", { gain: this._vol }).catch(() => {});
    }
    get playbackRate() { return this._rate; }
    set playbackRate(v) {
      if (Number(v) !== 1 && !rateWarned) { rateWarned = true; showToast("В эксклюзивном режиме скорость не меняется", 4000); }
    }
    setSinkId() { return Promise.resolve(); }      // устройство движок открывает сам (deviceId)
    setTrack(tr, start = 0, durHint = 0) {
      this._unload();
      this._track = tr; this._start = start; this._pos = start; this.ended = false; this.error = null;
      this._dur = durHint > 0 ? durHint : NaN;
    }
    play() {
      if (!this._track) return Promise.reject(Object.assign(new Error("нет трека"), { name: "NotSupportedError" }));
      if (!this._loaded) return this._load();
      if (!this.paused) return Promise.resolve();
      if (this.ended) { this._pos = 0; this.ended = false; }
      this.paused = false; this._emit("play");
      return invoke("engine_play").then(() => this._emit("playing"), (e) => { this.paused = true; this._emit("pause"); throw toErr(e); });
    }
    pause() {
      if (this.paused) return;
      this.paused = true;
      if (this._loaded) invoke("engine_pause").catch(() => {});
      this._emit("pause");
    }
    load() { if (!this._track) this._unload(); }
    removeAttribute(name) { if (name === "src") this._unload(); }
    _unload() {
      this._req++;
      if (active === this) { active = null; invoke("engine_stop", { gen: this._gen || null }).catch(() => {}); }
      this._loaded = false; this._track = null; this.paused = true; this.readyState = 0;
    }
    async _load() {
      const my = ++this._req, tr = this._track;
      this.paused = false; this._emit("play");
      active = this;
      let r;
      try {
        r = await invoke("engine_load", { kind: tr.kind, id: tr.id, quality: tr.quality || null, device: await deviceId(), start: this._start || 0, gain: this._vol });
      } catch (e) {
        if (my !== this._req) throw Object.assign(new Error("устарело"), { name: "AbortError" });
        if (active === this) active = null;
        this.paused = true;
        this.error = toErr(e);
        this._emit("error");
        throw this.error;
      }
      if (my !== this._req) throw Object.assign(new Error("устарело"), { name: "AbortError" });
      info = r; this._gen = r.gen; this._loaded = true; this.readyState = 4;
      if (r.duration > 0) this._dur = r.duration;
      invoke("engine_gain", { gain: this._vol }).catch(() => {});       // громкость могла поменяться, пока трек грузился
      this._emit("loadedmetadata");
      if (this.paused) invoke("engine_pause").catch(() => {});          // пауза нажата во время загрузки
      else this._emit("playing");
      window.soundRefresh?.();
    }
  }

  // события движка: позиция, перемотка, конец трека, сбой устройства посреди трека
  window.__TAURI__.event?.listen("engine", (e) => {
    const p = e.payload || {}, a = active;
    if (!a || p.gen !== a._gen) return;
    if (p.kind === "pos") { if (!a.seeking) a._pos = p.pos; a._emit("timeupdate"); }
    else if (p.kind === "seeked") { a._pos = p.pos; a.seeking = false; a._emit("seeked"); a._emit("timeupdate"); }
    else if (p.kind === "ended") {
      a._pos = a._dur > 0 ? a._dur : p.pos;
      a.ended = true; a.paused = true;
      a._emit("pause"); a._emit("ended");
    } else if (p.kind === "error") {
      const pos = a._pos;
      active = null; a._loaded = false; a.paused = true;
      goFallback(String(p.msg || "").replace(/^WASAPI:\s*/, ""));
      a._emit("pause");
      if (queue[current]) play(current, pos, true);          // доигрываем трек в общем режиме с того же места
    }
  });

  window.engine = { on, wanted: () => want, info: () => (on() ? info : null), available: () => avail, create: () => new NativeAudio() };

  // ---------- переключение режима ----------
  function openOut() {
    $("#settingsBtn")?.click();
    document.querySelector('#settingsPage .chip[data-tab="out"]')?.click();
  }
  // предупреждение перед включением: что изменится, коротко и по делу
  function warn() {
    return new Promise((resolve) => {
      closeTrackMenu?.();
      const wrap = document.createElement("div"); wrap.className = "login modal";
      const box = document.createElement("div"); box.className = "panel login-box modalbox exclbox";
      box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Эксклюзивный режим");
      const h = document.createElement("h2"); h.textContent = "Эксклюзивный режим";
      const p = document.createElement("p");
      p.textContent = "Whisper будет отдавать звук устройству напрямую, мимо микшера Windows — в частоте и разрядности самого трека.";
      const ul = document.createElement("ul"); ul.className = "excllist";
      for (const t of [
        "Пока играет Whisper, другие программы на этом устройстве не слышны: браузер, Discord, уведомления.",
        "Системная громкость не действует — громкость меняется только в Whisper. Начни с небольшой.",
        "Эквалайзер, визуализатор и смена скорости не работают.",
        "Если устройство занято или не примет формат, Whisper сам вернётся в общий режим.",
      ]) { const li = document.createElement("li"); li.textContent = t; ul.append(li); }
      const row = document.createElement("div"); row.className = "row";
      const no = document.createElement("button"); no.type = "button"; no.className = "nav"; no.textContent = "Отмена";
      const yes = document.createElement("button"); yes.type = "button"; yes.className = "nav active"; yes.textContent = "Включить";
      row.append(no, yes);
      box.append(h, p, ul, row); wrap.append(box); document.body.append(wrap);
      const done = (v) => { document.removeEventListener("keydown", onKey, true); wrap.remove(); resolve(v); };
      const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); done(false); } };
      document.addEventListener("keydown", onKey, true);
      no.onclick = () => done(false); yes.onclick = () => done(true);
      wrap.onpointerdown = (ev) => { if (ev.target === wrap) done(false); };
      yes.focus();
    });
  }
  async function setMode(excl) {
    if (excl && !avail) return;
    if (excl ? on() : !want) return;                 // уже так
    if (excl && !(await warn())) { paint(); return; }
    want = excl; fallback = false; save(); paint();
    // играющий трек переезжает на другой движок с той же позиции; на паузе — загрузится по «Играть»
    if (audio && queue[current] && !needLoad) {
      const pos = audio.currentTime || 0;
      if (!audio.paused) play(current, pos, true);
      else { audio.pause(); audio.removeAttribute("src"); audio.load(); needLoad = true; resumePos = pos; }
    }
    showToast(excl ? "Эксклюзивный режим включён" : "Общий режим", 2500, { kind: "ok" });
    window.soundRefresh?.();
  }
  window.engineSetMode = setMode;

  function paint() {
    const seg = document.getElementById("omSeg");
    if (!seg) return;
    seg.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", (c.dataset.v === "excl") === on()));
    const ex = seg.querySelector('[data-v="excl"]');
    if (ex) { ex.disabled = !avail; if (!avail) ex.title = "Есть только в Windows"; }
    const n = document.getElementById("omNote");
    if (n) n.textContent = want && fallback ? "Устройство отказало — сейчас играет общий режим. Нажми «Эксклюзивный», чтобы попробовать снова." : "";
  }
  document.getElementById("omSeg")?.addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c || c.disabled) return;
    setMode(c.dataset.v === "excl");
  });
  invoke("engine_available").then((v) => { avail = !!v; paint(); }).catch(() => {});
  paint();
})();
