use crate::secret;
use std::time::Duration;
use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri::{webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder, WindowEvent};

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
    crate::net::forget_uid();
    secret::set(t)
}

/// Выход: токен удаляется из системного хранилища, а заодно стираются cookies Яндекса.
/// Окно входа в прошлых версиях делило профиль с главным окном, и вход в Яндекс (cookies passport.yandex.ru)
/// оставался в нём после выхода — при следующем входе Яндекс сразу отдавал токен, не спрашивая пароль.
/// Теперь окно входа открывается в режиме инкогнито (ничего не сохраняет), а эта чистка убирает то, что осталось.
#[tauri::command]
pub async fn token_clear(app: AppHandle) -> Result<(), String> {
    secret::clear()?;
    crate::net::forget_uid();
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

// ---------------------------------------------------------------------------
// Куда может ходить окно входа (аудит F-04). Раньше годился любой адрес, которому доверяет net::url_ok
// (все поддомены yandex.ru/.net/.com…). Теперь — только страницы входа, перечисленные явно, без портов,
// логинов в адресе и http. Капча Яндекса живёт на корневом домене, поэтому для него разрешены лишь её пути.
// ---------------------------------------------------------------------------

const AUTH_TLDS: [&str; 4] = ["ru", "com", "by", "kz"];
/// Поддомены yandex.<tld>, через которые проходит вход: OAuth, Паспорт и единый вход (SSO) между доменами.
const AUTH_SUBS: [&str; 5] = ["oauth", "passport", "sso.passport", "sso", "id"];
const CAPTCHA_PATHS: [&str; 2] = ["/showcaptcha", "/checkcaptcha"];

fn plain_https(u: &tauri::Url) -> bool {
    u.scheme() == "https" && u.username().is_empty() && u.password().is_none() && u.port().is_none()
}

/// Хост вида <sub>.yandex.<tld> (sub = "" — корень yandex.<tld>).
fn host_is(u: &tauri::Url, subs: &[&str]) -> bool {
    let Some(h) = u.host_str().map(str::to_ascii_lowercase) else { return false };
    AUTH_TLDS.iter().any(|tld| {
        subs.iter().any(|s| if s.is_empty() { h == format!("yandex.{tld}") } else { h == format!("{s}.yandex.{tld}") })
    })
}

pub fn auth_nav_allowed(u: &tauri::Url) -> bool {
    if !plain_https(u) {
        return false;
    }
    if host_is(u, &AUTH_SUBS) {
        return true;
    }
    host_is(u, &[""]) && CAPTCHA_PATHS.iter().any(|p| u.path() == *p || u.path().starts_with(&format!("{p}/")))
}

/// Адрес, на который Яндекс возвращает токен: https://music.yandex.ru/#access_token=… (адрес перенаправления
/// клиента Яндекс Музыки) или страница кода OAuth. Токен с любого другого адреса не принимается.
fn callback_ok(u: &tauri::Url) -> bool {
    plain_https(u)
        && u.query().is_none()
        && ((host_is(u, &["music"]) && u.path() == "/")
            || (host_is(u, &["oauth"]) && matches!(u.path(), "/verification_code" | "/authorize")))
}

/// Токен из адреса вида `https://oauth.yandex.ru/...#access_token=...&state=...`
/// (только с доверенного адреса и только при совпавшем state).
fn token_from_url(u: &tauri::Url, expected_state: &str) -> Option<String> {
    let frag = u.fragment()?;
    if !frag.contains("access_token=") || !callback_ok(u) {
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

#[cfg(desktop)]
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
        Some(t) if token_looks_valid(&t) => {
            crate::net::forget_uid();
            secret::set(&t)
        }
        Some(t) if t.is_empty() => Err("Окно входа закрыто".into()),
        Some(_) => Err("Яндекс вернул токен в неожиданном виде".into()),
        None => Err("Окно входа закрыто".into()),
    }
}

// ---------------------------------------------------------------------------
// Вход на телефоне. Второго окна там нет, поэтому страница входа Яндекса открывается прямо в главном окне:
// yandex_login запоминает state и адрес приложения и уходит на oauth.yandex.ru, а nav-guard (lib.rs)
// пропускает в главном окне только страницы входа (auth_nav_allowed) — и только пока вход начат.
// Переход на адрес с токеном не выполняется: токен забирается из адреса (та же проверка state и
// callback_ok), и окно возвращается на страницу приложения — она загрузится заново уже со входом.
// Кнопка «Назад» на телефоне просто вернёт на страницу приложения без входа.
// ---------------------------------------------------------------------------

#[cfg(mobile)]
struct Pending {
    state: String,
    back: tauri::Url,
}
#[cfg(mobile)]
static PENDING: std::sync::Mutex<Option<Pending>> = std::sync::Mutex::new(None);

/// Можно ли главному окну телефона перейти на этот адрес (кроме своих страниц — их пропускает lib.rs).
#[cfg(mobile)]
pub fn mobile_nav(webview: &tauri::Webview, u: &tauri::Url) -> bool {
    if u.fragment().is_some_and(|f| f.contains("access_token=")) {
        mobile_finish(webview.app_handle(), u);
        return false;
    }
    PENDING.lock().map(|p| p.is_some()).unwrap_or(false) && auth_nav_allowed(u)
}

/// Адрес с токеном: проверить, сохранить и вернуть окно в приложение. true — вход завершён (успешно или нет).
#[cfg(mobile)]
fn mobile_finish(app: &AppHandle, u: &tauri::Url) -> bool {
    let Some(p) = PENDING.lock().ok().and_then(|mut g| g.take()) else { return false };
    match token_from_url(u, &p.state) {
        Some(t) if token_looks_valid(&t) => {
            crate::net::forget_uid();
            if let Err(e) = secret::set(&t) {
                eprintln!("Не удалось сохранить токен: {e}");
            }
        }
        _ => eprintln!("Яндекс вернул токен с чужого адреса или без state — вход не принят"),
    }
    // уходить со страницы из обработчика перехода нельзя — переход ещё не закончен; делаем это чуть позже
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.navigate(p.back);
        }
    });
    true
}

