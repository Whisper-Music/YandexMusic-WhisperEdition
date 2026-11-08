"use strict";
// Общее окно «Подробнее» для настроек: одна разметка, одни кнопки, одно поведение у всех «Настроить…» / «Выбрать…».
// Правило настроек: зависимые опции (2–3 строки) — прямо под своим выключателем, всё, что больше, — в этом окне.
// Кнопка с многоточием («Настроить…») всегда открывает это окно.
//
//   const d = openDetails({ title, sub, body, adopt, foot, wide, onClose, escape });
//   body   — функция (el) => { …заполнить el… } или готовый узел;
//   adopt  — уже существующие элементы страницы (список шрифтов, станции сна): на время окна переезжают внутрь
//            и становятся видны, после — возвращаются на место и прячутся, со всеми своими обработчиками;
//   foot   — свои кнопки слева от «Готово» (массив элементов); foot: false — без нижней строки;
//   escape — () => false, если Esc сейчас нужен самому окну (например, отмена записи сочетания);
//   d.close(), d.body, d.box, d.note — строка состояния над кнопками.
(() => {
  let cur = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  window.openDetails = ({ title = "", sub = "", body = null, adopt = [], foot = [], wide = false, onClose = null, escape = null } = {}) => {
    cur?.close();
    window.closeTrackMenu?.();
    const wrap = el("div", "login modal dtwrap");
    const box = el("div", "panel login-box modalbox dtmodal" + (wide ? " wide" : ""));
    box.setAttribute("role", "dialog"); box.setAttribute("aria-label", title);
    const head = el("div", "dthead");
    const x = el("button", "dtx", "✕"); x.type = "button"; x.title = "Закрыть (Esc)"; x.setAttribute("aria-label", "Закрыть");
    head.append(el("h2", "", title), x);
    box.append(head);
    if (sub) box.append(el("p", "dtsub", sub));
    const bodyEl = el("div", "dtbody");
    box.append(bodyEl);
    // чужие элементы: запомнить, где жили, — вернуть туда же
    const moved = [];
    for (const n of adopt.filter(Boolean)) {
      moved.push({ n, parent: n.parentNode, next: n.nextSibling, hidden: n.hidden });
      n.hidden = false;
      bodyEl.append(n);
    }
    if (typeof body === "function") body(bodyEl); else if (body) bodyEl.append(body);
    const note = el("p", "status dtnote");
    let done = null;
    if (foot !== false) {
      const row = el("div", "row dtfoot");
      for (const b of foot || []) row.append(b);
      done = el("button", "nav active", "Готово"); done.type = "button";
      row.append(done);
      box.append(note, row);
    }
    wrap.append(box);
    document.body.append(wrap);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      window.removeEventListener("keydown", onKey);
      for (const m of moved) {
        m.n.hidden = m.hidden;
        if (m.parent) m.parent.insertBefore(m.n, m.next && m.next.parentNode === m.parent ? m.next : null);
      }
      wrap.remove();
      if (cur === h) cur = null;
      try { onClose?.(); } catch (e) { console.warn(e); }
    }
    // Esc — в самом конце пути события: поля внутри (поиск шрифта) и окно со своим Esc успевают его забрать
    function onKey(e) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (escape && escape() === false) { e.preventDefault(); return; }
      e.preventDefault(); close();
    }
    window.addEventListener("keydown", onKey);
    x.onclick = close;
    if (done) done.onclick = close;
    wrap.onpointerdown = (e) => { if (e.target === wrap) close(); };
    const h = { close, body: bodyEl, box, note, done };
    cur = h;
    requestAnimationFrame(() => { if (!box.contains(document.activeElement)) (done || x).focus({ preventScroll: true }); });
    return h;
  };
  window.closeDetails = () => cur?.close();
})();
