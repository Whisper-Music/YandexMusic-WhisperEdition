"use strict";
// «Распад на пиксели»: строка трека, убранного из лайков, рассыпается пылью слева направо и схлопывается
// (main.js → toggleLike, на открытой странице «Лайки»). window.rowDust(li) → Promise, когда строки уже нет.
// Скриншота DOM у страницы нет (а через SVG <foreignObject> CSP и чужие обложки не дают), поэтому строка
// перерисовывается на холст сама: фон, обложка и текст — этого хватает, кусочки разлетаются за долю секунды.
// Потом холст режется на квадратики, и каждый улетает вверх-вправо и тает. Рисуется одним <canvas> поверх окна
// (pointer-events: none), ~1,5 с — и холст убирается. Анимации выключены — строка просто исчезает.
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const animOn = () => document.documentElement.dataset.anim !== "off" && !reduced.matches && !document.hidden;
  const shown = (cs) => cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05;
  const clear = (c) => !c || c === "transparent" || /rgba\([^)]*[,/]\s*0(\.0+)?\s*\)$/.test(c);

  // строка → холст того же размера (в пикселях экрана)
  function paintRow(li, r, dpr) {
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.ceil(r.width * dpr)); cv.height = Math.max(1, Math.ceil(r.height * dpr));
    const g = cv.getContext("2d");
    g.scale(dpr, dpr); g.translate(-r.left, -r.top);
    const rounded = (b, cs) => {
      const rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, b.width / 2, b.height / 2);
      g.beginPath();
      if (rad && g.roundRect) g.roundRect(b.left, b.top, b.width, b.height, rad); else g.rect(b.left, b.top, b.width, b.height);
    };
    const walk = document.createTreeWalker(li, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = walk.currentNode; n; n = walk.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const p = n.parentElement, s = n.textContent.replace(/\s+/g, " ");
        if (!p || !s.trim()) continue;
        const cs = getComputedStyle(p);
        if (!shown(cs)) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const q = rg.getClientRects()[0];
        if (!q || !q.width) continue;
        const clip = p.getBoundingClientRect();      // многоточие не нарисуется — просто обрезаем по своему блоку
        g.save();
        g.beginPath(); g.rect(clip.left, clip.top, clip.width, clip.height); g.clip();
        g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        g.fillStyle = cs.color; g.textBaseline = "middle";
        g.fillText(s, q.left, q.top + q.height / 2);
        g.restore();
        continue;
      }
      if (n instanceof SVGElement) continue;          // значки кнопок не нужны: пыль — от обложки и названия
      const cs = getComputedStyle(n);
      if (!shown(cs)) continue;
      const b = n.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (!clear(cs.backgroundColor)) { g.fillStyle = cs.backgroundColor; rounded(b, cs); g.fill(); }
      if (n.tagName === "IMG" && n.complete && n.naturalWidth) {
        g.save(); rounded(b, cs); g.clip();
        try { g.drawImage(n, b.left, b.top, b.width, b.height); } catch {}
        g.restore();
      }
    }
    return cv;
  }

  // Строка убирается сразу, а строки под ней, что видны на экране, подъезжают на её место (FLIP): им ставится
  // сдвиг вниз на высоту убранной, и он плавно уходит в ноль. Анимируется только transform — это делает
  // видеокарта, без пересчёта раскладки. Раньше схлопывалась высота строки, и на каждом кадре заново
  // раскладывался весь список (в «Лайках» — тысячи строк): отсюда и рывки.
  function collapse(li) {
    const cs = getComputedStyle(li);
    const h = li.getBoundingClientRect().height + Math.max(parseFloat(cs.marginTop) || 0, parseFloat(cs.marginBottom) || 0);
    const after = [];
    for (let n = li.nextElementSibling; n && after.length < 60; n = n.nextElementSibling) {
      if (n.getBoundingClientRect().top > innerHeight) break;           // ниже экрана — сдвиг не виден
      after.push(n);
    }
    li.remove();
    if (!after.length) return;
    for (const el of after) { el.style.transition = "none"; el.style.transform = `translateY(${h}px)`; el.style.willChange = "transform"; }
    void after[0].offsetHeight;                                           // одна раскладка — с уже убранной строкой
    requestAnimationFrame(() => {
      for (const el of after) { el.style.transition = "transform .34s cubic-bezier(.2, .7, .25, 1)"; el.style.transform = ""; }
      setTimeout(() => { for (const el of after) { el.style.transition = el.style.willChange = ""; } }, 400);
    });
  }

  window.rowDust = (li) => new Promise((done) => {
    if (!li?.isConnected) return done();
    if (li.dataset.dust) return done();
    li.dataset.dust = "1";
    const r = li.getBoundingClientRect();
    if (!animOn() || !r.width || !r.height || r.bottom < 0 || r.top > innerHeight) { li.remove(); return done(); }
    const dpr = window.devicePixelRatio || 1;
    let src;
    try { src = paintRow(li, r, dpr); } catch { li.remove(); return done(); }

    const PAD = 110;                                  // место, куда долетает пыль
    const W = r.width + PAD * 2, H = r.height + PAD * 2;
    const cv = document.createElement("canvas");
    cv.className = "rowdust";
    cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(H * dpr);
    Object.assign(cv.style, { position: "fixed", left: r.left - PAD + "px", top: r.top - PAD + "px", width: W + "px", height: H + "px", pointerEvents: "none", zIndex: "9000" });
    document.body.append(cv);
    const g = cv.getContext("2d");
    g.imageSmoothingEnabled = false;

    // ~1800 квадратиков на строку, но не мельче 4 px. Задержка старта растёт по столбцам слева направо
    // (SPREAD) плюс случайная добавка не больше JIT — значит, всё правее «фронта» (x/w·SPREAD > t) ещё
    // на месте и рисуется одним куском, а по кусочку — только то, что уже летит. Частицы отсортированы
    // по столбцам: перебор кончается на фронте.
    const SPREAD = 0.55, JIT = 0.16;
    const cell = Math.max(4, Math.ceil(Math.sqrt((r.width * r.height) / 1800)));
    const ps = [];
    for (let x = 0; x < r.width; x += cell)
      for (let y = 0; y < r.height; y += cell) {
        const a = -(0.04 + Math.random() * 0.42) * Math.PI;       // вверх-вправо
        const sp = 45 + Math.random() * 120;                       // px/с
        const l = 0.5 + Math.random() * 0.4;
        ps.push({ x, y, d: (x / r.width) * SPREAD + Math.random() * JIT, l, dx: Math.cos(a) * sp * l, dy: Math.sin(a) * sp * l });
      }
    const sc = cell * dpr;
    li.style.visibility = "hidden";                   // настоящая строка прячется сразу — дальше видна только пыль
    setTimeout(() => collapse(li), 420);

    const t0 = performance.now();
    const frame = (now) => {
      const t = (now - t0) / 1000;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // столбцы, которые точно ещё не тронулись, — одним drawImage
      const front = t <= 0 ? 0 : Math.min(r.width, Math.floor(((t / SPREAD) * r.width) / cell) * cell);
      if (front < r.width) g.drawImage(src, front * dpr, 0, src.width - front * dpr, src.height, PAD + front, PAD, r.width - front, r.height);
      let alive = front < r.width, alpha = 1;
      for (const p of ps) {
        if (p.x >= front) break;
        const u = (t - p.d) / p.l;
        if (u >= 1) continue;
        alive = true;
        let ox = 0, oy = 0, a = 1;
        if (u > 0) {
          const e = 1 - (1 - u) * (1 - u);            // разлёт с затуханием скорости
          ox = p.dx * e; oy = p.dy * e; a = 1 - u * u;
        }
        if (a !== alpha) g.globalAlpha = alpha = a;
        g.drawImage(src, p.x * dpr, p.y * dpr, sc, sc, PAD + p.x + ox, PAD + p.y + oy, cell, cell);
      }
      g.globalAlpha = 1;
      if (alive && t < 3) requestAnimationFrame(frame);
      else { cv.remove(); done(); }
    };
    requestAnimationFrame(frame);
  });
})();
