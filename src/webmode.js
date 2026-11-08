// Браузерная версия (Настройки → Приложение → «Браузерная версия»; Rust — webmode.rs, перенос — webstate.js).
// В окне: «Открыть в браузере» — отдать настройки и данные, окно прячется и становится переходником, вкладка
// открывается в браузере по умолчанию. Во вкладке (html.webmode, webshim.js): «Вернуться в приложение» — здесь и
// в боковой панели над «Профилем»; настройки уходят обратно, окно появляется, вкладка показывает «вернулись».
// Пока интерфейс во вкладке, её настройки раз в 20 с (если что-то менялось) уходят в Rust: окно могут вернуть
// и из трея («Открыть»), тогда кнопку во вкладке не нажимали.
(() => {
  const WEB = !!window.__WEB__;
  const $w = (id) => document.getElementById(id);
  const btn = $w("webBtn"), back = $w("webBackBtn"), status = $w("webStatus"), note = $w("webNote");
  const say = (t) => { if (status) status.textContent = t || ""; };
  let busy = false;

  // что ещё в памяти — на диск, чтобы перенеслось (настройки и статистика)
  async function flush() {
    try { saveCfg(); } catch {}
    try { await window.lstatsApi?.data?.(1); } catch {}       // data() сначала сохраняет статистику
  }
  const pause = () => { try { if (typeof audio !== "undefined" && audio && !audio.paused) togglePlay(); } catch {} };

  // ---------- в окне приложения ----------
  async function open() {
    if (busy) return;
    busy = true; btn.disabled = true;
    say("Переносим настройки…");
    try {
      await flush();
      pause();
      await WebState.push(WebState.tauri);
      say("Открываем браузер…");
      await invoke("web_open");          // окно спрячется и станет переходником — эта страница сейчас закроется
    } catch (e) {
      say("Не удалось открыть браузерную версию: " + (e?.message || e));
      busy = false; btn.disabled = false;
    }
  }

  // ---------- во вкладке браузера ----------
  let dirty = 1, lastSig = "", pushing = null;
  // записи IndexedDB (темы, фоны, статистика) — признак «надо отдать заново»
  if (WEB && typeof IDB !== "undefined") {
    for (const m of ["set", "del"]) { const f = IDB[m]; IDB[m] = (...a) => { dirty++; return f(...a); }; }
  }
  const lsSig = () => {
    let h = 0x811c9dc5, n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), s = k + "\u0000" + localStorage.getItem(k);
      n += s.length;
      for (let j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 0x01000193) >>> 0; }
    }
    return `${localStorage.length}:${n}:${h}`;
  };
  function sync(force = false) {
    if (gone || pushing) return pushing;
    const sig = lsSig() + "/" + dirty;
    if (!force && sig === lastSig) return null;
    pushing = WebState.push(WebState.http).then(() => { lastSig = sig; }).catch(() => {}).finally(() => { pushing = null; });
    return pushing;
  }
  async function goBack() {
    if (busy || gone) return;
    busy = true; if (btn) btn.disabled = true; if (back) back.disabled = true;
    say("Возвращаемся в приложение…");
    try {
      await flush();
      pause();
      await pushing;
      await WebState.push(WebState.http);
      await fetch("/__web/return", { method: "POST", headers: { "X-Whisper": "1" } });
      // вкладку закрываем сами. Браузер разрешает это вкладке с одной записью в истории — у нас так и есть
      // (/__web/start заменяется на «/»); не разрешил — остаётся заглушка «Whisper снова в окне»
      setTimeout(() => { try { window.close(); } catch {} }, 300);
    } catch (e) {
      say("Не удалось вернуться: " + (e?.message || e));
      busy = false; if (btn) btn.disabled = false; if (back) back.disabled = false;
    }
  }
  let gone = false;
  function showGone() {
    if (gone) return;
    gone = true;
    pause();
    document.querySelectorAll("audio, video").forEach((m) => { try { m.pause(); } catch {} });
    const box = document.createElement("div"); box.className = "webgone";
    const card = document.createElement("div"); card.className = "panel webgone-card";
    const h = document.createElement("h2"); h.textContent = "Whisper снова в окне приложения";
    const p = document.createElement("p"); p.textContent = "Настройки перенесены. Эту вкладку можно закрыть — снова открыть браузерную версию можно в настройках приложения.";
    card.append(h, p); box.append(card); document.body.append(box);
  }

  if (WEB) {
    if (back) { back.hidden = false; back.onclick = goBack; }
    if (btn) { btn.textContent = "Вернуться в приложение"; btn.onclick = goBack; }
    if (note) note.textContent = "Сейчас Whisper открыт во вкладке браузера. Вернёшься — настройки перенесутся в окно";
    window.addEventListener("whisper:web-gone", showGone);
    setInterval(() => sync(), 20000);
    setTimeout(() => sync(true), 3000);           // первая отметка «как сейчас» (и всё, что поменялось при запуске)
    document.addEventListener("visibilitychange", () => { if (document.hidden) sync(); });
  } else if (btn) btn.onclick = open;
})();
