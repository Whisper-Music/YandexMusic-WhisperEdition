// Строки интерфейса без перевода: node scripts/i18n-check.mjs [--all] [--out файл]
// Собирает русские строки из src/*.html и src/**/*.js (как их увидит i18n.js: пробелы схлопнуты, ${…} → {},
// разметка внутри строк разрезана на куски) и сравнивает со словарём src/i18n/en.js.
// --all — все строки, а не только непереведённые; --out — записать список в файл (по строке на ключ).
// Консоль (cli.js) и сообщения формата .wmt (core/wmt.js — для авторов тем) не переводятся.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const SKIP = new Set(["cli.js", path.join("core", "wmt.js"), path.join("i18n", "en.js"), "i18n.js", "webstart.html", "bridge.html"]);
const CY = /[А-Яа-яЁё]/;
const norm = (s) => s.replace(/\s+/g, " ").trim();
const args = process.argv.slice(2);
const all = args.includes("--all"), outAt = args.indexOf("--out");

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!["rust", "docs", "node_modules"].includes(f.name)) walk(p); }
    else if (/\.(js|html)$/.test(f.name) && !SKIP.has(path.relative(root, p))) files.push(p);
  }
})(root);

// ${ … } с вложенными скобками → {}
function holes(s) {
  let out = "", i = 0;
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "{") {
      let d = 1, j = i + 2;
      for (; j < s.length && d; j++) { if (s[j] === "{") d++; else if (s[j] === "}") d--; }
      out += "{}"; i = j;
    } else out += s[i++];
  }
  return out;
}
const unesc = (s) => s.replace(/\\n/g, "\n").replace(/\\(["'`\\])/g, "$1").replace(/\\u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));

const found = new Map();   // ключ → файл
function add(raw, file, js) {
  // подсказки в разметке внутри строки JS (`<button title="…">`)
  if (js && raw.includes("<")) {
    const ar = /\s(?:title|placeholder|aria-label|alt)="([^"]*)"/g; let a;
    while ((a = ar.exec(raw))) if (CY.test(a[1])) add(a[1], file, false);
  }
  // разметка внутри строки — отдельные текстовые узлы
  for (let part of raw.split(/<[^>]*>/)) {
    if (!CY.test(part)) continue;
    part = part.replace(/&nbsp;/g, " ").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&mdash;/g, "—").replace(/&amp;/g, "&");
    let k = norm(part);
    // "На паузе · " + artist → "На паузе · {}"; ", " + x — склейка в JS
    if (js && raw === part) {
      if (/[\s·:—–(«]$/.test(part) && !/\{\}$/.test(k)) k += /\s$/.test(part) ? " {}" : "{}";
      if (/^[\s·—–)»,.]/.test(part) && !/^\{\}/.test(k)) k = (/^\s/.test(part) ? "{} " : "{}") + k;
    }
    if (k.length > 400) continue;
    if (!found.has(k)) found.set(k, path.relative(root, file));
  }
}

for (const f of files) {
  let t = fs.readFileSync(f, "utf8");
  if (f.endsWith(".html")) {
    t = t.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
    let m; const re = />([^<>]+)</g;
    while ((m = re.exec(t))) add(m[1], f, false);
    const ar = /\s(?:title|placeholder|aria-label|alt)="([^"]*)"/g;
    while ((m = ar.exec(t))) add(m[1], f, false);
    continue;
  }
  // строки JS: комментарии и console.* не в счёт
  t = t.replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = t.split("\n").map((l) => l.replace(/(^|[\s;,(){}])\/\/(?![^"'`]*["'`][,)\s;]).*$/, "$1")).filter((l) => !/console\.(log|warn|error|debug)/.test(l));
  t = lines.join("\n");
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(t))) {
    const s = m[1] ?? m[2] ?? m[3] ?? "";
    if (!CY.test(s)) continue;
    add(unesc(m[3] !== undefined ? holes(s) : s), f, true);
  }
}

let dict = {};
const dp = path.join(root, "i18n", "en.js");
if (fs.existsSync(dp)) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(dp, "utf8"), ctx);
  dict = ctx.window.I18N_EN || {};
}
const has = (k) => Object.prototype.hasOwnProperty.call(dict, k);
const list = [...found].filter(([k]) => all || !has(k));
const text = list.map(([k, f]) => `${f}\t${k}`).join("\n");
if (outAt >= 0) fs.writeFileSync(args[outAt + 1], text + "\n");
else if (list.length) console.log(text);
const miss = [...found.keys()].filter((k) => !has(k)).length;
console.error(`строк: ${found.size}, без перевода: ${miss}, в словаре: ${Object.keys(dict).length}`);
