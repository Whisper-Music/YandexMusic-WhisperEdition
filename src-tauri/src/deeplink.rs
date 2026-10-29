// Ссылки whisper:// — приглашения в комнату «Слушать вместе» (src/together.js).
//
//   whisper://room/K7QH2M      — войти в комнату K7QH2M
//
// Друзьям отправляется https-ссылка https://origin.whisper-archive.ru/join/K7QH2M (в мессенджерах кликабельны только
// http/https) — страница архива сама открывает whisper://room/K7QH2M, а система передаёт её сюда.
//
// Схему регистрирует установщик (tauri.conf.json → plugins.deep-link.desktop.schemes). В отладочной сборке и в Linux
// (AppImage не ставится установщиком) приложение регистрирует её само при запуске — так ссылки работают и в `tauri dev`.
// Приложение уже открыто — ссылку перехватывает single-instance (feature "deep-link") и отдаёт сюда же, вторая копия
// не запускается.
//
// Из ссылки берётся только код комнаты по строгому шаблону; всё остальное игнорируется. Сам вход в комнату
// подтверждает пользователь в окне приложения — ссылка ничего не делает молча.
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

/// Код из последней ссылки, который окно ещё не забрало (приложение запускалось по ссылке и страница грузится).
#[derive(Default)]
pub struct Pending(Mutex<Option<String>>);

/// whisper://room/K7QH2M → "K7QH2M". Код — 4–12 латинских букв и цифр (как у сервера комнат), регистр не важен.
pub fn room_code(url: &Url) -> Option<String> {
    if !url.scheme().eq_ignore_ascii_case("whisper") {
        return None;
    }
    // whisper://room/CODE: «room» — это host, код — первый сегмент пути
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    let mut parts = url.path().split('/').filter(|s| !s.is_empty());
    let raw = if host == "room" || host == "join" {
        parts.next()?
    } else {
        // на всякий случай и whisper:/room/CODE без «//»
        match parts.next()? {
            p if p.eq_ignore_ascii_case("room") || p.eq_ignore_ascii_case("join") => parts.next()?,
            _ => return None,
        }
    };
    if parts.next().is_some() {
        return None;
    }
    let code = raw.to_ascii_uppercase();
    if (4..=12).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) {
        Some(code)
    } else {
        None
    }
}

// show: ссылка пришла в уже работающее приложение — достать окно из трея / из-под других окон.
// При запуске по ссылке окно ещё не готово (его показывает winstate::restore), поэтому только запоминаем код.
fn handle(app: &AppHandle, urls: &[Url], show: bool) {
    let Some(code) = urls.iter().find_map(room_code) else { return };
    if let Some(p) = app.try_state::<Pending>() {
        if let Ok(mut g) = p.0.lock() {
            *g = Some(code.clone());
        }
    }
    if show {
        let _ = app.emit("room-link", code);
        crate::show_main(app);
    }
}

/// Вызывать в setup(): подписка на ссылки, ссылка, с которой запущено приложение, и регистрация схемы.
pub fn init(app: &AppHandle) {
    app.manage(Pending::default());
    let h = app.clone();
    app.deep_link().on_open_url(move |event| handle(&h, &event.urls(), true));
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        handle(app, &urls, false);
    }
    // установщик Windows (NSIS/MSI) и пакеты .deb/.rpm прописывают схему сами; в отладке и в AppImage — регистрируемся здесь
    #[cfg(any(debug_assertions, target_os = "linux"))]
    {
        let _ = app.deep_link().register_all();
    }
}

/// Окно забирает код из ссылки (один раз): при старте — та, с которой запустили; дальше — по событию room-link.
#[tauri::command]
pub fn room_link_take(state: tauri::State<Pending>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(s: &str) -> Option<String> {
        room_code(&Url::parse(s).unwrap())
    }

    #[test]
    fn links() {
        assert_eq!(code("whisper://room/K7QH2M").as_deref(), Some("K7QH2M"));
        assert_eq!(code("whisper://room/k7qh2m/").as_deref(), Some("K7QH2M"));
        assert_eq!(code("WHISPER://join/ABCD").as_deref(), Some("ABCD"));
        assert_eq!(code("whisper:/room/ABCD12").as_deref(), Some("ABCD12"));
        assert_eq!(code("whisper://room/AB"), None); // короче 4
        assert_eq!(code("whisper://room/ABC-12"), None); // недопустимый символ
        assert_eq!(code("whisper://room/ABCD/extra"), None);
        assert_eq!(code("whisper://album/123"), None);
        assert_eq!(code("https://origin.whisper-archive.ru/join/K7QH2M"), None);
    }
}
