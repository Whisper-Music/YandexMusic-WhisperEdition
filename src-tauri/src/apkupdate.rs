//! Обновление на телефоне (Android): те же команды, что у update.rs на компьютере (`update_check` /
//! `update_install`), так что update.js не различает, где он.
//!
//! * Где искать: последний опубликованный выпуск репозитория (GitHub API, releases/latest) и в нём файл
//!   `…_android_arm64.apk` — его выкладывает release.yml (задание android).
//! * Подлинность: подпись minisign здесь не нужна — Android сам ставит обновление только если APK подписан тем же
//!   ключом, что и установленное приложение; чужой файл система откажется ставить.
//! * Установка: команда только скачивает файл в `<кэш приложения>/update.apk`, саму установку открывает
//!   страница через мост Android (MainActivity.kt → `WhisperAndroid.installUpdate()`): системное окно
//!   «Обновить приложение?» — пользователь подтверждает сам.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::Mutex;
use std::{sync::OnceLock, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_http::reqwest::{redirect, Client};

const API: &str = "https://api.github.com/repos/Whisper-Music/YandexMusic-WhisperEdition/releases/latest";
pub const RELEASES_PAGE: &str = "https://github.com/Whisper-Music/YandexMusic-WhisperEdition/releases/latest";
/// APK больше этого — точно не наш файл
const MAX: u64 = 300 * 1024 * 1024;

static INSTALLING: AtomicBool = AtomicBool::new(false);

/// Найденный при последней проверке файл (адрес и размер)
#[derive(Default)]
pub struct Pending(Mutex<Option<(String, u64, String)>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    version: Option<String>,
    notes: String,
    date: String,
    can_install: bool,
    page: &'static str,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    browser_download_url: String,
}

/// Только GitHub: сам API, страница файла и хранилище файлов выпусков, куда она перенаправляет
fn host_ok(u: &tauri::Url) -> bool {
    let h = u.host_str().unwrap_or("");
    u.scheme() == "https" && (h == "api.github.com" || h == "github.com" || h.ends_with(".githubusercontent.com"))
}

fn client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(600))
            .redirect(redirect::Policy::custom(|a| {
                if a.previous().len() < 5 && host_ok(a.url()) {
                    a.follow()
                } else {
                    a.error("перенаправление не на GitHub")
                }
            }))
            .user_agent(concat!("yandex-desktop/", env!("CARGO_PKG_VERSION"), " (android update)"))
            .build()
            .expect("не удалось создать HTTP-клиент обновлений")
    })
}

/// «1.2.3» / «v1.2.3» → (1, 2, 3); хвост вида «-beta» не учитывается
fn ver(s: &str) -> Vec<u64> {
    s.trim().trim_start_matches('v').split(|c| c == '-' || c == '+').next().unwrap_or("")
        .split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

fn newer(a: &str, b: &str) -> bool {
    let (mut x, mut y) = (ver(a), ver(b));
    let n = x.len().max(y.len());
    x.resize(n, 0);
    y.resize(n, 0);
    x > y
}

fn apk_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("update.apk"))
}

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, Pending>) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let resp = client()
        .get(API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("нет связи с GitHub: {e}"))?;
    if resp.status().as_u16() == 404 {
        return Err("на GitHub пока нет опубликованного выпуска".into());
    }
    if !resp.status().is_success() {
        return Err(format!("GitHub ответил {}", resp.status()));
    }
    let body = resp.bytes().await.map_err(|e| format!("нет связи с GitHub: {e}"))?;
    let rel: Release = serde_json::from_slice(&body).map_err(|e| format!("непонятный ответ GitHub: {e}"))?;
    let apk = rel.assets.iter().find(|a| a.name.ends_with(".apk") && a.name.contains("android"));
    let found = newer(&rel.tag_name, &current) && apk.is_some();
    let version = rel.tag_name.trim_start_matches('v').to_string();
    *pending.0.lock().unwrap_or_else(|e| e.into_inner()) =
        if found { apk.map(|a| (a.browser_download_url.clone(), a.size, version.clone())) } else { None };
    // старый скачанный файл (уже установленная версия) больше не нужен
    if !found {
        if let Ok(p) = apk_path(&app) { let _ = std::fs::remove_file(p); }
    }
    Ok(UpdateInfo {
        current,
        version: found.then_some(version),
        notes: if found { rel.body.unwrap_or_default().chars().take(4000).collect() } else { String::new() },
        date: rel.published_at.unwrap_or_default().chars().take(10).collect(),
        can_install: true,
        page: RELEASES_PAGE,
    })
}

/// Скачать APK новой версии в кэш. Ход — событие «update-progress» { got, total }, в конце { ready: true };
/// установку дальше открывает страница (WhisperAndroid.installUpdate()).
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    let (url, size, _) = pending.0.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or("сначала проверь обновления")?;
    if size > MAX {
        return Err("файл обновления слишком большой".into());
    }
    if INSTALLING.swap(true, SeqCst) {
        return Err("обновление уже скачивается".into());
    }
    let res = download(&app, &url, size).await;
    INSTALLING.store(false, SeqCst);
    res?;
    let _ = app.emit("update-progress", json!({ "ready": true }));
    Ok(())
}

async fn download(app: &AppHandle, url: &str, size: u64) -> Result<(), String> {
    let u: tauri::Url = url.parse().map_err(|_| "плохой адрес файла")?;
    if !host_ok(&u) {
        return Err("файл обновления не на GitHub".into());
    }
    let mut resp = client().get(u).send().await.map_err(|e| format!("не удалось скачать: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub ответил {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(size).min(MAX);
    let path = apk_path(app)?;
    let part = path.with_extension("part");
    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut last = -1i64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("связь оборвалась: {e}"))? {
        if buf.len() as u64 + chunk.len() as u64 > MAX {
            return Err("файл обновления слишком большой".into());
        }
        buf.extend_from_slice(&chunk);
        let pct = (buf.len() as u64 * 100 / total.max(1)) as i64;
        if pct != last {
            last = pct;
            let _ = app.emit("update-progress", json!({ "got": buf.len(), "total": total }));
        }
    }
    // APK — это zip: начинается с «PK»
    if buf.len() < 1024 || !buf.starts_with(b"PK\x03\x04") || (size > 0 && buf.len() as u64 != size) {
        return Err("скачанный файл повреждён — попробуй ещё раз".into());
    }
    std::fs::write(&part, &buf).map_err(|e| format!("не удалось сохранить: {e}"))?;
    std::fs::rename(&part, &path).map_err(|e| format!("не удалось сохранить: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions() {
        assert!(super::newer("v1.2.4", "1.2.3"));
        assert!(super::newer("v1.10.0", "1.9.9"));
        assert!(!super::newer("v1.2.3", "1.2.3"));
        assert!(!super::newer("1.2", "1.2.0"));
    }
}
