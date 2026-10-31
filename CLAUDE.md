# Yandex Music — Whisper Edition

Неофициальный десктопный клиент Яндекс Музыки на **Tauri 2** (Rust + системный WebView: WebView2 в Windows,
WebKitGTK в Linux). Фронтенд — **чистый JS/CSS/HTML без сборщика и фреймворков**. Свои темы оформления — файлы `.wmt`.
Автор — Вадим. Версия в `package.json` и `src-tauri/Cargo.toml` (сейчас 0.7.x).

## Язык и стиль

- Интерфейс, комментарии, документация, сообщения коммитов — **по-русски**. Тексты в UI — простые и дружелюбные,
  на «ты», без канцелярита («Нажми, чтобы…», «Не удалось сохранить: …»).
- Комментарии объясняют **почему**, а не что; коротко, по-человечески. Стиль комментариев в файле сохраняй.
- Код плотный: короткие функции, `const $ = (s) => document.querySelector(s)`, однострочники там, где читаемо.
  Не переписывай чужой код «под себя» без причины.
- Новую самостоятельную функцию удобнее делать **отдельным модулем** `src/<имя>.js` (+ `<имя>.css`) в виде IIFE
  `(() => { … })();`, а не раздувать `main.js` (в нём уже ~5000 строк).

## Запуск и сборка

```bash
git submodule update --init   # ядро Whisper (src/core) — подмодуль, без него приложение не соберётся
npm install
npm run tauri dev      # разработка
npm run tauri build    # установщик (Windows: …_x64-setup.exe; Linux — см. README)
```

- Тестов нет — проверка руками в приложении. После правок JS достаточно перезапуска dev, после Rust — пересборка.
- `node --check src/файл.js` — быстрая проверка синтаксиса JS.
- CI: `.github/workflows/release.yml` (выпуски, подпись обновлений), `security.yml` (аудит зависимостей;
  `src-tauri/deny.toml`, `.cargo/audit.toml`).

## Структура

