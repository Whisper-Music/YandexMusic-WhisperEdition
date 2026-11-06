// cache.js — кэш приложения (Rust: src-tauri/src/cache.rs). Нескачанные треки на диске:
//   * популярные — дослушанные 3 раза и больше (считает Rust), живут дольше всех;
//   * текущий плейлист — уже проигранные треки того, что слушается сейчас (альбом, плейлист, лайки);
//     переключился на другое — они удаляются (популярные остаются).
// Трек «дослушан», когда сыграла половина (или 4 минуты) — тогда Rust решает, класть ли его в кэш, и качает сам.
// Играет кэш main.js → play(): тем же ymlocal://, что и скачанные (window.appCache.has). Без интернета — сразу из кэша.
// Настройки — карточка «Кэш» во вкладке «Воспроизведение»: размер (Выкл — кэш очищен), «Сохранять текущий плейлист».
(() => {
  const W = window.Whisper;
  if (!W) return;
  const $c = (id) => document.getElementById(id);
  const ids = new Set();
  let limitMb = 1024, keepPl = true;

  window.appCache = {
    has: (id) => limitMb > 0 && ids.has(String(id)),
    forget: (id) => { ids.delete(String(id)); invoke("cache_forget", { id: String(id) }).catch(() => {}); },
    ids: () => [...ids],
  };

  async function loadIds() {
    try { ids.clear(); for (const id of await invoke("cache_ids")) ids.add(String(id)); } catch {}
  }

  // ---------- что слушается: ключ плейлиста ----------
  // Плейлист — то, что слушается по порядку: альбом, плейлист, лайки, артист. Волна, комната и одиночные треки — нет
  // (их проигранное не копится, а прошлый плейлист при переходе на них очищается).
  function ctxKey() {
    const c = W.player.state().context || {};
    if (!["album", "playlist", "likes", "artist"].includes(c.type)) return null;
    const id = String(c.id || W.queue.list()?.[0]?.id || "");
    return (c.type + ":" + id).replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 120) || null;
  }

  // ---------- дослушан ли трек ----------
  let started = null, reported = "", source = "";
  W.on("start", ({ track: t }) => { started = t ? String(t.id) : null; reported = ""; });
  W.on("source", ({ source: s }) => { source = s || ""; });
  setInterval(() => {
    if (!started || reported === started) return;      // считаем и при выключенном кэше: счётчик «популярных» пригодится
    const s = W.player.state(), m = W.player.media();
    if (String(s.track?.id ?? "") !== started || m.loading || m.pending) return;
    const dur = m.duration || (s.track?.durationMs || 0) / 1000;
    if (!(s.position >= Math.min(240, dur > 0 ? dur * 0.5 : 60))) return;
    reported = started;
    const id = started;
    if (!/^\d{1,20}$/.test(id)) return;                    // не трек Яндекса
    // скачан или играет из архива — в кэш не нужен (но прослушивание посчитается для «популярных»)
    const downloaded = (typeof got !== "undefined" && got.has(id)) || source === "archive" || source === "local";
    invoke("cache_played", { id, ctx: keepPl ? ctxKey() : null, downloaded })
      .then((inCache) => { if (inCache) ids.add(id); else if (!downloaded) ids.delete(id); refreshInfo(); })
      .catch(() => {});
  }, 3000);

  // ---------- настройки ----------
  const mb = (n) => (n >= 1024 * 1024 * 1024 ? (n / 1024 / 1024 / 1024).toFixed(1).replace(".", ",") + " ГБ" : Math.round(n / 1024 / 1024) + " МБ");
  const plural = (n, f) => { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]; };
  let infoTimer = 0;
  function refreshInfo() {
    clearTimeout(infoTimer);
    infoTimer = setTimeout(async () => {
      let i;
      try { i = await invoke("cache_info"); } catch (e) { if ($c("cacheNote")) $c("cacheNote").textContent = "Кэш недоступен: " + (e?.message || e); return; }
      limitMb = i.limit_mb; keepPl = i.playlist;
      paint(i);
    }, 150);
  }
  function paint(i) {
    if (!$c("cacheCard")) return;
    for (const b of $c("cacheLimit").querySelectorAll(".chip")) b.classList.toggle("active", +b.dataset.v === i.limit_mb);
    $c("cachePl").checked = i.playlist;
    $c("cachePl").disabled = i.limit_mb === 0;
    $c("cachePath").textContent = i.dir;
    $c("cachePath").title = i.dir;
    $c("cacheNote").textContent = i.limit_mb === 0 ? "Кэш выключен."
      : i.count ? `${i.count} ${plural(i.count, ["трек", "трека", "треков"])} · ${mb(i.bytes)} из ${mb(i.limit_mb * 1024 * 1024)}` + (i.popular ? ` · популярных: ${i.popular}` : "")
      : "Пока пусто — треки появятся, когда ты их послушаешь.";
    $c("cacheClear").disabled = !i.count;
  }
  async function config(args) {
    try {
      const left = await invoke("cache_config", { limitMb: null, playlist: null, ...args });
      ids.clear(); for (const id of left) ids.add(String(id));
    } catch (e) { $c("cacheNote").textContent = "Не удалось сохранить: " + (e?.message || e); }
    refreshInfo();
  }
  if ($c("cacheCard")) {
    $c("cacheLimit").addEventListener("click", async (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const v = +b.dataset.v;
      if (v === 0 && ids.size && !(await modal({ title: "Выключить кэш?", text: "Треки из кэша будут удалены с диска. Скачанные треки останутся.", ok: "Выключить", danger: true }))) return;
      config({ limitMb: v });
    });
    $c("cachePl").onchange = (e) => config({ playlist: e.target.checked });
    $c("cacheOpen").onclick = () => invoke("cache_open_dir").catch((e) => { $c("cacheNote").textContent = "Не удалось открыть папку: " + (e?.message || e); });
    $c("cacheClear").onclick = async () => {
      if (!(await modal({ title: "Очистить кэш?", text: "Треки из кэша будут удалены с диска. Скачанные треки останутся.", ok: "Очистить", danger: true }))) return;
      try { await invoke("cache_clear"); ids.clear(); } catch (e) { $c("cacheNote").textContent = "Не удалось очистить: " + (e?.message || e); }
      refreshInfo();
    };
    // вкладку открыли — свежие цифры
    document.querySelector('.chip[data-tab="play"]')?.addEventListener("click", refreshInfo);
  }

  loadIds();
  refreshInfo();
})();
