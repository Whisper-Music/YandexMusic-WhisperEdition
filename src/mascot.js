// Маскот: чёрный пиксельный кот Whisper гуляет по верхнему краю нижней панели (плеера).
// Сидит, моргает, слушает (кивает в такт), ходит к случайному месту, спит со свешенной лапкой, радуется лайку.
// Выключен по умолчанию: Настройки → Интерфейс → «Маскот». Свои настройки — в localStorage (ym_mascot).
// Рисуется на одном <canvas> поверх окна (pointer-events: none — кнопкам плеера не мешает); кадры меняются,
// только когда что-то поменялось, а когда кот выключен или окно скрыто — таймер стоит.
(() => {
  const KEY = "ym_mascot";
  const COLS = 20, ROWS = 22, BODY_ROWS = 18;      // спрайт 20×18; во сне ещё 4 ряда — лапка свисает на плеер
  const PAL = { K: "#100e16", D: "#342e42", P: "#b078ff", p: "#7042d2", W: "#f6f0ff" };

  const S = {
    idle: ["...K........K.......", "..KDK......KDK......", "..KpKK....KKpK......", "..KppKKKKKKppK......", "..KKKKKKKKKKKK......", ".KKKKKKKKKKKKKK.....", ".KKPPKKKKKKPPKK.....", ".KKPWKKKKKKPWKK.....", "PPKKKKKppKKKKKPP....", ".PKKKKKKKKKKKKP.....", "...KKKKKKKKKK.......", "....KKKKKKKK........", "...DKKKKKKKKK....PP.", "..DKKKPPKKKKKK....p.", "..DKKPKKPPKKKK....K.", "..DKKKKKKKKKKKK..K..", "..DKKKKKKKKKKKKKK...", "..KDDKKKKKKDDKK....."],
    blink: ["...K........K.......", "..KDK......KDK......", "..KpKK....KKpK......", "..KppKKKKKKppK......", "..KKKKKKKKKKKK......", ".KKKKKKKKKKKKKK.....", ".KKKKKKKKKKKKKK.....", ".KKppKKKKKKppKK.....", "PPKKKKKppKKKKKPP....", ".PKKKKKKKKKKKKP.....", "...KKKKKKKKKK.......", "....KKKKKKKK........", "...DKKKKKKKKK....PP.", "..DKKKPPKKKKKK....p.", "..DKKPKKPPKKKK....K.", "..DKKKKKKKKKKKK..K..", "..DKKKKKKKKKKKKKK...", "..KDDKKKKKKDDKK....."],
    listen: [".................PP.", "...K........K....PW.", "..KDK......KDK...P..", "..KpKK....KKpK.PPP..", "..KppKKKKKKppK.PP...", "..KKKKKKKKKKKK......", ".KKKKKKKKKKKKKK.....", ".KKPPKKKKKKPPKK.....", ".KKPWKKKKKKPWKK.....", "PPKKKKKppKKKKKPP....", ".PKKKKKKKKKKKKP.....", "....KKKKKKKK........", "...DKKKKKKKKK....PP.", "..DKKKPPKKKKKK....p.", "..DKKPKKPPKKKK....K.", "..DKKKKKKKKKKKK..K..", "..DKKKKKKKKKKKKKK...", "..KDDKKKKKKDDKK....."],
    sleep: ["...........PPPP.....", "..............P.....", ".............P......", "......PPP...P.......", "........P..PPPP.....", ".......P............", "......PPP...........", "....................", "..K....K............", ".KpK..KpK...........", ".KKKKKKKKK..........", "KKKKKKKKKKKKKKKK....", "KKppKKppKKKKKKKKKK..", "PKKKKppKKKKKKKKKKKK.", "KKKKKKKKKKKKKKKKKKK.", "DKKKKKKKKKKKKKKKKKKD", ".DKKKKKKKKKKKKKKKpPK", "..KDDKKKKKKKKKKKKKK.", "...KK...............", "...KK...............", "...KK...............", "..KDDK.............."],
    like: ["...K........K..PP.PP", "..KDK......KDK.PWPPP", "..KpKK....KKpK.PPPPP", "..KppKKKKKKppK..PPP.", "..KKKKKKKKKKKK...P..", ".KKKKKKKKKKKKKK.....", ".KKPKKKKKKKKPKK.....", ".KPKPKKKKKKPKPK.....", "PPKKKKKppKKKKKPP....", ".PKKKKKKKKKKKKP.....", "...KKKKKKKKKK.......", "....KKKKKKKK........", "...DKKKKKKKKK....PP.", "..DKKKPPKKKKKK....p.", "..DKKPKKPPKKKK....K.", "..DKKKKKKKKKKKK..K..", "..DKKKKKKKKKKKKKK...", "..KDDKKKKKKDDKK....."],
    walk0: ["....................", ".PP.................", "Pp..................", "K.............K..K..", "K............KpKKpK.", ".K...........KKKKKK.", ".K...........KKKPWK.", "..KKKKKKKKKKKKKKKKpP", ".DKKKKKKKKKKKKKKKKKP", "..DKKKKKKKKKKKKKKK..", "..DKKKKKKKKKKKPKK...", "..DKKKKKKKKKKKKPK...", "...KKKKKKKKKKKPK....", "...KKKKKKKKKKKKK....", "....KKKKKKKKKKK.....", "....DKK.....DKK.....", "....KKD....DD.KK....", "...KK.DD..DD...KK..."],
    walk1: ["....................", "....................", ".PP.................", "Pp..................", "K.............K..K..", "K............KpKKpK.", ".K...........KKKKKK.", ".K...........KKKPWK.", "..KKKKKKKKKKKKKKKKpP", ".DKKKKKKKKKKKKKKKKKP", "..DKKKKKKKKKKKKKKK..", "..DKKKKKKKKKKKPKK...", "..DKKKKKKKKKKKKPK...", "...KKKKKKKKKKKPK....", "...KKKKKKKKKKKKK....", "....DKK.....DKK.....", "....DKK.....DKK.....", "....DKK.....DKK....."],
    walk2: ["....................", ".PP.................", "Pp..................", "K.............K..K..", "K............KpKKpK.", ".K...........KKKKKK.", ".K...........KKKPWK.", "..KKKKKKKKKKKKKKKKpP", ".DKKKKKKKKKKKKKKKKKP", "..DKKKKKKKKKKKKKKK..", "..DKKKKKKKKKKKPKK...", "..DKKKKKKKKKKKKPK...", "...KKKKKKKKKKKPK....", "...KKKKKKKKKKKKK....", "....KKKKKKKKKKK.....", "....DKK.....DKK.....", "...DD.KK....KKD.....", "..DD...KK..KK.DD...."],
  };
  S.lie = S.sleep.map((r, i) => (i < 8 ? ".".repeat(COLS) : i === 12 ? "KKPWKKPWKKKKKKKKKK.." : r));   // лежит, но не спит
  const WALK = ["walk0", "walk1", "walk2", "walk1"];

  // ---------- настройки ----------
  const st = (() => {
    const v = lsJSON(KEY, {}, (x) => x && typeof x === "object" && !Array.isArray(x));
    return { on: v.on === true, size: v.size === 2 ? 2 : 3, react: v.react !== false };
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  // ---------- холст ----------
  const cv = document.createElement("canvas");
  cv.className = "mascot"; cv.hidden = true; cv.setAttribute("aria-hidden", "true");
  document.body.append(cv);
  const g = cv.getContext("2d");
  let scale = 0, drawn = "", flipDrawn = false;
  function fit() {
    const k = st.size * Math.max(1, Math.round(window.devicePixelRatio || 1));
    if (k === scale) return;
    scale = k; cv.width = COLS * k; cv.height = ROWS * k;
    cv.style.width = COLS * st.size + "px"; cv.style.height = ROWS * st.size + "px";
    drawn = "";
  }
  function draw(name, flip) {
    if (name === drawn && flip === flipDrawn) return;
    drawn = name; flipDrawn = flip;
    g.clearRect(0, 0, cv.width, cv.height);
    const rows = S[name];
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < COLS; x++) {
        const c = PAL[rows[y][x]];
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect((flip ? COLS - 1 - x : x) * scale, y * scale, scale, scale);
      }
  }

  // ---------- поведение ----------
  const now = () => performance.now();
  const rnd = (a, b) => a + Math.random() * (b - a);
  // mode: sit — сидит и слушает, lie — лежит на краю (лапка свисает), walk — идёт; until — когда решать, что дальше
  let mode = "sit", until = 0, lastT = 0;
  let x = -1, target = -1, pausedSince = 0, likeUntil = 0, blinkAt = now() + rnd(4000, 7000), blinkUntil = 0;
  let headDown = false, nextBob = 0, bassAvg = 0, prevId = null, prevLiked = false, timer = 0;

  const curTrack = () => (typeof current === "number" && current >= 0 ? queue?.[current] : null);
  const isPlaying = () => !!(audio && !audio.paused && curTrack());
  const sleepMode = () => { const l = $("#sleepLeft"); return !!l && !l.hidden; };
  const calm = () => document.documentElement.dataset.anim === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const player = () => document.querySelector(".app .player");
  // Спокойная музыка — кот спит весь трек. Меток настроения у трека в API нет, поэтому смотрим на то, что есть:
  // настроение/занятие «Моей волны» (её seed) и жанр альбома трека.
  const CALM_SEED = /(^|:)(calm|sleep|relax|relaxation|chill|chillout|dream|lullaby|meditation|ambient|newage|lofi)$/i;
  const CALM_GENRE = new Set(["ambient", "relax", "newage", "meditation", "lounge", "chillout", "chill", "lofi", "sleep", "lullaby", "spa"]);
  function calmTrack(tr) {
    if (!tr) return false;
    if (wave?.on && CALM_SEED.test(String(wave.seed || ""))) return true;
    return (tr.albums || []).some((al) => CALM_GENRE.has(String(al?.genre || "").toLowerCase()));
  }

  // удар бочки по анализатору звука, если он сейчас работает (визуализатор или эквалайзер); иначе — ровно 2 кивка в секунду
  function beat(t) {
    if (typeof audioViz !== "undefined" && audioViz && analyser && freq) {
      analyser.getByteFrequencyData(freq);
      const b = (freq[1] + freq[2] + freq[3] + freq[4]) / 4;
      bassAvg = bassAvg * 0.9 + b * 0.1;
      if (b > bassAvg * 1.18 && b > 80 && t > nextBob) { nextBob = t + 240; return true; }
      return false;
    }
    if (t > nextBob) { nextBob = t + 500; return true; }
    return false;
  }

  function tick() {
    if (!st.on || document.hidden) return;
    const pl = player(), r = pl?.getBoundingClientRect();
    // плеера не видно (консольный стиль, тема без панели, свёрнутое окно) — кота тоже
    if (!r || r.width < COLS * st.size * 3 || r.height < 8) { cv.hidden = true; return; }
    cv.hidden = false;
    fit();
    const t = now(), w = COLS * st.size, minX = 12, maxX = Math.max(minX, r.width - w - 12);
    if (x < 0) { x = target = Math.round(maxX * 0.82); mode = "sit"; until = t + rnd(40000, 70000); }
    x = Math.min(Math.max(x, minX), maxX); target = Math.min(Math.max(target, minX), maxX);
    const dt = Math.min(200, t - (lastT || t)); lastT = t;

    const playing = isPlaying();
    if (playing) pausedSince = 0; else pausedSince ||= t;
    const still = calm();
    const asleep = st.react && (sleepMode() || (pausedSince && t - pausedSince > 120000) || (playing && calmTrack(curTrack())));

    // лайк играющему треку — порадоваться полторы секунды
    // (только переход «не в лайках → в лайках» у того же трека: переключение на уже лайкнутый трек не считается)
    const tr = curTrack(), id = tr ? String(tr.id) : "", liked = !!id && likedIds.has(id);
    if (liked && !prevLiked && id === prevId) likeUntil = t + 1500;
    prevId = id; prevLiked = liked;
    const liking = st.react && t < likeUntil;

    // Характер — спокойный: подолгу сидит, часто ложится, ходит редко и недалеко.
    if (asleep || still) { if (mode === "walk") { target = x; mode = "sit"; } until = Math.max(until, t + 30000); }
    else if (mode === "walk") {
      if (Math.abs(target - x) < 1) { mode = "sit"; until = t + rnd(45000, 90000); }   // пришёл — садится надолго
    } else if (!playing && mode === "sit" && pausedSince && t - pausedSince > 10000) { mode = "lie"; until = t + rnd(60000, 120000); }
    else if (t > until) {
      const r = Math.random();
      if (mode === "lie") { mode = "sit"; until = t + rnd(25000, 45000); }              // встал — посидит
      else if (r < 0.5) { mode = "lie"; until = t + rnd(60000, 150000); }               // лёг полежать
      else if (r < 0.8 || !playing) { until = t + rnd(30000, 60000); }                  // сидит дальше
      else {                                                                            // изредка — короткая прогулка
        const dir = x < minX + w * 2 ? 1 : x > maxX - w * 2 ? -1 : Math.random() < 0.5 ? -1 : 1;
        target = Math.round(Math.min(maxX, Math.max(minX, x + dir * rnd(w * 1.5, w * 5))));
        if (Math.abs(target - x) >= w) mode = "walk"; else { target = x; until = t + rnd(30000, 60000); }
      }
    }
    if (mode !== "walk") target = x;

    let name, flip = false;
    const speed = 15 * st.size;                              // px/с: 45 при 3× — лапы почти не скользят
    if (mode === "walk" && Math.abs(target - x) >= 1) {
      const step = Math.min(Math.abs(target - x), (speed * dt) / 1000);
      flip = target < x;
      x += flip ? -step : step;
      name = WALK[Math.floor(t / 140) % WALK.length];
    } else if (liking) name = "like";                       // лайк будит даже спящего — на полторы секунды
    else if (asleep) name = "sleep";
    else if (mode === "lie") name = "lie";
    else {
      if (st.react && playing && !still && beat(t)) headDown = !headDown;
      if (!playing || !st.react || still) headDown = false;
      if (!still && t > blinkAt) { blinkUntil = t + 120; blinkAt = t + rnd(4000, 7000); }
      name = t < blinkUntil ? "blink" : headDown ? "listen" : "idle";
    }
    draw(name, flip);
    cv.style.transform = `translate(${Math.round(r.left + x)}px, ${Math.round(r.top - BODY_ROWS * st.size)}px)`;
  }

  function run() {
    clearInterval(timer); timer = 0; prevId = null; lastT = 0;
    if (st.on && !document.hidden) { timer = setInterval(tick, 50); tick(); }
    else cv.hidden = true;
  }
  document.addEventListener("visibilitychange", run);

  // ---------- настройки в окне «Настройки → Оформление» ----------
  const on = $("#mcOn"), box = $("#mcBox"), react = $("#mcReact"), seg = $("#mcSize");
  function paint() {
    if (on) on.checked = st.on;
    if (box) box.hidden = !st.on;
    if (react) react.checked = st.react;
    seg?.querySelectorAll(".chip").forEach((c) => {
      const sel = +c.dataset.v === st.size;
      c.classList.toggle("active", sel); c.setAttribute("aria-pressed", sel ? "true" : "false");
    });
  }
  if (on) on.onchange = () => { st.on = on.checked; save(); paint(); x = -1; run(); };
  if (react) react.onchange = () => { st.react = react.checked; save(); };
  seg?.querySelectorAll(".chip").forEach((c) => (c.onclick = () => { st.size = +c.dataset.v === 2 ? 2 : 3; save(); paint(); scale = 0; x = -1; run(); }));
  paint();
  run();
  window.mascotSet = (k, v) => { if (k in st) { st[k] = v; save(); paint(); scale = 0; x = -1; run(); } };
})();
