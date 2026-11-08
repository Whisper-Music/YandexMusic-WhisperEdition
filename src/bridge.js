// Переходник браузерной версии (bridge.html в спрятанном главном окне, webmode.rs).
// Вкладка → Rust → событие «web-call» → здесь вызывается настоящая команда → web_reply → ответ вкладке.
// «web-return» — интерфейс возвращается в окно: забрать настройки из Rust (WebState.pull) и открыть index.html.
(() => {
  const T = window.__TAURI__, invoke = T.core.invoke;
  const isBytes = (v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v);
  const errText = (e) => (typeof e === "string" ? e : e?.message || (() => { try { return JSON.stringify(e); } catch { return String(e); } })());

  T.event.listen("web-call", async (e) => {
    const { id, cmd, args, raw, headers } = e.payload || {};
    if (!id || typeof cmd !== "string") return;
    try {
      let r;
      if (raw) {
        const body = await invoke("web_body", { id });
        r = await invoke(cmd, new Uint8Array(body), { headers: headers || {} });
      } else r = await invoke(cmd, args || {});
      if (isBytes(r)) await invoke("web_reply", r instanceof ArrayBuffer ? new Uint8Array(r) : r, { headers: { "x-id": String(id) } });
      else await invoke("web_reply", { id, ok: true, val: r === undefined ? null : r });
    } catch (err) {
      await invoke("web_reply", { id, ok: false, err: errText(err) }).catch(() => {});
    }
  });

  let returning = false;
  T.event.listen("web-return", async () => {
    if (returning) return;
    returning = true;
    try { await WebState.pull(WebState.tauri); } catch (e) { console.warn("настройки из вкладки не перенеслись:", e); }
    await invoke("web_finish").catch(() => {});
  });
})();
