//! Резервные копии.
//!
//! * Файл резервной копии (.wbak) — zip, который собирает страница (backup.js): настройки, темы, фоны, статистика,
//!   закреплённые. Здесь — только сохранение через системный диалог «Сохранить как». Токены в копию не попадают:
//!   они лежат в системном хранилище (secret.rs), а страница их не видит; ключи и счётчики входа тоже не копируются.
//! * Автокопии — на случай повреждения данных (сбой диска, аварийное выключение, чужая программа переписала файл).
//!   Лежат в папке настроек приложения, в подпапке backups: `<вид>-<время>.json`, последние SNAP_KEEP каждого вида.
//!     - settings   — настройки страницы (localStorage), присылает backup.js раз в несколько часов и перед восстановлением;
//!     - downloaded — список скачанных треков (download.rs, после записи);
//!     - downloads  — папка загрузок и прежние папки (download.rs, после записи).
//!   Повреждённый список скачанных или настройки папки download.rs восстанавливает из свежей целой автокопии сам,
//!   а интерфейс сообщает об этом (recovery_status).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Сколько автокопий каждого вида хранить.
const SNAP_KEEP: usize = 8;
/// Автокопия настроек страницы: не больше 16 МБ (статистика за год — несколько мегабайт).
const SNAP_MAX: u64 = 16 * 1024 * 1024;
/// Файл резервной копии целиком (с темами и фонами).
const BACKUP_MAX: usize = 512 * 1024 * 1024;
const SNAP_KINDS: [&str; 3] = ["settings", "downloaded", "downloads"];

pub(crate) fn snap_dir_of(config_file: &Path) -> Option<PathBuf> {
    config_file.parent().map(|d| d.join("backups"))
}

fn snap_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("backups"))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// «downloaded-1793549669.json» → время; чужие и подозрительные имена не принимаются.
fn snap_ts(kind: &str, name: &str) -> Option<u64> {
    let rest = name.strip_prefix(kind)?.strip_prefix('-')?.strip_suffix(".json")?;
    if rest.is_empty() || rest.len() > 12 || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    rest.parse().ok()
}

/// Автокопии вида `kind`: (время, путь), самые свежие первыми.
pub(crate) fn snap_files(dir: &Path, kind: &str) -> Vec<(u64, PathBuf)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<(u64, PathBuf)> = rd
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            snap_ts(kind, &name).map(|ts| (ts, e.path()))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    out
}

/// Сохранить автокопию, если с прошлой прошло не меньше `min_gap` секунд (или `force`) и содержимое изменилось.
/// Лишние старые копии удаляются. Ошибки не мешают основной записи — копия дело второстепенное.
pub(crate) fn snap_keep(dir: &Path, kind: &str, bytes: &[u8], min_gap: u64, force: bool) -> bool {
    if bytes.is_empty() || bytes.len() as u64 > SNAP_MAX {
        return false;
    }
    let files = snap_files(dir, kind);
    let now = now_secs();
    if let Some((ts, p)) = files.first() {
        if !force && now.saturating_sub(*ts) < min_gap {
            return false;
        }
        if crate::download::read_capped(p, SNAP_MAX).ok().flatten().as_deref() == Some(bytes) {
            return false; // ничего не изменилось
        }
    }
    // время в имени должно расти, даже если две копии пишутся в одну секунду
    let ts = files.first().map(|(t, _)| (*t + 1).max(now)).unwrap_or(now);
    let p = dir.join(format!("{kind}-{ts}.json"));
    if crate::download::write_atomic(&p, bytes).is_err() {
        return false;
    }
    for (_, old) in snap_files(dir, kind).into_iter().skip(SNAP_KEEP) {
        let _ = std::fs::remove_file(old);
    }
    true
}

/// Самая свежая автокопия, которая проходит проверку `ok` (повреждённые копии пропускаются).
pub(crate) fn snap_latest(dir: &Path, kind: &str, ok: impl Fn(&[u8]) -> bool) -> Option<(u64, Vec<u8>)> {
    snap_files(dir, kind).into_iter().find_map(|(ts, p)| {
        let b = crate::download::read_capped(&p, SNAP_MAX).ok().flatten()?;
        ok(&b).then_some((ts, b))
    })
}

/// Прочитать автокопию по имени (имя проверяется — из папки backups не выйти).
pub(crate) fn snap_read_in(dir: &Path, kind: &str, name: &str) -> Result<Vec<u8>, String> {
    if snap_ts(kind, name).is_none() {
        return Err("Нет такой автокопии".into());
    }
    crate::download::read_capped(&dir.join(name), SNAP_MAX)
        .map_err(|e| format!("Автокопия не читается: {e}"))?
        .ok_or_else(|| "Автокопия не найдена".into())
}

// ---------------------------------------------------------------------------
// Что восстановлено при запуске — интерфейс показывает это один раз
// ---------------------------------------------------------------------------

static RECOVERED: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub(crate) fn note_recovered(msg: String) {
    eprintln!("[backup] {msg}");
    let mut v = RECOVERED.lock().unwrap_or_else(|e| e.into_inner());
    if v.len() < 16 && !v.contains(&msg) {
        v.push(msg);
    }
}

/// Сообщения о восстановлении из автокопий (и об отложенных повреждённых файлах) — забираются один раз.
#[tauri::command]
pub fn recovery_status() -> Vec<String> {
    std::mem::take(&mut *RECOVERED.lock().unwrap_or_else(|e| e.into_inner()))
}

// ---------------------------------------------------------------------------
// Команды
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct SnapInfo {
    name: String,
    ts: u64,
    size: u64,
}

fn kind_ok(kind: &str) -> Result<&'static str, String> {
    SNAP_KINDS.iter().copied().find(|k| *k == kind).ok_or_else(|| "Неизвестный вид автокопии".into())
}

