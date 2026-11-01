// Профили устройств вывода: громкость, нормализация, режим вывода и эквалайзер — свои у каждых наушников и колонок.
// Всё автоматически: устройство, на котором сейчас играет звук, сменилось (выбрали другое в «Устройстве вывода»,
// подключили наушники и Windows переключилась на них, отключили Bluetooth) — настройки этого устройства
// возвращаются такими, какими были, когда на нём играли в последний раз. Новое устройство получает текущие настройки
// и дальше запоминает свои. Карточка «Профили устройств» — Настройки → Звук.
//
// Какое устройство играет: выбранное в output.js, а если выбрано «Системное по умолчанию» — то, что сейчас
// по умолчанию в Windows (audio_endpoints, без разрешения на микрофон). Узнаётся по названию — так же, как
// устройство сопоставляют sound.js и engine.js. Устройство вне Windows без названия — профилей нет.
//
// Хранение: localStorage ym_devprof = { on, cur, map: { "<название в нижнем регистре>": { name, vol, sound, excl, eq, at } } }.
(() => {
  const KEY = "ym_devprof", MAX_DEV = 24, POLL_MS = 15000, REMEMBER_MS = 2000;
  const d0 = lsJSON(KEY, {}, (v) => v && typeof v === "object" && !Array.isArray(v));
  const st = {
    on: d0.on !== false,
    cur: typeof d0.cur === "string" ? d0.cur : "",
    map: d0.map && typeof d0.map === "object" && !Array.isArray(d0.map) ? d0.map : {},
  };
  for (const [k, p] of Object.entries(st.map)) if (!p || typeof p !== "object" || typeof p.name !== "string") delete st.map[k];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const keyOf = (name) => String(name).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
  const NORM = { off: "без нормализации", track: "нормализация по трекам", album: "нормализация по альбому", auto: "нормализация авто" };

  // ---------- какое устройство играет ----------
  let eps = [], epsAt = 0;
  async function activeName() {
    const o = window.outInfo?.() || { isDefault: true, label: "" };
    if (!o.isDefault && o.label) return o.label;
    if (Date.now() - epsAt > 3000) {
      try { eps = await invoke("audio_endpoints"); } catch { eps = []; }
      epsAt = Date.now();
    }
    return eps.find((e) => e.default)?.name || o.label || "";
  }

  // ---------- настройки сейчас ----------
  const capture = () => ({
    vol: Math.round(volume * 100) / 100,
    sound: window.soundPrefs?.get() || null,
    excl: !!window.engine?.wanted?.(),
    eq: window.eqState?.() || null,
  });
  const same = (a, b) => JSON.stringify([a.vol, a.sound, a.excl, a.eq]) === JSON.stringify([b.vol, b.sound, b.excl, b.eq]);

  let applying = false;
  async function applyProf(p) {
    applying = true;
    try {
      if (typeof p.vol === "number" && isFinite(p.vol)) setVol(p.vol);
      if (p.sound) window.soundPrefs?.set(p.sound);
      if (p.eq) window.eqSetState?.(p.eq);
      // режим вывода — последним: переключение перезапускает трек с той же позиции, уже с новыми громкостью и звуком
      if (typeof p.excl === "boolean" && window.engine?.available?.() && p.excl !== !!window.engine.wanted()) {
        await window.engineSetMode?.(p.excl, true);
      }
    } finally { applying = false; }
  }
  function describe(p) {
    const parts = [`громкость ${Math.round((p.vol ?? volume) * 100)} %`];
    if (p.sound?.mode) parts.push(NORM[p.sound.mode] || "");
    if (p.excl) parts.push("эксклюзивный режим");
    if (p.eq?.on) parts.push("эквалайзер");
    return parts.filter(Boolean).join(", ");
  }

  // текущие настройки → профиль текущего устройства (пользователь двигает громкость, меняет нормализацию…)
  function remember() {
    if (!st.on || applying || !st.cur) return;
    const p = st.map[st.cur];
    if (!p) return;
    const now = capture();
    if (same(p, now)) return;
    Object.assign(p, now, { at: Date.now() });
    save();
  }

  function trim() {
    const keys = Object.keys(st.map);
    if (keys.length <= MAX_DEV) return;
    keys.filter((k) => k !== st.cur).sort((a, b) => (st.map[a].at || 0) - (st.map[b].at || 0))
      .slice(0, keys.length - MAX_DEV).forEach((k) => delete st.map[k]);
  }

  // устройство сменилось? — запомнить настройки прежнего и вернуть настройки нового
  let busy = false, again = false;
  async function check(quiet = false) {
    if (!st.on) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const name = await activeName();
      if (!name) return;
      const k = keyOf(name);
      if (k === st.cur && st.map[k]) { remember(); return; }
      const prev = st.cur;
      if (prev && st.map[prev] && !applying) Object.assign(st.map[prev], capture(), { at: Date.now() });
      st.cur = k;
      const p = st.map[k];
      if (p) {
        p.name = name; p.at = Date.now();
        if (!same(p, capture())) {
          await applyProf(p);
          if (!quiet) showToast(`«${name}»: ${describe(p)}`, 4000, { kind: "ok" });
        }
      } else {
        st.map[k] = { name, ...capture(), at: Date.now() };
        if (prev && !quiet) showToast(`Новое устройство «${name}» — его громкость и звук будут запоминаться отдельно`, 4500);
      }
      trim(); save(); paint();
    } finally {
      busy = false;
      if (again) { again = false; setTimeout(() => check(), 300); }
    }
  }
  // сменилось устройство или его список: даём output.js и Windows договорить, потом проверяем
  let checkT = 0;
  const soon = (ms = 700) => { clearTimeout(checkT); checkT = setTimeout(() => check(), ms); };

  window.addEventListener("whisper:output", () => soon(300));
  navigator.mediaDevices?.addEventListener?.("devicechange", () => { epsAt = 0; soon(); });
  // Windows не всегда сообщает странице о смене устройства по умолчанию — изредка проверяем сами
  setInterval(() => { if (!document.hidden) { epsAt = 0; check(); } }, POLL_MS);
  setInterval(remember, REMEMBER_MS);
  window.Whisper?.on?.("track", () => soon(200));
  // при запуске — без сообщения: если играли на другом устройстве, просто подставляем его настройки
  setTimeout(() => check(true), 1500);

  // ---------- карточка «Профили устройств» ----------
  const $d = (id) => document.getElementById(id);
  function paint() {
    const sw = $d("dpOn"); if (sw) sw.checked = st.on;
    const box = $d("dpList");
    if (!box) return;
    box.textContent = "";
    box.hidden = !st.on;
    const keys = Object.keys(st.map).sort((a, b) => (a === st.cur ? -1 : b === st.cur ? 1 : (st.map[b].at || 0) - (st.map[a].at || 0)));
    for (const k of keys) {
      const p = st.map[k];
      const row = document.createElement("div"); row.className = "outdev dprow" + (k === st.cur ? " on" : "");
      const dot = document.createElement("i"); dot.className = "odot";
      const t = document.createElement("span"); t.className = "olbl"; t.textContent = p.name; t.title = p.name;
      const sm = document.createElement("small"); sm.textContent = k === st.cur ? "играет сейчас" : describe(p);
      row.append(dot, t, sm);
      if (k !== st.cur) {
        const x = document.createElement("button"); x.type = "button"; x.className = "dpx"; x.textContent = "✕";
        x.title = "Забыть настройки этого устройства";
        x.onclick = () => { delete st.map[k]; save(); paint(); };
        row.append(x);
      }
      box.append(row);
    }
    const n = $d("dpNote");
    if (n) n.textContent = !st.on ? "Выключено: громкость и звук общие для всех устройств."
      : !keys.length ? "Пока ни одного устройства — профиль появится, как только заиграет звук." : "";
  }
  $d("dpOn")?.addEventListener("change", (e) => {
    st.on = e.target.checked;
    if (st.on) { st.cur = ""; check(true); }      // включили — текущие настройки становятся профилем текущего устройства
    save(); paint();
  });
  const page = $d("settingsPage");
  if (page) new MutationObserver(() => { if (!page.hidden && page.dataset.tab === "out") paint(); }).observe(page, { attributes: true, attributeFilter: ["hidden", "data-tab"] });
  paint();
})();
