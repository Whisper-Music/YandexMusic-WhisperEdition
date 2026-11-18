// Телефон: «что играет» — в уведомление плеера Android (шторка, экран блокировки, кнопки наушников) и обратно.
// Уведомление и фоновую службу держит Android-часть (MediaService.kt); страница сообщает ей трек, паузу и место
// в треке через мост WhisperAndroid.media(json), а нажатия в уведомлении приходят в window.whisperMediaAction.
// «Что играет» — только из ядра (Whisper.player.watch / state, как traymini.js и obs.js), без переменных main.js.
(() => {
  const W = window.Whisper;
  const A = window.WhisperAndroid;
  if (!window.isMobile || !A?.media || !W?.player) return;

  let last = "", queued = false, forceNext = false;

  function snapshot() {
    const p = W.player.state(), t = p.track;
    return {
      title: t ? t.title + (t.version ? ` (${t.version})` : "") : "",
      artist: t ? t.artists.map((a) => a.name).filter(Boolean).join(", ") : "",
      cover: t ? W.cover(t, 400) || "" : "",
      duration: Math.round((p.duration || 0) * 1000),
      position: Math.round((p.position || 0) * 1000),
      playing: !!p.playing,
    };
  }

  // несколько изменений подряд — одна отправка; место в треке Android дальше считает сам (по скорости 1×),
  // поэтому заново шлём его только после перемотки (force) или когда поменялось что-то ещё
  function push(force) {
    if (force) forceNext = true;
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const s = snapshot();
      const key = JSON.stringify({ ...s, position: 0 });
      const f = forceNext; forceNext = false;
      if (!f && key === last) return;
      last = key;
      try { A.media(JSON.stringify(s)); } catch {}
    });
  }
  W.player.watch(push);
  push(true);

  // нажатия в уведомлении / на наушниках (MainActivity.kt → MediaService.onAction)
  window.whisperMediaAction = (a, posMs) => {
    const P = W.player;
    if (a === "play") P.play();
    else if (a === "pause") P.pause();
    else if (a === "next") P.next();
    else if (a === "prev") P.prev();
    else if (a === "seek" && Number.isFinite(+posMs)) { P.seek(+posMs / 1000); push(true); }
  };
})();