```
src/                      фронтенд (без сборки, файлы отдаются как есть)
  core/                   ЯДРО Whisper — ПОДМОДУЛЬ git (репозиторий Whisper-Music/whisper-core, общий с Whisper VK).
                          Правки ядра — коммит в whisper-core, потом в приложении `git add src/core` (см. ниже)
  core/whisper-core.js    ядро: шина событий, сущности, провайдер и
                          возможности, Whisper.player / Whisper.queue, роли интерфейса для тем. Подробно — src/core/docs/CORE.md
  core/queue.js/.css      ОБЩИЙ модуль «Очередь и история» (клавиша Q) — только через Whisper.*, без переменных main.js
  core/together.js        ОБЩИЙ модуль «Слушать вместе» (комнаты через сервер архива): плеер — Whisper.player
                          (playTrack/reload/media/setRate), трек для сервера — provider.toRoom/fromRoom; стили — core/together.css
                          (сразу после styles.css; в styles.css — только гость на «Моей волне» и затемнённые кнопки)
  core/archive.js/.css    ОБЩИЙ модуль Whisper Archive: источник звука «archive» (Whisper.sources), вход, карточка
                          в «Интеграциях», «Сохранить в архив» (Whisper.ui.trackMenu; файл трека — provider.archiveSave)
  core/wmt.js             ОБЩИЙ формат .wmt: разбор/сборка (без зависимостей; браузер и Node 18+)
  core/theme-css.js       ОБЩИЙ движок CSS тем: привязка к стилю, фильтр безопасности (cssSafe), роли, tokens, OBS
  core/rust/whisper/      ОБЩИЙ Whisper Archive на Rust (подключён из src-tauri/src/lib.rs через #[path]): mod (ключ,
                          альбомы), auth (вход по почте), upload (загрузка в архив), stream (протокол wa://), rooms
  core/docs/              CORE.md (ядро целиком), WMT-FORMAT.md (формат .wmt)
  yandex.js               Яндекс в ядре: роли разметки (Whisper.ui.define), провайдер «yandex», привязка плеера main.js,
                          операции с очередью (upcoming/remove/move/«играть следующим» — у main.js свой порядок
                          перемешивания), набор интерфейса для общих модулей (Whisper.ui.provide: toast, confirm, меню трека…)
  index.html              вся разметка: окно, страницы, настройки, плеер
  boot.js                 первым, БЕЗ defer: стиль прошлого запуска и «шторка» до первой отрисовки
  main.js                 ядро: API Яндекса, плеер, страницы, списки, настройки, цвета, фон, DynCss
  styles.css              общее оформление + встроенные стили (:root[data-style="neon|royal|steam|lolitta"])
  theme.js / theme.css    свои темы в этом приложении: загрузка, хранение, фон, сохранение в файл, карточки стилей
  themelib.js/.css        «Библиотека тем» (репозиторий Whisper-Music/whisper-themes)
  core/discord.js/.css    ОБЩИЙ модуль Discord Rich Presence (Rust — core/rust/discord.rs); карточку в «Интеграциях» ставит сам
  core/obs.js/.css        ОБЩИЙ виджет «Сейчас играет» для OBS (Rust — core/rust/obs.rs, страница — core/rust/obs/widget.*);
                          цвета и секции whisper-obs стиля берёт из kit.accentColors / kit.obsTheme (yandex.js)
  cli.js                  консоль вместо интерфейса (тема с "console") + скрытые команды
  hotkeys.js/.css         ГЛОБАЛЬНЫЕ сочетания (регистрирует Rust, работают в свёрнутом окне)
  keynav.js               навигация клавиатурой ВНУТРИ окна (стрелки, Пробел, Ctrl+F, F1 — список клавиш)
  imgview.js              аватарка артиста / обложка альбома на весь экран (щелчок по #headImg)
  uifont.js               шрифт интерфейса из установленных в системе (Оформление → Шрифт)
  sleep, eq, output, engine, sound — режим сна, эквалайзер, устройство вывода, свой WASAPI-движок, качество/нормализация
  layout.js/.css          режимы «Расположения» (без defer)
  mascot, listenstats, traymini, update, imgguard — маскот, статистика, трей, автообновление, заглушки картинок
  mini.html/js/css        отдельное окно мини-плеера
src-tauri/
  src/lib.rs              регистрация модулей и команд (generate_handler!), трей, окно
  src/*.rs                net (запросы к Яндексу), auth/secret (токен в keyring), download, engine (WASAPI),
                          theme/themelib, hotkeys,
                          fonts (список шрифтов), desktop (обои), power (экономия в трее), update, …
  src/whisper_host.rs     что приложение даёт общему Rust ядра (src/core/rust: whisper/, discord.rs, obs.rs): хранилище
                          ключа, heavy_slot, app_origin, подпись ключа, приложение Discord и кнопка, обложки для OBS —
                          единственное своё у приложения
  src/whisper_yandex.rs   Whisper Archive и Яндекс: wa_save_track (скачать трек с Яндекса → whisper::upload)
  build.rs                СПИСОК КОМАНД (AppManifest) — без строки здесь команда не вызывается
  capabilities/*.json     права окон на команды (default.json — главное окно)
  tauri.conf.json         окно, CSP, сборка
docs/
  CORE.md, WMT-FORMAT.md  ссылки: сами документы — в ядре, src/core/docs/
  THEMES.md               гайд по темам для пользователей
  examples/*.wmt          примеры: terminal, retro-tv (архив, своя раскладка), chalk, night-sky (старый вид с base64)
```

## Правила, о которые легко споткнуться

### CSP (`tauri.conf.json`)
`default-src 'none'; script-src 'self'; style-src 'self' blob:; img-src 'self' data: blob: https://*.yandex.net https://*.yandex.ru …;
connect-src 'self' ipc: http://ipc.localhost; font-src 'self' data: blob:`.

- **Нельзя** `<style>`, атрибут `style="…"` в разметке, `setAttribute("style", …)`, инлайн-обработчики `onclick="…"`,
  `eval`, внешние скрипты.
- **Можно** `el.style.prop = …` / `el.style.setProperty(…)` из JS (CSSOM).
- **Динамический CSS — только через `window.DynCss`** (main.js): `DynCss.set("ключ", cssText)` / `DynCss.remove("ключ")`.
  Это adoptedStyleSheets (или `<link>` на blob: в старом WebKitGTK); подключается после всех .css, после CSS тем,
  а `ccStyle` («Тонкая настройка цветов») — всегда последним.
