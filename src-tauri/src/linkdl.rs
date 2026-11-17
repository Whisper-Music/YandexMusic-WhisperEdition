//! Трек по ссылке: YouTube, SoundCloud, видео и клипы ВКонтакте → аудиофайл на этом компьютере, дальше — то же окно
//! «Что сделать с треком», что при перетаскивании файла (dropin.js: в «Лайки», просто сохранить, заменить трек Яндекса,
//! в Whisper Archive).
//!
//! Скачивает yt-dlp (github.com/yt-dlp/yt-dlp) — свой код для YouTube не выдержал бы и недели: защита там меняется
//! постоянно. Всё, что может пойти не так, закрыто здесь, а не в интерфейсе:
//!  * **ссылка** (`check_url`) — только https, только эти сайты (список хостов, без IP, портов, логинов в адресе), только
//!    один трек: у YouTube — номер видео, у SoundCloud — «автор/трек», у ВК — видео или клип. Плейлисты, каналы,
//!    альбомы отклоняются. В yt-dlp уходит уже пересобранный адрес, а не то, что вставил пользователь;
//!  * **сам yt-dlp** — только официальный выпуск с GitHub (перенаправления — только на хосты GitHub), сверка SHA-256 со
//!    списком SHA2-256SUMS того же выпуска, лежит в папке приложения (не в PATH, путь задать нельзя);
//!  * **запуск** — без конфигов и плагинов (`--ignore-config --no-plugin-dirs`), без cookies, без внешних загрузчиков
//!    (`--downloader native`: aria2c/ffmpeg не вызываются), без постобработки и команд (`--no-exec`), только экстракторы
//!    этого сайта, только звуковая дорожка m4a/mp3 без видео, не больше 100 МБ и часа, не прямой эфир; адрес — после `--`
//!    (не может стать параметром); пишет только в свою новую папку; не дольше 15 минут, можно отменить;
//!  * **результат** (`check_audio`) — ровно один обычный файл, по содержимому m4a (ftyp) или mp3, без видеодорожки
//!    (hdlr «vide»), и он реально декодируется (symphonia). Иначе файл удаляется и ничего не добавляется.
//! Дальше файл идёт через обычный путь перетаскивания (bg.rs → Picked, studio.rs → read_drop): там его проверяют ещё раз.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_http::reqwest::{redirect, Client, Url};

