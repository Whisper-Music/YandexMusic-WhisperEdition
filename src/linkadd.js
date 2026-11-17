// linkadd.js — трек по ссылке: YouTube, SoundCloud, видео и клипы ВКонтакте (Rust — linkdl.rs, качает yt-dlp).
// Здесь же — общая «Добавить трек»: по ссылке или с компьютера. Откуда: правый щелчок по пустому месту «Лайков» →
// «Добавить трек ›» (подменю, tmenu.js), кнопка «Добавить трек…» в карточке «Треки по ссылке» («Приложение» — окно
// выбора window.addTrack), Ctrl+V со ссылкой в окне (share.js → window.linkLooks / window.linkAdd).
// Ссылку проверяет Rust (link_check: только эти сайты и только один трек), скачанный файл — тоже (только звук m4a/mp3,
// реально декодируется). Дальше — то же окно «Что сделать с треком», что при перетаскивании (dropin.js → dropAudio).
// yt-dlp ставится по согласию пользователя: официальный выпуск с GitHub, сверка SHA-256; раз в неделю обновляется сам.
(() => {
  const $l = (id) => document.getElementById(id);
  const err = (e) => String(e?.message || e || "ошибка").replace(/^Error:\s*/, "");
  // похоже ли на ссылку поддерживаемого сайта — только чтобы решить, предлагать ли скачивание (строгая проверка — в Rust)
  const LOOKS = /^(https?:\/\/)?([a-z0-9-]+\.)*(youtube\.com|youtu\.be|soundcloud\.com|vk\.com|vk\.ru|vkvideo\.ru)\/\S+$/i;
  window.linkLooks = (s) => { const t = String(s || "").trim(); return t.length <= 2048 && LOOKS.test(t); };

  let busy = false;
  const mb = (n) => (n / 1048576).toFixed(1).replace(".", ",");

  async function status() {
    try { return await invoke("link_tool_status"); } catch { return { installed: false }; }
  }
  // yt-dlp нет — спросить и поставить
  async function ensureTool() {
    if ((await status()).installed) return true;
    const ok = await modal({
      title: "Нужен yt-dlp",
      text: "Чтобы скачивать треки с YouTube, SoundCloud и из видео ВКонтакте, приложению нужна бесплатная программа yt-dlp "
        + "(около 18 МБ). Она скачается с официальной страницы проекта на GitHub, контрольная сумма будет сверена. "
        + "Лежит в папке приложения и запускается только для скачивания по ссылке. Удалить — в «Настройках» → «Приложение».",
      ok: "Скачать yt-dlp",
    });
    if (!ok) return false;
    showToast("yt-dlp скачивается с GitHub…", 0);
    try { await invoke("link_tool_install"); }
    catch (e) { showToast(err(e), 8000, { kind: "err" }); return false; }
    paint();
    return true;
  }

  // скачать по уже проверенной ссылке (chk — ответ link_check): ход — в подсказке внизу, «Отменить» там же
  async function start(chk) {
    if (busy) return showToast("Трек по ссылке уже скачивается — подожди немного", 3500);
    busy = true;
    let un = null, last = 0;
    const cancel = { label: "Отменить", fn: () => invoke("link_cancel").catch(() => {}) };
    try {
      if (!(await ensureTool())) return;
      showToast(`Скачивается с ${chk.source}…`, 0, { action: cancel });
      un = await window.__TAURI__?.event?.listen("link-progress", (e) => {
        const p = e.payload || {};
        if (p.stage === "update") return showToast("Обновляется yt-dlp…", 0, { action: cancel });
        const now = Date.now();
        if (now - last < 250) return;
        last = now;
        const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
        showToast(pct ? `Скачивается с ${chk.source}: ${pct}%` : `Скачивается с ${chk.source}: ${mb(p.done || 0)} МБ`, 0, { action: cancel });
      });
      const r = await invoke("link_download", { url: chk.url });
      hideToast();
      // ссылка едет с файлом: студия запомнит, откуда трек (studio.rs → source), — это видно и на других устройствах
      if (!window.dropAudio([{ ...r.entry, link: chk.url }])) showToast("Трек скачался, но открыть его не получилось", 6000, { kind: "err" });
    } catch (e) {
      const m = err(e);
      if (/отменено$/.test(m)) showToast("Скачивание отменено", 3000);
      else showToast(m, 9000, { kind: "err" });
    } finally {
      busy = false;
      try { un?.(); } catch {}
    }
  }

  // ---------- с компьютера: системный выбор файлов (bg.rs → audio_pick) ----------
  async function addFile() {
    if (!window.dropAudio) return showToast("Добавлять треки здесь нельзя", 3500);
    let files;
    try { files = await invoke("audio_pick"); } catch (e) { return showToast("Не удалось открыть файл: " + err(e), 5000); }
    if (files?.length) window.dropAudio(files);
  }
  window.addTrackFile = addFile;

  // ---------- окно «Добавить трек»: всё в одном ----------
  // Сверху — поле для ссылки (Enter или «Скачать»), под ним — зона «Перетащи файл или выбери»: щелчок открывает выбор
  // файлов, а файл, брошенный в окно, приходит как обычно (bg.rs → main.js bg-drop → dropin.js) — окно при этом
  // закрывается само. prefill — ссылка, вставленная в поиск или Ctrl+V в окне: её остаётся только подтвердить.
  let dlg = null;
  function choose(prefill = "") {
    if (!window.dropAudio) return showToast("Добавлять треки здесь нельзя", 3500);
    if (dlg) { if (prefill) { dlg.inp.value = prefill; dlg.inp.focus(); } return; }
    if (document.querySelector(".modal")) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const wrap = el("div", "login modal");
    const box = el("form", "panel login-box modalbox addtrack"); box.noValidate = true;
    box.append(el("h2", "", "Добавить трек"));
    const lab = el("label", "addlab", "Ссылка");
    const line = el("div", "addline");
    const inp = el("input", "field"); inp.type = "text"; inp.maxLength = 2048; inp.placeholder = "https://…"; inp.value = prefill;
    inp.autocomplete = "off"; inp.spellcheck = false;
    const go = el("button", "nav active", "Скачать"); go.type = "submit";
    line.append(inp, go);
    const note = el("p", "addnote", "YouTube, SoundCloud, видео и клипы ВКонтакте");
    const msg = el("p", "status addmsg");
    const or = el("div", "addor"); or.append(el("span", "", "или"));
    const zone = el("button", "adddrop"); zone.type = "button";
    zone.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M12 3l5 5h-3.5v6h-3V8H7zM5 17h14v3H5z"/></svg>';
    zone.append(el("b", "", "Перетащи файл сюда или выбери"), el("small", "", "mp3, flac, m4a, ogg, wav"));
    const row = el("div", "row");
    const no = el("button", "nav", "Отмена"); no.type = "button";
    row.append(no);
    box.append(lab, line, note, msg, or, zone, row);
    wrap.append(box);

    let un = [];
    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      for (const u of un) { try { u(); } catch {} }
      wrap.remove(); dlg = null;
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    no.onclick = close;
    wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
    zone.onclick = () => { close(); addFile(); };
    inp.oninput = () => { msg.textContent = ""; };
    box.onsubmit = async (e) => {
      e.preventDefault();
      const url = inp.value.trim();
      if (!url) { msg.textContent = "Вставь ссылку — или перетащи файл ниже"; inp.focus(); return; }
      go.disabled = true;
      let chk;
      try { chk = await invoke("link_check", { url }); }
      catch (x) { msg.textContent = err(x); go.disabled = false; inp.focus(); inp.select(); return; }
      close();
      start(chk);
    };
    // файл тащат над окном — подсветить зону; бросили — окно закрывается, файл открывает dropin.js
    const ev = window.__TAURI__?.event;
    ev?.listen("bg-drag", (e) => zone.classList.toggle("over", !!e.payload?.over)).then((u) => (dlg ? un.push(u) : u()));
    ev?.listen("bg-drop", () => close()).then((u) => (dlg ? un.push(u) : u()));
    document.body.append(wrap);
    dlg = { inp };
    inp.focus();
    if (prefill) inp.select();
  }
  window.addTrack = choose;
  // ссылка с YouTube / SoundCloud / ВК вставлена (поиск, Ctrl+V в окне) — то же окно, ссылка уже в поле
  window.linkAdd = (url) => choose(String(url || "").trim());

  // ---------- карточка «Треки по ссылке» (Настройки → Приложение) ----------
  async function paint() {
    if (!$l("linkCard")) return;
    const s = await status();
    $l("linkState").textContent = s.installed
      ? `yt-dlp ${s.version || ""} · обновлён ${new Date(s.updatedAt).toLocaleDateString(document.documentElement.lang === "en" ? "en-GB" : "ru-RU")}`.replace("  ", " ")
      : "yt-dlp не установлен — скачается при первой ссылке";
    $l("linkUpdate").textContent = s.installed ? "Обновить yt-dlp" : "Установить yt-dlp";
    $l("linkRemove").hidden = !s.installed;
  }
  if ($l("linkCard")) {
    $l("linkAdd").onclick = () => choose();
    $l("linkUpdate").onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      $l("linkState").textContent = "yt-dlp скачивается с GitHub…";
      try { await invoke("link_tool_install"); showToast("yt-dlp обновлён", 3000, { kind: "ok" }); }
      catch (x) { showToast(err(x), 8000, { kind: "err" }); }
      b.disabled = false;
      paint();
    };
    $l("linkRemove").onclick = async () => {
      if (!(await modal({ title: "Удалить yt-dlp?", text: "Скачанные по ссылке треки останутся. Для новой ссылки yt-dlp скачается снова.", ok: "Удалить", danger: true }))) return;
      try { await invoke("link_tool_remove"); } catch (e) { showToast(err(e), 6000, { kind: "err" }); }
      paint();
    };
    new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) paint(); }).observe($l("linkCard"));
  }
})();