- Страница **сама в сеть не ходит** (`connect-src` — только IPC). Все запросы — через Rust-команды (`invoke("ym_read", …)` и т. п.).
  Картинки — только с доменов Яндекса (`safeUrl()` в main.js).

### Скрипты и глобальные переменные
- Все `.js` — классические скрипты с `defer` в `<head>` (кроме `boot.js` и `layout.js`). Порядок = порядок в index.html.
- Верхнеуровневые `let/const/function` из `main.js` видны модулям, подключённым после него (общая глобальная
  лексическая область): `queue`, `current`, `audio`, `volume`, `needLoad`, `cfg`, `togglePlay()`, `setVol()`,
  `toggleLike()`, `navigate()`, `goTop()`, `showToast()`, `tmenu`, `openMenu()`, `closeTrackMenu()`, `invoke()`, `$()`.
  Модули обычно объявляют свои помощники (`$k`, `$w`, `$h`) внутри IIFE, чтобы не конфликтовать с `$`.
- Новый модуль: `<script src="x.js" defer></script>` в нужное место index.html (после main.js),
  CSS — `<link rel="stylesheet">` там же или правилами в styles.css.

### Ядро Whisper (`core/whisper-core.js`, src/core/docs/CORE.md)
- `src/core` — **подмодуль** (whisper-core): после `git pull` приложения — `git submodule update --init`. Правишь файл в
  `src/core` → это правка ядра для ВСЕХ приложений: коммит и push внутри `src/core` (репозиторий whisper-core), затем в
  приложении `git add src/core && git commit` (приложение запоминает версию ядра). Взять свежее ядро —
  `git submodule update --remote src/core`. Ничего про Яндекс в `src/core` не клади — для этого `yandex.js`, `whisper_*.rs`.
- Порядок скриптов: `core/whisper-core.js` → `main.js` → `yandex.js` → остальные (theme.js — после yandex.js: роли нужны при запуске;
  перед ним `core/wmt.js` и `core/theme-css.js`).
- Ядро **не знает** о Яндексе и разметке — ничего специфичного туда не клади: оно копируется в другие приложения (Whisper VK).
- `main.js` сообщает ядру о плеере через `wReport({ track | playing | volume | liked | disliked | seek | rate | modes | queue | started })` —
  в `showTrack` (в конце), `syncIcons`, `setVol`, `setSpeed`, `updateModes`, `refreshHearts`, `onseeked`, при дозагрузке волны,
  `started` — в `play()` при включении трека (история); правки очереди в `yandex.js` — `report({ queue: true })`.
- Источник звука вместо сервиса — `Whisper.sources.register(...)`; play() спрашивает `Whisper.sources.resolve` и шлёт
  `wReport({ source })`. Пункт в меню «⋯» от модуля — `Whisper.ui.trackMenu.add(...)` (main.js зовёт `trackMenu.build`).
- Общие модули (`src/core/*`) не трогают переменные main.js: всё нужное — через `Whisper.*`, роли и `Whisper.ui.kit`.
  Не хватает возможности — добавь её в ядро (и привязку в `yandex.js`), а не обращайся к main.js напрямую.
  Новое место, где меняется трек/состояние/очередь, — добавь `wReport`.
- Новый модуль лучше писать на `Whisper.on("track" | "playstate" | "volume" | "like" | "queue" | "seek" | "rate" | "modes", fn)`
  и `Whisper.player.*` / `Whisper.queue.*`, а не на глобальные переменные main.js. Модуль, который отправляет «что играет»
  наружу, — на `Whisper.player.watch(fn(force))` + `Whisper.player.state()` (так сделаны traymini, obs, discord, together).
  Крючков `window.miniPush` / `window.discordPush` main.js больше не вызывает (они оставлены только как «отправь заново»).
- Новый элемент интерфейса, похожий на существующий (ещё один поиск, кнопка плеера, вид списка), — добавь его
  селектор в нужную роль в `yandex.js` (`W.ui.define`). Иначе общие темы его не увидят. Новые общие роли — в `VOCAB` ядра и в docs/CORE.md.
