// src-tauri/src/auth.rs — токен и вход. Заменяет прежний auth.rs.
//
// Токен хранится только в системном хранилище и никогда не передаётся в JavaScript:
//  * вход одной кнопкой: окно авторизации Яндекса -> токен забирает Rust -> сразу кладёт в хранилище;
//  * ручной ввод: токен один раз уходит из поля ввода в token_store;
//  * заголовок Authorization к API подставляет net::http_request.
// Команд с произвольным ключом больше нет (нельзя прочитать/перезаписать чужой секрет).

use crate::net::{host_trusted, KEYRING_ACCOUNT, KEYRING_SERVICE};
use keyring::Entry;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const AUTH_URL: &str =
    "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d";

fn entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

fn token_looks_valid(t: &str) -> bool {
    (10..=300).contains(&t.len())
        && t.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Есть ли сохранённый токен (сам токен наружу не отдаётся).
#[tauri::command]
pub fn token_exists() -> Result<bool, String> {
    match entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Сохранить токен (ручной ввод).
#[tauri::command]
pub fn token_store(token: String) -> Result<(), String> {
    let t = token.trim();
    if !token_looks_valid(t) {
        return Err("Токен выглядит неправильно: проверь, что скопировал его целиком".into());
    }
    entry()?.set_password(t).map_err(|e| e.to_string())
}

/// Удалить токен (выход). Ошибка возвращается наружу, чтобы интерфейс не делал вид, что вышел.
#[tauri::command]
pub fn token_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Случайная строка state (защита от подмены результата входа). Источник случайности — ключи RandomState,
/// которые Rust берёт у операционной системы; отдельных зависимостей не нужно.
fn random_state() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut s = String::new();
    for i in 0..3u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        s.push_str(&format!("{:016x}", h.finish()));
    }
    s
}

/// Вход одной кнопкой. После успеха токен уже лежит в хранилище, возвращается только Ok(()).
/// После входа Яндекс перенаправляет на https://<домен Яндекса>/#access_token=...&state=...
/// Мы перехватываем этот переход до загрузки страницы, проверяем https, домен и state, забираем токен
/// и отменяем переход. Окно входа — внешняя страница без доступа к командам приложения.
#[tauri::command]
pub async fn yandex_login(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("yandex-auth") {
        let _ = w.set_focus();
        return Err("Окно входа уже открыто".into());
    }

    let state = random_state();
    let expected = state.clone();
    let (tx, mut rx) = tauri::async_runtime::channel::<String>(4);
    let tx_nav = tx.clone();
    let tx_close = tx;

    let url: tauri::Url = format!("{AUTH_URL}&state={state}")
        .parse()
        .map_err(|_| "Неверный адрес входа".to_string())?;

    let win = WebviewWindowBuilder::new(&app, "yandex-auth", WebviewUrl::External(url))
        .title("Вход через Яндекс")
        .inner_size(520.0, 720.0)
        .center()
        .on_navigation(move |u| {
            if let Some(frag) = u.fragment() {
                if frag.contains("access_token=") {
                    // токен принимаем только с https-страницы доверенного домена и только с нашим state
                    let origin_ok = u.scheme() == "https"
                        && u.host_str().map(host_trusted).unwrap_or(false);
                    if origin_ok {
                        if let Ok(fake) = tauri::Url::parse(&format!("https://x.invalid/?{frag}")) {
                            let (mut token, mut got_state) = (None, None);
                            for (k, v) in fake.query_pairs() {
                                match k.as_ref() {
                                    "access_token" => token = Some(v.into_owned()),
                                    "state" => got_state = Some(v.into_owned()),
                                    _ => {}
                                }
                            }
                            if let (Some(t), Some(s)) = (token, got_state) {
                                if s == expected {
                                    let _ = tx_nav.try_send(t);
                                }
                            }
                        }
                    }
                    return false; // страницу с токеном в адресе никогда не открываем
                }
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    // окно закрыли, не дождавшись входа — сообщаем об отмене
    win.on_window_event(move |ev| {
        if matches!(ev, WindowEvent::Destroyed) {
            let _ = tx_close.try_send(String::new());
        }
    });

    let got = rx.recv().await;
    let _ = win.close();

    match got {
        Some(t) if token_looks_valid(&t) => entry()?.set_password(&t).map_err(|e| e.to_string()),
        Some(t) if t.is_empty() => Err("Окно входа закрыто".into()),
        Some(_) => Err("Яндекс вернул токен в неожиданном виде".into()),
        None => Err("Окно входа закрыто".into()),
    }
}