#[cfg(mobile)]
#[tauri::command]
pub async fn yandex_login(app: AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("Нет главного окна")?;
    let back = w.url().map_err(|e| e.to_string())?;
    let state = random_state()?;
    let url: tauri::Url = format!("{AUTH_URL}&state={state}")
        .parse()
        .map_err(|_| "Неверный адрес входа".to_string())?;
    *PENDING.lock().map_err(|_| "Вход сломался — перезапусти приложение")? = Some(Pending { state, back: back.clone() });
    w.navigate(url).map_err(|e| e.to_string())?;
    // Запасной путь, как для Linux в окне входа: переход, который меняет только часть адреса после «#»,
    // через on_navigation может не пройти — смотрим на текущий адрес окна, пока вход не закончен.
    tauri::async_runtime::spawn(async move {
        let mut left = false; // окно уже ушло со страницы приложения на страницу входа
        loop {
            tokio_sleep(Duration::from_millis(400)).await;
            if PENDING.lock().map(|p| p.is_none()).unwrap_or(true) {
                break;
            }
            let Ok(u) = w.url() else { break };
            if u.fragment().is_some_and(|f| f.contains("access_token=")) && mobile_finish(w.app_handle(), &u) {
                break;
            }
            if !crate::app_page(&u) {
                left = true;
            } else if left {
                // вернулись в приложение кнопкой «Назад» — вход отменён, чужие страницы снова закрыты
                if let Ok(mut g) = PENDING.lock() {
                    *g = None;
                }
                break;
            }
        }
    });
    Ok(())
}

/// Пауза без блокировки потока (async_runtime в Tauri — это tokio, но сам tokio в зависимостях нет).
async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    fn u(s: &str) -> tauri::Url { s.parse().unwrap() }

    #[test]
    fn nav() {
        assert!(auth_nav_allowed(&u("https://oauth.yandex.ru/authorize?response_type=token&client_id=x")));
        assert!(auth_nav_allowed(&u("https://passport.yandex.ru/auth?retpath=x")));
        assert!(auth_nav_allowed(&u("https://sso.passport.yandex.ru/push?uuid=1")));
        assert!(auth_nav_allowed(&u("https://sso.yandex.by/install?uuid=1")));
        assert!(auth_nav_allowed(&u("https://yandex.ru/showcaptcha?retpath=x")));
        assert!(!auth_nav_allowed(&u("https://yandex.ru/search/?text=x")));
        assert!(!auth_nav_allowed(&u("https://music.yandex.ru/")));
        assert!(!auth_nav_allowed(&u("https://disk.yandex.ru/")));
        assert!(!auth_nav_allowed(&u("https://storage.mds.yandex.net/x")));
        assert!(!auth_nav_allowed(&u("https://evil.oauth.yandex.ru/")));
        assert!(!auth_nav_allowed(&u("http://oauth.yandex.ru/authorize")));
        assert!(!auth_nav_allowed(&u("https://oauth.yandex.ru:8443/authorize")));
        assert!(!auth_nav_allowed(&u("https://a:b@oauth.yandex.ru/authorize")));
        assert!(!auth_nav_allowed(&u("https://oauth.yandex.ru.evil.com/")));
    }

    #[test]
    fn callback() {
        let st = "abc";
        let good = u("https://music.yandex.ru/#access_token=y0_AAAAtoken1234&token_type=bearer&state=abc");
        assert_eq!(token_from_url(&good, st).as_deref(), Some("y0_AAAAtoken1234"));
        assert!(token_from_url(&good, "other").is_none());
        assert!(token_from_url(&u("https://music.yandex.ru/#access_token=y0_AAAA&token_type=bearer"), st).is_none());
        assert!(token_from_url(&u("https://music.yandex.ru/album/1#access_token=y0_AAAA&state=abc"), st).is_none());
        assert!(token_from_url(&u("https://disk.yandex.ru/#access_token=y0_AAAA&state=abc"), st).is_none());
        assert!(token_from_url(&u("https://passport.yandex.ru/#access_token=y0_AAAA&state=abc"), st).is_none());
        assert!(token_from_url(&u("http://music.yandex.ru/#access_token=y0_AAAA&state=abc"), st).is_none());
        assert!(token_from_url(&u("https://music.yandex.ru/?x=1#access_token=y0_AAAA&state=abc"), st).is_none());
        assert!(token_from_url(&u("https://oauth.yandex.ru/verification_code#access_token=y0_AAAA&state=abc"), st).is_some());
    }
}