- Темы: `@@ css whisper-core` (по ролям `[data-w="…"]`) подключается перед `@@ css whisper-music`. Роли разворачивает
  `Whisper.ui.resolve` (core/theme-css.js, `scopeCss`).

### Новая Rust-команда — в четырёх местах
1. `src-tauri/src/<модуль>.rs` — `#[tauri::command] pub async fn имя(…) -> Result<…, String>`; тяжёлое — в `tauri::async_runtime::spawn_blocking`.
2. `src-tauri/src/lib.rs` — `mod <модуль>;` и `<модуль>::имя` в `generate_handler![…]`.
3. `src-tauri/build.rs` — `"имя"` в `COMMANDS`.
4. `src-tauri/capabilities/default.json` (или нужный файл) — `"allow-имя"` (дефисы вместо `_`).
5. Новая библиотека — `Cargo.toml` с комментарием «зачем» (так оформлены все зависимости).

Вызов из JS: `await invoke("имя", { аргументы })` (обёртка в main.js) или `window.__TAURI__.core.invoke`.

### Страницы и шапка (main.js)
- Навигация: `navigate(fn)` — с историей «Назад», `goTop(fn)` — раздел из бокового меню. Защита от гонок: `const my = ++nav; … if (my !== nav) return;`.
- `setHead({ title, img, round, back, pin, artistWave, sub })` — шапка страницы; `resetView()` прячет всё страничное.
- `renderList(tracks, append, opts)` — строки треков `#list li` (`.t`, `.a`, `.likebtn`, `.morebtn`, `li.playing`).
- `setChips(items, active, onPick)` — переключатели под заголовком (`#chips`).
- Кнопки шапки с классом `.pin` (`#artistWaveBtn`, `#dlAllBtn`, `#pinBtn`, `#plCreateBtn`) прижаты вправо одной группой:
  `margin-left: auto` у первой видимой, `.head .pin:not([hidden]) ~ .pin { margin-left: -6px }` у остальных.
  «Скачать лайки» живёт в ряду `#chips` справа (переносит `paintDlAll()`).
- Офлайн: `offline`, `isNetErr()`, `suspectOffline()`, `offlinePick()` — страницы умеют показывать скачанное.

### Настройки (`#settingsPage`)
- Вкладки: `look` Оформление, `ui` Интерфейс, `play` Воспроизведение, `out` Звук, `app` Приложение, `int` Интеграции.
  Карточка — прямой ребёнок `.settings`: `<div class="card" data-tab="…">`. Без `data-tab` попадает в «Интеграции».
- Два столбца (CSS columns, ≥1100px): карточки идут **в порядке разметки**, правый столбец начинается с карточки `.colbreak`
  (одна на вкладку). Баланс высоты столбцов подбирается переносом `.colbreak`.
- Сейчас: Оформление — слева Стиль, Цвета, Шрифт; справа Фон. Интерфейс — Расположение, Эффекты и анимации | Визуализатор, Маскот.
  Воспроизведение — Режим сна | Скачивание треков. Интеграции — Whisper Archive (вставляет core/archive.js первой, через kit.settingsCard в yandex.js) | Discord, OBS.
- Настройки оформления — `cfg` (localStorage `ym_cfg3`, `saveCfg()`, `applyCfg()`, `syncControls()`), значения стиля — `cfg.s[стиль]`.
  Отдельные модули хранят своё под своими ключами (`ym_font`, `ym_hotkeys`, …).

### Клавиатура
- Глобальные сочетания (Ctrl+Alt+…) — `hotkeys.js` + `hotkeys.rs`. Внутри окна — `keynav.js`; занятые клавиши:
  стрелки, Enter, Home/End/PgUp/PgDn, Пробел, Ctrl+←/→/↑/↓, Shift+←/→, M, L, Ctrl+F, Alt+←/Backspace, F1, Menu/Shift+F10;
  Q — очередь (core/queue.js), F — визуализатор на весь экран (main.js), Ctrl+Shift+Backspace — аварийный сброс стиля (theme.js).
- Обработчики клавиш не срабатывают в полях ввода (`input, textarea, [contenteditable]`) и при открытом `.modal`.

