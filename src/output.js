// Устройство вывода звука: вкладка настроек «Звук» и пункт «Устройство вывода» в меню «⋯» нижней панели.
//
// Звук играет страница: <audio> напрямую или через Web Audio (визуализатор, эквалайзер — main.js: makeAudio).
// Устройство задаётся у обоих: audio.setSinkId и actx.setSinkId. Пустой id — системное устройство по умолчанию,
// оно само следует за Windows (сменили устройство в системе — звук переехал туда же).
//
// Названия и идентификаторы динамиков Chromium (WebView2) отдаёт только с разрешением на микрофон. Его выдаёт
// Rust (audiodev.rs) — разово, на 5 секунд и до закрытия программы; поток микрофона закрывается сразу же.
// Запрос делается, только когда список действительно нужен: открыта вкладка «Звук» или подменю в «⋯»,
// либо выбрано не системное устройство (без разрешения WebView2 не даст вывести звук на него).
(() => {
  const KEY = "ym_out";
  const canEl = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && !!navigator.mediaDevices?.enumerateDevices;
  const canCtx = typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
  // выбранное устройство: id и название (название — чтобы показать его, пока список не загружен)
  let want = lsJSON(KEY, { id: "", label: "" }, (v) => v && typeof v === "object" && typeof v.id === "string");
  if (typeof want.label !== "string") want.label = "";
  let devices = [], defLabel = "", unlocked = false, listed = false;
  let missing = false;            // выбранное устройство сейчас отключено — звук на системном
  let unlockP = null;

  ICON.speaker = svgp("M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm8 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z");
  ICON.outOk = svgp("M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z");

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(want)); } catch {} };
  const SYS = "Системное по умолчанию";
  // «Default - Динамики (Realtek)» / «По умолчанию - …» → «Динамики (Realtek)»
  const stripDef = (s) => String(s || "").replace(/^[^-–]{2,24}\s[-–]\s/, "");
  const nameOf = (id) => (id ? devices.find((d) => d.id === id)?.label || want.label || "Устройство" : SYS);

  // ---------- разрешение и список ----------
  function unlock() {
    if (unlocked) return Promise.resolve(true);
    return (unlockP ||= (async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (list.some((d) => d.kind === "audiooutput" && d.label)) return (unlocked = true);
        if (!(await invoke("audio_devices_unlock"))) return false;
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());       // микрофон не нужен — только разрешение
        return (unlocked = true);
      } catch { return false; }
    })().finally(() => { unlockP = null; }));
  }
  async function refresh(ask = true) {
    if (!canEl) return devices;
    if (ask) await unlock();
    let list = [];
    try { list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput"); } catch {}
    defLabel = stripDef(list.find((d) => d.deviceId === "default")?.label);
    devices = list
      .filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d) => ({ id: d.deviceId, label: d.label || "Устройство без названия" }));
    listed = devices.length > 0;
    return devices;
  }

  // ---------- применение ----------
  // На какой id реально выводить: выбранное устройство, если оно есть (или список ещё не известен), иначе системное.
  const target = () => (want.id && (!listed || devices.some((d) => d.id === want.id)) ? want.id : "");
  // Звук идёт через Web Audio (визуализатор, эквалайзер) — выход определяет actx, а setSinkId у захваченного
  // <audio> WebView2 часто обрывает с AbortError («operation could not be performed and was aborted»), хотя
  // контекст уже переключился. Поэтому: вызовы строго по очереди (параллельные setSinkId тоже обрываются),
  // главный — тот, через кого реально идёт звук; ошибка второстепенного не считается неудачей.
  const sinkOf = (o) => (typeof o?.sinkId === "string" ? o.sinkId : "");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function setOne(o, id) {
    if (sinkOf(o) === id) return;
    try { await o.setSinkId(id); }
    catch (e) {
      if (e?.name !== "AbortError") throw e;
      await wait(200);
      if (sinkOf(o) === id) return;           // оборвалось, но устройство всё же сменилось
      await o.setSinkId(id);                  // одна повторная попытка
    }
  }
  let sinkChain = Promise.resolve();
  function sinkOn(a, id) {
    const job = sinkChain.then(async () => {
      const ctx = actx && canCtx && (!a || a._src) ? actx : null;
      if (ctx) await setOne(ctx, id);
      if (a?.setSinkId) {
        try { await setOne(a, id); } catch (e) { if (!ctx) throw e; }
      }
    });
    sinkChain = job.catch(() => {});
    return job;
  }
  // вывести звук на нужное устройство; отказ без разрешения — получить разрешение и повторить; устройства нет — системное
  async function applyTo(a) {
    const id = target();
    try { await sinkOn(a, id); return id; }
    catch (e) {
      if (id && e?.name === "NotAllowedError" && (await unlock())) {
        try { await sinkOn(a, id); return id; } catch (e2) { e = e2; }
      }
      if (!id) throw e;
      await refresh(false);
      try { await sinkOn(a, ""); } catch {}
      if (!missing) { missing = true; showToast(`«${want.label || "Выбранное устройство"}» недоступно — звук идёт на системное устройство`, 5000); }
      paint();
      return "";
    }
  }
  // sound.js: какое устройство сейчас играет — для «Сведений о формате»
  window.outInfo = () => ({ id: want.id, label: want.id && !missing ? want.label : defLabel, isDefault: !want.id || missing });
  // main.js: makeAudio вызывает для каждого нового плеера, play() ждёт a._sinkP перед audio.play()
  window.outBind = (a) => { a._sinkP = canEl ? applyTo(a).catch(() => "") : Promise.resolve(""); };

  async function select(id) {
    if (id && !devices.some((d) => d.id === id)) return;
    const prev = want;
    want = { id, label: id ? nameOf(id) : "" };
    missing = false;
    try {
      if (audio || (actx && canCtx)) await sinkOn(audio, id);
      save();
      showToast(id ? `Звук идёт на «${want.label}»` : "Звук идёт на системное устройство по умолчанию", 3000, { kind: "ok" });
    } catch (e) {
      want = prev;
      showToast("Не удалось переключить устройство: " + (e?.message || e), 5000, { kind: "err" });
    }
    paint();
    window.soundRefresh?.();
  }

  // Устройство отключили / подключили обратно (наушники, USB-ЦАП, Bluetooth)
  navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
    if (!canEl) return;
    await refresh(false);
    if (want.id && listed) {
      const has = devices.some((d) => d.id === want.id);
      if (!has && !missing) {
        missing = true;
        try { await sinkOn(audio, ""); } catch {}
        showToast(`«${want.label}» отключено — звук идёт на системное устройство`, 5000);
      } else if (has && missing) {
        missing = false;
        try { await sinkOn(audio, want.id); showToast(`Звук снова идёт на «${want.label}»`, 3000, { kind: "ok" }); } catch {}
      }
    }
    paint();
  });

  // ---------- вкладка «Звук» ----------
  const $o = (id) => document.getElementById(id);
  function paint() {
    const box = $o("outList");
    if (!box) return;
    box.textContent = "";
    const row = (id, label, sub) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "outdev"; b.setAttribute("role", "radio");
      const on = want.id === id;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false");
      const dot = document.createElement("i"); dot.className = "odot";
      const t = document.createElement("span"); t.className = "olbl"; t.textContent = label;
      b.append(dot, t);
      if (sub) { const s = document.createElement("small"); s.textContent = sub; b.append(s); }
      b.onclick = () => { if (want.id !== id) select(id); };
      box.append(b);
    };
    row("", SYS, defLabel || "следует за Windows");
    for (const d of devices) row(d.id, d.label, d.id === want.id && missing ? "отключено" : "");
    if (want.id && !devices.some((d) => d.id === want.id)) row(want.id, want.label || "Выбранное устройство", "не найдено");
    const note = $o("outNote");
    if (note) {
      note.textContent = !canEl ? "Выбор устройства недоступен — обнови WebView2."
        : !listed && !unlocked ? "Список недоступен: в системе нет микрофона или входа."
        : missing ? `«${want.label}» отключено — играет системное устройство.`
        : actx && !canCtx ? "С эквалайзером и визуализатором звук идёт на системное устройство — обнови WebView2." : "";
    }
  }
  async function load() { paint(); await refresh(true); paint(); }
  $o("outRefresh")?.addEventListener("click", load);

  // список загружается, когда вкладка «Звук» открыта (в т.ч. сразу при входе в настройки, если она была последней)
  const page = $o("settingsPage");
  let shownOnce = false;
  const onPage = () => {
    const vis = page && !page.hidden && page.dataset.tab === "out";
    if (vis && !shownOnce) load();
    shownOnce = !!vis;
  };
  if (page) new MutationObserver(onPage).observe(page, { attributes: true, attributeFilter: ["hidden", "data-tab"] });
  paint();

  // ---------- меню «⋯» нижней панели ----------
  window.outMenu = (t, ctx) => {
    if (!canEl) return;
    const it = menuItem(ICON.speaker, "Устройство вывода", () => subMenu(t, ctx), { keep: true, arrow: true });
    const s = document.createElement("small"); s.className = "mosub"; s.textContent = want.id ? want.label || "выбрано" : "системное";
    it.querySelector(".mt")?.after(s);
  };
  async function subMenu(t, ctx) {
    const seq = menuReset();
    menuHead("Устройство вывода", () => trackMenuMain(t, ctx));
    const wait = menuNote("Идёт поиск устройств…");
    placeMenu();
    await refresh(true);
    if (!menuAlive(seq)) return;
    wait.remove();
    const box = document.createElement("div"); box.className = "mscroll"; tmenu.append(box);
    const item = (id, label) => {
      const b = menuItem(want.id === id ? ICON.outOk : "<i class='moempty'></i>", label, () => select(id), { to: box });
      b.classList.toggle("on", want.id === id);
    };
    item("", defLabel ? `${SYS} (${defLabel})` : SYS);
    for (const d of devices) item(d.id, d.label);
    if (!devices.length) menuNote("Другие устройства не найдены.", box);
    menuSep();
    menuItem(ICON.eq || "", "Настройки звука…", () => {
      $("#settingsBtn")?.click();
      document.querySelector('#settingsPage .chip[data-tab="out"]')?.click();
    });
    placeMenu();
  }
})();
