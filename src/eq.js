// Эквалайзер: 10 полос (32 Гц — 16 кГц), предусиление, готовые настройки. Открывается из меню «⋯».
//
// Звук идёт через Web Audio: источник → предусиление → 10 фильтров → анализатор визуализатора → динамики.
// Граф создаётся только когда он нужен (main.js: vizWanted): эквалайзер выключен или все полосы на нуле и визуализатор
// не нужен — трек играет напрямую, без фильтров и без лишней работы процессора.
(() => {
  const KEY = "ym_eq";
  const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const MAX = 12;
  const PRESETS = [
    ["flat", "Обычный", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ["bass", "Больше баса", [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]],
    ["bassplus", "Мощный бас", [9, 8, 6, 3, 0, -1, 0, 0, 0, 0]],
    ["treble", "Высокие", [0, 0, 0, 0, 0, 1, 2, 4, 5, 6]],
    ["vocal", "Вокал", [-2, -2, -1, 1, 3, 4, 4, 3, 1, 0]],
    ["rock", "Рок", [5, 4, 2, 0, -1, -1, 1, 3, 4, 4]],
    ["pop", "Поп", [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1]],
    ["electro", "Электроника", [6, 5, 2, 0, -2, 1, 0, 2, 4, 5]],
    ["jazz", "Джаз", [3, 2, 1, 2, -1, -1, 0, 1, 2, 3]],
    ["classic", "Классика", [3, 2, 1, 0, 0, 0, -1, 0, 2, 3]],
    ["night", "Тихо, для сна", [2, 1, 0, 0, 0, -1, -2, -4, -6, -8]],
  ];
  const clampDb = (v, m = MAX) => Math.max(-m, Math.min(m, Math.round((Number(v) || 0) * 2) / 2));
  const st = (() => {
    const v = lsJSON(KEY, {}, (x) => typeof x === "object");
    const gains = Array.isArray(v.gains) && v.gains.length === BANDS.length ? v.gains.map((g) => clampDb(g)) : BANDS.map(() => 0);
    return { on: !!v.on, gains, pre: clampDb(v.pre, 12), guard: v.guard !== false, preset: typeof v.preset === "string" ? v.preset : "flat" };
  })();
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }, 300); };

  // эквалайзер что-то меняет в звуке — только тогда нужен звуковой граф
  const active = () => st.on && (st.pre !== 0 || st.gains.some((g) => g !== 0));
  window.eqActive = active;

  // ---------- звуковой граф ----------
  let ctxOf = null, pre = null, filters = [];
  const dbToGain = (db) => Math.pow(10, db / 20);
  // «Без искажений»: подъём полос может вывести сигнал за предел и дать хрип — приглушаем всё на величину самого большого подъёма
  const preDb = () => st.pre - (st.guard ? Math.max(0, ...st.gains) : 0);
  function build() {
    ctxOf = actx;
    pre = actx.createGain();
    filters = BANDS.map((f, i) => {
      const n = actx.createBiquadFilter();
      n.type = i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking";
      n.frequency.value = f;
      n.Q.value = 1.41;                // ширина полосы — октава: соседние полосы плавно перекрываются
      return n;
    });
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    wire(); params(true);
  }
  // включён — сигнал идёт через фильтры; выключен — фильтры обходятся (их не считает процессор)
  function wire() {
    if (!pre || !analyser) return;
    try { pre.disconnect(); } catch {}
    try { filters[filters.length - 1].disconnect(); } catch {}
    if (active()) { pre.connect(filters[0]); filters[filters.length - 1].connect(analyser); }
    else pre.connect(analyser);
  }
  function params(now = false) {
    if (!pre) return;
    const t = actx.currentTime, on = active();
    const set = (p, v) => (now ? (p.value = v) : p.setTargetAtTime(v, t, 0.03));      // плавно, без щелчков
    set(pre.gain, on ? dbToGain(preDb()) : 1);
    filters.forEach((n, i) => set(n.gain, on ? st.gains[i] : 0));
  }
  window.eqInput = () => {
    if (!actx) return analyser;
    if (ctxOf !== actx || !pre) build();
    else wire();
    return pre;
  };
  // настройки поменялись: подкрутить фильтры; если звук ещё идёт напрямую — перевести трек на граф с той же позиции
  function apply() {
    save();
    if (window.engine?.on()) { note("В эксклюзивном режиме эквалайзер не действует — звук идёт на устройство без обработки."); paintMain(); return; }
    if (pre && ctxOf === actx) { wire(); params(); }
    if (active() && !audioViz && audio && audio.src && !needLoad) {
      note("Эквалайзер подключается — трек догружается, пара секунд…");
      Promise.resolve(ensureVizAudio()).finally(() => { if (audioViz) note(""); });
    }
    paintMain();
  }

  // ---------- окно ----------
  ICON.eq = svgp("M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z");
  let ui = null;
  const fmtDb = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + String(Math.abs(v)).replace(".", ",");
  const fmtHz = (f) => (f >= 1000 ? f / 1000 + "к" : String(f));
  function note(text) { if (ui) ui.note.textContent = text; }

  function slider(label, min, max, value, onInput, cls = "") {
    const band = document.createElement("div"); band.className = "eqband " + cls;
    const val = document.createElement("span"); val.className = "eqv";
    const slot = document.createElement("div"); slot.className = "eqslot";
    const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = 0.5; inp.value = value;
    const cap = document.createElement("small"); cap.textContent = label;
    const show = () => {
      val.textContent = fmtDb(Number(inp.value));
      const p = ((inp.value - min) / (max - min)) * 100;
      inp.style.setProperty("--a", Math.min(p, 50) + "%"); inp.style.setProperty("--b", Math.max(p, 50) + "%");
    };
    inp.addEventListener("input", () => { onInput(Number(inp.value)); show(); });
    inp.addEventListener("dblclick", () => { inp.value = 0; onInput(0); show(); });       // двойной щелчок — в ноль
    inp.title = "Двойной щелчок — сбросить в 0";
    slot.append(inp); band.append(val, slot, cap);
    show();
    return { band, inp, show };
  }
  function paintMain() {
    if (!ui) return;
    ui.sw.checked = st.on;
    ui.box.classList.toggle("off", !st.on);
    ui.chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.p === st.preset));
    ui.guard.checked = st.guard;
  }
  function syncSliders() {
    if (!ui) return;
    ui.bands.forEach((b, i) => { b.inp.value = st.gains[i]; b.show(); });
    ui.pre.inp.value = st.pre; ui.pre.show();
  }

  function open() {
    if (ui) return;
    closeTrackMenu();
    const wrap = document.createElement("div"); wrap.className = "login modal eqwrap";
    const box = document.createElement("div"); box.className = "panel login-box modalbox eqbox";
    box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Эквалайзер");

    const head = document.createElement("div"); head.className = "eqhead";
    const h = document.createElement("h2"); h.textContent = "Эквалайзер";
    const swl = document.createElement("label"); swl.className = "switch eqsw";
    const sw = document.createElement("input"); sw.type = "checkbox";
    const swt = document.createElement("span"); swt.textContent = "Включён";
    swl.append(sw, document.createElement("i"), swt);
    const x = document.createElement("button"); x.className = "round eqclose"; x.title = "Закрыть (Esc)"; x.textContent = "✕";
    head.append(h, swl, x);

    const chips = document.createElement("div"); chips.className = "chips eqpresets";
    for (const [id, name, g] of PRESETS) {
      const c = document.createElement("button"); c.className = "chip"; c.dataset.p = id; c.textContent = name;
      c.onclick = () => { st.gains = g.slice(); st.preset = id; st.on = true; syncSliders(); apply(); };
      chips.append(c);
    }
    const custom = document.createElement("button"); custom.className = "chip"; custom.dataset.p = "custom"; custom.textContent = "Свой"; custom.disabled = true;
    chips.append(custom);

    const grid = document.createElement("div"); grid.className = "eqgrid";
    const preS = slider("Усил.", -12, 12, st.pre, (v) => { st.pre = v; st.on = true; apply(); }, "eqpre");
    const sep = document.createElement("div"); sep.className = "eqsep";
    const bands = BANDS.map((f, i) => slider(fmtHz(f), -MAX, MAX, st.gains[i], (v) => { st.gains[i] = v; st.preset = "custom"; st.on = true; apply(); }));
    grid.append(preS.band, sep, ...bands.map((b) => b.band));
    const scale = document.createElement("div"); scale.className = "eqscale"; scale.innerHTML = `<span>+${MAX} дБ</span><span>0</span><span>−${MAX} дБ</span>`;

    const foot = document.createElement("div"); foot.className = "eqfoot";
    const gl = document.createElement("label"); gl.className = "switch"; gl.title = "Когда полосы подняты, общая громкость немного снижается, чтобы звук не хрипел";
    const guard = document.createElement("input"); guard.type = "checkbox";
    const gt = document.createElement("span"); gt.textContent = "Без искажений";
    gl.append(guard, document.createElement("i"), gt);
    const reset = document.createElement("button"); reset.className = "nav"; reset.textContent = "Сбросить";
    reset.onclick = () => { st.gains = BANDS.map(() => 0); st.pre = 0; st.preset = "flat"; syncSliders(); apply(); };
    foot.append(gl, reset);
    const nt = document.createElement("p"); nt.className = "eqnote";

    box.append(head, chips, scale, grid, foot, nt);
    wrap.append(box);
    document.body.append(wrap);

    ui = { wrap, box, sw, chips, guard, bands, pre: preS, note: nt };
    sw.onchange = () => { st.on = sw.checked; apply(); };
    guard.onchange = () => { st.guard = guard.checked; apply(); };
    const close = () => { document.removeEventListener("keydown", onKey, true); wrap.remove(); ui = null; };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    x.onclick = close;
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
    paintMain();
    if (!actx && active()) note("");
  }
  window.eqOpen = open;
})();