### Прочее
- `[hidden]` перебивается `display:` в CSS классов — в своих блоках добавляй `#блок [hidden] { display: none !important; }`.
- Учитывай все 4 встроенных стиля: у `royal`/`steam` квадратные углы и рамки, у `lolitta` декор и свои переменные (`--l-*`),
  `:root[data-anim="off"]` — анимации выключены.
- Цвета в CSS — через переменные (`var(--accent)`, `var(--accent2)`, `var(--text)`, `var(--muted)`), а не числами.

---

## Формат темы `.wmt` — шпаргалка

Полное описание — `docs/WMT-FORMAT.md`, гайд с примерами — `docs/THEMES.md`. Здесь — всё нужное для работы.
Код: `src/core/wmt.js` (формат), `src/core/theme-css.js` (привязка CSS, безопасность, tokens, OBS — общее ядро),
`src/theme.js` (применение в этом приложении), `src/core/obs.js` (виджет).

### Два вида файла
- **Текст** (UTF-8): секции `@@`. Фона нет.
- **Архив** = zip, переименованный в `.wmt` (определяется по `PK\x03\x04`):
  `theme.wmt` (обязательно) + `background.<jpg|jpeg|png|webp|gif|avif|bmp|mp4|webm|m4v|mov>` + любые файлы
  (`preview.png`, `font.woff2`…). Файлы доступны как `"asset:имя"` в JSON и `url(asset:имя)` в CSS.
  Можно в подпапке (берётся папка с `theme.wmt`); только stored/deflate, без zip64.
- Лимиты: файл ≤ 64 МБ, распаковано ≤ 80 МБ, видеофон ≤ 48 МБ; имя ресурса `[A-Za-z0-9._-]{1,100}`.

### Текст темы
```
#WMT 1                         ← первая непустая строка; «#WMT 1.2» ок (дробная часть — совместимые дополнения)
# комментарии до первой секции

@@ manifest                    ← ровно одна, JSON
@@ tokens                      ← ≤1, JSON
@@ css whisper-core            ← CSS по ролям [data-w="search"] — для всех приложений Whisper (docs/CORE.md)
@@ settings whisper-music      ← JSON
@@ css whisper-music           ← CSS
@@ settings whisper-obs        ← JSON (виджет OBS)
@@ css whisper-obs             ← CSS (виджет OBS)
@@ asset имя base64|text       ← устаревшее: ресурс внутри текста (файл в архиве главнее)
```
Секция длится до следующей строки с `@@`. Строка внутри секции не может начинаться с `@@`. Неизвестные секции пропускаются.
JSON-секции — JSONC: `//`, `/* */`, лишняя запятая. Ошибки показываются с номером строки.

### manifest
```jsonc
{ "id": "midnight-gold",   // [a-z0-9][a-z0-9-]{0,47}; не neon/royal/steam/lolitta; тот же id при загрузке = обновление
  "name": "Полночное золото", "author": "Вадим" /* ≤40, «Автор · Название» */, "description": "…", "version": "1.0",
  "base": "royal",          // neon | royal | steam | lolitta (неизвестное = neon)
  "apps": ["whisper-music"], "created": "2026-10-17T10:00:00Z", "preview": "asset:preview.png" }
```
Основа даёт то, что сделано кодом: `neon` — свечение (ползунок есть только у него); `steam` — отступ кругового
визуализатора; `lolitta` — банты/жемчуг/розы (`.lodeco`), подбор контрастного текста, отступ визуализатора; `royal` — ничего.

### tokens (общие для всех приложений Whisper)
```jsonc
{ "color":   { "accent": "#c9a24b", "accent2": "#8b1e2d",      // строго #rrggbb — стартовые значения, пользователь меняет
               "text": "#eadfc6", "muted": "#a39579", "background": "#0e0b09" },  // любой цвет CSS, применяются как есть
  "effects": { "glow": 6 /*0–48 px*/, "panelOpacity": 0.92 /*0.2–1*/, "dim": 0.1 /*0–0.85*/, "backgroundBlur": 6 },
  "font":    { "body": "Tahoma, sans-serif", "display": "Georgia, serif" } }   // display → --font-display
```
Значения CSS без `; { } < > \ url( expression`, ≤300 символов. `text/muted/font/background` применяются ПОСЛЕ CSS темы
(главнее её переменных). Числа вне диапазона обрезаются.

