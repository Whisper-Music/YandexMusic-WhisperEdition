// pagecache.js — карточка «Кэш страниц» в настройках (вкладка «Воспроизведение»).
// Показывает, что лежит в кэше страниц и как он сработал: снимок «Лайков» на диске (IndexedDB «likes:v1», main.js →
// window.pageCache), его возраст и размер, как открылись «Лайки» в последний раз (из памяти / из снимка / с Яндекса)
// и что держится в памяти до перезапуска (плейлисты, авторы). «Сбросить снимок» — стереть снимок с диска.
(() => {
  const $c = (id) => document.getElementById(id);
  if (!$c("pageCacheCard") || !window.pageCache) return;
  const plural = (n, f) => { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]; };
  const size = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1).replace(".", ",") + " МБ" : Math.max(1, Math.round(n / 1024)) + " КБ");
  const ms = (v) => (v >= 1000 ? (v / 1000).toFixed(1).replace(".", ",") + " с" : Math.round(v) + " мс");
  const tracks = (n) => `${n} ${plural(n, ["трек", "трека", "треков"])}`;
  const when = (t) => new Date(t).toLocaleString(document.documentElement.lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  function lastText(p) {
    if (!p) return "После запуска ещё не открывались";
    if (p.src === "mem") return `Из памяти за ${ms(p.ms)}`;
    if (p.src === "snap") {
      if (p.need == null) return `Из снимка за ${ms(p.ms)}, Яндекс ещё отвечает…`;
      if (p.stale) return `Из снимка за ${ms(p.ms)}, описания обновлены целиком (снимок старше суток)`;
      return p.need ? `Из снимка за ${ms(p.ms)}, у Яндекса догружено ${p.need} из ${p.total}` : `Из снимка за ${ms(p.ms)}, новых треков не было`;
    }
    const why = p.why === "empty" ? "снимок был пустой" : "снимка ещё не было";
    return p.ms ? `С Яндекса за ${ms(p.ms)} — ${why}` : `С Яндекса, ещё грузится — ${why}`;
  }

  let busy = false;
  async function paint() {
    if (busy) return;
    busy = true;
    try {
      const i = await window.pageCache.info();
      const s = i.snap;
      $c("pcSnap").textContent = !s ? "Ещё нет — появится, когда «Лайки» загрузятся целиком"
        : !s.mine ? "От другого аккаунта — будет заменён"
        : `${tracks(s.count)} · ≈ ${size(s.bytes)}`;
      if (s?.at) {
        const left = s.at + i.fresh - Date.now();
        $c("pcAt").textContent = left > 0 ? `${when(s.at)} · обновятся через ${Math.max(1, Math.round(left / 3600e3))} ч` : `${when(s.at)} · обновятся при следующем открытии`;
      } else $c("pcAt").textContent = "—";
      $c("pcRead").textContent = s ? ms(i.snap.readMs) : "—";
      $c("pcLast").textContent = lastText(i.last);
      $c("pcMem").textContent = `лайков ${i.mem.likes}, плейлистов ${i.mem.playlists}, авторов ${i.mem.artists}`;
      $c("pcClear").disabled = !s;
    } catch (e) {
      $c("pcSnap").textContent = "Кэш недоступен: " + (e?.message || e);
    } finally { busy = false; }
  }

  $c("pcRefresh").onclick = paint;
  $c("pcClear").onclick = async () => {
    if (!(await modal({ title: "Сбросить снимок «Лайков»?", text: "Следующий запуск загрузит лайки с Яндекса заново и сохранит новый снимок. Лайки, скачанное и кэш треков не тронутся.", ok: "Сбросить", danger: true }))) return;
    try { await window.pageCache.clear(); } catch (e) { $c("pcSnap").textContent = "Не удалось сбросить: " + (e?.message || e); return; }
    paint();
  };
  // карточка показалась (открыли настройки, вкладку, нашли поиском по настройкам) — свежие цифры
  new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) paint(); }).observe($c("pageCacheCard"));
})();
