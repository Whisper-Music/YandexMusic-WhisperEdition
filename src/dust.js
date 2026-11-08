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

  // строка схлопывается по высоте, остальные плавно подъезжают
  function collapse(li) {
    const h = li.getBoundingClientRect().height;
    Object.assign(li.style, { height: h + "px", overflow: "hidden", boxSizing: "border-box" });
    void li.offsetHeight;
    li.style.transition = "height .34s ease, padding .34s ease, margin .34s ease, border-width .34s ease";
    Object.assign(li.style, { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px" });
    setTimeout(() => li.remove(), 380);
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

    // ~2500 квадратиков на строку, но не мельче 3 px: кадр — пара миллисекунд
    const cell = Math.max(3, Math.ceil(Math.sqrt((r.width * r.height) / 2500)));
    const ps = [];
    for (let y = 0; y < r.height; y += cell)
      for (let x = 0; x < r.width; x += cell) {
        const a = -(0.04 + Math.random() * 0.42) * Math.PI;       // вверх-вправо
        const sp = 45 + Math.random() * 120;                       // px/с
        ps.push({ x, y, d: (x / r.width) * 0.55 + Math.random() * 0.16, l: 0.5 + Math.random() * 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
      }
    li.style.visibility = "hidden";                   // настоящая строка прячется сразу — дальше видна только пыль
    setTimeout(() => collapse(li), 420);

    const t0 = performance.now();
    const frame = (now) => {
      const t = (now - t0) / 1000;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of ps) {
        const u = (t - p.d) / p.l;
        if (u >= 1) continue;
        alive = true;
        let ox = 0, oy = 0;
        if (u > 0) {
          const e = 1 - (1 - u) * (1 - u);            // разлёт с затуханием скорости
          ox = p.vx * p.l * e; oy = p.vy * p.l * e;
          g.globalAlpha = 1 - u * u;
        } else g.globalAlpha = 1;
        g.drawImage(src, p.x * dpr, p.y * dpr, cell * dpr, cell * dpr, PAD + p.x + ox, PAD + p.y + oy, cell, cell);
      }
      g.globalAlpha = 1;
      if (alive && t < 3) requestAnimationFrame(frame);
      else { cv.remove(); done(); }
    };
    requestAnimationFrame(frame);
  });
})();
