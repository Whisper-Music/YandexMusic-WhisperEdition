
use crate::net;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
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

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(INDEX_FILE))
}

fn read_index(app: &AppHandle) -> BTreeMap<String, String> {
    index_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_index(app: &AppHandle, index: &BTreeMap<String, String>) -> Result<(), String> {
    let p = index_path(app)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, serde_json::to_vec(index).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn downloaded_ids(app: AppHandle) -> Vec<String> {
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut index = read_index(&app);
    let before = index.len();
    index.retain(|_, path| Path::new(path).is_file());
    if index.len() != before {
        let _ = write_index(&app, &index);
    }
    index.into_keys().collect()
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

#[tauri::command]
pub async fn download_track(app: AppHandle, url: String, name: String, id: String) -> Result<String, String> {
    if !id_ok(&id) {
        return Err("Некорректный номер трека".into());
    }
    let bytes = net::fetch_checked(&url).await?;
    if bytes.len() < 1024 {
        return Err("Сервер вернул пустой файл".into());
    }
    let (dir, _) = current_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    let stem = sanitize_name(&name);
    let path = free_path(&dir, &stem, sniff_ext(&bytes));
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let tmp = dir.join(format!(".{}-{}.part", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("Не удалось записать файл: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Не удалось сохранить файл: {e}"));
    }
    let saved = path.to_string_lossy().into_owned();
    {
        let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut index = read_index(&app);
        index.insert(id, saved.clone());
        let _ = write_index(&app, &index);
    }
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

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
