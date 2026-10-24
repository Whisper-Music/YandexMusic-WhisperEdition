
use crate::net;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const CFG_FILE: &str = "downloads.json";
const INDEX_FILE: &str = "downloaded.json";
static INDEX_LOCK: Mutex<()> = Mutex::new(());
const DEFAULT_SUBDIR: &str = "Моя Музыка";

#[derive(Serialize, Deserialize, Default)]
struct DlCfg {
    dir: Option<String>,
}

#[derive(Serialize)]
pub struct DirInfo {
    path: String,
    custom: bool,
}

fn cfg_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(CFG_FILE))
}

fn read_cfg(app: &AppHandle) -> DlCfg {
    cfg_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_cfg(app: &AppHandle, cfg: &DlCfg) -> Result<(), String> {
    let p = cfg_path(app)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn default_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .audio_dir()
        .or_else(|_| app.path().download_dir())
        .map_err(|e| e.to_string())?;
    Ok(base.join(DEFAULT_SUBDIR))
}

fn current_dir(app: &AppHandle) -> Result<(PathBuf, bool), String> {
    match read_cfg(app).dir.map(PathBuf::from) {
        Some(p) if p.is_absolute() => Ok((p, true)),
        _ => Ok((default_dir(app)?, false)),
    }
}

fn info(app: &AppHandle) -> Result<DirInfo, String> {
    let (p, custom) = current_dir(app)?;
    Ok(DirInfo { path: p.to_string_lossy().into_owned(), custom })
}

fn sanitize_name(raw: &str) -> String {
    let mut s: String = raw
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect();
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = s.trim_matches(|c: char| c == '.' || c == ' ');
    let mut s: String = s.chars().take(150).collect();
    s = s.trim_end_matches(|c: char| c == '.' || c == ' ').to_string();
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    if s.is_empty() || reserved {
        s = format!("Трек {s}").trim().to_string();
    }
    s
}

fn free_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..10_000)
        .map(|n| dir.join(format!("{stem} ({n}).{ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

fn sniff_ext(b: &[u8]) -> &'static str {
    if b.starts_with(b"fLaC") {
        "flac"
    } else if b.len() > 8 && &b[4..8] == b"ftyp" {
        "m4a"
    } else if b.len() > 1 && b[0] == 0xFF && (b[1] & 0xF6) == 0xF0 {
        "aac"
    } else {
        "mp3"
    }
}

fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
}

// Запись индекса скачанных треков. Старый формат — просто путь к файлу (строка), новый — объект
// с путём, кратким описанием трека (название, исполнители, обложка, длительность — чтобы показать
// список без сети) и временем скачивания. Старые записи читаются как есть и дополняются описанием позже.
#[derive(Serialize, Deserialize, Clone)]
#[serde(untagged)]
enum Entry {
    Full {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        meta: Option<serde_json::Value>,
        #[serde(default)]
        ts: u64,
    },
    Path(String),
}

impl Entry {
    fn path(&self) -> &str {
        match self {
            Entry::Full { path, .. } | Entry::Path(path) => path,
        }
    }
    fn meta(&self) -> Option<&serde_json::Value> {
        match self {
            Entry::Full { meta, .. } => meta.as_ref(),
            Entry::Path(_) => None,
        }
    }
    fn ts(&self) -> u64 {
        match self {
            Entry::Full { ts, .. } if *ts > 0 => *ts,
            _ => std::fs::metadata(self.path())
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
        }
    }
}

type Index = BTreeMap<String, Entry>;

const META_MAX: usize = 16 * 1024;

/// Описание трека принимаем только объектом и разумного размера — это всего лишь подсказка для офлайн-списка.
fn clean_meta(meta: Option<serde_json::Value>) -> Option<serde_json::Value> {
    let m = meta.filter(|m| m.is_object())?;
    let len = serde_json::to_vec(&m).map(|v| v.len()).unwrap_or(usize::MAX);
    (len <= META_MAX).then_some(m)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(INDEX_FILE))
}

