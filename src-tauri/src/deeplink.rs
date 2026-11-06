// Ссылки whisper:// — приглашения в комнату «Слушать вместе» (src/core/together.js) и ссылки на музыку (src/share.js).
//
//   whisper://room/K7QH2M          — войти в комнату K7QH2M
//   whisper://track/12345          — трек (можно с альбомом: whisper://track/12345:678)
//   whisper://album/678            — альбом
//   whisper://artist/9101          — артист
//
// Друзьям отправляется https-ссылка на страницу архива (https://origin.whisper-archive.ru/join/K7QH2M,
// …/s/track/12345:678 — в мессенджерах кликабельны только http/https): страница сама открывает whisper://…,
// а система передаёт ссылку сюда.
//
// Схему регистрирует установщик (tauri.conf.json → plugins.deep-link.desktop.schemes). В отладочной сборке и в Linux
// (AppImage не ставится установщиком) приложение регистрирует её само при запуске — так ссылки работают и в `tauri dev`.
// Приложение уже открыто — ссылку перехватывает single-instance (feature "deep-link") и отдаёт сюда же, вторая копия
// не запускается.
//
// Из ссылки берётся только код комнаты или номер по строгому шаблону; всё остальное игнорируется. Вход в комнату
// подтверждает пользователь в окне приложения; ссылка на музыку только открывает страницу или трек — ничего не меняет.
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

/// Код из последней ссылки-приглашения и последняя ссылка на музыку, которые окно ещё не забрало
/// (приложение запускалось по ссылке и страница грузится).
#[derive(Default)]
pub struct Pending {
    room: Mutex<Option<String>>,
    open: Mutex<Option<String>>,
}

/// host и сегменты пути; поддерживает и whisper:/room/CODE без «//».
fn parts(url: &Url) -> Option<(String, Vec<String>)> {
    if !url.scheme().eq_ignore_ascii_case("whisper") {
        return None;
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    let mut segs: Vec<String> = url.path().split('/').filter(|s| !s.is_empty()).map(String::from).collect();
    if host.is_empty() {
        if segs.is_empty() {
            return None;
        }
        let h = segs.remove(0).to_ascii_lowercase();
        return Some((h, segs));
    }
    Some((host, segs))
}

/// whisper://room/K7QH2M → "K7QH2M". Код — 4–12 латинских букв и цифр (как у сервера комнат), регистр не важен.
pub fn room_code(url: &Url) -> Option<String> {
    let (host, segs) = parts(url)?;
    if (host != "room" && host != "join") || segs.len() != 1 {
        return None;
    }
    let code = segs[0].to_ascii_uppercase();
    if (4..=12).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) {
        Some(code)
    } else {
        None
    }
}

fn digits(s: &str) -> bool {
    (1..=15).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit())
}

/// whisper://track/12345:678 → "track/12345:678"; album и artist — только номер. Иначе None.
pub fn open_target(url: &Url) -> Option<String> {
    let (kind, segs) = parts(url)?;
    if segs.len() != 1 {
        return None;
    }
    let id = segs[0].as_str();
    let ok = match kind.as_str() {
        "track" => match id.split_once(':') {
            Some((t, a)) => digits(t) && digits(a),
            None => digits(id),
        },
        "album" | "artist" => digits(id),
        _ => false,
    };
    ok.then(|| format!("{kind}/{id}"))
}

fn put(slot: &Mutex<Option<String>>, v: String) {
    if let Ok(mut g) = slot.lock() {
        *g = Some(v);
    }
}

// show: ссылка пришла в уже работающее приложение — достать окно из трея / из-под других окон.
// При запуске по ссылке окно ещё не готово (его показывает winstate::restore), поэтому только запоминаем.
fn handle(app: &AppHandle, urls: &[Url], show: bool) {
    let Some(p) = app.try_state::<Pending>() else { return };
    if let Some(code) = urls.iter().find_map(room_code) {
        put(&p.room, code.clone());
        if show {
            let _ = app.emit("room-link", code);
            crate::show_main(app);
        }
        return;
    }
    if let Some(target) = urls.iter().find_map(open_target) {
        put(&p.open, target.clone());
        if show {
            let _ = app.emit("open-link", target);
            crate::show_main(app);
        }
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
    state.room.lock().ok().and_then(|mut g| g.take())
}

/// То же для ссылок на музыку: "track/12345:678", "album/678", "artist/9101" (событие open-link).
#[tauri::command]
pub fn open_link_take(state: tauri::State<Pending>) -> Option<String> {
    state.open.lock().ok().and_then(|mut g| g.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(s: &str) -> Option<String> {
        room_code(&Url::parse(s).unwrap())
    }
    fn open(s: &str) -> Option<String> {
        open_target(&Url::parse(s).unwrap())
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

    #[test]
    fn music() {
        assert_eq!(open("whisper://track/12345").as_deref(), Some("track/12345"));
        assert_eq!(open("whisper://track/12345:678/").as_deref(), Some("track/12345:678"));
        assert_eq!(open("WHISPER://Album/678").as_deref(), Some("album/678"));
        assert_eq!(open("whisper:/artist/9101").as_deref(), Some("artist/9101"));
        assert_eq!(open("whisper://track/12a"), None);
        assert_eq!(open("whisper://track/1:"), None);
        assert_eq!(open("whisper://album/1:2"), None);
        assert_eq!(open("whisper://playlist/1"), None);
        assert_eq!(open("whisper://track/1/2"), None);
        assert_eq!(open("whisper://room/K7QH2M"), None);
        assert_eq!(open("https://music.yandex.ru/track/1"), None);
    }
}
