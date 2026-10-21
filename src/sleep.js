// Режим сна: Моя волна под выбранное настроение, плавное затихание и выключение компьютера по таймеру.
// Сам таймер и выключение — в Rust (sleep.rs): он сработает, даже если страницу в трее заморозил режим экономии.
// Здесь — настройки, кнопка с луной в нижней панели, затихание и остановка музыки.
(() => {
  const KEY = "ym_sleep";
  const TIMES = [15, 30, 45, 60, 90, 120, 180];
  const CALM = { seed: "settingMoodEnergy:calm", name: "Спокойное" };      // уточняется по списку Яндекса (auto)
  const SEED_OK = /^[\w-]+:[\w.-]+$/;
  ICON.moon = svgp("M12.34 2.02C6.59 1.82 2 6.42 2 12c0 5.52 4.48 10 10 10 3.71 0 6.93-2.02 8.66-5.02-7.51-.25-12.09-8.43-8.32-14.96z");

  const cfgS = (() => {
    const v = lsJSON(KEY, {}, (x) => typeof x === "object");
    return {
      min: TIMES.includes(v.min) ? v.min : 30,
      act: v.act === "stop" ? "stop" : "off",
      seed: typeof v.seed === "string" && SEED_OK.test(v.seed) ? v.seed : CALM.seed,
      name: typeof v.name === "string" && v.name ? v.name.slice(0, 100) : CALM.name,
      auto: typeof v.seed === "string" && SEED_OK.test(v.seed) ? !!v.auto : true,   // настроение ещё не выбирали — «Спокойное» по умолчанию
    };
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfgS)); } catch {} };
  const fmtMin = (m) => (m < 60 ? `${m} мин` : `${String(m / 60).replace(".", ",")} ч`);

  let deadline = 0, tickT = 0, fadeT = 0, fadeFrom = 0, fadeEnd = 0;

  // ---------- кнопка в нижней панели ----------
  const btn = $("#sleepBtn"), left = $("#sleepLeft");
  btn.insertAdjacentHTML("afterbegin", ICON.moon);
  function paint() {
    const on = deadline > Date.now();
    btn.classList.toggle("on", on);
    left.hidden = !on;
    if (on) {
      const m = Math.max(1, Math.ceil((deadline - Date.now()) / 60000));
      left.textContent = m >= 60 ? Math.floor(m / 60) + "ч" : String(m);
      btn.title = `Режим сна: осталось ${m} мин — ${cfgS.act === "off" ? "потом выключится компьютер" : "потом музыка остановится"}. Нажми, чтобы выключить`;
    } else btn.title = `Режим сна: ${cfgS.name}, ${fmtMin(cfgS.min)} — ${cfgS.act === "off" ? "потом выключить компьютер" : "потом остановить музыку"}`;
    $("#slStart").textContent = on ? "Выключить режим сна" : "Включить режим сна";
    $("#slStart").classList.toggle("active", !on);
    $("#slNote").textContent = on ? `Включён: ${cfgS.act === "off" ? "компьютер выключится" : "музыка остановится"} в ${new Date(deadline).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "";
  }
  function setDeadline(d) {
    deadline = d || 0;
    clearInterval(tickT);
    if (deadline) tickT = setInterval(paint, 15000);
    paint();
  }
  btn.onclick = () => (deadline > Date.now() ? stop(true) : start());
  $("#slStart").onclick = () => (deadline > Date.now() ? stop(true) : start());

  // ---------- затихание ----------
  function fadeTick() {
    if (!audio) return;
    const k = Math.max(0, Math.min(1, (fadeEnd - Date.now()) / Math.max(1, fadeEnd - fadeFrom)));
    audio.volume = volume * k;           // и у следующего трека: новый плеер берёт полную громкость, тик её поправит
  }
  function fadeStart(secs) {
    clearInterval(fadeT);
    fadeFrom = Date.now(); fadeEnd = fadeFrom + Math.max(1, secs) * 1000;
    fadeT = setInterval(fadeTick, 1000);
    fadeTick();
  }
  function fadeStop() {
    clearInterval(fadeT); fadeT = 0;
    if (audio) audio.volume = volume;       // громкость в настройках не трогали — возвращаем как была
  }

  // ---------- включение / выключение ----------
  async function resolveCalm() {
    if (!cfgS.auto) return;
    try {
      await loadStations();
      const hit = (stations.groups.mood || []).find((s) => /спокой/i.test(s.name));
      if (hit) { cfgS.seed = hit.seed; cfgS.name = hit.name; save(); renderCfg(); }
    } catch {}
  }
  async function start() {
    let st;
    try { st = await invoke("sleep_start", { minutes: cfgS.min, shutdown: cfgS.act === "off" }); }
    catch (e) { showToast("Не удалось включить режим сна: " + e.message, 6000); return; }
    setDeadline(st.deadline);
    showToast(`Режим сна на ${fmtMin(cfgS.min)}: ${cfgS.act === "off" ? "потом компьютер выключится" : "потом музыка остановится"}. Волна «${cfgS.name}»`, 5000, { kind: "ok" });
    await resolveCalm();
    // волна для сна — без сохранения как обычной: завтра Моя волна будет прежней
    if (!(wave.on && wave.seed === cfgS.seed && audio && !audio.paused)) {
      Object.assign(wave, { seed: cfgS.seed, name: cfgS.name, album: null, session: null, queue: [], pos: -1, on: false });
      updateStBtn();
      try { await waveStart(); } catch (e) { showToast("Не удалось запустить волну для сна: " + e.message, 6000); }
      if (!$("#wavePage").hidden) showWave();
    }
  }
  async function stop(manual) {
    try { await invoke("sleep_cancel"); } catch {}
    fadeStop();
    setDeadline(0);
    if (manual) showToast("Режим сна выключен", 3000, { kind: "ok" });
  }

  const ev = window.__TAURI__.event;
  ev?.listen("sleep-fade", (e) => { if (audio && !audio.paused) fadeStart(Number(e.payload) || 180); });
  ev?.listen("sleep-end", () => {
    clearInterval(fadeT); fadeT = 0;
    if (audio && !audio.paused) audio.pause();
    if (audio) audio.volume = volume;
    setDeadline(0);
    if (cfgS.act === "off") {
      showToast("Режим сна: компьютер выключится через минуту", 60000, { action: { label: "Не выключать", fn: () => { invoke("sleep_cancel").catch(() => {}); showToast("Выключение отменено", 3000, { kind: "ok" }); } } });
    }
  });
  // страницу перезагрузили, а режим включён — показываем его
  invoke("sleep_status").then((st) => { if (st?.deadline) { cfgS.act = st.shutdown ? "off" : "stop"; setDeadline(st.deadline); } }).catch(() => {});

  // ---------- настройки ----------
  function renderCfg() {
    const t = $("#slTime"); t.innerHTML = "";
    for (const m of TIMES) {
      const b = document.createElement("button");
      b.className = "chip" + (m === cfgS.min ? " active" : ""); b.textContent = fmtMin(m);
      b.onclick = () => { cfgS.min = m; save(); renderCfg(); };
      t.append(b);
    }
    document.querySelectorAll("#slAct .chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.v === cfgS.act);
      c.onclick = () => { if (deadline > Date.now()) { $("#slNote").textContent = "Новое действие сработает при следующем включении режима сна"; } cfgS.act = c.dataset.v; save(); renderCfg(); };
    });
    $("#slWaveName").textContent = cfgS.name;
    paint();
  }
  let slTab = "mood";
  function renderPicker() {
    const chips = $("#slChips"), grid = $("#slGrid");
    chips.innerHTML = ""; grid.innerHTML = "";
    const known = new Set(GROUPS.map((g) => g[0]));
    const all = [...GROUPS, ...Object.keys(stations.groups).filter((t) => !known.has(t)).map((t) => [t, t])];
    if (!stations.groups[slTab]) slTab = all.map((g) => g[0]).find((t) => stations.groups[t]) || "";
    for (const [type, label] of all) {
      if (!stations.groups[type]) continue;
      const b = document.createElement("button");
      b.className = "chip" + (type === slTab ? " active" : ""); b.textContent = label;
      b.onclick = () => { slTab = type; renderPicker(); };
      chips.append(b);
    }
    for (const s of stations.groups[slTab] || []) {
      const b = document.createElement("button");
      b.className = "pill" + (s.seed === cfgS.seed ? " active" : ""); b.textContent = s.name;
      b.onclick = () => { Object.assign(cfgS, { seed: s.seed, name: s.name, auto: false }); save(); renderCfg(); $("#slStations").hidden = true; $("#slWavePick").textContent = "Выбрать…"; };
      grid.append(b);
    }
  }
  $("#slWavePick").onclick = async () => {
    const box = $("#slStations");
    if (!box.hidden) { box.hidden = true; $("#slWavePick").textContent = "Выбрать…"; return; }
    box.hidden = false; $("#slWavePick").textContent = "Скрыть";
    $("#slChips").innerHTML = ""; $("#slGrid").textContent = "Загружаю список…";
    try { await loadStations(); renderPicker(); await resolveCalm(); renderPicker(); }
    catch (e) { $("#slGrid").textContent = "Не удалось загрузить список: " + e.message; }
  };
  renderCfg();
})();