fn read_index(app: &AppHandle) -> Index {
    index_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_index(app: &AppHandle, index: &Index) -> Result<(), String> {
    let p = index_path(app)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, serde_json::to_vec(index).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Индекс без записей, чьи файлы удалены с диска (заодно сохраняется очищенным).
fn live_index(app: &AppHandle) -> Index {
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut index = read_index(app);
    let before = index.len();
    index.retain(|_, e| Path::new(e.path()).is_file());
    if index.len() != before {
        let _ = write_index(app, &index);
    }
    index
}

/// Путь к скачанному файлу трека (для локального воспроизведения).
pub fn local_path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    if !id_ok(id) {
        return None;
    }
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let p = PathBuf::from(read_index(app).get(id)?.path());
    p.is_file().then_some(p)
}

#[tauri::command]
pub fn downloaded_ids(app: AppHandle) -> Vec<String> {
    live_index(&app).into_keys().collect()
}

#[derive(Serialize)]
pub struct DlItem {
    id: String,
    name: String,
    meta: Option<serde_json::Value>,
    ts: u64,
}

/// Скачанные треки с описанием — из них собирается список «Лайков» без интернета.
#[tauri::command]
pub fn downloaded_tracks(app: AppHandle) -> Vec<DlItem> {
    live_index(&app)
        .into_iter()
        .map(|(id, e)| DlItem {
            name: Path::new(e.path())
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            meta: e.meta().cloned(),
            ts: e.ts(),
            id,
        })
        .collect()
}

#[derive(Deserialize)]
pub struct MetaItem {
    id: String,
    meta: serde_json::Value,
}

/// Дописать описание трекам, скачанным раньше (когда описание ещё не сохранялось).
#[tauri::command]
pub fn downloaded_meta(app: AppHandle, items: Vec<MetaItem>) -> Result<(), String> {
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut index = read_index(&app);
    let mut changed = false;
    for it in items.into_iter().take(5000) {
        let Some(e) = index.get_mut(&it.id) else { continue };
        if e.meta().is_some() {
            continue;
        }
        let Some(meta) = clean_meta(Some(it.meta)) else { continue };
        let ts = e.ts();
        *e = Entry::Full { path: e.path().to_string(), meta: Some(meta), ts };
        changed = true;
    }
    if changed {
        write_index(&app, &index)?;
    }
    Ok(())
}

#[tauri::command]
pub fn download_dir_get(app: AppHandle) -> Result<DirInfo, String> {
    info(&app)
}

#[tauri::command]
pub async fn download_dir_pick(app: AppHandle) -> Result<Option<DirInfo>, String> {
    let (start, _) = current_dir(&app)?;
    let start = if start.is_dir() { Some(start) } else { start.parent().map(Path::to_path_buf).filter(|p| p.is_dir()) };
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = a.dialog().file().set_title("Папка для скачанных треков");
        if let Some(s) = start {
            d = d.set_directory(s);
        }
        d.blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let p = fp.into_path().map_err(|e| e.to_string())?;
    if !p.is_absolute() || !p.is_dir() {
        return Err("Не удалось открыть эту папку".into());
    }
    write_cfg(&app, &DlCfg { dir: Some(p.to_string_lossy().into_owned()) })?;
    info(&app).map(Some)
}

#[tauri::command]
pub fn download_dir_reset(app: AppHandle) -> Result<DirInfo, String> {
    write_cfg(&app, &DlCfg::default())?;
    info(&app)
}

#[tauri::command]
pub fn download_dir_open(app: AppHandle) -> Result<(), String> {
    let (dir, _) = current_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Временный файл для скачивания (аудит F-06): случайное имя (128 бит из getrandom) и создание только
/// нового файла (create_new = O_EXCL / CREATE_NEW). Если по этому пути уже лежит что угодно, в том числе
/// подставленная ссылка (symlink), открытие завершится ошибкой, а не запишет данные по ссылке.
/// Пишем через открытый дескриптор, а не повторным открытием по пути.
fn write_temp(dir: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    use std::io::Write;
    for _ in 0..8 {
        let mut r = [0u8; 16];
        getrandom::fill(&mut r).map_err(|e| std::io::Error::other(e.to_string()))?;
        let name: String = r.iter().map(|b| format!("{b:02x}")).collect();
        let tmp = dir.join(format!(".{name}.part"));
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o644);
        }
        let mut f = match opts.open(&tmp) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        };
        // открыли действительно обычный файл, а не что-то подставленное
        if !f.metadata()?.is_file() {
            return Err(std::io::Error::other("временный файл подменён"));
        }
        if let Err(e) = f.write_all(bytes).and_then(|_| f.sync_all()) {
            drop(f);
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        return Ok(tmp);
    }
    Err(std::io::Error::other("не удалось создать временный файл"))
}

