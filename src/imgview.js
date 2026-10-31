// Просмотр картинки на весь окно: щелчок по аватарке артиста или обложке альбома (плейлиста) в шапке страницы.
// Сначала показывается уже загруженная картинка из шапки, затем она заменяется большой (1000×1000) с сервера Яндекса.
// Закрыть: щелчок в любом месте, Esc, Пробел или Enter.
(() => {
  const head = document.getElementById("headImg");
  if (!head) return;
  head.classList.add("zoomable");
  head.title = "Открыть на весь экран";

  // адрес обложки Яндекса заканчивается размером («…/200x200») — просим самый большой
  const big = (src) => {
    try {
      const u = new URL(src);
      if (!/(^|\.)yandex\.net$|(^|\.)yandex\.ru$/.test(u.hostname)) return src;
      u.pathname = u.pathname.replace(/\/\d+x\d+$/, "/1000x1000");
      return u.href;
    } catch { return src; }
  };

  let view = null;
  function close() {
    if (!view) return;
    document.removeEventListener("keydown", view.onKey, true);
    view.wrap.classList.remove("on");
    const w = view.wrap; view = null;
    setTimeout(() => w.remove(), 180);
    head.focus?.({ preventScroll: true });
  }
  function open() {
    const src = head.currentSrc || head.src;
    if (!src || head.hidden || (typeof COVER_W !== "undefined" && head.getAttribute("src") === COVER_W)) return;      // заглушка «W» — смотреть нечего
    if (view) return close();
    const wrap = document.createElement("div");
    wrap.className = "imgview";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", document.getElementById("title")?.textContent || "Картинка");
    const img = document.createElement("img");
    img.alt = ""; img.src = src; img.draggable = false;
    if (!head.classList.contains("sq")) img.classList.add("rnd");      // артист — круг, как в шапке
    const hint = document.createElement("span");
    hint.className = "ivhint"; hint.textContent = "Esc или щелчок — закрыть";
    wrap.append(img, hint);
    document.body.append(wrap);
    // большая версия — подменяем, когда загрузится (если не загрузилась — остаётся то, что было)
    const hi = big(src);
    if (hi !== src) { const pre = new Image(); pre.onload = () => { if (view?.wrap === wrap) img.src = hi; }; pre.src = hi; }
    const onKey = (e) => {
      if (["Escape", " ", "Enter"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); close(); }
      else e.stopPropagation();          // пока открыто — клавиши окна (стрелки, пробел-пауза) не срабатывают
    };
    document.addEventListener("keydown", onKey, true);
    wrap.onclick = close;
    view = { wrap, onKey };
    requestAnimationFrame(() => wrap.classList.add("on"));
  }
  head.addEventListener("click", open);
  head.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
  window.imgView = { open, close };
})();
