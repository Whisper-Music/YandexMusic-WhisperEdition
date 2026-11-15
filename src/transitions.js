// Переходы между треками (Настройки → Воспроизведение → «Переходы между треками»; Rust — edges.rs).
//   «Пропускать тишину» — тишина в начале трека перематывается, а на тишине в конце сразу включается следующий;
//   «Плавные переходы» — громкость на стыке выравнивается: следующий начинается тихо — конец этого плавно
//   затихает до его уровня; начинается громко после тихого конца — следующий входит с уровня этого конца
//   и за пару секунд поднимается до своей громкости. Без наложения треков: один плеер, меняется только громкость.
// Где тишина и насколько громко звучат края — audio_edges: Rust декодирует трек целиком (Яндекс — в экономном
// качестве, громкость та же). Следующий трек меряется заранее, пока играет этот.
// Громкость: main.js → outVol() умножает на window.xfK(a). Во «Слушать вместе» у гостя выключено — он идёт за ведущим.
(() => {
  const KEY = "ym_xfade";
  const $x = (id) => document.getElementById(id);
  let st = (() => { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return { silence: !!v.silence, smooth: !!v.smooth }; } catch { return { silence: false, smooth: false }; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  const DIFF = 4;          // разница громкости на стыке, дБ, меньше которой ничего не делаем
  const MAX = 12;          // сильнее не приглушаем и не поднимаем
  const FADE_OUT = 5, FADE_IN = 2.5;   // с
  const lin = (db) => Math.pow(10, db / 20);

  // ---------- замеры ----------
  const edges = new Map();       // id → замер | Promise | null (не вышло)
  function kindOf(t) {
    const id = String(t?.id ?? "");
    if (!id || t._room || isShared(id)) return null;       // чужая версия по ссылке, трек комнаты — не наш файл
    const rep = !isStudio(id) && window.studioReplacement?.(id);      // своя замена трека (studio.js) — меряем её файл
    if (rep) return { kind: "local", id: rep };
    if (isStudio(id) || got.has(id) || window.appCache?.has(id)) return { kind: "local", id };
    return /^\d+$/.test(id) ? { kind: "ym", id } : null;
  }
  function measure(t) {
    const src = kindOf(t);
    if (!src) return null;
    const v = edges.get(src.id);
    if (v !== undefined) return v instanceof Promise ? null : v;
    if (edges.size > 300) edges.delete(edges.keys().next().value);
    edges.set(src.id, invoke("audio_edges", src).then((e) => { edges.set(src.id, e); return e; }).catch(() => { edges.set(src.id, null); return null; }));
    return null;
  }

  // следующий трек — без побочных действий nextIndex() (очередь комнаты, перестройка перемешивания)
  function peekNext() {
    if (current < 0 || !queue[current]) return null;
    if (effRepeat() === 2) return null;             // повтор трека — стыка нет
    if (!modesActive()) return queue[current + 1] || null;
    if (shuffle && order.length === queue.length && order[ordPos] === current) return queue[order[ordPos + 1]] || null;
    return queue[current + 1] || (repeat === 1 ? queue[0] : null) || null;
  }
  const active = () => {
    if (!st.silence && !st.smooth) return false;
    const r = window.roomInfo?.();
    return !(r && !r.host);
  };

  // ---------- громкость ----------
  let k = 1, fired = "", fadeIn = null, curId = "", nextPlan = null;
  window.xfK = (a) => (a === audio && active() ? k : 1);
  const setK = (v) => {
    v = Math.max(lin(-MAX), Math.min(1, v));
    if (Math.abs(v - k) < 0.002) return;
    k = v;
    try { if (audio) audio.volume = outVol(audio); } catch {}
  };

  function tick() {
    if (!active() || !audio || current < 0) { if (k !== 1) setK(1); return; }
    const t = queue[current];
    if (!t) return;
    const id = String(t.id);
    if (id !== curId) onTrack();
    const e = measure(t);
    const dur = audio.duration, pos = audio.currentTime || 0;
    if (!e || !isFinite(dur) || !dur || audio.paused) return;
    const nx = peekNext();
    if (pos > 3 && nx) measure(nx);               // следующий меряем заранее

    // тишина в начале: перематываем (и после «повтора» трека — тоже)
    if (st.silence && e.start > 0 && pos < e.start - 0.15 && !audio.seeking) { audio.currentTime = e.start; return; }
    const end = st.silence && e.end < dur - 0.3 ? e.end : dur;

    // вход следующего трека после тихого конца прошлого
    if (fadeIn && fadeIn.id === id) {
      const rel = pos - (st.silence ? e.start : 0);
      setK(lin(-fadeIn.db * Math.max(0, 1 - rel / FADE_IN)));
      if (rel >= FADE_IN) fadeIn = null;
    } else if (st.smooth && nx) {
      // конец этого трека: следующий начинается тише — затихаем до его уровня
      const ne = edges.get(kindOf(nx)?.id ?? String(nx.id));       // своя замена — под номером её файла
      const left = end - pos;
      if (ne && typeof ne === "object" && left <= FADE_OUT + 1) {
        const diff = ne.head_db - e.tail_db;
        nextPlan = diff > DIFF ? { id: String(nx.id), db: Math.min(MAX, diff) } : null;
        if (diff < -DIFF) {
          const span = Math.min(FADE_OUT, (end - (st.silence ? e.start : 0)) * 0.2);
          setK(lin(Math.max(-MAX, diff) * Math.max(0, Math.min(1, 1 - left / span))));
        } else if (k !== 1) setK(1);
      }
    }

    // тишина в конце: сразу следующий (тем же путём, что и конец трека)
    if (st.silence && end < dur && pos >= end && fired !== id) {
      fired = id;
      try { audio.onended?.(); } catch (err) { console.warn(err); }
    }
  }
  // сменился трек: громкость — как задумано для стыка (или обычная)
  function onTrack() {
    const t = queue[current];
    curId = t ? String(t.id) : "";
    fired = "";
    fadeIn = st.smooth && nextPlan && nextPlan.id === curId ? nextPlan : null;
    nextPlan = null;
    k = 1;
    if (fadeIn) setK(lin(-fadeIn.db)); else try { if (audio) audio.volume = outVol(audio); } catch {}
    if (t && active()) measure(t);
  }
  window.Whisper?.on?.("track", () => { if (queue[current] && String(queue[current].id) !== curId) onTrack(); });
  setInterval(tick, 100);

  // ---------- настройки ----------
  function paint() {
    if ($x("xfSilence")) $x("xfSilence").checked = st.silence;
    if ($x("xfSmooth")) $x("xfSmooth").checked = st.smooth;
  }
  $x("xfSilence")?.addEventListener("change", (e) => { st.silence = e.target.checked; save(); if (active() && queue[current]) measure(queue[current]); });
  $x("xfSmooth")?.addEventListener("change", (e) => { st.smooth = e.target.checked; save(); if (!st.smooth) { fadeIn = nextPlan = null; setK(1); } });
  paint();
  window.xfPrefs = { get: () => ({ ...st }), set: (p) => { st = { ...st, ...p }; save(); paint(); } };
})();
