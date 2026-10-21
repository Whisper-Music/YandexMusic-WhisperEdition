use crate::net::url_ok;
use crate::secret;
use std::time::Duration;
use tauri::{webview::NewWindowResponse, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const AUTH_URL: &str =
    "https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d";

fn token_looks_valid(t: &str) -> bool {
    (10..=300).contains(&t.len())
        && t.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

#[tauri::command]
pub fn token_exists() -> Result<bool, String> {
    secret::get().map(|t| t.is_some())
}

#[tauri::command]
pub fn token_store(token: String) -> Result<(), String> {
    let t = token.trim();
    if !token_looks_valid(t) {
        return Err("Токен выглядит неправильно: проверь, что скопировал его целиком".into());
    }
    secret::set(t)
}

/// Выход: токен удаляется из системного хранилища, а заодно стираются cookies Яндекса.
/// Окно входа в прошлых версиях делило профиль с главным окном, и вход в Яндекс (cookies passport.yandex.ru)
/// оставался в нём после выхода — при следующем входе Яндекс сразу отдавал токен, не спрашивая пароль.
/// Теперь окно входа открывается в режиме инкогнито (ничего не сохраняет), а эта чистка убирает то, что осталось.
#[tauri::command]
pub async fn token_clear(app: AppHandle) -> Result<(), String> {
    secret::clear()?;
    if let Err(e) = forget_yandex_cookies(&app).await {
        eprintln!("Не удалось стереть cookies Яндекса: {e}");      // токена уже нет — выход всё равно выполнен
    }
    Ok(())
}

/// Домен cookie относится к Яндексу: yandex.ru, passport.yandex.ru, yandex.com, ya.ru и т. п.
fn yandex_domain(d: &str) -> bool {
    let d = d.trim_start_matches('.').to_ascii_lowercase();
    d == "ya.ru" || d.ends_with(".ya.ru") || d.split('.').any(|label| label == "yandex")
}

async fn forget_yandex_cookies(app: &AppHandle) -> Result<usize, String> {
    let Some(w) = app.get_webview_window("main") else { return Ok(0) };
    // с cookies WebView2 работаем не из главного потока (иначе возможна взаимоблокировка, см. документацию Tauri)
    tauri::async_runtime::spawn_blocking(move || {
        let mut n = 0;
        for c in w.cookies().map_err(|e| e.to_string())? {
            if c.domain().is_some_and(yandex_domain) && w.delete_cookie(c).is_ok() {
                n += 1;
            }
        }
        Ok(n)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn random_state() -> Result<String, String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).map_err(|e| format!("Нет источника случайных чисел: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn auth_nav_allowed(u: &tauri::Url) -> bool {
    url_ok(u)
}

/// Токен из адреса вида `https://oauth.yandex.ru/...#access_token=...&state=...`
/// (только с доверенного адреса и только при совпавшем state).
fn token_from_url(u: &tauri::Url, expected_state: &str) -> Option<String> {
    let frag = u.fragment()?;
    if !frag.contains("access_token=") || !auth_nav_allowed(u) {
        return None;
    }
    let fake = tauri::Url::parse(&format!("https://x.invalid/?{frag}")).ok()?;
    let (mut token, mut got_state) = (None, None);
    for (k, v) in fake.query_pairs() {
        match k.as_ref() {
            "access_token" => token = Some(v.into_owned()),
            "state" => got_state = Some(v.into_owned()),
            _ => {}
        }
    }
    match (token, got_state) {
        (Some(t), Some(s)) if same(&s, expected_state) => Some(t),
        _ => None,
    }
}

#[tauri::command]
pub async fn yandex_login(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("yandex-auth") {
        let _ = w.set_focus();
        return Err("Окно входа уже открыто".into());
    }

    let state = random_state()?;
    let expected = state.clone();
    let (tx, mut rx) = tauri::async_runtime::channel::<String>(4);
    let tx_nav = tx.clone();
    let tx_poll = tx.clone();
    let tx_close = tx;
    let expected_poll = state.clone();

    let url: tauri::Url = format!("{AUTH_URL}&state={state}")
        .parse()
        .map_err(|_| "Неверный адрес входа".to_string())?;

    let win = WebviewWindowBuilder::new(&app, "yandex-auth", WebviewUrl::External(url))
        .title("Вход через Яндекс")
        // ничего не сохраняет (cookies, кэш): после выхода из аккаунта в нём придётся войти заново
        .incognito(true)
        .inner_size(520.0, 720.0)
        .center()
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_navigation(move |u| {
            if u.fragment().is_some_and(|f| f.contains("access_token=")) {
                if let Some(t) = token_from_url(u, &expected) {
                    let _ = tx_nav.try_send(t);
                }
                return false;
            }
            auth_nav_allowed(u)
        })
        .build()
        .map_err(|e| e.to_string())?;

    win.on_window_event(move |ev| {
        if matches!(ev, WindowEvent::Destroyed) {
            let _ = tx_close.try_send(String::new());
        }
    });

    // Запасной путь. В Windows (WebView2) переход на адрес с токеном всегда виден в on_navigation.
    // В Linux (WebKitGTK) переход, который меняет только часть адреса после «#», через
    // on_navigation может не пройти — поэтому дополнительно смотрим на текущий адрес окна.
    if cfg!(not(windows)) {
        let poll_win = win.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio_sleep(Duration::from_millis(300)).await;
                let Ok(u) = poll_win.url() else { break };
                if let Some(t) = token_from_url(&u, &expected_poll) {
                    let _ = tx_poll.try_send(t);
                    break;
                }
            }
        });
    } else {
        drop((tx_poll, expected_poll));
    }

    let got = rx.recv().await;
    let _ = win.close();

    match got {
        Some(t) if token_looks_valid(&t) => secret::set(&t),
        Some(t) if t.is_empty() => Err("Окно входа закрыто".into()),
        Some(_) => Err("Яндекс вернул токен в неожиданном виде".into()),
        None => Err("Окно входа закрыто".into()),
    }
}

/// Пауза без блокировки потока (async_runtime в Tauri — это tokio, но сам tokio в зависимостях нет).
async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}