const MAX_URL: usize = 2048;
const MAX_TRACK: u64 = 100 * 1024 * 1024;
const MAX_TOOL: usize = 80 * 1024 * 1024;
const MAX_SECONDS: u32 = 3600;
const RUN_LIMIT: Duration = Duration::from_secs(15 * 60);
/// yt-dlp старше недели перед скачиванием обновляется сам (YouTube ломает старые версии быстро)
const UPDATE_AFTER: Duration = Duration::from_secs(7 * 86400);
const RELEASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
/// только звук, без видео: m4a (AAC) или mp3 — их играет и окно, и свой движок (symphonia)
const FORMAT: &str = "bestaudio[ext=m4a][vcodec=none]/bestaudio[ext=mp3][vcodec=none]/bestaudio[acodec^=mp4a][vcodec=none]/bestaudio[acodec=mp3][vcodec=none]";

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
pub enum Source {
    YouTube,
    SoundCloud,
    Vk,
}
impl Source {
    fn label(self) -> &'static str {
        match self {
            Source::YouTube => "YouTube",
            Source::SoundCloud => "SoundCloud",
            Source::Vk => "ВКонтакте",
        }
    }
    /// экстракторы yt-dlp, которым разрешено работать (имена — IE_NAME, начало совпадения)
    fn extractors(self) -> &'static str {
        match self {
            Source::YouTube => "youtube",
            Source::SoundCloud => "soundcloud",
            Source::Vk => "vk",
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// ссылка
// ---------------------------------------------------------------------------------------------------------------

fn host_source(h: &str) -> Option<Source> {
    match h {
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be" => Some(Source::YouTube),
        "soundcloud.com" | "www.soundcloud.com" | "m.soundcloud.com" | "on.soundcloud.com" => Some(Source::SoundCloud),
        "vk.com" | "www.vk.com" | "m.vk.com" | "vk.ru" | "www.vk.ru" | "m.vk.ru" | "vkvideo.ru" | "www.vkvideo.ru"
        | "m.vkvideo.ru" => Some(Source::Vk),
        _ => None,
    }
}

fn yt_id(s: &str) -> Option<&str> {
    (s.len() == 11 && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')).then_some(s)
}

/// «video-123_456», «clip123_456» → ("video", "-123_456")
fn vk_id(s: &str) -> Option<(&'static str, String)> {
    let (kind, rest) = if let Some(r) = s.strip_prefix("video") { ("video", r) } else { ("clip", s.strip_prefix("clip")?) };
    let r = rest.strip_prefix('-').unwrap_or(rest);
    let (a, b) = r.split_once('_')?;
    let num = |x: &str| !x.is_empty() && x.len() <= 20 && x.bytes().all(|c| c.is_ascii_digit());
    (num(a) && num(b)).then(|| (kind, format!("{}{a}_{b}", if rest.starts_with('-') { "-" } else { "" })))
}

const SC_RESERVED: [&str; 14] = [
    "discover", "search", "stream", "you", "upload", "charts", "stations", "settings", "messages", "notifications",
    "pages", "terms-of-use", "people", "tags",
];
fn sc_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 255 && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

/// Проверенная и пересобранная ссылка на один трек.
pub fn check_url(raw: &str) -> Result<(String, Source), String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("Вставь ссылку на трек".into());
    }
    if s.len() > MAX_URL || s.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("Это не похоже на ссылку".into());
    }
    let s = if s.contains("://") { s.to_string() } else { format!("https://{s}") };
    let u = Url::parse(&s).map_err(|_| "Это не похоже на ссылку".to_string())?;
    if !matches!(u.scheme(), "https" | "http") {
        return Err("Подходят только обычные ссылки https://".into());
    }
    if !u.username().is_empty() || u.password().is_some() || u.port().is_some_and(|p| p != 443 && p != 80) {
        return Err("В ссылке есть логин или порт — такие не берём".into());
    }
    let host = u.host_str().unwrap_or("").trim_end_matches('.').to_ascii_lowercase();
    let src = host_source(&host).ok_or("Поддерживаются ссылки на YouTube, SoundCloud и видео ВКонтакте")?;
    let segs: Vec<&str> = u.path_segments().map(|p| p.filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    let q = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    match src {
        Source::YouTube => {
            let id = if host == "youtu.be" {
                segs.first().copied().and_then(yt_id).map(str::to_string)
            } else {
                match segs.as_slice() {
                    ["watch"] => q("v").filter(|v| yt_id(v).is_some()),
                    ["shorts" | "live" | "embed" | "v", id] => yt_id(id).map(str::to_string),
                    _ => None,
                }
            };
            let id = id.ok_or_else(|| {
                if q("list").is_some() || segs.first().is_some_and(|s| matches!(*s, "playlist" | "channel" | "c" | "user") || s.starts_with('@')) {
                    "Это плейлист или канал — нужна ссылка на одно видео".to_string()
                } else {
                    "В ссылке YouTube не нашлось видео".to_string()
                }
            })?;
            Ok((format!("https://www.youtube.com/watch?v={id}"), src))
        }
        Source::SoundCloud => {
            if host == "on.soundcloud.com" {
                // короткая ссылка из «Поделиться»: yt-dlp сам пройдёт перенаправление на soundcloud.com
                return match segs.as_slice() {
                    [code] if sc_name(code) && code.len() <= 40 => Ok((format!("https://on.soundcloud.com/{code}"), src)),
                    _ => Err("Короткая ссылка SoundCloud какая-то не такая".into()),
                };
            }
            match segs.as_slice() {
                [user, track] if sc_name(user) && sc_name(track) && !SC_RESERVED.contains(user) && *track != "sets"
                    && !matches!(*track, "tracks" | "albums" | "reposts" | "likes" | "followers" | "following" | "popular-tracks") =>
                {
                    Ok((format!("https://soundcloud.com/{user}/{track}"), src))
                }
                [_, "sets", ..] => Err("Это плейлист SoundCloud — нужна ссылка на один трек".into()),
                _ => Err("Нужна ссылка на один трек SoundCloud: soundcloud.com/автор/трек".into()),
            }
        }
        Source::Vk => {
            if segs.first().is_some_and(|s| s.starts_with("audio") || *s == "music") || q("z").is_some_and(|z| z.starts_with("audio")) {
                return Err("Музыку ВКонтакте скачать не получится — только видео и клипы".into());
            }
            let from_path = segs.last().and_then(|s| vk_id(s));
            let from_z = q("z").and_then(|z| vk_id(z.split('/').next().unwrap_or("")));
            let (kind, id) = from_path.or(from_z).ok_or("В ссылке ВКонтакте не нашлось видео или клипа")?;
            Ok((format!("https://vk.com/{kind}{id}"), src))
        }
    }
}

