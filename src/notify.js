"use strict";
// Системные уведомления (Rust — notify.rs, tauri-plugin-notification): друг зовёт в комнату, участник «подмигнул».
// Общие модули зовут их через Whisper.ui.kit.notify (yandex.js → window.sysNotify). Внутри окна и так есть подсказка
// (showToast), поэтому по умолчанию системное — только когда окно свёрнуто или в фоне; «Даже когда окно открыто» — всегда.
// Настройки — Приложение → Уведомления, localStorage ym_notify.
(() => {
  const KEY = "ym_notify";
  const DEF = { invite: true, wink: true, always: false };
  const KINDS = ["invite", "wink"];
  const $n = (s) => document.getElementById(s);
  let st = load();
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "{}");
      const out = { ...DEF };
      if (v && typeof v === "object") for (const k of Object.keys(DEF)) if (typeof v[k] === "boolean") out[k] = v[k];
      return out;
    } catch { return { ...DEF }; }
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const away = () => document.hidden || !document.hasFocus();
  // одно и то же (повторный опрос, два снимка подряд) — не чаще раза в 4 с
  let lastText = "", lastAt = 0;

  async function show(title, body) {
    await invoke("sys_notify", { title: String(title || "Whisper"), body: String(body || "") });
  }
  // { kind, title, body } → true — показано
  window.sysNotify = async ({ kind, title, body } = {}) => {
    if (!KINDS.includes(kind) || !st[kind]) return false;
    if (!st.always && !away()) return false;
    const t = `${title}\n${body}`;
    if (t === lastText && Date.now() - lastAt < 4000) return false;
    lastText = t; lastAt = Date.now();
    try { await show(title, body); return true; }
    catch (e) { console.warn("Уведомление не показано:", e?.message || e); return false; }
  };

  function sync() {
    const set = (id, v) => { const x = $n(id); if (x) x.checked = v; };
    set("ntInvite", st.invite); set("ntWink", st.wink); set("ntAlways", st.always);
    const al = $n("ntAlways"); if (al) al.disabled = !st.invite && !st.wink;
  }
  function mount() {
    const bind = (id, k) => { const x = $n(id); if (x) x.onchange = () => { st[k] = x.checked; save(); sync(); }; };
    bind("ntInvite", "invite"); bind("ntWink", "wink"); bind("ntAlways", "always");
    const test = $n("ntTest"), note = $n("ntNote");
    if (test) test.onclick = async () => {
      test.disabled = true;
      try {
        await show("Whisper", "Так выглядят уведомления: друг зовёт в комнату или подмигивает тебе");
        if (note) { note.textContent = "Уведомление отправлено — если его не видно, проверь, что уведомления Whisper разрешены в системе"; note.classList.add("ok"); }
      } catch (e) {
        if (note) { note.textContent = "Не удалось показать: " + (e?.message || e); note.classList.remove("ok"); }
      } finally { test.disabled = false; }
    };
    sync();
  }
  mount();
})();
