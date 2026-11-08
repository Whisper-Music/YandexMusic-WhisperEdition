// Браузерная версия: `window.__TAURI__` поверх HTTP. Подставляется сервером (webmode.rs) первым скриптом
// в index.html, только во вкладке — в окне приложения этого файла нет. Остальной код не знает, где он запущен.
//   core.invoke   → POST /__web/ipc (команда выполняется в спрятанном окне-переходнике, bridge.js);
//                   байты (тема, копия) — телом запроса, заголовки команды — X-H-*;
//   event.listen  → поток /__web/events (SSE);
//   convertFileSrc → /__proto/ymlocal/… и /__proto/wa/… (скачанные треки и поток архива);
//   opener.openUrl → обычная новая вкладка.
// Чего во вкладке нет (окно, эксклюзивный WASAPI) — отвечаем на месте, без приложения.
(() => {
  if (window.__TAURI_INTERNALS__) return;
  window.__WEB__ = true;
  document.documentElement.classList.add("webmode");
  const H = { "X-Whisper": "1" };
  const FS = { on: false };
  const LOCAL = {
    app_ready: () => null,
    win_minimize: () => null,
    win_close: () => null,
    win_drag: () => null,
    win_is_max: () => false,
    win_toggle_max: () => null,
    engine_available: () => false,       // свой звуковой движок играет только в окне приложения
    // «на весь экран» — средствами браузера
    win_set_fullscreen: (a) => {
      FS.on = !!a?.on;
      const d = document;
      if (FS.on && !d.fullscreenElement) d.documentElement.requestFullscreen?.().catch(() => {});
      if (!FS.on && d.fullscreenElement) d.exitFullscreen?.().catch(() => {});
      return null;
    },
  };
  const isBytes = (v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v);

  async function invoke(cmd, args, opts) {
    if (LOCAL[cmd]) return LOCAL[cmd](args);
    let r;
    try {
      if (isBytes(args)) {
        const h = { ...H, "Content-Type": "application/octet-stream" };
        for (const [k, v] of Object.entries(opts?.headers || {})) h["X-H-" + k] = String(v);
        r = await fetch("/__web/ipc?cmd=" + encodeURIComponent(cmd), { method: "POST", headers: h, body: args });
      } else {
        r = await fetch("/__web/ipc", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ cmd, args: args ?? {} }) });
      }
    } catch { throw "нет связи с приложением — оно закрыто?"; }
    if (r.status === 403) { gone(); throw "вкладка больше не связана с приложением"; }
    if ((r.headers.get("content-type") || "").startsWith("application/octet-stream")) return r.arrayBuffer();
    const j = await r.json().catch(() => null);
    if (!j) throw "приложение не ответило";
    if (!j.ok) throw j.err;
    return j.val;
  }

  // ---------- события ----------
  const subs = new Map();
  let es = null;
  function connect() {
    es = new EventSource("/__web/events");
    es.onmessage = (m) => {
      let d;
      try { d = JSON.parse(m.data); } catch { return; }
      if (d.event === "web-return") return gone();
      for (const fn of [...(subs.get(d.event) || [])]) { try { fn({ event: d.event, payload: d.payload, id: 0 }); } catch (e) { console.error(e); } }
    };
  }
  // приложение снова в окне (или перезапущено) — вкладке сообщает webmode.js
  let left = false;
  function gone() {
    if (left) return;
    left = true;
    try { es?.close(); } catch {}
    window.dispatchEvent(new CustomEvent("whisper:web-gone"));
  }
  function listen(name, fn) {
    if (!subs.has(name)) subs.set(name, new Set());
    subs.get(name).add(fn);
    return Promise.resolve(() => subs.get(name)?.delete(fn));
  }
  async function once(name, fn) {
    const un = await listen(name, (e) => { un(); fn(e); });
    return un;
  }

  const convertFileSrc = (path, scheme = "asset") => `${location.origin}/__proto/${scheme}/${path ? encodeURIComponent(path) : ""}`;

  window.__TAURI__ = {
    core: { invoke, convertFileSrc },
    event: { listen, once, emit: () => Promise.resolve() },
    app: { getVersion: () => invoke("plugin:app|version") },
    opener: {
      openUrl: (url) => {
        if (/^https?:\/\//i.test(String(url))) { window.open(url, "_blank", "noopener"); return Promise.resolve(); }
        return invoke("plugin:opener|open_url", { url });
      },
    },
  };
  window.__webLeave = gone;
  connect();
})();