/// Откуда трек — для библиотеки (studio.rs → Item.source, синхронизация через архив): ссылка заново проходит
/// check_url (сохраняется только пересобранная), площадка — как в docs/LIBRARY-SYNC.md архива
/// (youtube, soundcloud, vk-video), номер — id видео YouTube, «автор/трек» SoundCloud, «video-1_2» ВК.
pub fn source_info(raw: &str) -> Option<(String, &'static str, String)> {
    let (url, src) = check_url(raw).ok()?;
    let u = Url::parse(&url).ok()?;
    let (site, id) = match src {
        Source::YouTube => ("youtube", u.query_pairs().find(|(k, _)| k == "v").map(|(_, v)| v.into_owned()).unwrap_or_default()),
        Source::SoundCloud => ("soundcloud", u.path().trim_matches('/').to_string()),
        Source::Vk => ("vk-video", u.path().trim_matches('/').to_string()),
    };
    Some((url, site, id))
}

// ---------------------------------------------------------------------------------------------------------------
// yt-dlp: установка и обновление
// ---------------------------------------------------------------------------------------------------------------

fn asset() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else {
        "yt-dlp_linux"
    }
}

fn tool_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tools"))
}
fn tool_file(dir: &Path) -> PathBuf {
    dir.join(if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" })
}

fn gh_client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(300))
            .redirect(redirect::Policy::custom(|a| {
                let ok_host = matches!(
                    a.url().host_str(),
                    Some("github.com" | "objects.githubusercontent.com" | "release-assets.githubusercontent.com")
                );
                if a.previous().len() < 8 && a.url().scheme() == "https" && ok_host {
                    a.follow()
                } else {
                    a.error("перенаправление за пределы GitHub")
                }
            }))
            .user_agent(concat!("yandex-desktop/", env!("CARGO_PKG_VERSION"), " (yt-dlp install)"))
            .build()
            .expect("не удалось создать HTTP-клиент для yt-dlp")
    })
}

async fn get_limited(url: &str, max: usize) -> Result<Vec<u8>, String> {
    let mut resp = gh_client().get(url).send().await.map_err(|e| format!("GitHub не отвечает: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub ответил {}", resp.status()));
    }
    if resp.content_length().is_some_and(|n| n > max as u64) {
        return Err("файл на GitHub больше, чем ожидалось".into());
    }
    let mut out = Vec::new();
    while let Some(c) = resp.chunk().await.map_err(|e| format!("загрузка прервалась: {e}"))? {
        if out.len() + c.len() > max {
            return Err("файл на GitHub больше, чем ожидалось".into());
        }
        out.extend_from_slice(&c);
    }
    Ok(out)
}

fn sha256_hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

/// Строка «<sha256>  <файл>» (или «<sha256> *<файл>») из SHA2-256SUMS.
fn expected_sum(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|l| {
        let (h, f) = l.trim().split_once(char::is_whitespace)?;
        let f = f.trim_start().trim_start_matches('*');
        (f == name && h.len() == 64 && h.bytes().all(|c| c.is_ascii_hexdigit())).then(|| h.to_ascii_lowercase())
    })
}

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn tool_version(tool: &Path) -> Option<String> {
    let mut c = Command::new(tool);
    c.args(["--ignore-config", "--no-plugin-dirs", "--version"]).stdin(Stdio::null());
    no_window(&mut c);
    let out = c.output().ok()?;
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !v.is_empty() && v.len() < 40 && v.bytes().all(|b| b.is_ascii_graphic())).then_some(v)
}

/// Скачать последний выпуск yt-dlp в dir и сверить контрольную сумму. Возвращает версию.
pub async fn install_to(dir: &Path) -> Result<String, String> {
    let name = asset();
    let sums = get_limited(&format!("{RELEASE}SHA2-256SUMS"), 64 * 1024).await?;
    let want = expected_sum(&String::from_utf8_lossy(&sums), name).ok_or("в списке контрольных сумм нет нужного файла")?;
    let bin = get_limited(&format!("{RELEASE}{name}"), MAX_TOOL).await?;
    if sha256_hex(&bin) != want {
        return Err("контрольная сумма yt-dlp не совпала — файл не тот, ставить не будем".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("yt-dlp.new");
    std::fs::write(&tmp, &bin).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    let ver = tool_version(&tmp).ok_or_else(|| {
        let _ = std::fs::remove_file(&tmp);
        "скачанный yt-dlp не запускается".to_string()
    })?;
    let dst = tool_file(dir);
    let _ = std::fs::remove_file(&dst);
    std::fs::rename(&tmp, &dst).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("yt-dlp.version"), &ver).map_err(|e| e.to_string())?;
    Ok(ver)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    installed: bool,
    version: String,
    /// когда поставлен или обновлён (мс с 1970), 0 — не стоит
    updated_at: u64,
    size: u64,
}

fn status_of(dir: &Path) -> ToolStatus {
    let f = tool_file(dir);
    let meta = std::fs::symlink_metadata(&f).ok().filter(|m| m.is_file());
    let at = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    ToolStatus {
        installed: meta.is_some(),
        version: std::fs::read_to_string(dir.join("yt-dlp.version")).unwrap_or_default().trim().chars().take(40).collect(),
        updated_at: at,
        size: meta.map(|m| m.len()).unwrap_or(0),
    }
}

#[tauri::command]
pub fn link_tool_status(app: AppHandle) -> Result<ToolStatus, String> {
    Ok(status_of(&tool_dir(&app)?))
}

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn link_tool_install(app: AppHandle) -> Result<ToolStatus, String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("yt-dlp уже скачивается".into());
    }
    let dir = tool_dir(&app);
    let r = match dir {
        Ok(d) => install_to(&d).await.map(|_| status_of(&d)),
        Err(e) => Err(e),
    };
    INSTALLING.store(false, Ordering::SeqCst);
    r.map_err(|e| format!("Не удалось поставить yt-dlp: {e}"))
}

