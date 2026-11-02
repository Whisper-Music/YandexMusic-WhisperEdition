// Версия приложения — одна, в package.json. Остальные места подтягиваются отсюда:
//   tauri.conf.json  — "version": "../package.json" (Tauri читает сам, править не нужно)
//   Cargo.toml       — version в [package] (из неё env!("CARGO_PKG_VERSION") в user-agent)
//   Cargo.lock       — запись пакета yandex-desktop (иначе cargo перепишет её при сборке и CI увидит разницу)
//   package-lock.json — корневая версия
//
//   npm run version 0.8.4    — поставить новую версию везде
//   npm run version          — без числа: только подтянуть Cargo.* и package-lock к package.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = (p) => join(root, p);
const read = (p) => readFileSync(file(p), "utf8");
// сохраняем переводы строк файла (в Windows git может отдать CRLF)
const write = (p, s) => writeFileSync(file(p), s);

const pkg = JSON.parse(read("package.json"));
const want = process.argv[2] ?? pkg.version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(want)) {
  console.error(`Версия должна быть вида 1.2.3, а не «${want}»`);
  process.exit(1);
}

const done = [];
function patch(p, re, to) {
  const s = read(p);
  if (!re.test(s)) { console.error(`${p}: не нашёл, где версия — файл поменялся?`); process.exit(1); }
  const n = s.replace(re, to);
  if (n !== s) { write(p, n); done.push(p); }
}

// package.json — правим строкой, чтобы не трогать форматирование файла
patch("package.json", /("version"\s*:\s*")[^"]*(")/, `$1${want}$2`);
// package-lock.json: корень и packages[""] — первые две записи "version" после "name": "yandex-desktop"
patch("package-lock.json", /("name"\s*:\s*"yandex-desktop",\s*"version"\s*:\s*")[^"]*(")/g, `$1${want}$2`);
// Cargo.toml — только version в [package] (у зависимостей свои version, их не трогаем)
patch("src-tauri/Cargo.toml", /(\[package\][^[]*?\nversion\s*=\s*")[^"]*(")/, `$1${want}$2`);
patch("src-tauri/Cargo.lock", /(\[\[package\]\]\r?\nname = "yandex-desktop"\r?\nversion = ")[^"]*(")/, `$1${want}$2`);

// tauri.conf.json должен брать версию из package.json — если кто-то вписал число, напомним
const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
if (conf.version !== "../package.json") console.warn(`Внимание: в tauri.conf.json "version": "${conf.version}" — поставь "../package.json"`);

console.log(done.length ? `Версия ${want}: ${done.join(", ")}` : `Версия ${want} уже везде`);
