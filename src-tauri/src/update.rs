//! Обновления приложения из GitHub Releases.
//!
//! * Где искать: `plugins.updater.endpoints` в tauri.conf.json — файл `latest.json` последнего опубликованного
//!   (не черновика и не pre-release) выпуска репозитория. Его вместе с подписанными установщиками собирает
//!   .github/workflows/release.yml (tauri-action).
//! * Подлинность: каждый файл обновления подписан ключом minisign. Открытый ключ вшит в приложение
//!   (`plugins.updater.pubkey`), закрытый лежит только у автора и в секрете репозитория
//!   TAURI_SIGNING_PRIVATE_KEY. Файл с чужой подписью (или без неё) приложение не установит,
//!   даже если кто-то подменит выпуск на GitHub.
//! * Странице доступны только две команды: «проверить» и «установить найденное». Адрес, файл и подпись
//!   страница выбрать не может — всё решает Rust по настройкам выше.
//! * Linux: обновляется только AppImage. Пакеты .deb/.rpm ставятся системой — для них приложение сообщает
//!   о новой версии и даёт ссылку на страницу выпуска.

use serde::Serialize;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Страница последнего выпуска — для ручной загрузки (Linux .deb/.rpm) и «что нового».
pub const RELEASES_PAGE: &str = "https://github.com/Whisper-Music/YandexMusic-WhisperEdition/releases/latest";

/// Найденное при последней проверке обновление (его и устанавливаем — без повторного запроса).
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
pub struct UpdateInfo {
    /// версия, которая работает сейчас
    current: String,
    /// новая версия, если есть
    version: Option<String>,
    /// описание выпуска (текст релиза на GitHub)
    notes: String,
    /// дата выпуска, ГГГГ-ММ-ДД
    date: String,
    /// можно ли обновиться прямо из приложения (в Linux — только AppImage)
    can_install: bool,
    page: &'static str,
}

fn can_install() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

fn friendly(e: impl std::fmt::Display) -> String {
    let s = e.to_string();
    if s.contains("404") || s.to_ascii_lowercase().contains("not found") {
        "на GitHub пока нет опубликованного выпуска с файлом обновлений (latest.json)".into()
    } else if s.to_ascii_lowercase().contains("signature") {
        "подпись обновления не совпадает — файл не от автора приложения, установка отменена".into()
    } else {
        s
    }
}

/// Проверить, есть ли версия новее текущей.
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, Pending>) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let found = app.updater().map_err(friendly)?.check().await.map_err(friendly)?;
    let info = UpdateInfo {
        current,
        version: found.as_ref().map(|u| u.version.clone()),
        notes: found.as_ref().and_then(|u| u.body.clone()).unwrap_or_default().chars().take(4000).collect(),
        date: found.as_ref().and_then(|u| u.date).map(|d| d.date().to_string()).unwrap_or_default(),
        can_install: can_install(),
        page: RELEASES_PAGE,
    };
    *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = found;
    Ok(info)
}

/// Скачать найденное обновление, проверить подпись, установить и перезапустить приложение.
/// Ход загрузки — событие «update-progress»: { got, total } в байтах, в конце { done: true }.
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    if !can_install() {
        return Err("эта сборка установлена пакетом системы — скачай новую версию со страницы выпуска".into());
    }
    let update = pending
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or("сначала проверь обновления")?;
    if INSTALLING.swap(true, SeqCst) {
        return Err("обновление уже устанавливается".into());
    }
    let (a, b) = (app.clone(), app.clone());
    let (mut got, mut last) = (0u64, -1i64);
    let res = update
        .download_and_install(
            move |chunk, total| {
                got += chunk as u64;
                // не чаще одного события на процент
                let pct = total.map(|t| (got.saturating_mul(100) / t.max(1)) as i64).unwrap_or((got / 262_144) as i64);
                if pct != last {
                    last = pct;
                    let _ = a.emit("update-progress", json!({ "got": got, "total": total }));
                }
            },
            move || {
                // Windows: установщик сейчас закроет приложение — запоминаем окно, как при обычном выходе
                crate::winstate::save(&b);
                let _ = b.emit("update-progress", json!({ "done": true }));
            },
        )
        .await;
    if let Err(e) = res {
        INSTALLING.store(false, SeqCst);
        return Err(friendly(e));
    }
    app.restart();
}
