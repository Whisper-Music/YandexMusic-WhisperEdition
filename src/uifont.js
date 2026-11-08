// Шрифт интерфейса: любой шрифт, установленный в системе (Настройки → Оформление → Шрифт).
// Список даёт Rust (fonts.rs, команда system_fonts); если команды нет (старая сборка) — Local Font Access API WebView.
// Выбор хранится отдельно от стилей (ym_font): при смене стиля шрифт остаётся. Пусто — шрифт самого стиля.
(() => {
  const KEY = "ym_font";
  const $f = (id) => document.getElementById(id);
  const okName = (n) => typeof n === "string" && n.length > 0 && n.length <= 120 && !/["\\<>{};\n\r]/.test(n);
  let st = { name: "", heads: true };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v === "object") { if (okName(v.name)) st.name = v.name; st.heads = v.heads !== false; }
  } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  // ---------- применение ----------
  // CSP запрещает встроенный <style> (style-src 'self' blob:) — правила подключаются файлом из blob:, как CSS тем
  let link = null, linkUrl = "";
  function setCss(text) {
    if (linkUrl) { URL.revokeObjectURL(linkUrl); linkUrl = ""; }
    if (!text) { link?.remove(); link = null; return; }
    linkUrl = URL.createObjectURL(new Blob([text], { type: "text/css" }));
    if (!link) { link = document.createElement("link"); link.rel = "stylesheet"; link.id = "uiFontCss"; }
    link.href = linkUrl;
    document.head.append(link);          // последним — поверх стилей и тем
  }
  function apply() {
    document.documentElement.classList.toggle("uifont", !!st.name);
    if (!st.name) return setCss("");
    const fam = `"${st.name}", system-ui, "Segoe UI", sans-serif`;
    // «И для заголовков» — шрифт везде, кроме значков (svg); иначе — основной текст, а заголовки и надписи,
    // для которых стиль задал свой шрифт (--font-display у «Королевского», «Lolitta» и тем), остаются как в стиле
    setCss(st.heads
      ? `html body, html body *:not(svg):not(svg *) { font-family: ${fam} !important; }`
      : `html body { font-family: ${fam} !important; } html body :is(button, input, select, textarea) { font-family: inherit; }`);
  }
  apply();

  // ---------- список шрифтов ----------
  let fonts = null, loading = null;
  async function loadFonts() {
    if (fonts) return fonts;
    if (loading) return loading;
    loading = (async () => {
      try {
        const r = await window.__TAURI__.core.invoke("system_fonts");
        if (Array.isArray(r) && r.length) return (fonts = r.filter(okName));
      } catch (e) { console.warn("system_fonts:", e); }
      try {
        if (typeof window.queryLocalFonts === "function") {
          const list = await window.queryLocalFonts();
          const set = [...new Set(list.map((f) => f.family))].filter(okName);
          set.sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" }));
          if (set.length) return (fonts = set);
        }
      } catch (e) { console.warn("queryLocalFonts:", e); }
      return (fonts = []);
    })();
    try { return await loading; } finally { loading = null; }
  }

  // ---------- карточка в настройках ----------
  const card = $f("fontCard");
  if (!card) return;
  const nameEl = $f("fontName"), box = $f("fontBox"), find = $f("fontFind"), list = $f("fontList"), note = $f("fontNote");
  const heads = $f("fontHeads"), pick = $f("fontPick"), reset = $f("fontReset");

  function paint() {
    nameEl.textContent = st.name || "Шрифт стиля";
    if (st.name) nameEl.style.setProperty("font-family", `"${st.name}", system-ui, sans-serif`, "important"); else nameEl.style.removeProperty("font-family");
    reset.hidden = !st.name;
    heads.checked = st.heads;
    heads.closest("label").hidden = !st.name;
    list.querySelectorAll(".fontitem").forEach((b) => b.classList.toggle("on", b.dataset.font === st.name));
  }
  function choose(name) {
    st.name = okName(name) ? name : "";
    save(); apply(); paint();
  }
  function renderList() {
    const q = find.value.trim().toLowerCase();
    const items = (fonts || []).filter((n) => !q || n.toLowerCase().includes(q));
    list.textContent = "";
    const frag = document.createDocumentFragment();
    for (const n of items.slice(0, 600)) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "fontitem"; b.dataset.font = n;
      b.setAttribute("role", "option");
      b.textContent = n;
      b.style.setProperty("font-family", `"${n}", system-ui, sans-serif`, "important");      // каждое название — своим шрифтом (important: поверх выбранного шрифта интерфейса)
      b.onclick = () => choose(n);
      frag.append(b);
    }
    list.append(frag);
    note.textContent = !fonts?.length ? "" : items.length ? (items.length > 600 ? `Показаны первые 600 из ${items.length} — уточни поиск` : "") : "Ничего не найдено";
    paint();
  }
  // список шрифтов — в общем окне «Подробнее» (details.js): поле поиска и список переезжают туда на время выбора
  let dt = null;
  async function open() {
    if (dt) { dt.close(); return; }
    dt = openDetails({ title: "Шрифт интерфейса", sub: "Каждое название показано своим шрифтом. Щёлкни — и он сразу применится.", adopt: [box, note], onClose: () => { dt = null; } });
    if (!fonts) {
      note.textContent = "Читаю список шрифтов…";
      await loadFonts();
      if (!fonts.length) { note.textContent = "Не удалось получить список шрифтов: пересобери приложение (нужна команда system_fonts из fonts.rs)."; return; }
    }
    renderList();
    find.focus();
    list.querySelector(".fontitem.on")?.scrollIntoView({ block: "center" });
  }
  pick.onclick = open;
  reset.onclick = () => choose("");
  heads.onchange = () => { st.heads = heads.checked; save(); apply(); };
  let t = 0;
  find.oninput = () => { clearTimeout(t); t = setTimeout(renderList, 120); };
  find.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && find.value) { e.stopPropagation(); e.preventDefault(); find.value = ""; renderList(); }   // пустое поле — Esc закрывает окно
    else if (e.key === "ArrowDown") { e.preventDefault(); list.querySelector(".fontitem")?.focus(); }
  });
  // стрелки по списку
  list.addEventListener("keydown", (e) => {
    const b = e.target.closest?.(".fontitem");
    if (!b) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); e.stopPropagation();
      const n = e.key === "ArrowDown" ? b.nextElementSibling : b.previousElementSibling;
      if (n) { n.focus(); n.scrollIntoView({ block: "nearest" }); } else if (e.key === "ArrowUp") find.focus();
    }
  });
  paint();
})();
