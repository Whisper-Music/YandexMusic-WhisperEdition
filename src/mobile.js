// Телефон (Android; iOS — позже). Подключён без defer, сразу после boot.js: класс html.mobile должен стоять
// до первой отрисовки (раскладку под телефон делает mobile.css), а подмена invoke — до main.js.
// На компьютере файл ничего не делает. Признак для остального кода — window.isMobile.
(() => {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") && !window.__WEB__;
  window.isMobile = mobile;
  if (!mobile) return;
  const root = document.documentElement;
  root.classList.add("mobile");

  // Команд только для компьютера (трей, кнопки окна, WASAPI, мини-плеер…) в мобильной сборке нет (lib.rs, cfg(desktop)).
  // Тех, что страница зовёт сама при запуске и не ждёт ответа, — тихо «выполняем» здесь, чтобы не сыпались ошибки.
  // Остальные отвечают ошибкой, как и раньше, — их кнопки на телефоне спрятаны (mobile.css).
  const QUIET = {
    app_ready: null, engine_available: false, win_is_max: false, web_active: false,
    tray_playing: null, tray_lang: null, tray_icon: null, tray_mode: null, thumbbar_state: null,
    mini_state: null, obs_state: null, obs_theme: null, discord_update: null, hotkeys_set: null,
    audio_devices_unlock: null, audio_endpoints: [], system_fonts: [],
  };
  // Свойства window.__TAURI__.core — только для чтения (геттеры), поэтому подменяем сам объект __TAURI__ копией,
  // в которой core.invoke — наш. Не вышло (объект закрыт) — ничего страшного: те команды просто ответят ошибкой.
  try {
    const T = window.__TAURI__;
    const real = T?.core?.invoke;
    if (real) {
      const invoke = (cmd, args, opts) => (cmd in QUIET ? Promise.resolve(QUIET[cmd]) : real(cmd, args, opts));
      window.__TAURI__ = { ...T, core: { ...T.core, invoke } };
    }
  } catch {}

  // Отступы от строки состояния и полоски жестов. Приложение рисуется под ними (edge-to-edge), а старые WebView
  // в env(safe-area-inset-*) отдают 0 — размеры сообщает сама Android-часть (MainActivity.kt): "top,right,bottom,left"
  // в CSS-пикселях. Нет её (другая сборка) — запас под обычную строку состояния.
  const insets = (s) => {
    const [t, r, b, l] = String(s || "").split(",").map((n) => Math.max(0, Math.min(200, +n || 0)));
    root.style.setProperty("--sys-top", t + "px");
    root.style.setProperty("--sys-right", r + "px");
    root.style.setProperty("--sys-bottom", b + "px");
    root.style.setProperty("--sys-left", l + "px");
  };
  window.whisperInsets = insets;
  const askInsets = () => { try { if (window.WhisperAndroid) insets(window.WhisperAndroid.insets()); } catch {} };
  if (window.WhisperAndroid) askInsets(); else insets("24,0,0,0");
  window.addEventListener("resize", askInsets);

  // Кнопка «Назад» телефона: Android-часть (MainActivity.kt) спрашивает window.whisperBack(). Своей истории
  // у страницы нет (navigate() в main.js ведёт свою): закрываем то, что открыто поверх (как Esc), или идём на
  // предыдущую страницу приложения (#back) — "true"; ничего такого нет — "bg", приложение уходит в фон
  // (музыка играет дальше, а не закрывается вместе с ним).
  const opened = () =>
    document.querySelector("#full:not([hidden]), #vizFull:not([hidden]), .tmenu:not([hidden]), .modal:not(.hidden), .login.modal:not(.hidden)");
  window.whisperBack = () => {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) { a.blur(); return true; }
    if (opened()) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    }
    const back = document.getElementById("back");
    if (back && !back.hidden) { back.click(); return true; }
    return "bg";
  };

  document.addEventListener("DOMContentLoaded", () => {
    askInsets();
    // плеер внизу маленький: по названию трека, как и по обложке, открывается плеер на весь экран
    document.querySelector(".player .meta")?.addEventListener("click", () => document.getElementById("cover")?.click());
    // окно входа: на телефоне страница Яндекса открывается прямо здесь, а не в отдельном окне
    const p = document.querySelector("#login .login-box > p");
    if (p) p.textContent = "Нажми кнопку и войди в аккаунт Яндекса. После входа приложение откроется само, копировать ничего не нужно.";
    // карточки Discord и OBS модули ядра вставляют сами и позже; :has() в CSS старые WebView не понимают —
    // прячем по выключателю внутри
    const settings = document.querySelector(".settings");
    const hideDesk = () => ["dcOn", "obsOn"].forEach((id) => document.getElementById(id)?.closest(".card")?.classList.add("m-hide"));
    hideDesk();
    if (settings) new MutationObserver(hideDesk).observe(settings, { childList: true });
    oldWebView();
  });

  // Интерфейс рисует встроенный браузер Android (Android System WebView), и он обновляется отдельно от приложения.
  // Слишком старый (до Chrome 111) не понимает color-mix() — на нём пропадают яркие кнопки, «Играть» и т. п.
  // Тогда сверху — подсказка обновить его в Google Play (закрыл — не показываем до следующей версии WebView).
  function oldWebView() {
    if (CSS.supports?.("color", "color-mix(in srgb, red 50%, blue)")) return;
    const ver = (/Chrome\/(\d+)/.exec(navigator.userAgent) || [])[1] || "?";
    try { if (localStorage.getItem("ym_m_oldwv") === ver) return; } catch {}
    const bar = document.createElement("div");
    bar.className = "m-oldwv";
    const txt = document.createElement("span");
    txt.textContent = `Встроенный браузер Android устарел (версия ${ver}), поэтому часть кнопок не видна. Обнови «Android System WebView» в Google Play.`;
    const go = document.createElement("button");
    go.className = "nav active"; go.textContent = "Обновить";
    go.onclick = () => window.__TAURI__.core.invoke("plugin:opener|open_url", { url: "https://play.google.com/store/apps/details?id=com.google.android.webview" }).catch(() => {});
    const x = document.createElement("button");
    x.className = "nav"; x.textContent = "✕"; x.title = "Скрыть";
    x.onclick = () => { bar.remove(); try { localStorage.setItem("ym_m_oldwv", ver); } catch {} };
    bar.append(txt, go, x);
    document.body.append(bar);
  }
})();
