// src-tauri/src/auth.rs — безопасное хранение токена и вход одной кнопкой.
//
// ПОДКЛЮЧЕНИЕ (три шага):
// 1) src-tauri/Cargo.toml, раздел [dependencies]:
//      keyring = { version = "3", features = ["windows-native"] }
//    (без указания windows-native keyring молча пишет «в никуда» — фича нужна обязательно)
// 2) В начале src-tauri/src/lib.rs (или main.rs, где у тебя run()):
//      mod auth;
// 3) В .invoke_handler(tauri::generate_handler![ ... ]) к уже существующим командам добавь:
//      auth::secret_get, auth::secret_set, auth::secret_delete, auth::yandex_login

use keyring::Entry;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const SERVICE: &str = "WhisperEdition";
const AUTH_URL: &str =
    "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d";

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Положить секрет в системное хранилище (Windows: Диспетчер учётных данных).
#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

/// Прочитать секрет; если его нет — Ok(None).
#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Удалить секрет (если его и не было — не ошибка).
#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Открывает окно авторизации Яндекса и сам забирает токен.
/// После входа Яндекс перенаправляет на адрес вида https://music.yandex.ru/#access_token=...&...
/// Мы перехватываем этот переход ещё до загрузки страницы, достаём токен из фрагмента адреса,
/// отменяем переход и закрываем окно. Окно входа — внешняя страница без доступа к командам приложения.
#[tauri::command]
pub async fn yandex_login(app: AppHandle) -> Result<String, String> {
    if let Some(w) = app.get_webview_window("yandex-auth") {
        let _ = w.set_focus();
        return Err("Окно входа уже открыто".into());
    }

    let (tx, mut rx) = tauri::async_runtime::channel::<String>(4);
    let tx_nav = tx.clone();
    let tx_close = tx;

    let url: tauri::Url = AUTH_URL
        .parse()
        .map_err(|_| "Неверный адрес входа".to_string())?;

    let win = WebviewWindowBuilder::new(&app, "yandex-auth", WebviewUrl::External(url))
        .title("Вход через Яндекс")
        .inner_size(520.0, 720.0)
        .center()
        .on_navigation(move |u| {
            if let Some(frag) = u.fragment() {
                for part in frag.split('&') {
                    if let Some(t) = part.strip_prefix("access_token=") {
                        let _ = tx_nav.try_send(t.to_string());
                        return false; // страницу с токеном не открываем
                    }
                }
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    // если окно закрыли крестиком, не дождавшись входа — сообщаем об отмене
    win.on_window_event(move |ev| {
        if matches!(ev, WindowEvent::Destroyed) {
            let _ = tx_close.try_send(String::new());
        }
    });

    let got = rx.recv().await;
    let _ = win.close();

    match got {
        Some(t) if !t.is_empty() => Ok(t),
        _ => Err("Окно входа закрыто".into()),
    }
}
