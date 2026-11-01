// Проверка настроек при запуске — до main.js (подключён без defer, сразу после boot.js).
//
// Настройки страницы лежат в localStorage. Если запись повреждена (сбой диска, аварийное выключение посреди
// записи, чужая программа покопалась в профиле WebView2), модули молча берут значения по умолчанию и тут же
// сохраняют их поверх — испорченное пропадает, а вместе с ним и настройки. Поэтому замечаем повреждение ДО того,
// как кто-то что-то запишет: backup.js потом предложит восстановить всё из автокопии и не будет делать
// новую автокопию из «сброшенных» настроек, пока пользователь не решит.
(() => {
  const broken = [];
  let empty = false;
  try {
    empty = localStorage.length === 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      if (v == null) continue;
      const t = v.trimStart()[0];
      // JSON-значения (объекты, списки, строки в кавычках) должны разбираться; простые числа и слова — как есть
      if (t === "{" || t === "[" || t === '"') {
        try { JSON.parse(v); } catch { broken.push(k); }
      } else if (/[\u0000-\u0008\u000e-\u001f�]/.test(v.slice(0, 4096))) broken.push(k);    // мусорные байты
    }
  } catch { empty = false; }
  window.__lsCheck = { broken, empty, at: Date.now() };
})();
