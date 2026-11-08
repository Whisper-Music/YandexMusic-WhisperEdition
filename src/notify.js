"use strict";
// Свои уведомления, как в Telegram (Rust — notify.rs, окно notifywin.html): друг зовёт в комнату, участник «подмигнул».
// Не системные: карточка поверх всех окон в выбранном углу экрана, со своим звуком. Общие модули зовут их через
// Whisper.ui.kit.notify (yandex.js → window.sysNotify). Внутри окна и так есть подсказка (showToast), поэтому по умолчанию
// уведомление — только когда окно свёрнуто или в фоне; «Даже когда окно открыто» — всегда.
// Настройки — Приложение → Уведомления (выключатель + «Подробная настройка…»), localStorage ym_notify.
(() => {
  const KEY = "ym_notify";
  const DEF = { on: true, invite: true, wink: true, always: false, sound: true, info: "full", corner: "br" };
  const KINDS = ["invite", "wink"];
  const INFO = [["full", "Полностью", "Кто и что: «Вадим зовёт тебя в комнату»"],
    ["short", "Без имён", "Только что случилось: «Тебя зовут в комнату»"],
    ["none", "Скрыть", "Просто «Новое уведомление» — без подробностей"]];
  const CORNERS = [["tl", "Слева сверху"], ["tr", "Справа сверху"], ["bl", "Слева снизу"], ["br", "Справа снизу"]];
  const SHORT = { invite: "Тебя зовут в комнату", wink: "Тебе подмигнули", test: "Так выглядят уведомления" };
  const $n = (s) => document.getElementById(s);
  let st = load();
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "{}");
      const out = { ...DEF };
      if (v && typeof v === "object") {
        for (const k of ["on", "invite", "wink", "always", "sound"]) if (typeof v[k] === "boolean") out[k] = v[k];
        if (INFO.some(([id]) => id === v.info)) out.info = v.info;
        if (CORNERS.some(([id]) => id === v.corner)) out.corner = v.corner;
      }
      return out;
    } catch { return { ...DEF }; }
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const away = () => document.hidden || !document.hasFocus();
  // одно и то же (повторный опрос, два снимка подряд) — не чаще раза в 4 с
  let lastText = "", lastAt = 0;

  // ---------- звук (Linux: в Windows его играет Rust, см. notify.rs → chime_wav — тот же звук) ----------
  let chimeUrl = "";
  function chimeWav() {
    const SR = 44100, DUR = 0.45, n = Math.floor(SR * DUR), TAU = Math.PI * 2;
    const buf = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) buf.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); buf.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
    buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
    buf.setUint32(24, SR, true); buf.setUint32(28, SR * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
    str(36, "data"); buf.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const tone = (f, start, amp) => {
        const u = t - start;
        if (u < 0) return 0;
        return amp * Math.min(1, u / 0.006) * Math.exp(-u * 9) * (Math.sin(TAU * f * u) + 0.25 * Math.sin(TAU * 2 * f * u));
      };
      const fade = Math.min(1, Math.max(0, (DUR - t) / 0.03));
      const v = (tone(987.8, 0, 0.32) + tone(1318.5, 0.09, 0.3)) * fade * 0.6;
      buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true);
    }
    return new Blob([buf.buffer], { type: "audio/wav" });
  }
  function beep() {
    try {
      if (!chimeUrl) chimeUrl = URL.createObjectURL(chimeWav());
      const a = new Audio(chimeUrl);
      a.volume = 0.8;
      a.play().catch(() => {});
    } catch {}
  }

  // ---------- показ ----------
  function accent() {
    const cs = getComputedStyle(document.documentElement);
    // --accent зарегистрирован как <color> (styles.css), поэтому приходит как rgb(…) — Rust ждёт #rrggbb
    const hex = (v) => {
      if (/^#[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(v)) return v;
      const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
      return m ? "#" + m.slice(1, 4).map((x) => Math.max(0, Math.min(255, Math.round(+x))).toString(16).padStart(2, "0")).join("") : null;
    };
    return { accent: hex(cs.getPropertyValue("--accent").trim()), accent2: hex(cs.getPropertyValue("--accent2").trim()) };
  }
  async function show(kind, title, body) {
    let t = String(title || "Whisper"), b = String(body || "");
    if (st.info === "short") b = SHORT[kind] || "";
    else if (st.info === "none") { t = "Whisper"; b = "Новое уведомление"; kind = "test"; }
    const played = await invoke("notify_show", { note: { kind, title: t, body: b, corner: st.corner, sound: st.sound, ...accent() } });
    if (st.sound && !played) beep();
  }
  // { kind, title, body } → true — показано
  window.sysNotify = async ({ kind, title, body } = {}) => {
    if (!st.on || !KINDS.includes(kind) || !st[kind]) return false;
    if (!st.always && !away()) return false;
    const t = `${title}\n${body}`;
    if (t === lastText && Date.now() - lastAt < 4000) return false;
    lastText = t; lastAt = Date.now();
    try { await show(kind, title, body); return true; }
    catch (e) { console.warn("Уведомление не показано:", e?.message || e); return false; }
  };
  const test = () => show("test", "Whisper", "Так выглядят уведомления: друг зовёт в комнату или подмигивает тебе");

  // ---------- карточка в настройках ----------
  const corName = () => (CORNERS.find(([id]) => id === st.corner) || CORNERS[3])[1].toLowerCase();
  function sync() {
    const on = $n("ntOn"); if (on) on.checked = st.on;
    const more = $n("ntMore"); if (more) more.hidden = !st.on;
    const sum = $n("ntSum");
    if (sum) {
      const kinds = [st.invite && "приглашения", st.wink && "подмигивания"].filter(Boolean).join(" и ");
      sum.textContent = kinds ? `${kinds[0].toUpperCase()}${kinds.slice(1)} · ${corName()} · ${st.sound ? "со звуком" : "без звука"}`
        : "Не выбрано ни одного вида уведомлений";
    }
    if (m) paintModal();
  }

  // ---------- окно «Подробная настройка» ----------
  let m = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function sw(key, label, hint) {
    const l = el("label", "switch"); if (hint) l.title = hint;
    const i = el("input"); i.type = "checkbox";
    i.onchange = () => { st[key] = i.checked; save(); sync(); };
    l.append(i, el("i"), el("span", "", label));
    return { l, i };
  }
  function paintModal() {
    for (const [k, s] of Object.entries(m.sw)) s.i.checked = st[k];
    m.sw.always.i.disabled = !st.invite && !st.wink;
    for (const b of m.info) b.classList.toggle("active", b.dataset.v === st.info);
    m.infoNote.textContent = (INFO.find(([id]) => id === st.info) || INFO[0])[2];
    for (const b of m.corners) { const on = b.dataset.c === st.corner; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }
    m.cornerNote.textContent = (CORNERS.find(([id]) => id === st.corner) || CORNERS[3])[1];
  }
  function open() {
    if (m) return;
    const swS = {
      invite: sw("invite", "Приглашения в комнату", "Друг позвал тебя в комнату «Слушать вместе»"),
      wink: sw("wink", "Подмигивания в комнате", "Участник комнаты подмигнул тебе: попросил переключить трек, сделать тише…"),
      always: sw("always", "Даже когда окно открыто", "Выключено — уведомление только когда окно свёрнуто или в фоне"),
      sound: sw("sound", "Звук уведомления", "Короткий «дзынь», как в мессенджерах"),
    };
    const sec = (title, ...kids) => { const s = el("div", "ntsec"); s.append(el("h4", "", title), ...kids); return s; };

    const seg = el("div", "lyseg ntseg");
    const info = INFO.map(([id, label, hint]) => {
      const b = el("button", "chip", label); b.type = "button"; b.dataset.v = id; b.title = hint;
      b.onclick = () => { st.info = id; save(); sync(); };
      seg.append(b); return b;
    });
    const infoNote = el("p", "status ntnote");

    // «экран» с четырьмя углами: где появится карточка
    const scr = el("div", "ntscreen");
    scr.append(el("i", "ntbar"));
    const corners = CORNERS.map(([id, label]) => {
      const b = el("button", "ntcorner"); b.type = "button"; b.dataset.c = id; b.title = label; b.setAttribute("aria-label", label);
      b.append(el("i"));
      b.onclick = () => { st.corner = id; save(); sync(); };
      scr.append(b); return b;
    });
    const cornerNote = el("p", "status ntnote");

    const tb = el("button", "nav", "Проверить"); tb.type = "button";
    // общее окно «Подробнее» (details.js)
    const d = openDetails({
      title: "Уведомления", foot: [tb],
      body: (b) => b.append(
        sec("Что показывать", swS.invite.l, swS.wink.l, swS.always.l),
        sec("Звук", swS.sound.l),
        sec("Текст уведомления", seg, infoNote),
        sec("Где появляться", scr, cornerNote),
      ),
      onClose: () => { m = null; },
    });
    tb.onclick = async () => {
      tb.disabled = true;
      try { await test(); d.note.textContent = "Уведомление показано — смотри в выбранном углу экрана"; d.note.classList.add("ok"); }
      catch (e) { d.note.textContent = "Не удалось показать: " + (e?.message || e); d.note.classList.remove("ok"); }
      finally { tb.disabled = false; }
    };
    m = { d, sw: swS, info, infoNote, corners, cornerNote };
    paintModal();
  }

  function mount() {
    const on = $n("ntOn");
    if (on) on.onchange = () => { st.on = on.checked; save(); sync(); };
    const setup = $n("ntSetup"); if (setup) setup.onclick = open;
    sync();
  }
  mount();
})();
