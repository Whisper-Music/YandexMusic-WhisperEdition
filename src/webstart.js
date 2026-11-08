// Стартовая страница браузерной версии: забрать настройки и данные, которые положило окно (WebState.pull),
// и открыть интерфейс. Адрес /__web/start?k=… — убираем его из истории (location.replace), ключа в адресе не остаётся.
(async () => {
  try { await WebState.pull(WebState.http); }
  catch (e) { document.getElementById("ws").textContent = "Не все настройки перенеслись: " + (e?.message || e); await new Promise((r) => setTimeout(r, 1500)); }
  location.replace("/");
})();
