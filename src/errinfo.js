// Понятные ошибки: где именно проблема — в Яндекс Музыке, сети, устройстве вывода, декодере, самом файле
// или Whisper Archive — и что с этим делать. Вместо «Не удалось воспроизвести: HTTP 403: …» плеер пишет
// «проблема в Яндекс Музыке: трек не отдаётся — нужна подписка Плюс или он недоступен в твоём регионе».
// Исходный текст ошибки остаётся во всплывающей подсказке строки состояния (title) — для отчётов об ошибках.
//
// window.errExplain(e, ctx) → { kind, short, where, text, raw }
//   ctx: { local — играл скачанный файл, wa — поток Whisper Archive, native — свой движок (WASAPI),
//          media — audio.error (MediaError), device — ошибка при работе с устройством вывода, track }
// Последняя ошибка запоминается (window.errLast) — sound.js показывает её в «Сведениях о формате».
(() => {
  const KINDS = {
    yandex: ["Яндекс", "проблема в Яндекс Музыке"],
    archive: ["архив", "проблема в Whisper Archive"],
    net: ["сеть", "проблема в сети"],
    device: ["устройство", "проблема в устройстве вывода"],
    decoder: ["декодер", "проблема в декодере"],
    file: ["файл", "проблема в самом файле"],
    app: ["приложение", "сбой приложения"],
  };
  const make = (kind, text, raw) => ({ kind, short: KINDS[kind][0], where: KINDS[kind][1], text, raw });

  // ответ сервера по коду: свой текст для Яндекса и для архива
  function http(code, wa) {
    const who = wa ? "archive" : "yandex";
    if (code === 401) return [who, wa ? "вход в архив устарел — войди заново в «Интеграциях»" : "вход устарел — выйди и войди в аккаунт заново"];
    if (code === 403) return [who, wa ? "архив не дал доступ к этому треку" : "трек не отдаётся: нужна подписка Плюс, или он недоступен в твоём регионе"];
    if (code === 404 || code === 410) return [who, wa ? "трека больше нет в архиве" : "трек удалён или больше недоступен"];
    if (code === 451) return [who, "трек недоступен в твоём регионе"];
    if (code === 429) return [who, "слишком много запросов — подожди минуту и попробуй снова"];
    if (code >= 500) return [who, wa ? "сервер архива сейчас сбоит — попробуй позже" : "сбой на стороне Яндекса — обычно проходит за несколько минут"];
    if (code >= 400) return [who, `сервер отклонил запрос (код ${code})`];
    return null;
  }

  function explain(e, ctx = {}) {
    const raw = String(e?.message || e || "").replace(/^(WASAPI|LOCAL):\s*/, "").trim() || "неизвестная ошибка";
    const full = String(e?.message || e || "");
    const name = e?.name || "";
    const m = full.toLowerCase();
    const media = ctx.media && typeof ctx.media.code === "number" ? ctx.media.code : 0;   // 2 сеть, 3 декодер, 4 источник

    // ответ сервера с кодом — первым: в тексте ответа (кусок HTML) бывают любые слова
    const code = Number(full.match(/^HTTP (\d{3})\b/)?.[1] || 0);
    if (code && !ctx.local) { const h = http(code, ctx.wa); if (h) return make(h[0], h[1], raw); }
    // обрыв посреди загрузки — это сеть, хотя в тексте reqwest есть «decoding»
    if (/error (decoding|reading) response body|connection (reset|closed|aborted)|broken pipe|unexpected eof/i.test(full)) {
      return make("net", "связь оборвалась посреди загрузки — проверь интернет", raw);
    }
    // декодер: формат не разобрался (свой движок — symphonia; страница — MediaError 3)
    if (/формат файла не распознан|не распознан|decod|декод|symphonia|unsupported (codec|format)|ffmpeg|demux/i.test(full) || media === 3) {
      return make(ctx.local ? "file" : "decoder",
        ctx.local ? "скачанный файл повреждён или в неподдерживаемом формате — скачай трек заново"
          : "звук пришёл, но не раскодировался — файл повреждён или формат не поддерживается", raw);
    }
    // устройство вывода: эксклюзивный режим, setSinkId, звуковой граф
    if (ctx.device || name === "EngineFallback" || /^WASAPI:/.test(full) || /audclnt|устройств|монопольн|эксклюзивн|занят[оа]|sink|audio ?(device|output|context)|no audio/i.test(full)) {
      const busy = /занят|in use|exclusive|монопольн|audclnt_e_device_in_use/i.test(full);
      return make("device",
        busy ? "устройство занято другой программой или запрещён монопольный доступ (Параметры звука Windows → Дополнительно)"
          : name === "NotFoundError" || /not ?found|не найден|отключ/i.test(full) ? "устройство отключено или не найдено — проверь, подключены ли наушники или колонки"
          : name === "NotAllowedError" ? "Windows не дала доступ к устройству — открой «Звук» в настройках и выбери устройство ещё раз"
          : "устройство не приняло звук: " + raw, raw);
    }
    // скачанный файл
    if (/^LOCAL:|скачанн/i.test(full) || ctx.local) {
      return make("file",
        /не найден|not found|os error 2|enoent|пропал/i.test(full) || name === "NotSupportedError" ? "скачанный файл удалён или перемещён — трек сыграет из сети"
          : /отказано|denied|os error 5|permission/i.test(full) ? "нет доступа к скачанному файлу — проверь права на папку загрузок"
          : /вне папки|подменён/i.test(full) ? "файл лежит не в папке загрузок — из соображений безопасности он не открывается"
          : "скачанный файл не читается: " + raw, raw);
    }
    // сеть: нет интернета, DNS, таймаут, обрыв
    if (!navigator.onLine) return make("net", "нет подключения к интернету", raw);
    if (/timed? ?out|таймаут|долго/i.test(full)) return make("net", "сервер слишком долго не отвечает — медленная сеть, VPN или прокси", raw);
    if (/dns|failed to lookup|resolve|no route|unreachable|connect|error sending request|network|сеть|связ/i.test(m) || media === 2) {
      return make("net", ctx.wa ? "нет связи с Whisper Archive — проверь интернет" : "нет связи с Яндекс Музыкой — проверь интернет, VPN или прокси", raw);
    }
    // Яндекс ответил что-то не то
    if (/неожиданный адрес файла|не входит в список разрешённых|нет входа|неожиданн/i.test(full)) {
      return make(ctx.wa ? "archive" : "yandex", ctx.wa ? "архив ответил не так, как ожидалось" : "Яндекс отдал неожиданный ответ — возможно, изменился сервис; обнови Whisper", raw);
    }
    // плеер страницы не принял источник: файл не звук (протухшая ссылка вернула страницу ошибки) — или кодек
    if (media === 4 || name === "NotSupportedError") {
      return make(ctx.wa ? "archive" : "yandex", ctx.wa ? "архив отдал не звуковой файл" : "по ссылке пришёл не звук — ссылка устарела или доступ закрыт", raw);
    }
    if (name === "NotAllowedError") return make("app", "система не дала начать звук без нажатия — нажми «Играть»", raw);
    return make(ctx.wa ? "archive" : "app", raw, raw);
  }

  window.errLast = null;
  window.errExplain = (e, ctx = {}) => {
    const x = explain(e, ctx);
    window.errLast = { ...x, at: Date.now(), track: ctx.track?.id != null ? String(ctx.track.id) : null };
    return x;
  };
})();
