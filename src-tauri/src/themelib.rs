//! Библиотека тем: список и файлы тем из репозитория GitHub Whisper-Music/whisper-themes.
//!
//! Страница сама в сеть не ходит (CSP), поэтому файлы приносит эта команда. Она умеет только одно —
//! скачать файл из ветки main этого репозитория, и только трёх видов:
//! * `index.json`                              — список тем (до 1 МБ);
//! * `previews/<папка>/<имя>.<jpg|png|webp>`   — картинка для карточки (до 2 МБ);
//! * `themes/<папка>/<имя>.wmt`                — сама тема (до 64 МБ, как в формате .wmt).
//! Папка — одна из папок библиотеки (CATEGORIES), имя — как manifest.id темы: a–z, 0–9, «-».
//! Пути без папки (`themes/<имя>.wmt`, как было до папок) тоже разрешены. Перенаправления — только внутри того же хоста.
//! Тема из библиотеки дальше проходит ту же проверку, что и файл, загруженный вручную (theme.js):
//! никакого кода, внешних адресов и @import.

use std::{sync::OnceLock, time::Duration};
use tauri_plugin_http::reqwest::{redirect, Client};

const HOST: &str = "raw.githubusercontent.com";
const BASE: &str = "https://raw.githubusercontent.com/Whisper-Music/whisper-themes/main/";

const MB: usize = 1024 * 1024;

/// Папки библиотеки: темы Whisper Music, темы пользователей, темы в стиле артистов.
/// Тот же список — в src/themelib.js (CATS) и в tools/build-index.js репозитория тем.
const CATEGORIES: [&str; 3] = ["whisper", "community", "artists"];

fn client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .redirect(redirect::Policy::custom(|a| {
                if a.previous().len() < 3 && a.url().scheme() == "https" && a.url().host_str() == Some(HOST) {
                    a.follow()
                } else {
                    a.error("перенаправление за пределы репозитория тем")
                }
            }))
            .user_agent(concat!("yandex-desktop/", env!("CARGO_PKG_VERSION"), " (theme library)"))
            .build()
            .expect("не удалось создать HTTP-клиент библиотеки тем")
    })
}

/// Имя файла темы или превью — как manifest.id: начинается с буквы или цифры, дальше a–z, 0–9, «-», до 48 символов.
fn name_ok(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 48
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

/// `<папка>/<файл>` или просто `<файл>` → имя файла; неизвестная папка или вложенность глубже — None.
fn in_folder(rest: &str) -> Option<&str> {
    match rest.split_once('/') {
        None => Some(rest),
        Some((cat, file)) => (CATEGORIES.contains(&cat) && !file.contains('/')).then_some(file),
    }
}

/// Разрешённый путь в репозитории → наибольший размер файла. Всё остальное — None.
fn limit_for(path: &str) -> Option<usize> {
    if path == "index.json" {
        return Some(MB);
    }
    if let Some(rest) = path.strip_prefix("themes/") {
        return in_folder(rest)?.strip_suffix(".wmt").filter(|n| name_ok(n)).map(|_| 64 * MB);
    }
    if let Some(rest) = path.strip_prefix("previews/") {
        let (n, ext) = in_folder(rest)?.rsplit_once('.')?;
        return (name_ok(n) && matches!(ext, "jpg" | "jpeg" | "png" | "webp")).then_some(2 * MB);
    }
    None
}

#[tauri::command]
pub async fn themelib_fetch(path: String) -> Result<tauri::ipc::Response, String> {
    let max = limit_for(&path).ok_or("Такого файла в библиотеке тем быть не может")?;
    let mut resp = client()
        .get(format!("{BASE}{path}"))
        .send()
        .await
        .map_err(|e| format!("Библиотека тем недоступна: {e}"))?;
    match resp.status().as_u16() {
        200 => {}
        404 => return Err("В библиотеке нет такого файла".into()),
        s => return Err(format!("Библиотека тем: HTTP {s}")),
    }
    if resp.content_length().is_some_and(|n| n > max as u64) {
        return Err("Файл в библиотеке слишком большой".into());
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() + chunk.len() > max {
            return Err("Файл в библиотеке слишком большой".into());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(tauri::ipc::Response::new(buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths() {
        assert_eq!(limit_for("index.json"), Some(MB));
        assert_eq!(limit_for("themes/chalk.wmt"), Some(64 * MB));
        assert_eq!(limit_for("themes/retro-tv.wmt"), Some(64 * MB));
        assert_eq!(limit_for("previews/chalk.jpg"), Some(2 * MB));
        assert_eq!(limit_for("previews/a1.webp"), Some(2 * MB));
        // папки библиотеки
        assert_eq!(limit_for("themes/whisper/spetsnaz.wmt"), Some(64 * MB));
        assert_eq!(limit_for("themes/community/my-theme.wmt"), Some(64 * MB));
        assert_eq!(limit_for("themes/artists/kino.wmt"), Some(64 * MB));
        assert_eq!(limit_for("previews/whisper/chalk.jpg"), Some(2 * MB));
        assert_eq!(limit_for("previews/artists/kino.png"), Some(2 * MB));
        for bad in [
            "", "README.md", "themes/../index.json", "themes/Chalk.wmt", "themes/-x.wmt", "themes/a/b.wmt",
            "themes/chalk.zip", "previews/chalk.svg", "previews/.jpg", "previews/x.jpg/../y.jpg",
            "/index.json", "index.json?x", "themes/chalk.wmt#", "previews/a b.png", "themes/ chalk.wmt",
            "https://evil.com/x", "themes/%2e%2e.wmt",
            "themes/other/x.wmt", "themes/Whisper/x.wmt", "themes/whisper/a/b.wmt", "themes/whisper/../x.wmt",
            "themes/whisper/.wmt", "themes/whisper/", "themes//x.wmt", "previews/whisper/x.svg",
            "previews/other/x.jpg", "previews/artists/a/b.jpg", "themes/whisper/x.wmt/", "index.json/whisper",
        ] {
            assert_eq!(limit_for(bad), None, "{bad}");
        }
        assert!(!name_ok(&"a".repeat(49)));
        assert!(name_ok(&"a".repeat(48)));
    }
}