/// Список автокопий вида `kind` (settings | downloaded | downloads), свежие первыми.
#[tauri::command]
pub fn snap_list(app: AppHandle, kind: String) -> Result<Vec<SnapInfo>, String> {
    let kind = kind_ok(&kind)?;
    let dir = snap_dir(&app)?;
    Ok(snap_files(&dir, kind)
        .into_iter()
        .map(|(ts, p)| SnapInfo {
            name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            size: std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
            ts,
        })
        .collect())
}

/// Автокопия настроек страницы: JSON-объект от backup.js. `force` — не ждать паузы между копиями
/// (перед восстановлением из файла: чтобы можно было откатиться).
#[tauri::command]
pub fn snap_settings_save(app: AppHandle, json: String, force: bool) -> Result<bool, String> {
    if json.len() as u64 > SNAP_MAX {
        return Err("Настройки слишком большие для автокопии".into());
    }
    match serde_json::from_str::<serde_json::Value>(&json) {
        Ok(v) if v.is_object() => {}
        _ => return Err("Автокопия настроек должна быть JSON-объектом".into()),
    }
    Ok(snap_keep(&snap_dir(&app)?, "settings", json.as_bytes(), 3 * 3600, force))
}

/// Текст автокопии настроек страницы.
#[tauri::command]
pub fn snap_settings_read(app: AppHandle, name: String) -> Result<String, String> {
    let b = snap_read_in(&snap_dir(&app)?, "settings", &name)?;
    String::from_utf8(b).map_err(|_| "Автокопия повреждена".into())
}

/// Сохранить файл резервной копии через диалог «Сохранить как». Данные — одним двоичным куском (zip от backup.js),
/// имя файла по умолчанию — в заголовке x-backup-name. Возвращает путь или None, если пользователь передумал.
#[tauri::command]
pub async fn backup_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("Нет данных резервной копии".into());
    };
    if body.len() > BACKUP_MAX {
        return Err(format!("Копия получилась больше {} МБ — сохрани её без фонов", BACKUP_MAX / 1048576));
    }
    if !body.starts_with(b"PK\x03\x04") {
        return Err("Это не файл резервной копии".into());
    }
    let content = body.clone();
    let name = request
        .headers()
        .get("x-backup-name")
        .and_then(|v| v.to_str().ok())
        .filter(|n| !n.is_empty() && n.len() <= 80 && n.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_. ".contains(&b)))
        .unwrap_or("whisper-backup")
        .to_string();
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_title("Сохранить резервную копию")
            .set_file_name(format!("{name}.wbak"))
            .add_filter("Резервная копия Whisper", &["wbak"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let mut p = fp.into_path().map_err(|e| e.to_string())?;
    if p.extension().map(|e| !e.eq_ignore_ascii_case("wbak")).unwrap_or(true) {
        p.set_extension("wbak");
    }
    // атомарно: прерванная запись не оставит половину файла поверх прежней копии
    let path = p.clone();
    tauri::async_runtime::spawn_blocking(move || crate::download::write_atomic(&path, &content))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Не удалось записать файл: {e}"))?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bk-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn names() {
        assert_eq!(snap_ts("settings", "settings-123.json"), Some(123));
        assert_eq!(snap_ts("settings", "downloaded-123.json"), None);
        assert_eq!(snap_ts("settings", "settings-.json"), None);
        assert_eq!(snap_ts("settings", "settings-12a.json"), None);
        assert_eq!(snap_ts("settings", "settings-1/../x.json"), None);
        assert_eq!(snap_ts("settings", "settings-1234567890123.json"), None);
        assert!(kind_ok("downloaded").is_ok());
        assert!(kind_ok("../x").is_err());
    }

    #[test]
    fn keep_and_rotate() {
        let dir = tmpdir("rot");
        assert!(snap_keep(&dir, "settings", b"{\"a\":1}", 3600, false));
        // слишком рано и без force — не пишется
        assert!(!snap_keep(&dir, "settings", b"{\"a\":2}", 3600, false));
        // то же содержимое — не пишется даже с force
        assert!(!snap_keep(&dir, "settings", b"{\"a\":1}", 0, true));
        for i in 0..20 {
            assert!(snap_keep(&dir, "settings", format!("{{\"a\":{}}}", i + 10).as_bytes(), 0, true));
        }
        let files = snap_files(&dir, "settings");
        assert_eq!(files.len(), SNAP_KEEP);
        // свежая — последняя записанная
        let (_, b) = snap_latest(&dir, "settings", |_| true).unwrap();
        assert_eq!(b, b"{\"a\":29}");
        // повреждённые копии пропускаются
        std::fs::write(&files[0].1, b"{broken").unwrap();
        let (_, b) = snap_latest(&dir, "settings", |b| serde_json::from_slice::<serde_json::Value>(b).is_ok()).unwrap();
        assert_eq!(b, b"{\"a\":28}");
        // чужой вид не смешивается
        assert!(snap_files(&dir, "downloaded").is_empty());
        // чтение по имени: только имена своего вида
        let name = files[1].1.file_name().unwrap().to_string_lossy().into_owned();
        assert!(snap_read_in(&dir, "settings", &name).is_ok());
        assert!(snap_read_in(&dir, "settings", "../settings-1.json").is_err());
        assert!(snap_read_in(&dir, "downloaded", &name).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn recovered_messages() {
        // общий список с другими тестами — проверяем только своё сообщение
        note_recovered("тест-сообщение".into());
        note_recovered("тест-сообщение".into());
        let got = recovery_status();
        assert_eq!(got.iter().filter(|m| *m == "тест-сообщение").count(), 1);
        assert!(!recovery_status().iter().any(|m| m == "тест-сообщение"));
    }
}