#[tauri::command]
pub fn link_tool_remove(app: AppHandle) -> Result<(), String> {
    if BUSY.load(Ordering::SeqCst) {
        return Err("Сейчас идёт скачивание по ссылке — подожди или отмени его".into());
    }
    let d = tool_dir(&app)?;
    for f in [tool_file(&d), d.join("yt-dlp.version"), d.join("yt-dlp.new")] {
        if f.exists() {
            std::fs::remove_file(&f).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------
// скачивание
// ---------------------------------------------------------------------------------------------------------------

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Default, Debug, Clone)]
pub struct Meta {
    pub title: String,
    pub uploader: String,
    pub artist: String,
    pub track: String,
    pub duration: f64,
}

fn s(v: &serde_json::Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").chars().filter(|c| !c.is_control()).take(300).collect::<String>().trim().to_string()
}

/// Аргументы yt-dlp (кроме адреса) — отдельной функцией, чтобы тест видел их целиком.
fn args(src: Source, dir: &Path) -> Vec<String> {
    let mut a: Vec<String> = [
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-cookies",
        "--no-cookies-from-browser",
        "--no-exec",
        "--no-playlist",
        "--no-cache-dir",
        "--no-mtime",
        "--no-write-info-json",
        "--no-write-thumbnail",
        "--no-write-subs",
        "--no-embed-metadata",
        "--no-embed-thumbnail",
        "--downloader",
        "native",
        "--use-extractors",
        src.extractors(),
        "--format",
        FORMAT,
        "--max-filesize",
        "100M",
        "--match-filters",
        "!is_live & duration <=? 3600",
        "--socket-timeout",
        "30",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
        "--encoding",
        "utf-8",
        "--newline",
        "--progress",
        "--progress-template",
        "download:WMDL %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
        "--no-simulate",
        "--print",
        "after_move:WMJSON %(.{title,uploader,artist,track,duration,ext,extractor_key})j",
        "--output",
        "track.%(ext)s",
    ]
    .iter()
    .map(|x| x.to_string())
    .collect();
    a.push("--paths".into());
    a.push(dir.to_string_lossy().into_owned());
    a
}

fn explain(stderr: &str) -> String {
    let e = stderr.to_ascii_lowercase();
    let pick = |m: &str| m.to_string();
    if e.contains("requested format is not available") || e.contains("no video formats") {
        pick("в этой ссылке нет отдельной звуковой дорожки m4a или mp3")
    } else if e.contains("does not pass filter") || e.contains("is_live") {
        pick("это прямой эфир или запись длиннее часа — такие не скачиваем")
    } else if e.contains("max-filesize") || e.contains("larger than max") {
        pick("файл больше 100 МБ")
    } else if e.contains("private video") || e.contains("sign in") || e.contains("login") || e.contains("authentication") {
        pick("видео закрыто или доступно только после входа — такие не скачиваем")
    } else if e.contains("unavailable") || e.contains("not available") || e.contains("404") {
        pick("трек или видео недоступно (удалено или закрыто в твоей стране)")
    } else if e.contains("unsupported url") {
        pick("yt-dlp не узнал эту ссылку")
    } else if e.contains("unable to download") || e.contains("timed out") || e.contains("connection") {
        pick("нет связи с сайтом")
    } else {
        let last = stderr.lines().rev().find(|l| l.contains("ERROR")).unwrap_or("").replace("ERROR:", "");
        let last: String = last.trim().chars().take(200).collect();
        if last.is_empty() { "yt-dlp не смог скачать трек".into() } else { format!("yt-dlp: {last}") }
    }
}

/// Запустить yt-dlp для одной проверенной ссылки и дождаться файла. progress(скачано, всего) — по ходу.
pub fn run(tool: &Path, url: &str, src: Source, dir: &Path, progress: impl Fn(u64, u64) + Send + 'static) -> Result<(PathBuf, Meta), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(tool);
    cmd.args(args(src, dir))
        .arg("--")
        .arg(url)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // чужой Python не должен подмешаться в yt-dlp
    for k in ["PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONUSERBASE"] {
        cmd.env_remove(k);
    }
    no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("yt-dlp не запустился: {e}"))?;
    let meta: Arc<Mutex<Option<serde_json::Value>>> = Arc::default();
    let tail: Arc<Mutex<String>> = Arc::default();
    let out = child.stdout.take().map(|o| {
        let meta = meta.clone();
        std::thread::spawn(move || {
            let mut r = BufReader::new(o);
            let mut line = Vec::new();
            while r.read_until(b'\n', &mut line).map(|n| n > 0).unwrap_or(false) {
                let l = String::from_utf8_lossy(&line).trim().to_string();
                line.clear();
                if let Some(p) = l.strip_prefix("WMDL ") {
                    let n: Vec<u64> = p.split(' ').map(|x| x.parse::<f64>().map(|f| f as u64).unwrap_or(0)).collect();
                    let total = n.get(1).copied().filter(|&t| t > 0).or_else(|| n.get(2).copied()).unwrap_or(0);
                    progress(n.first().copied().unwrap_or(0), total);
                } else if let Some(j) = l.strip_prefix("WMJSON ") {
                    if let Ok(v) = serde_json::from_str(j) {
                        *meta.lock().unwrap_or_else(|e| e.into_inner()) = Some(v);
                    }
                }
            }
        })
    });
    let err = child.stderr.take().map(|e| {
        let tail = tail.clone();
        std::thread::spawn(move || {
            let mut r = BufReader::new(e);
            let mut buf = [0u8; 4096];
            while let Ok(n) = r.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut t = tail.lock().unwrap_or_else(|e| e.into_inner());
                t.push_str(&String::from_utf8_lossy(&buf[..n]));
                if t.len() > 8192 {
                    let cut = t.len() - 8192;
                    let cut = (cut..t.len()).find(|&i| t.is_char_boundary(i)).unwrap_or(t.len());
                    t.drain(..cut);
                }
            }
        })
    });
    let started = Instant::now();
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break st;
        }
        if CANCEL.load(Ordering::SeqCst) || started.elapsed() > RUN_LIMIT {
            let _ = child.kill();
            let _ = child.wait();
            if let Some(t) = out {
                let _ = t.join();
            }
            if let Some(t) = err {
                let _ = t.join();
            }
            return Err(if CANCEL.load(Ordering::SeqCst) { "отменено".into() } else { "скачивание идёт дольше 15 минут — остановлено".into() });
        }
        std::thread::sleep(Duration::from_millis(150));
    };
    if let Some(t) = out {
        let _ = t.join();
    }
    if let Some(t) = err {
        let _ = t.join();
    }
    if !status.success() {
        return Err(explain(&tail.lock().unwrap_or_else(|e| e.into_inner())));
    }
    // в папке — ровно один обычный файл track.m4a / track.mp3, ничего больше
    let mut files = Vec::new();
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        files.push(e.path());
    }
    let [file] = files.as_slice() else {
        return Err("yt-dlp оставил не один файл — такое не берём".into());
    };
    let name = file.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !matches!(name, "track.m4a" | "track.mp3") {
        return Err("скачался не звуковой файл".into());
    }
    let v = meta.lock().unwrap_or_else(|e| e.into_inner()).take().unwrap_or_default();
    let m = Meta {
        title: s(&v, "title"),
        uploader: s(&v, "uploader"),
        artist: s(&v, "artist"),
        track: s(&v, "track"),
        duration: v.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.0),
    };
    if m.duration > MAX_SECONDS as f64 + 1.0 {
        return Err("запись длиннее часа".into());
    }
    Ok((file.clone(), m))
}