#[tauri::command]
pub async fn download_track(
    app: AppHandle,
    name: String,
    id: String,
    meta: Option<serde_json::Value>,
) -> Result<String, String> {
    if !id_ok(&id) {
        return Err("Некорректный номер трека".into());
    }
    // ссылку на файл Rust получает сам по номеру трека (интерфейс адрес для скачивания не передаёт)
    let url = net::track_mp3_url(&id).await?;
    let bytes = net::fetch_media(&url).await?;
    if bytes.len() < 1024 {
        return Err("Сервер вернул пустой файл".into());
    }
    let (dir, _) = current_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    let stem = sanitize_name(&name);
    let path = free_path(&dir, &stem, sniff_ext(&bytes));
    let tmp = write_temp(&dir, &bytes).map_err(|e| format!("Не удалось записать файл: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Не удалось сохранить файл: {e}"));
    }
    let saved = path.to_string_lossy().into_owned();
    {
        let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut index = read_index(&app);
        index.insert(id, Entry::Full { path: saved.clone(), meta: clean_meta(meta), ts: now_secs() });
        let _ = write_index(&app, &index);
    }
    Ok(saved)
}

// ---------------------------------------------------------------------------
// Локальное воспроизведение: <audio src="ymlocal://localhost/track/<id>"> (на Windows —
// http://ymlocal.localhost/track/<id>) играет скачанный файл прямо с диска, без запросов к Яндексу.
// Отдаётся кусками по Range — перемотка работает сразу, в память не грузится весь файл.
// Путь к файлу берётся только из своего индекса по номеру трека, произвольный файл так не открыть.
// ---------------------------------------------------------------------------

use std::io::{Read, Seek, SeekFrom};
use tauri::http::{header, Request, Response, StatusCode};

const LOCAL_CHUNK: u64 = 2 * 1024 * 1024;

fn audio_ctype(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("flac") => "audio/flac",
        Some("m4a") | Some("mp4") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("ogg") | Some("opus") => "audio/ogg",
        Some("wav") => "audio/wav",
        _ => "audio/mpeg",
    }
}

fn local_resp(status: StatusCode, origin: &Option<String>) -> tauri::http::response::Builder {
    let mut b = Response::builder().status(status).header(header::CACHE_CONTROL, "no-store");
    // запрос приходит только из главного окна (проверка в lib.rs); CORS нужен визуализатору —
    // разрешаем ровно Origin страниц приложения, а не любой присланный (аудит F-11)
    if let Some(o) = net::app_origin(origin.as_deref()) {
        b = b.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, o).header(header::VARY, "Origin");
    }
    b
}

fn local_err(status: StatusCode, msg: &str, origin: &Option<String>) -> Response<Vec<u8>> {
    local_resp(status, origin)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap_or_default()
}

fn read_part(path: &Path, start: u64, len: u64) -> std::io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity(len as usize);
    f.take(len).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Обработчик ymlocal://localhost/track/<id> (регистрируется в lib.rs).