### settings whisper-music
```jsonc
{ "features": { "glow": false, "panelOpacity": false, "animations": false },  // скрыть настройки; нет поля — как у основы
  "colorOverrides": { "heading": "#f0e2b6", "mainBg": "#ffffff59" },        // #rrggbb / #rrggbbaa; главнее CSS темы, даже !important
  "controls": { "volume": "knob" },   // #volBtn — ручка; громкость в CSS: var(--vol) 0…1
  "layout": "fixed",                  // режимы «Расположения» не применяются
  "buttons": { "power": "wave" },     // ≤16; имя [a-z][a-z0-9-]{0,23} → #thBtns > button.thbtn[data-th="power"], .on — включено
  "console": { "prompt": "user@whisper:~$", "banner": "Привет!\nhelp — команды" } }  // или "console": true
```
- Действия `buttons`: `wave play next prev like dislike shuffle repeat mute vol-up vol-down full sleep more
  page:wave page:likes page:stats page:settings page:profile`. Кнопка темы просто нажимает кнопку приложения (и так же `:disabled`).
- Ключи `colorOverrides` (= «Тонкая настройка цветов», список — `CC_GROUPS` в main.js): `text muted heading winBg
  tabBg tabText tabBorder tabActBg tabActText titleBarBg sideBg sideBorder navBg navText navBorder navActBg navActText
  searchBg searchText btnBg btnText btnBorder btnActBg btnActText plBg plBorder plTitle plArtist plIcons plModeOn
  playBg playIcon seekFill seekTrack seekThumb volFill like rowHover rowTitle rowArtist mainBg listBg titleBg
  menuBg menuText cardBg cardBorder ctl vizA vizB glow`.
- Консоль: `#cli`, `.cli-out`, строки `.cl` (`.cmd .err .dim .ok .hl .hd .banner`, `.cl.art`, `.cl.live`), `.cli.party`,
  `.cli-status`, `.cli-in`, `.cli-ps`. Текст — `accent`, подсветка — `accent2`. Выход — `gui` или Ctrl+Shift+Backspace.

