// Глобальные горячие клавиши: карточка в настройках и окно назначения сочетаний.
// Регистрирует их Rust (src-tauri/src/hotkeys.rs): работают, даже когда окно свёрнуто или поверх открыта игра.
(() => {
  const KEY = "ym_hotkeys";
  // Сочетания по умолчанию — Ctrl+Alt, как у классических плееров (Winamp, AIMP), и только то, что не занято
  // ни Windows, ни популярными оболочками Linux (GNOME, KDE, Xfce, Cinnamon). Сознательно НЕ используются:
  //  Alt+Shift (переключение раскладки), Win/Super (системные), Ctrl+Alt+стрелки (поворот экрана у Intel,
  //  рабочие столы в GNOME), Ctrl+Alt+F1…F12 (консоли Linux), Ctrl+Alt+L/K/T/D/Del/Backspace (блокировка,
  //  раскладка в KDE, терминал, системные), Ctrl+Shift+буква (сочетания браузеров и редакторов).
  const ACTIONS = [
    ["toggle", "Пауза / играть", "Ctrl+Alt+Space"],
    ["next", "Следующий трек", "Ctrl+Alt+PageDown"],
    ["prev", "Предыдущий трек", "Ctrl+Alt+PageUp"],
    ["vol_up", "Громче", "Ctrl+Alt+Equal"],
    ["vol_down", "Тише", "Ctrl+Alt+Minus"],
    ["mute", "Выключить / включить звук", "Ctrl+Alt+Digit0"],
    ["seek_fwd", "Перемотать вперёд на 10 с", "Ctrl+Alt+Period"],
    ["seek_back", "Перемотать назад на 10 с", "Ctrl+Alt+Comma"],
    ["like", "Лайк", "Ctrl+Alt+Insert"],
    ["repeat", "Повтор", "Ctrl+Alt+KeyR"],
    ["shuffle", "Перемешивание", "Ctrl+Alt+KeyH"],
    ["show", "Показать / спрятать окно", "Ctrl+Alt+Home"],
  ];
  // прежние сочетания по умолчанию: у кого они остались нетронутыми — тихо меняем на новые
  const OLD_DEF = {
    toggle: "Alt+Shift+Space", next: "Alt+Shift+ArrowRight", prev: "Alt+Shift+ArrowLeft", vol_up: "Alt+Shift+ArrowUp",
    vol_down: "Alt+Shift+ArrowDown", mute: "Alt+Shift+KeyM", seek_fwd: "Alt+Shift+Period", seek_back: "Alt+Shift+Comma",
    like: "Alt+Shift+KeyL", repeat: "Alt+Shift+KeyR", shuffle: "Alt+Shift+KeyS", show: "Alt+Shift+KeyY",
  };
  // один порядок модификаторов (Ctrl, Alt, Shift, Win) — чтобы «Shift+Alt+X» и «Alt+Shift+X» считались одним сочетанием
  const ORDER = ["Ctrl", "Alt", "Shift", "Super"];
  function canon(accel) {
    if (typeof accel !== "string" || !accel) return "";
    const parts = accel.split("+"), code = parts.pop();
    return [...ORDER.filter((m) => parts.includes(m)), code].join("+");
  }
  const DEF = () => Object.fromEntries(ACTIONS.map(([a, , k]) => [a, canon(k)]));
  let hk = { on: true, binds: DEF() };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v === "object") {
      hk.on = v.on !== false;
      for (const [a] of ACTIONS) {
        if (typeof v.binds?.[a] !== "string") continue;
        const b = canon(v.binds[a]);
        if (b !== OLD_DEF[a]) hk.binds[a] = b;      // своё сочетание сохраняем, прежнее «по умолчанию» — меняем на новое
      }
    }
  } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(hk)); } catch {} };
  const call = (cmd, args) => Promise.resolve(window.__TAURI__.core.invoke(cmd, args));
  const $h = (id) => document.getElementById(id);
  let errors = {};          // действие → почему не зарегистрировалось
  let paused = false;       // окно назначения открыто — сочетания временно сняты, чтобы их можно было нажать

  // ---------- как сочетание выглядит ----------
  const KEYNAME = {
    Space: "Пробел", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Comma: ",", Period: ".", Slash: "/",
    Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Backquote: "`", Minus: "−", Equal: "=",
    Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End",
    PageUp: "PgUp", PageDown: "PgDn", Escape: "Esc", PrintScreen: "PrtSc", ScrollLock: "ScrLk", Pause: "Pause",
    MediaPlayPause: "⏯ Play/Pause", MediaTrackNext: "⏭ Next", MediaTrackPrevious: "⏮ Prev", MediaStop: "⏹ Stop",
    AudioVolumeUp: "🔊 Громче", AudioVolumeDown: "🔉 Тише", AudioVolumeMute: "🔇",
    NumpadAdd: "Num +", NumpadSubtract: "Num −", NumpadMultiply: "Num *", NumpadDivide: "Num /", NumpadDecimal: "Num .", NumpadEnter: "Num Enter",
  };
  const keyName = (code) => KEYNAME[code] || code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad(\d)$/, "Num $1");
  const MOD_NAME = { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Win" };
  function pretty(accel) {
    if (!accel) return "";
    const parts = accel.split("+");
    const code = parts.pop();
    return [...parts.map((m) => MOD_NAME[m] || m), keyName(code)].join(" + ");
  }
  // клавиши, которые можно назначать без Ctrl/Alt/Shift (они не мешают ни набору текста, ни играм)
  const SOLO = /^(Media\w+|AudioVolume\w+|F(1[3-9]|2[0-4]))$/;
  const SUPPORTED = /^(Key[A-Z]|Digit\d|Numpad\w+|F\d{1,2}|Arrow(Up|Down|Left|Right)|Space|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Backquote|Minus|Equal|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Escape|PrintScreen|ScrollLock|Pause|Media\w+|AudioVolume\w+)$/;

  // ---------- регистрация ----------
  async function apply() {
    const binds = hk.on && !paused ? ACTIONS.map(([a]) => ({ action: a, accel: hk.binds[a] || "" })).filter((b) => b.accel) : [];
    let res = [];
    try { res = await call("hotkeys_set", { binds }); } catch (e) { console.warn("hotkeys:", e); }
    if (!paused) {
      errors = {};
      for (const r of res || []) if (r.error) errors[r.action] = r.error;
    }
    paintCard(); paintRows();
  }

  function paintCard() {
    const sw = $h("hkOn"); if (sw) sw.checked = hk.on;
    const n = $h("hkNote"); if (!n) return;
    const set = ACTIONS.filter(([a]) => hk.binds[a]).length, bad = Object.keys(errors).length;
    n.textContent = !hk.on ? "Выключено" : bad ? `Не сработают: ${bad} — заняты другой программой` : `Назначено: ${set}`;
    n.classList.toggle("bad", hk.on && bad > 0);
  }

  // ---------- окно назначения ----------
  let m = null, recording = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function paintRows() {
    if (!m) return;
    for (const [a] of ACTIONS) {
      const r = m.rows[a];
      const acc = hk.binds[a] || "";
      r.key.classList.toggle("rec", recording === a);
      r.key.classList.toggle("empty", !acc && recording !== a);
      r.key.textContent = recording === a ? "Нажми сочетание…" : acc ? pretty(acc) : "Не задано";
      r.clear.hidden = !acc || recording === a;
      const warn = recording === a ? "" : errors[a] || (/^Shift\+(Key|Digit)/.test(acc) && acc.split("+").length === 2
        ? "Shift + буква перехватит ввод этой заглавной буквы во всех программах" : "");
      r.note.textContent = warn;
      r.note.classList.toggle("bad", !!errors[a]);
    }
    m.hint.textContent = recording ? "Esc — отмена, Backspace — убрать сочетание" : "";
  }

  function onKey(e) {
    if (!m) return;
    if (!recording) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    const code = e.code;
    if (["ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight"].includes(code)) return;
    const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
    if (!mods.length && code === "Escape") { recording = null; paintRows(); return; }
    if (!mods.length && (code === "Backspace" || code === "Delete")) { hk.binds[recording] = ""; recording = null; save(); paintRows(); return; }
    if (!SUPPORTED.test(code)) { m.hint.textContent = "Эту клавишу назначить нельзя"; return; }
    if (!mods.length && !SOLO.test(code)) { m.hint.textContent = "Нужен Alt, Shift или Ctrl — одиночные клавиши мешали бы в играх и при наборе текста"; return; }
    const accel = canon([...mods, code].join("+"));
    // то же сочетание у другого действия — переносим его сюда
    for (const [a] of ACTIONS) if (a !== recording && hk.binds[a] === accel) hk.binds[a] = "";
    hk.binds[recording] = accel;
    recording = null;
    save(); paintRows();
  }

  function open() {
    if (m) return;
    paused = true; apply();                     // сняли сочетания — иначе система не даст нажать их здесь
    const wrap = el("div", "login modal");
    const box = el("div", "panel login-box modalbox hkmodal");
    const head = el("div", "hkhead");
    head.append(el("h2", "", "Горячие клавиши"));
    const list = el("div", "hklist");
    const rows = {};
    for (const [a, label] of ACTIONS) {
      const row = el("div", "hkrow");
      const name = el("span", "hkname", label);
      const key = el("button", "hkkey"); key.type = "button";
      key.onclick = () => { recording = recording === a ? null : a; paintRows(); };
      const clear = el("button", "hkclear", "✕"); clear.type = "button"; clear.title = "Убрать сочетание";
      clear.onclick = () => { hk.binds[a] = ""; delete errors[a]; save(); paintRows(); };
      const note = el("small", "hknote");
      row.append(name, key, clear, note);
      list.append(row);
      rows[a] = { key, clear, note };
    }
    const hint = el("p", "status hkhint");
    const foot = el("div", "row");
    const reset = el("button", "nav", "По умолчанию"); reset.type = "button";
    reset.onclick = () => { hk.binds = DEF(); errors = {}; recording = null; save(); paintRows(); };
    const done = el("button", "nav active", "Готово"); done.type = "button";
    done.onclick = close;
    foot.append(reset, done);
    box.append(head, el("p", "hksub", "Работают везде: в свёрнутом окне, в трее и в играх. Нажми на сочетание, чтобы назначить новое."), list, hint, foot);
    wrap.append(box); document.body.append(wrap);
    wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
    document.addEventListener("keydown", onKey, true);
    m = { wrap, rows, hint };
    paintRows();
  }

  function close() {
    if (!m) return;
    document.removeEventListener("keydown", onKey, true);
    m.wrap.remove(); m = null; recording = null;
    paused = false; apply();
  }

  // ---------- карточка ----------
  const sw = $h("hkOn");
  if (sw) sw.onchange = (e) => { hk.on = e.target.checked; save(); apply(); };
  const btn = $h("hkSetup"); if (btn) btn.onclick = open;
  apply();
})();