pub fn serve_local(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()).map(str::to_string);
    let Some(id) = req.uri().path().strip_prefix("/track/") else {
        return local_err(StatusCode::NOT_FOUND, "not found", &origin);
    };
    let Some(path) = local_path(app, id) else {
        return local_err(StatusCode::NOT_FOUND, "трек не скачан", &origin);
    };
    let total = match std::fs::metadata(&path) {
        Ok(m) => m.len(),
        Err(e) => return local_err(StatusCode::NOT_FOUND, &e.to_string(), &origin),
    };
    if total == 0 {
        return local_err(StatusCode::NOT_FOUND, "пустой файл", &origin);
    }
    let (start, want_end) = crate::whisper::parse_range(req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()));
    if start >= total {
        return local_resp(StatusCode::RANGE_NOT_SATISFIABLE, &origin)
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .body(Vec::new())
            .unwrap_or_default();
    }
    let end = want_end.unwrap_or(u64::MAX).min(start + LOCAL_CHUNK - 1).min(total - 1);
    let body = match read_part(&path, start, end - start + 1) {
        Ok(b) if !b.is_empty() => b,
        Ok(_) => return local_err(StatusCode::INTERNAL_SERVER_ERROR, "файл не читается", &origin),
        Err(e) => return local_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string(), &origin),
    };
    let end = start + body.len() as u64 - 1;
    local_resp(StatusCode::PARTIAL_CONTENT, &origin)
        .header(header::CONTENT_TYPE, audio_ctype(&path))
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_files() {
        let dir = std::env::temp_dir().join(format!("yd-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = write_temp(&dir, b"hello").unwrap();
        let b = write_temp(&dir, b"world").unwrap();
        assert_ne!(a, b);
        assert_eq!(std::fs::read(&a).unwrap(), b"hello");
        let n = a.file_name().unwrap().to_string_lossy().into_owned();
        assert!(n.starts_with('.') && n.ends_with(".part") && n.len() == 1 + 32 + 5);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Заранее подставленная ссылка с «предсказуемым» именем не используется: create_new не идёт по ссылке.
    #[cfg(unix)]
    #[test]
    fn temp_never_follows_symlink() {
        let dir = std::env::temp_dir().join(format!("yd-test-sl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("victim");
        std::fs::write(&target, b"keep").unwrap();
        let link = dir.join(".x.part");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let mut o = std::fs::OpenOptions::new();
        o.write(true).create_new(true);
        assert!(o.open(&link).is_err());
        let t = write_temp(&dir, b"new").unwrap();
        assert_ne!(t, link);
        assert_eq!(std::fs::read(&target).unwrap(), b"keep");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn names() {
        assert_eq!(sanitize_name("AC/DC — Back in Black"), "AC DC — Back in Black");
        assert_eq!(sanitize_name("..\\..\\evil"), "evil");
        assert_eq!(sanitize_name("a:b*c?d\"e<f>g|h"), "a b c d e f g h");
        assert_eq!(sanitize_name("  ...  "), "Трек");
        assert_eq!(sanitize_name("CON"), "Трек CON");
        assert_eq!(sanitize_name("com1.txt"), "Трек com1.txt");
        assert_eq!(sanitize_name("Компот"), "Компот");
        assert_eq!(sanitize_name(&"я".repeat(300)).chars().count(), 150);
        assert!(!sanitize_name("x\u{0}y\n").contains(['\0', '\n']));
    }

    #[test]
    fn index_compat() {
        let idx: Index =
            serde_json::from_str(r#"{"1":"C:\\a.mp3","2":{"path":"C:\\b.mp3","meta":{"title":"x"},"ts":5}}"#).unwrap();
        assert_eq!(idx["1"].path(), "C:\\a.mp3");
        assert!(idx["1"].meta().is_none());
        assert_eq!(idx["2"].path(), "C:\\b.mp3");
        assert_eq!(idx["2"].meta().unwrap()["title"], "x");
        assert_eq!(idx["2"].ts(), 5);
        assert!(clean_meta(Some(serde_json::json!("str"))).is_none());
        assert!(clean_meta(Some(serde_json::json!({ "t": "я".repeat(20_000) }))).is_none());
    }

    #[test]
    fn ids() {
        assert!(id_ok("12345"));
        assert!(id_ok("12345:678"));
        assert!(!id_ok(""));
        assert!(!id_ok("../x"));
        assert!(!id_ok("a b"));
        assert!(!id_ok(&"1".repeat(41)));
    }

    #[test]
    fn ext() {
        assert_eq!(sniff_ext(b"ID3\x04rest"), "mp3");
        assert_eq!(sniff_ext(b"fLaC\0\0"), "flac");
        assert_eq!(sniff_ext(b"\0\0\0\x20ftypM4A "), "m4a");
    }
}