### css whisper-music — как привязывается
Пишется как будто тема единственная; core/theme-css.js сам префиксует:
- `.panel {…}` → `:root[data-style="<id>"] .panel {…}`; `:root {…}` / `html {…}` → переменные стиля;
- `:root[data-anim="off"] .x` → `:root[data-style="<id>"][data-anim="off"] .x`; внутри `@media/@supports/@container/@layer` так же;
- `@keyframes`, `@font-face` — подключаются, имена тихо делаются уникальными; `@property` и `@import` — нет.
- **Безопасность** (core/theme-css.js, `cssSafe`): проверка после раскрытия `\`-экранирования и без комментариев. Нельзя `@import`,
  `expression(`, `javascript:`, `behavior:`, `-moz-binding`, `image-set/cross-fade/element/paint/src(`, `url()` куда-либо,
  кроме `asset:` этой темы (→ blob:), `data:` и `#якорей`. Небезопасное правило выкидывается целиком.
- Порядок: CSS приложения → CSS темы → tokens → `colorOverrides`/«Тонкая настройка» (последней, главнее всего).

**Переменные:** `--accent --accent2 --text --muted --glow (px) --glow-c --panel-a (0–1) --on-accent --btn-fill
--font-display --vol (0–1) --kick (0–1, на .stage при визуализаторе) --viz-gap (задаёт тема на .stage, px)`.

**Основные селекторы:** `.titlebar` (`.tbctl button`), `.tabs .tab(.active)`, `.side .nav(.active)`, `.search`,
`.main[data-page="likes|wave|settingsBtn|…"]`, `.head h2`/`#title`, `#headImg`, `.chip(.active)`, `.list li(.playing)` (`.t .a`),
`.likebtn(.on) .morebtn`, `.player` (`.pinfo .pcenter .pright .seekrow .ctrls .volwrap .playbtn .modebtn.on`), `#seek #vol`,
`.wavebtn` (`.stamp` при нажатии), `.waveorbits` (5×`<i>`, скрыт по умолчанию; `.on`, `.beats`), `.stage`, `.card`, `.stylecard`,
`.tmenu`, `.toast`, `.login-box .modalbox`, `.qpanel`, `.panel`, `#bg #dim` (обои — не прятать!), `#thBtns .thbtn`.

**События для анимаций:** смена трека — `.player .cover` получает `.flip-out` → (ждёт конца анимации) → `.flip-in`;
«Моя волна» — `.wavebtn.stamp`; волна играет — `.waveorbits.on` (анимации `neonSpin` внутри ×2.4); смена страницы —
`.main[data-page]` (своё имя анимации на каждую страницу, чтобы перезапускалась); анимации — только под `:root[data-anim="on"]`.

**Перестройка интерфейса целиком** (пример `retro-tv.wmt`): `"layout": "fixed"`; сетка — `body > .app { grid-template-… }`;
разобрать плеер — `.player, .player > .pcenter, .player > .pright { display: contents; }`; у `.panel` есть `backdrop-filter` —
он становится containing block для absolute/fixed, выносишь — ставь `backdrop-filter: none`; `.qpanel` — задать
`top/bottom/right` с `!important`; свободный декор — `.app::before/::after`, `body::before/::after`;
обои можно «вписать»: `#bg, #dim { inset: …; border-radius: … }`; пиксельный шрифт — кратные размеры, без дробного letter-spacing.

### Виджет OBS (`whisper-obs`)
```jsonc
@@ settings whisper-obs
{ "layout": "card",               // card | compact | bar — вид по умолчанию
  "layouts": ["card", "compact"], // необязательно: какие виды стиль умеет
  "opacity": 0.55,                // фон 0…1
  "size": [410, 270] }            // размер источника в OBS (40…4000)
```
CSS без привязки к стилю, после встроенного. Разметка: `#w.w[data-base][data-layout][data-playing][data-empty][data-paused-hidden]`
→ `.w-bg`, `.w-art > img.w-cover`, `.w-info` (`.w-title .w-artist .w-bar > i .w-time > .w-cur .w-dur`), `.w-eq > i×4`,
`.w-play > i` (скрыт; включать `display: grid`), `.w-deco > i×6` (скрыт; слой inset:0, у `i` есть ::before/::after).
Переменные на `#w`: `--a --b --alpha --p --cover`. Ресурсы `url(asset:…)` встраиваются (≤1,5 МБ каждый);
`@import`, `url(http…)`, `image-set` вырезаются. Перекрыть встроенные виды — селекторами через `#w`.

### Как в приложении
- «Сохранить стиль в файл…» — выгружает правила текущего стиля уже без привязки (архив, если есть фон).
- «Загрузить тему…» / перетащить файл в окно; тот же `id` → обновление. Хранение — IndexedDB (`theme:<id>`), список — `cfg.themes`.
- «Библиотека тем» — `themelib.rs` качает `index.json`, `previews/<папка>/<id>.*`, `themes/<папка>/<id>.wmt`
  (папки `whisper`, `community`, `artists`) из ветки `main` репозитория Whisper-Music/whisper-themes.
- Чтение в JS: `const th = await WMT.open(bytes); th.manifest; th.tokens; th.css("whisper-music"); th.settings(app);
  th.background; th.asset("asset:x")`. Сборка: `WMT.pack({…})` (архив) / `WMT.serialize({…})` (текст).

### Минимальная тема
```
#WMT 1
@@ manifest
{ "id": "mint", "name": "Мята", "base": "neon" }
@@ tokens
{ "color": { "accent": "#3fb8af", "accent2": "#ff6f59" } }
```

### Частые ошибки в темах
- Цвета числами в CSS → настройки цветов не действуют. Пиши `var(--accent)`.
- Спрятаны `#bg` / `body { background: … !important }` → пользователь не может поставить обои.
- Правило не срабатывает → встроенное сильнее: уточни селектор или `!important` (но `colorOverrides` всё равно главнее).
- Кнопки `buttons` не видно → им нужны размер и место в CSS.
- Сломан вид окна → **Ctrl+Shift+Backspace**.
