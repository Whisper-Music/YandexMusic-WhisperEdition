// Обновления приложения: Настройки → Приложение → «Обновления». Проверка и установка — в Rust (src-tauri/src/update.rs):
// он берёт latest.json последнего выпуска на GitHub, проверяет подпись файла и ставит новую версию.
// Здесь — только кнопки, сообщение о новой версии и ход загрузки.
(() => {
  const KEY = "ym_update";
  const $u = (id) => document.getElementById(id);
  let o = { auto: true, skip: "" };          // auto — проверять при запуске; skip — версия, о которой не напоминать
  try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && typeof v === "object") o = { auto: v.auto !== false, skip: String(v.skip || "") }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} };
  let info = null, busy = false;

  const note = (t, err) => { const n = $u("updNote"); if (!n) return; n.textContent = t; n.classList.toggle("err", !!err); };
  function paint() {
    if (!$u("updBox")) return;
    $u("updAuto").checked = o.auto;
    if (info?.current) $u("updCur").textContent = info.current;
    const has = !!info?.version;
    $u("updBox").hidden = !has;
    if (!has) return;
    $u("updNew").textContent = `Доступна версия ${info.version}` + (info.date ? ` от ${info.date.split("-").reverse().join(".")}` : "");
    $u("updNotes").textContent = info.notes || "";
    $u("updNotes").hidden = !info.notes;
    $u("updInstall").hidden = !info.can_install;
    $u("updInstall").disabled = busy;
  }

  async function check(manual) {
    if (busy) return;
    $u("updCheck") && ($u("updCheck").disabled = true);
    if (manual) note("Идёт проверка…");
    try {
      info = await invoke("update_check");
      if (!info.version) { if (manual) note(`Установлена последняя версия (${info.current}).`); }
      else {
        note(info.can_install ? "" : "Эта сборка установлена пакетом системы (.deb/.rpm) — скачай новую версию со страницы выпуска.");
        // при запуске напоминаем один раз на версию; вручную — всегда
        if (manual || o.skip !== info.version) {
          showToast(`Доступно обновление ${info.version}`, 12000, { kind: "ok", action: { label: info.can_install ? "Обновить" : "Подробнее", fn: () => (info.can_install ? install() : openSettings()) } });
          o.skip = info.version; save();
        }
      }
    } catch (e) {
      if (manual) note("Не удалось проверить обновления: " + (e?.message || e), true);
      else console.warn("update_check:", e?.message || e);
    } finally {
      $u("updCheck") && ($u("updCheck").disabled = false);
      paint();
    }
  }

  function openSettings() {
    $("#settingsBtn")?.click();
    document.querySelector('#settingsPage .chip[data-tab="app"]')?.click();
    $u("updBox")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async function install() {
    if (busy || !info?.version) return;
    busy = true; paint();
    const bar = $u("updBar");
    bar.hidden = false; bar.style.setProperty("--p", "0");
    note(`Скачивается версия ${info.version}…`);
    try {
      await invoke("update_install");          // при успехе приложение перезапускается само
    } catch (e) {
      busy = false; bar.hidden = true; paint();
      note("Обновление не установлено: " + (e?.message || e), true);
      showToast("Обновление не установлено — подробности в настройках", 5000);
    }
  }

  window.__TAURI__.event?.listen("update-progress", (e) => {
    const p = e.payload || {}, bar = $u("updBar");
    if (p.done) { note("Обновление устанавливается, затем приложение перезапустится…"); bar?.style.setProperty("--p", "1"); return; }
    if (bar && p.total) bar.style.setProperty("--p", String(Math.min(1, p.got / p.total)));
    const mb = (n) => (n / 1048576).toFixed(1);
    note(p.total ? `Скачивается… ${mb(p.got)} из ${mb(p.total)} МБ` : `Скачивается… ${mb(p.got)} МБ`);
  });

  if ($u("updBox")) {
    $u("updCheck").onclick = () => check(true);
    $u("updInstall").onclick = install;
    $u("updPage").onclick = () => { try { window.__TAURI__.opener.openUrl(info?.page || "https://github.com/Whisper-Music/YandexMusic-WhisperEdition/releases/latest"); } catch {} };
    $u("updAuto").onchange = (e) => { o.auto = e.target.checked; save(); };
  }
  paint();
  // при запуске — через 8 секунд, чтобы не мешать загрузке; потом раз в 12 часов, пока приложение открыто
  if (o.auto) setTimeout(() => check(false), 8000);
  setInterval(() => { if (o.auto) check(false); }, 12 * 3600 * 1000);
  // номер текущей версии в настройках — сразу, без запроса в сеть
  window.__TAURI__.app?.getVersion?.().then((v) => { if (!info && $u("updCur")) $u("updCur").textContent = v; }).catch(() => {});
})();
