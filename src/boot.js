// Запуск без «мигания» стилей.
// Стиль собирается по частям: встроенная основа (чаще всего «Неон»), потом фон из IndexedDB, потом CSS своей темы
// из .wmt (тоже из IndexedDB). На медленном компьютере было видно, как интерфейс сначала рисуется «Неоном»
// и перекрашивается. Поэтому:
// * этот файл подключён в <head> без defer — работает до первой отрисовки: ставит на <html> стиль прошлого запуска
//   и прячет интерфейс (класс booting) под цветом фона этой темы (снимок ym_boot сохраняет main.js — saveBoot);
// * main.js и theme.js отмечают готовность (bootMark): фон загружен, свои темы подключены;
// * когда всё готово — интерфейс показывается, а при запуске Rust только тогда показывает и само окно (app_ready).
// Что-то сломалось или очень долго — через 4 с интерфейс показывается в любом случае (а окно — через 5 с, Rust).
(() => {
  const root = document.documentElement;
  root.classList.add("booting");
  try {
    const b = JSON.parse(localStorage.getItem("ym_boot") || "null");
    if (b && typeof b === "object") {
      if (typeof b.style === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(b.style)) root.dataset.style = b.style;
      if (typeof b.base === "string" && /^[a-z]{1,16}$/.test(b.base)) root.dataset.base = b.base;
      // только цвет: #rgb / #rrggbb(aa) или rgb()/rgba() из getComputedStyle
      const color = (v) => typeof v === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(v.trim());
      if (color(b.bg)) root.style.setProperty("--boot-bg", b.bg.trim());
      if (color(b.accent)) root.style.setProperty("--boot-accent", b.accent.trim());      // цвет индикатора загрузки
    }
  } catch {}

  const need = new Set(["bg", "themes"]);
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    // шрифты темы (из .wmt) ещё догружаются — подождать их, но не дольше 0,6 с.
    // Без requestAnimationFrame: при запуске окно ещё скрыто, а у скрытого окна кадров нет — колбэк не пришёл бы.
    // Стили к этому моменту уже применены; первый кадр нарисуется, когда Rust покажет окно.
    const fonts = document.fonts?.ready || Promise.resolve();
    Promise.race([fonts, new Promise((r) => setTimeout(r, 600))]).then(() => {
      root.classList.remove("booting");
      try { window.__TAURI__?.core?.invoke("app_ready"); } catch {}
      try { window.saveBoot?.(); } catch {}
    });
  }
  // main.js: "bg" — фоны стилей загружены (initBg); theme.js: "themes" — CSS своих тем подключены
  window.bootMark = (k) => { need.delete(k); if (!need.size) finish(); };
  setTimeout(finish, 4000);
})();
