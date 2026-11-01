// Проверка репозитория «Библиотеки тем» (Whisper-Music/whisper-themes) перед публикацией.
//
//   node scripts/check-themes.mjs <папка whisper-themes>                 — проверить весь репозиторий
//   node scripts/check-themes.mjs <папка whisper-themes> --new тема.wmt  — можно ли добавить присланную тему
//
// Зачем: приложение узнаёт тему только по manifest.id. Две разные темы с одним id — беда:
// в библиотеке видна только первая (вторую приложение молча пропускает), у пользователя одна заменяет другую.
// Здесь ловится всё, из-за чего библиотека тихо сломается или не установит тему:
// дубли id, файл не там, где его ждёт приложение, id в файле не совпадает со списком, битые темы.
// Темы открываются тем же разбором, что в приложении (src/core/wmt.js). Код выхода 1 — есть ошибки.
// Ещё предупреждение «прячет обязательный минимум» (управление окном, пауза, настройки — см. src/themeguard.js):
// по CSS видно не всё, поэтому это подсказка, а не ошибка; точную проверку делает приложение после включения стиля.
import { readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

// wmt.js отдаёт себя через module.exports, а если Node грузит его как ES-модуль ("type": "module") — кладёт в globalThis.WMT
const require = createRequire(import.meta.url);
const mod = require(fileURLToPath(new URL("../src/core/wmt.js", import.meta.url)));
const WMT = typeof mod?.open === "function" ? mod : globalThis.WMT;
if (typeof WMT?.open !== "function") { console.error("Не удалось подключить src/core/wmt.js (подмодуль ядра на месте? git submodule update --init)"); process.exit(1); }

// то же, что в themelib.js: папки, встроенные стили, формат списка
const CATS = ["whisper", "community", "artists"];
const BUILTIN = ["neon", "royal", "steam", "lolitta"];
const FORMAT = 2;

const args = process.argv.slice(2);
const ni = args.indexOf("--new");
const newFile = ni >= 0 ? args[ni + 1] : null;
const repo = resolve(args.find((a, i) => !a.startsWith("--") && (ni < 0 || i !== ni + 1)) || "../whisper-themes");

const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const exists = (p) => stat(p).then((s) => s.isFile(), () => false);
const norm = (s) => String(s || "").trim().toLowerCase();

async function openTheme(path) {
  const th = await WMT.open(new Uint8Array(await readFile(path)));
  minimumWarnings(path, th);
  return th.manifest;
}

// ---------- обязательный минимум (то же, что проверяет src/themeguard.js в приложении) ----------
// Действие закрыто, если тема прячет его кнопку (по последней части селектора) и не дала своей кнопки
// с тем же действием ("buttons") и не консоль. Правила внутри @media тоже ловятся: берутся самые внутренние блоки.
const MINIMUM = [
  { name: "управление окном (закрыть, свернуть, перетащить)", sel: /^(\.titlebar|#titlebar|\.tbctl|#wClose|#wMin)\b/, acts: ["close", "minimize", "drag"] },
  { name: "пауза", sel: /^(#play|\.playbtn|\.ctrls|\.pcenter|\.player)\b/, acts: ["play"], cli: true },
  { name: "настройки", sel: /^(#settingsBtn|\.side)\b/, acts: ["page:settings"], cli: true },
];
const HIDES = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*(hidden|collapse)|opacity\s*:\s*0*\.?0+\s*(!important)?\s*(;|$)|(width|height)\s*:\s*0(px)?\s*(!important)?\s*(;|$)|transform\s*:[^;]*scale\(\s*0\s*\)|clip-path\s*:\s*inset\(\s*(50|100)%)/i;
function minimumWarnings(path, th) {
  let css = "", st = {};
  try { css = [th.css("whisper-core"), th.css("whisper-music")].filter(Boolean).join("\n"); st = th.settings("whisper-music") || {}; } catch { return; }
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const acts = new Set(Object.values(st.buttons && typeof st.buttons === "object" ? st.buttons : {}));
  const cli = st.console === true || (st.console && typeof st.console === "object" && st.console.enabled !== false);
  const r = relative(repo, path).replaceAll("\\", "/");
  const rel = !r || r.startsWith("..") ? path : r;
  for (const m of MINIMUM) {
    if (m.acts.every((a) => acts.has(a)) || (m.cli && cli)) continue;
    for (const [, sels, body] of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      if (!HIDES.test(body)) continue;
      // :hover / :focus — показывается при наведении: это не «спрятано навсегда»
      const hit = sels.split(",").map((s) => s.trim()).find((s) => {
        if (/:hover|:focus/.test(s)) return false;
        const last = s.split(/\s*[>+~]\s*|\s+/).filter(Boolean).pop() || "";
        // ::before/::after — прячется украшение, а не кнопка; [hidden] — и так скрытое приложением
        if (last.includes("::") || last.includes("[hidden]")) return false;
        return m.sel.test(last.replace(/^:root(\[[^\]]*\])*/, ""));
      });
      if (hit) {
        const need = m.acts.filter((a) => !acts.has(a)).map((a) => `"${a}"`).join(", ");
        warn(`${rel}: похоже, тема прячет «${m.name}» (правило «${hit}»). В приложении появится аварийная панель. `
          + `Если так задумано — дай свои кнопки в settings whisper-music → buttons с действиями ${need}`);
        break;
      }
    }
  }
}

// все .wmt в themes/ (и в подпапках) — чтобы найти файлы, которых нет в списке
async function wmtFiles(dir) {
  const out = [];
  let list = [];
  try { list = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await wmtFiles(p));
    else if (/\.wmt$/i.test(e.name)) out.push(p);
  }
  return out;
}

async function main() {
  let index;
  try { index = JSON.parse(await readFile(join(repo, "index.json"), "utf8")); }
  catch (e) { console.error(`Не удалось прочитать ${join(repo, "index.json")}: ${e.message}`); process.exit(1); }
  if (!Array.isArray(index?.themes)) { console.error("В index.json нет массива themes"); process.exit(1); }
  const fmt = Number(index.format) || 1, flat = fmt < 2;
  if (fmt > FORMAT) warn(`index.json: format ${fmt} новее, чем знает этот скрипт (${FORMAT})`);
  if (index.themes.length > 1000) warn(`в списке ${index.themes.length} тем — приложение читает только первые 1000`);

  const byId = new Map();          // id → первая запись (как в приложении: следующие с тем же id пропускаются)
  const listed = new Set();
  for (const [n, t] of index.themes.entries()) {
    const at = `index.json, тема №${n + 1}${t?.id ? ` «${t.id}»` : ""}`;
    const id = String(t?.id || "");
    if (!WMT.ID_RE.test(id)) { err(`${at}: id должен быть латиницей в нижнем регистре, цифрами и дефисом (до 48 знаков)`); continue; }
    if (BUILTIN.includes(id)) { err(`${at}: id совпадает со встроенным стилем — приложение такую тему не покажет`); continue; }
    if (byId.has(id)) {
      const first = byId.get(id);
      err(`${at}: id уже занят темой «${first.name || id}» (${first.category || "whisper"}, автор — ${first.author || "не указан"}). `
        + "Приложение покажет только первую, эта не появится в библиотеке никогда. Дай одной из них другой id (например, с ником автора)");
      continue;
    }
    byId.set(id, t);
    const cat = flat ? "whisper" : String(t.category || "");
    if (!CATS.includes(cat)) { err(`${at}: папка «${t.category}» неизвестна (бывают: ${CATS.join(", ")}) — тема не появится`); continue; }
    const dir = flat ? "" : cat + "/";
    const file = `themes/${dir}${id}.wmt`;
    if (t.file && t.file !== file) { err(`${at}: file «${t.file}», а приложение ждёт «${file}» — тема не появится`); continue; }
    listed.add(resolve(repo, file));
    if (!await exists(join(repo, file))) { err(`${at}: нет файла ${file}`); continue; }
    if (t.preview) {
      const pv = new RegExp(`^previews/${dir}${id}\\.(jpg|jpeg|png|webp)$`);
      if (!pv.test(t.preview)) warn(`${at}: preview «${t.preview}» не по правилу previews/${dir}${id}.jpg|png|webp — картинки не будет`);
      else if (!await exists(join(repo, t.preview))) warn(`${at}: нет картинки ${t.preview}`);
    }
    let m;
    try { m = await openTheme(join(repo, file)); }
    catch (e) { err(`${file}: тема не открывается — ${e.message}`); continue; }
    if (m.id !== id) err(`${file}: в файле manifest.id «${m.id}», а в списке «${id}» — приложение откажется её ставить`);
    if (t.version && String(m.version || "") !== String(t.version)) warn(`${file}: версия в списке ${t.version}, в файле ${m.version || "не указана"} — у пользователей кнопка «Обновить» не пропадёт`);
    if (norm(t.author) !== norm(m.author)) warn(`${file}: автор в списке «${t.author || ""}», в файле «${m.author || ""}» — у тех, у кого тема стоит, библиотека предложит «Заменить…» вместо «Включить»`);
    if (t.base && t.base !== (m.base || "neon")) warn(`${file}: основа в списке ${t.base}, в файле ${m.base || "neon"}`);
  }

  // файлы, которых нет в списке: тема лежит, но её никто не увидит (часто — второй файл с тем же id в другой папке)
  for (const f of await wmtFiles(join(repo, "themes"))) {
    if (listed.has(resolve(f))) continue;
    const rel = relative(repo, f).replaceAll("\\", "/");
    const id = basename(f, ".wmt");
    warn(`${rel}: файла нет в index.json${byId.has(id) ? ` — и id «${id}» уже занят другой записью` : ""}`);
  }

  // присланная тема: свободен ли её id
  if (newFile) {
    let m = null;
    try { m = await openTheme(resolve(newFile)); }
    catch (e) { err(`${newFile}: тема не открывается — ${e.message}`); }
    if (m) {
      const taken = byId.get(m.id);
      if (BUILTIN.includes(m.id)) err(`${newFile}: id «${m.id}» — встроенный стиль`);
      else if (taken) {
        if (norm(taken.author) && norm(taken.author) === norm(m.author)) {
          console.log(`\n${newFile}: это новая версия темы «${taken.name}» того же автора (${taken.author}). Подними version в файле и в index.json.`);
        } else {
          const nick = norm(m.author).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
          err(`${newFile}: id «${m.id}» уже занят темой «${taken.name}» (автор — ${taken.author || "не указан"}). `
            + `Перед добавлением смени id в manifest и в index.json, например на «${nick || "nick"}-${m.id}»`);
        }
      } else console.log(`\n${newFile}: id «${m.id}» свободен — можно добавлять (файл — themes/<папка>/${m.id}.wmt).`);
    }
  }

  for (const w of warns) console.log("⚠ " + w);
  for (const e of errors) console.log("✖ " + e);
  console.log(`\nТем в списке: ${byId.size}. Ошибок: ${errors.length}, предупреждений: ${warns.length}.`);
  process.exit(errors.length ? 1 : 0);
}
main();
