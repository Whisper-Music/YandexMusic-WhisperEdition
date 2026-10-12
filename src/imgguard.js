// imgguard.js — проверка картинки ДО декодирования.
// Формат определяется по байтам (расширению и MIME-типу не верим), размеры и число кадров читаются из
// заголовков. Слишком большие, анимации с огромным числом кадров, повреждённые и незнакомые файлы
// отклоняются, не доходя до декодера браузера.
"use strict";
const IMG_LIMITS = Object.freeze({
  maxBytes: 50 * 1048576,      // размер файла
  maxSide: 16384,              // ширина или высота
  maxPixels: 50e6,             // пикселей в одном кадре (≈ 8K×6K)
  maxFrames: 1000,             // кадров в анимации
  maxTotalPixels: 2e9,         // пикселей во всех кадрах вместе
});

function imageGuard(b, limits = IMG_LIMITS) {
  if (!(b instanceof Uint8Array)) throw new Error("Нет данных картинки.");
  if (b.length > limits.maxBytes) throw new Error(`Файл больше ${limits.maxBytes / 1048576} МБ.`);
  const bad = (why) => { throw new Error("Файл повреждён или не является картинкой" + (why ? ` (${why})` : "") + "."); };
  const need = (p, n) => { if (p < 0 || p + n > b.length) bad("обрыв данных"); };
  const u16be = (p) => (need(p, 2), (b[p] << 8) | b[p + 1]);
  const u16le = (p) => (need(p, 2), b[p] | (b[p + 1] << 8));
  const u24le = (p) => (need(p, 3), b[p] | (b[p + 1] << 8) | (b[p + 2] << 16));
  const u32be = (p) => (need(p, 4), ((b[p] << 24) >>> 0) + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]));
  const u32le = (p) => (need(p, 4), ((b[p + 3] << 24) >>> 0) + ((b[p + 2] << 16) | (b[p + 1] << 8) | b[p]));
  const i32le = (p) => u32le(p) | 0;
  const str = (p, n) => (p + n <= b.length ? String.fromCharCode(...b.subarray(p, p + n)) : "");

  let type, ext, w = 0, h = 0, frames = 1;
  if (b[0] === 0x89 && str(1, 3) === "PNG") {                     // PNG / APNG
    type = "image/png"; ext = "png";
    if (str(12, 4) !== "IHDR") bad("нет IHDR");
    w = u32be(16); h = u32be(20);
    let p = 8, n = 0;
    while (p + 8 <= b.length && n++ < 100000) {
      const len = u32be(p), t = str(p + 4, 4);
      if (len > b.length) bad("кусок PNG длиннее файла");
      if (t === "acTL") { frames = Math.max(1, u32be(p + 8)); }
      if (t === "IDAT" || t === "IEND") break;                     // acTL обязан стоять до данных
      p += 12 + len;
    }
  } else if (b[0] === 0xff && b[1] === 0xd8) {                     // JPEG
    type = "image/jpeg"; ext = "jpg";
    let p = 2;
    for (;;) {
      need(p, 2);
      if (b[p] !== 0xff) bad("неверный маркер JPEG");
      while (b[p] === 0xff) { p++; need(p, 1); }                 // байты-заполнители
      const m = b[p++];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;   // маркеры без длины
      if (m === 0xd9 || m === 0xda) bad("нет заголовка кадра");
      const len = u16be(p);
      if (len < 2) bad("неверная длина сегмента");
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = u16be(p + 3); w = u16be(p + 5); break; }
      p += len;
    }
  } else if (str(0, 4) === "GIF8") {                               // GIF (в том числе анимированный)
    type = "image/gif"; ext = "gif";
    w = u16le(6); h = u16le(8);
    need(10, 3);
    let p = 13;
    if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
    const skipBlocks = () => { for (;;) { need(p, 1); const n = b[p++]; if (!n) return; p += n; } };
    frames = 0;
    try {
      while (p < b.length) {
        const k = b[p++];
        if (k === 0x3b) break;                                     // конец файла
        if (k === 0x21) { p++; skipBlocks(); continue; }           // расширение
        if (k !== 0x2c) bad("неизвестный блок GIF");
        const fw = u16le(p + 4), fh = u16le(p + 6), fl = b[p + 8];
        if (fw > limits.maxSide || fh > limits.maxSide) throw new Error(`Кадр GIF больше ${limits.maxSide} пикселей по стороне.`);
        p += 9;
        if (fl & 0x80) p += 3 * (1 << ((fl & 7) + 1));
        p++;                                                       // минимальный размер кода LZW
        skipBlocks();
        if (++frames > limits.maxFrames) throw new Error(`В анимации больше ${limits.maxFrames} кадров.`);
      }
    } catch (e) {
      if (!/повреждён/.test(e.message) || !frames) throw e;         // оборванный хвост терпим, если кадры есть
    }
    if (!frames) bad("нет кадров");
  } else if (str(0, 4) === "RIFF" && str(8, 4) === "WEBP") {       // WebP (в том числе анимированный)
    type = "image/webp"; ext = "webp";
    const first = str(12, 4);
    if (first === "VP8 ") {
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) bad("неверный кадр VP8");
      w = u16le(26) & 0x3fff; h = u16le(28) & 0x3fff;
    } else if (first === "VP8L") {
      if (b[20] !== 0x2f) bad("неверный кадр VP8L");
      const v = u32le(21); w = (v & 0x3fff) + 1; h = ((v >>> 14) & 0x3fff) + 1;
    } else if (first === "VP8X") {
      w = u24le(24) + 1; h = u24le(27) + 1;
      if (b[20] & 0x02) {                                          // флаг анимации: считаем кадры ANMF
        frames = 0;
        let p = 12;
        while (p + 8 <= b.length) {
          const t = str(p, 4), len = u32le(p + 4);
          if (len > b.length) bad("кусок WebP длиннее файла");
          if (t === "ANMF" && ++frames > limits.maxFrames) throw new Error(`В анимации больше ${limits.maxFrames} кадров.`);
          p += 8 + len + (len & 1);
        }
        if (!frames) bad("нет кадров");
      }
    } else bad("неизвестный вариант WebP");
  } else if (str(0, 2) === "BM") {                                 // BMP
    type = "image/bmp"; ext = "bmp";
    w = Math.abs(i32le(18)); h = Math.abs(i32le(22));
  } else if (str(4, 4) === "ftyp" && /^avi[fs]$/.test(str(8, 4))) { // AVIF
    if (str(8, 4) === "avis") throw new Error("Анимированный AVIF не поддерживается — подойдёт GIF или WebP.");
    type = "image/avif"; ext = "avif";
    const lim = Math.min(b.length - 16, 4 * 1048576);
    for (let p = 4; p < lim; p++) {                                // размеры — из коробок ispe (у сетки их несколько)
      if (b[p] === 0x69 && str(p, 4) === "ispe") { w = Math.max(w, u32be(p + 8)); h = Math.max(h, u32be(p + 12)); }
    }
  } else {
    throw new Error("Формат не поддерживается. Подойдут JPG, PNG, WebP, GIF, AVIF, BMP.");
  }

  if (!w || !h) bad("нулевой размер");
  if (w > limits.maxSide || h > limits.maxSide) throw new Error(`Картинка ${w}×${h} больше ${limits.maxSide} пикселей по стороне.`);
  if (w * h > limits.maxPixels) throw new Error(`Картинка ${w}×${h} слишком большая (больше ${Math.round(limits.maxPixels / 1e6)} Мп).`);
  if (frames > limits.maxFrames) throw new Error(`В анимации больше ${limits.maxFrames} кадров.`);
  if (w * h * frames > limits.maxTotalPixels) throw new Error(`Анимация слишком тяжёлая: ${frames} кадров по ${w}×${h}.`);
  return { type, ext, w, h, frames };
}
if (typeof module !== "undefined") module.exports = { imageGuard, IMG_LIMITS };