/// В mp4: обработчики дорожек (hdlr) — есть ли видео.
fn has_video_track(b: &[u8]) -> bool {
    b.windows(4).enumerate().any(|(i, w)| w == b"hdlr" && b.get(i + 12..i + 16) == Some(b"vide"))
}

/// Файл — настоящий звук m4a или mp3 без видео, и он декодируется. Возвращает расширение по содержимому.
pub fn check_audio(path: &Path) -> Result<&'static str, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("это не файл".into());
    }
    if meta.len() > MAX_TRACK {
        return Err("файл больше 100 МБ".into());
    }
    if meta.len() < 2048 {
        return Err("файл подозрительно маленький".into());
    }
    let b = std::fs::read(path).map_err(|e| e.to_string())?;
    let ext = if b.len() > 12 && &b[4..8] == b"ftyp" {
        if has_video_track(&b) {
            return Err("в файле есть видео — берём только звук".into());
        }
        "m4a"
    } else if b.starts_with(b"ID3") || (b[0] == 0xFF && (b[1] & 0xE0) == 0xE0) {
        "mp3"
    } else {
        return Err("по содержимому это не m4a и не mp3".into());
    };
    let mut hint = Hint::new();
    hint.with_extension(ext);
    let mss = MediaSourceStream::new(Box::new(std::io::Cursor::new(b)), Default::default());
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("файл не открывается как звук ({e})"))?;
    let mut format = probed.format;
    let tracks = format.tracks();
    if tracks.iter().any(|t| t.codec_params.codec != CODEC_TYPE_NULL && t.codec_params.sample_rate.is_none()) {
        return Err("в файле есть дорожка, которая не звук".into());
    }
    let track = tracks.iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or("нет звуковой дорожки")?;
    let id = track.id;
    let mut dec = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("кодек не поддерживается ({e})"))?;
    let mut ok = 0;
    for _ in 0..400 {
        match format.next_packet() {
            Ok(p) if p.track_id() == id => {
                if dec.decode(&p).is_ok() {
                    ok += 1;
                    if ok >= 8 {
                        break;
                    }
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    if ok == 0 {
        return Err("звук в файле не декодируется".into());
    }
    Ok(ext)
}

/// Хвосты в названиях видео: «(Official Video)», «[Lyrics]», «(Клип, 2024)»…
fn strip_noise(t: &str) -> String {
    const NOISE: [&str; 16] = [
        "official", "video", "audio", "lyric", "клип", "премьера", "visualizer", "visualiser", "hd", "4k", "mv", "m/v",
        "текст", "караоке", "live video", "full version",
    ];
    let mut out = String::new();
    let mut rest = t;
    while let Some(i) = rest.find(['(', '[']) {
        let close = if rest.as_bytes()[i] == b'(' { ')' } else { ']' };
        let Some(j) = rest[i..].find(close).map(|j| i + j) else { break };
        let inner = rest[i + 1..j].to_lowercase();
        out.push_str(&rest[..i]);
        if !NOISE.iter().any(|n| inner.split(|c: char| !c.is_alphanumeric() && c != '/').any(|w| w == *n) || inner.contains(n) && n.len() > 3) {
            out.push_str(&rest[i..=j]);
        }
        rest = &rest[j + 1..];
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Имя файла «Исполнитель - Название» — по нему окно «Что сделать с треком» подбирает трек Яндекса.
pub fn file_stem(m: &Meta) -> String {
    let uploader = m.uploader.trim_end_matches(" - Topic").trim_end_matches("VEVO").trim();
    let raw = if !m.artist.is_empty() && !m.track.is_empty() {
        format!("{} - {}", m.artist.split(',').next().unwrap_or(&m.artist).trim(), m.track)
    } else {
        let t = strip_noise(&m.title);
        if t.contains(" - ") || t.contains(" – ") || t.contains(" — ") || uploader.is_empty() {
            t.replace(" – ", " - ").replace(" — ", " - ")
        } else {
            format!("{uploader} - {t}")
        }
    };
    let clean: String = raw
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .take(150)
        .collect();
    let clean = clean.trim().trim_matches('.').trim().to_string();
    if clean.is_empty() { "Трек по ссылке".into() } else { clean }
}

fn rand_hex() -> String {
    let mut b = [0u8; 8];
    let _ = getrandom::fill(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Старые папки загрузок (больше суток) — удалить: файл из них уже взят окном «Что сделать с треком» или брошен.
fn sweep(root: &Path) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|d| d > Duration::from_secs(86400));
        if old && e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

#[derive(Serialize)]
pub struct Checked {
    url: String,
    source: &'static str,
}

/// Проверить ссылку до скачивания (интерфейс сразу говорит, что не так).
#[tauri::command]
pub fn link_check(url: String) -> Result<Checked, String> {
    let (u, s) = check_url(&url)?;
    Ok(Checked { url: u, source: s.label() })
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: u64,
}

#[derive(Serialize)]
pub struct Downloaded {
    entry: crate::bg::Entry,
    title: String,
    source: &'static str,
}

#[tauri::command]
pub async fn link_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn link_download(app: AppHandle, url: String) -> Result<Downloaded, String> {
    let (url, src) = check_url(&url)?;
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("Уже скачивается другой трек по ссылке".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let r = download(&app, &url, src).await;
    BUSY.store(false, Ordering::SeqCst);
    r.map_err(|e| format!("Не получилось скачать с {}: {e}", src.label()))
}

async fn download(app: &AppHandle, url: &str, src: Source) -> Result<Downloaded, String> {
    let tdir = tool_dir(app)?;
    let st = status_of(&tdir);
    if !st.installed {
        return Err("сначала нужно поставить yt-dlp".into());
    }
    // раз в неделю — свежий yt-dlp (не вышло — работаем со старым)
    let age = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0).saturating_sub(st.updated_at);
    if age > UPDATE_AFTER.as_millis() as u64 && !INSTALLING.swap(true, Ordering::SeqCst) {
        let _ = app.emit("link-progress", serde_json::json!({ "stage": "update" }));
        let _ = install_to(&tdir).await;
        INSTALLING.store(false, Ordering::SeqCst);
    }
    let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("linkdl");
    sweep(&root);
    let dir = root.join(rand_hex());
    let tool = tool_file(&tdir);
    let (a, u, d) = (app.clone(), url.to_string(), dir.clone());
    let res = tauri::async_runtime::spawn_blocking(move || {
        let a2 = a.clone();
        let (file, meta) = run(&tool, &u, src, &d, move |done, total| {
            let _ = a2.emit("link-progress", Progress { done, total });
        })?;
        let ext = check_audio(&file)?;
        let stem = file_stem(&meta);
        let named = d.join(format!("{stem}.{ext}"));
        std::fs::rename(&file, &named).map_err(|e| e.to_string())?;
        let entry = crate::bg::remember_one(&a, &named).ok_or("файл пропал сразу после скачивания")?;
        Ok::<_, String>((entry, stem))
    })
    .await
    .map_err(|e| e.to_string())?;
    match res {
        Ok((entry, title)) => Ok(Downloaded { entry, title, source: src.label() }),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(u: &str) -> String {
        check_url(u).unwrap_or_else(|e| panic!("{u}: {e}")).0
    }
    fn bad(u: &str) {
        assert!(check_url(u).is_err(), "должна быть отклонена: {u}");
    }

    #[test]
    fn youtube_links() {
        assert_eq!(ok("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL123&t=10"), "https://www.youtube.com/watch?v=jNQXAC9IVRw");
        assert_eq!(ok("youtu.be/jNQXAC9IVRw?si=abc"), "https://www.youtube.com/watch?v=jNQXAC9IVRw");
        assert_eq!(ok("https://music.youtube.com/watch?v=jNQXAC9IVRw"), "https://www.youtube.com/watch?v=jNQXAC9IVRw");
        assert_eq!(ok("https://m.youtube.com/shorts/jNQXAC9IVRw"), "https://www.youtube.com/watch?v=jNQXAC9IVRw");
        bad("https://www.youtube.com/playlist?list=PL123");
        bad("https://www.youtube.com/@someone");
        bad("https://www.youtube.com/watch?v=short");
        bad("https://www.youtube.com/watch?v=jNQXAC9IVR\"");
    }

    #[test]
    fn soundcloud_links() {
        assert_eq!(ok("https://soundcloud.com/artist-name/track_1?utm=x"), "https://soundcloud.com/artist-name/track_1");
        assert_eq!(ok("https://on.soundcloud.com/AbC123"), "https://on.soundcloud.com/AbC123");
        bad("https://soundcloud.com/artist/sets/album");
        bad("https://soundcloud.com/artist");
        bad("https://soundcloud.com/discover/sets");
        bad("https://soundcloud.com/artist/tracks");
    }

    #[test]
    fn vk_links() {
        assert_eq!(ok("https://vk.com/video-12345_67890"), "https://vk.com/video-12345_67890");
        assert_eq!(ok("https://vkvideo.ru/video12345_67890"), "https://vk.com/video12345_67890");
        assert_eq!(ok("https://vk.com/clip-1_2"), "https://vk.com/clip-1_2");
        assert_eq!(ok("https://vk.com/feed?z=video-1_2%2Fpl_cat"), "https://vk.com/video-1_2");
        bad("https://vk.com/audio-1_2");
        bad("https://vk.com/audios123");
        bad("https://vk.com/music/playlist/1_2");
        bad("https://vk.com/id1");
    }

    #[test]
    fn sources_for_library() {
        let (u, s, id) = source_info("youtu.be/jNQXAC9IVRw?si=abc").unwrap();
        assert_eq!((u.as_str(), s, id.as_str()), ("https://www.youtube.com/watch?v=jNQXAC9IVRw", "youtube", "jNQXAC9IVRw"));
        let (_, s, id) = source_info("https://soundcloud.com/forss/flickermood?x=1").unwrap();
        assert_eq!((s, id.as_str()), ("soundcloud", "forss/flickermood"));
        let (_, s, id) = source_info("https://vkvideo.ru/video-1_2").unwrap();
        assert_eq!((s, id.as_str()), ("vk-video", "video-1_2"));
        assert!(source_info("https://evil.example/x").is_none());
    }

    #[test]
    fn rejects_everything_else() {
        bad("");
        bad("https://evil.example/watch?v=jNQXAC9IVRw");
        bad("https://youtube.com.evil.example/watch?v=jNQXAC9IVRw");
        bad("https://user:pass@www.youtube.com/watch?v=jNQXAC9IVRw");
        bad("https://www.youtube.com:8443/watch?v=jNQXAC9IVRw");
        bad("file:///C:/Windows/win.ini");
        bad("ftp://youtube.com/watch?v=jNQXAC9IVRw");
        bad("https://127.0.0.1/watch?v=jNQXAC9IVRw");
        bad("--exec calc https://youtu.be/jNQXAC9IVRw");
        bad("https://youtu.be/jNQXAC9IVRw\nhttps://evil.example");
        bad(&format!("https://youtu.be/{}", "a".repeat(3000)));
    }

    #[test]
    fn safe_args() {
        let a = args(Source::YouTube, Path::new("x"));
        for need in ["--ignore-config", "--no-plugin-dirs", "--no-exec", "--no-playlist", "--no-cookies"] {
            assert!(a.iter().any(|x| x == need), "нет {need}");
        }
        let i = a.iter().position(|x| x == "--downloader").unwrap();
        assert_eq!(a[i + 1], "native");
        let i = a.iter().position(|x| x == "--use-extractors").unwrap();
        assert_eq!(a[i + 1], "youtube");
        assert!(!a.iter().any(|x| x.contains("cookies-from-browser") && x != "--no-cookies-from-browser"));
    }

    #[test]
    fn checksum_line() {
        let sums = "aa  other\n0123456789abcdef0123456789abcdef0123456789abcdef0123456789ABCDEF  yt-dlp.exe\n";
        assert_eq!(expected_sum(sums, "yt-dlp.exe").unwrap(), "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
        assert!(expected_sum(sums, "yt-dlp").is_none());
        assert!(expected_sum("zz  yt-dlp.exe", "yt-dlp.exe").is_none());
    }

    #[test]
    fn video_in_mp4() {
        let mut b = vec![0u8; 64];
        b[30..34].copy_from_slice(b"hdlr");
        b[42..46].copy_from_slice(b"soun");
        assert!(!has_video_track(&b));
        b[42..46].copy_from_slice(b"vide");
        assert!(has_video_track(&b));
    }

    #[test]
    fn names() {
        let m = Meta { title: "Кино - Группа крови (Official Video) [HD]".into(), uploader: "Кино".into(), ..Default::default() };
        assert_eq!(file_stem(&m), "Кино - Группа крови");
        let m = Meta { title: "Song Name (feat. X)".into(), uploader: "Artist - Topic".into(), ..Default::default() };
        assert_eq!(file_stem(&m), "Artist - Song Name (feat. X)");
        let m = Meta { artist: "A, B".into(), track: "T/1".into(), title: "x".into(), ..Default::default() };
        assert_eq!(file_stem(&m), "A - T_1");
        let m = Meta { title: "..".into(), ..Default::default() };
        assert_eq!(file_stem(&m), "Трек по ссылке");
    }

    #[test]
    fn rejects_non_audio() {
        let d = std::env::temp_dir().join(format!("linkdl-test-{}", rand_hex()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("x.m4a");
        std::fs::write(&f, vec![b'<'; 5000]).unwrap();
        assert!(check_audio(&f).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Настоящая загрузка: ставит yt-dlp во временную папку и качает трек (по умолчанию — «Flickermood» с SoundCloud,
    /// его же берёт тестами сам yt-dlp; своя ссылка — переменная LINKDL_URL).
    /// cargo test --lib linkdl::tests::real_download -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_download() {
        let base = std::env::temp_dir().join(format!("linkdl-real-{}", rand_hex()));
        let ver = tauri::async_runtime::block_on(install_to(&base.join("tools"))).expect("установка");
        println!("yt-dlp {ver}");
        let link = std::env::var("LINKDL_URL").unwrap_or_else(|_| "https://soundcloud.com/forss/flickermood".into());
        let (url, src) = check_url(&link).unwrap();
        let (file, meta) = run(&tool_file(&base.join("tools")), &url, src, &base.join("dl"), |d, t| println!("{d}/{t}")).expect("скачивание");
        println!("{file:?} {meta:?}");
        println!("формат: {}", check_audio(&file).expect("проверка"));
        println!("имя: {}", file_stem(&meta));
        let _ = std::fs::remove_dir_all(&base);
    }
}
