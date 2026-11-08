// Язык интерфейса. Код и разметка пишутся по-русски, а при английском этот модуль сам подменяет текст на экране
// по словарю src/i18n/en.js («русская строка» → «English»): текстовые узлы и подсказки (title, placeholder,
// aria-label, alt) — и в разметке, и всё, что код дорисует потом (MutationObserver). Строки с переменными —
// ключи с {} («Осталось {} мин» → «{} min left»; {1} {2} — если порядок другой; значение может быть функцией).
// По-русски модуль ничего не делает: наблюдатель выключен. Возврат на русский — без перезапуска: помним исходники.
// Без defer, сразу после lsguard.js: наблюдатель должен успеть до первой отрисовки. Пропущенные строки —
// node scripts/i18n-check.mjs.
(() => {
  const KEY = "ym_lang";
  const CY = /[А-Яа-яЁё]/;
  const ATTRS = ["title", "placeholder", "aria-label", "alt"];
  // своё у пользователя и у сервиса не переводим: строки треков в списках (их тысячи — и быстрее), текст песни,
  // поля ввода, консоль. В плеере название не пропускаем: там бывает «Ничего не играет»; случайно совпасть
  // с короткой строкой интерфейса название может, но шаблоны для коротких строк — только с числами (en.js)
  const SKIP = "script, style, textarea, input, [contenteditable], [data-noi18n], #cli, .list li .t, .list li .a, .tartists, " +
    "#fLyrics, .qpanel li .t, .qpanel li .a";
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  let lang = (() => { try { return localStorage.getItem(KEY) === "en" ? "en" : "ru"; } catch { return "ru"; } })();
  let dict = null, pats = null, obs = null;
  const miss = new Map();
  const txtOrig = new WeakMap();      // текстовый узел → { ru, en }
  const attrOrig = new WeakMap();     // элемент → { title: { ru, en }, … }
  const subs = new Set();

  function load() {
    if (dict) return dict;
    dict = window.I18N_EN || {};
    // ключи с {} → шаблоны; сначала те, где больше постоянного текста (точнее)
    pats = Object.keys(dict).filter((k) => k.includes("{}") && CY.test(k.replace(/\{\}/g, ""))).map((k) => {
      const re = new RegExp("^" + k.split("{}").map((p) => p.replace(/[.*+?^$()|[\]\\]/g, "\\$&")).join("(.+?)") + "$", "s");
      // «{}» в кавычках — почти всегда название (трек, альбом, стиль): его не переводим, даже если совпало со словом
      const quoted = k.split("{}").slice(0, -1).map((p) => p.endsWith("«"));
      return [re, dict[k], k.replace(/\{\}/g, "").length, quoted];
    }).sort((a, b) => b[2] - a[2]);
    return dict;
  }
  // подставленное в шаблон тоже может быть строкой интерфейса («Сейчас: {}» ← «Моя волна»)
  const inner = (c) => (typeof dict[norm(c)] === "string" ? dict[norm(c)] : c);
  function fill(en, caps, quoted) {
    caps = caps.map((c, i) => (quoted[i] ? c : inner(c)));
    if (typeof en === "function") return en(...caps);
    let i = 0;
    return en.replace(/\{(\d?)\}/g, (m, n) => caps[n ? n - 1 : i++] ?? "");
  }
  // перевод строки или null — если перевода нет
  function tr(s) {
    if (!s || !CY.test(s)) return null;
    const k = norm(s);
    load();
    let v = dict[k];
    if (typeof v === "function") v = v();
    if (v === undefined) {
      if (miss.has(k)) v = miss.get(k);
      else {
        v = null;
        // функция-перевод может отказаться (null): «{} с» — только для чисел; тогда пробуем следующий шаблон
        for (const [re, en, , q] of pats) { const m = re.exec(k); if (m) { const r = fill(en, m.slice(1), q); if (r != null) { v = r; break; } } }
        if (miss.size > 4000) miss.clear();
        miss.set(k, v);
      }
    }
    if (v == null) return null;
    return s.match(/^\s*/)[0] + v + s.match(/\s*$/)[0];       // пробелы по краям — как были (склейка в разметке)
  }

  const skipped = (el) => !el || !!el.closest(SKIP);
  function doText(n) {
    const s = n.data;
    if (!CY.test(s) || skipped(n.parentElement)) return;
    const v = tr(s);
    if (v != null && v !== s) { txtOrig.set(n, { ru: s, en: v }); n.data = v; }
  }
  function doAttr(el, a) {
    const s = el.getAttribute(a);
    if (!s || !CY.test(s)) return;
    if (el.matches("[data-noi18n], [data-noi18n] *")) return;
    const v = tr(s);
    if (v == null || v === s) return;
    let o = attrOrig.get(el);
    if (!o) attrOrig.set(el, (o = {}));
    o[a] = { ru: s, en: v };
    el.setAttribute(a, v);
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    if (root.matches(SKIP)) { if (root.matches("input, textarea")) for (const a of ATTRS) if (root.hasAttribute(a)) doAttr(root, a); return; }
    for (const a of ATTRS) if (root.hasAttribute(a)) doAttr(root, a);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) && !n.matches("input, textarea") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) doText(n);
      else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a);
    }
  }
  function onMut(recs) {
    for (const r of recs) {
      if (r.type === "childList") r.addedNodes.forEach(walk);
      else if (r.type === "characterData") doText(r.target);
      else if (r.type === "attributes") doAttr(r.target, r.attributeName);
    }
  }
  function start() {
    load();
    if (!obs) obs = new MutationObserver(onMut);
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    walk(document.documentElement);
  }
  // назад на русский: всё, что мы подменили и код с тех пор не трогал, — как было
  function revert() {
    obs?.disconnect();
    const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.currentNode; n; n = w.nextNode()) {
      if (n.nodeType === 3) { const o = txtOrig.get(n); if (o && n.data === o.en) n.data = o.ru; }
      else { const o = attrOrig.get(n); if (o) for (const a in o) if (n.getAttribute(a) === o[a].en) n.setAttribute(a, o[a].ru); }
    }
  }
  function apply() {
    document.documentElement.lang = lang;
    if (lang === "en") start(); else if (obs) revert();
  }
  function set(l, save = true) {
    l = l === "en" ? "en" : "ru";
    if (l === lang) return;
    lang = l;
    if (save) try { localStorage.setItem(KEY, l); } catch {}
    apply();
    subs.forEach((fn) => { try { fn(lang); } catch {} });
  }

  window.i18n = {
    get lang() { return lang; },
    set,
    // для текста, который уходит не в разметку: трей, уведомления, холст
    t: (s) => (lang === "en" ? tr(s) ?? s : s),
    on: (fn) => subs.add(fn),
  };
  // другие окна приложения (мини-плеер, уведомления) — следом за главным
  window.addEventListener("storage", (e) => { if (e.key === KEY) set(e.newValue, false); });
  apply();
  // переключатель «Язык / Language» (Настройки → Интерфейс, карточка #langCard под маскотом)
  document.addEventListener("DOMContentLoaded", () => {
    // меню значка в трее рисует система — подписи ему отдаёт Rust (lib.rs, tray_lang)
    const tray = () => window.__TAURI__?.core?.invoke("tray_lang", { lang }).catch(() => {});
    if (document.getElementById("langSeg")) { tray(); subs.add(tray); }
    const seg = document.getElementById("langSeg");
    if (!seg) return;
    const paint = () => seg.querySelectorAll(".chip").forEach((b) => b.classList.toggle("active", b.dataset.v === lang));
    seg.addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) { set(b.dataset.v); paint(); } });
    subs.add(paint);
    paint();
  });
})();
