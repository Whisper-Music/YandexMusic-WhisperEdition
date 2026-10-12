// src-tauri/src/net.rs — сетевые команды с ограничениями. Заменяет http_request и fetch_bytes из lib.rs.
//
// Что изменилось по сравнению с «универсальным прокси»:
//  * только HTTPS, без логина в адресе и без нестандартных портов;
//  * только домены Яндекса (граница — точка: «evilyandex.net» не пройдёт), перенаправления проверяются так же;
//  * только методы GET и POST и короткий белый список заголовков;
//  * заголовок Authorization берётся ТОЛЬКО из системного хранилища и ТОЛЬКО для api.music.yandex.net —
//    токен больше не передаётся из JavaScript и не может уйти на другой адрес;
//  * таймауты и жёсткий предел размера ответа (читаем кусками, а не целиком в память).

use keyring::Entry;
// reqwest в проекте приходит через tauri-plugin-http (отдельной зависимости в Cargo.toml нет), поэтому берём его оттуда
use tauri_plugin_http::reqwest::{self, redirect, Client, Method, Url};
use serde::Serialize;
use std::{collections::HashMap, sync::OnceLock, time::Duration};

pub const KEYRING_SERVICE: &str = "WhisperEdition";
pub const KEYRING_ACCOUNT: &str = "ym_token";

const API_HOST: &str = "api.music.yandex.net";
const TRUSTED_SUFFIXES: [&str; 5] = ["yandex.net", "yandex.ru", "yandex.com", "yandex.by", "yandex.kz"];
const ALLOWED_HEADERS: [&str; 5] = ["user-agent", "x-yandex-music-client", "content-type", "accept", "accept-language"];

const MAX_API_BODY: usize = 8 * 1024 * 1024; // ответ API / текста песни — до 8 МБ
const MAX_AUDIO_BODY: usize = 120 * 1024 * 1024; // аудиофайл — до 120 МБ
const MAX_REQUEST_BODY: usize = 1024 * 1024; // тело запроса от интерфейса — до 1 МБ

/// Принадлежит ли хост доверенным доменам (сам домен или поддомен через точку).
pub fn host_trusted(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    TRUSTED_SUFFIXES
        .iter()
        .any(|s| h == *s || h.ends_with(&format!(".{s}")))
}

/// Единая строгая политика адреса: https, без логина/пароля, без явного порта, только домены Яндекса.
/// Ею проверяются запросы интерфейса, КАЖДОЕ перенаправление и навигация окна входа.
pub fn url_ok(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.host_str().map(host_trusted).unwrap_or(false)
}

fn checked_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Некорректный адрес".to_string())?;
    if url.scheme() != "https" {
        return Err("Разрешён только HTTPS".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Адрес с логином и паролем не разрешён".into());
    }
    if url.port().is_some() {
        return Err("Нестандартные порты запрещены".into());
    }
    if url_ok(&url) {
        Ok(url)
    } else {
        Err("Адрес не входит в список разрешённых".into())
    }
}

/// Токен из системного хранилища (в JavaScript он не передаётся).
fn read_token() -> Option<String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .ok()?
        .get_password()
        .ok()
}

/// `same_host`: перенаправления разрешены только в пределах того же хоста (для запросов с токеном).
fn build_client(total_secs: u64, same_host: bool) -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(total_secs))
        .redirect(redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("слишком много перенаправлений");
            }
            let mut ok = url_ok(attempt.url());
            if ok && same_host {
                let first = attempt.previous().first().and_then(|u| u.host_str().map(str::to_owned));
                ok = first.as_deref() == attempt.url().host_str();
            }
            if ok {
                attempt.follow()
            } else {
                attempt.error("перенаправление на непроверенный адрес")
            }
        }))
        .build()
        .expect("не удалось создать HTTP-клиент")
}

/// Клиент для запросов с токеном: уйти перенаправлением с api.music.yandex.net нельзя.
fn auth_client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| build_client(30, true))
}

fn api_client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| build_client(30, false))
}

fn media_client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| build_client(180, false))
}

/// Белый список операций API Яндекс Музыки, которые реально нужны интерфейсу.
/// `*` — один сегмент пути из букв, цифр и `-_:.`; строка запроса проверяется отдельно.
const API_ROUTES: &[(&str, &str)] = &[
    ("GET", "/account/status"),
    ("GET", "/users/*/likes/tracks"),
    ("POST", "/users/*/likes/tracks/add-multiple"),
    ("POST", "/users/*/likes/tracks/remove"),
    ("POST", "/tracks"),
    ("GET", "/tracks/*/download-info"),
    ("GET", "/get-mp3/**"), // сюда ведёт downloadInfoUrl из download-info: сведения о файле трека
    ("GET", "/tracks/*/lyrics"),
    ("GET", "/albums/*/with-tracks"),
    ("GET", "/artists/*/brief-info"),
    ("GET", "/artists/*/direct-albums"),
    ("GET", "/artists/*/tracks"),
    ("GET", "/search"),
    ("GET", "/rotor/stations/list"),
    ("GET", "/rotor/wave/settings"), // настроения, характер и язык Моей волны
    ("GET", "/genres"),              // список жанров (stations/list теперь отдаёт пустой список)
    ("POST", "/rotor/session/new"),
    ("POST", "/rotor/session/*/tracks"),
    ("POST", "/rotor/session/*/feedback"),
];

fn segment_ok(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_:.".contains(c))
}

fn api_route_allowed(method: &Method, url: &Url) -> bool {
    let path: Vec<&str> = url.path().split('/').skip(1).collect();
    API_ROUTES.iter().any(|(m, pat)| {
        if *m != method.as_str() {
            return false;
        }
        let p: Vec<&str> = pat.split('/').skip(1).collect();
        let seg = |a: &str, b: &str| if a == "*" { segment_ok(b, 128) && b != "." && b != ".." } else { a == b };
        // `**` в конце шаблона — один или больше сегментов; там лежит подписанный ключ (~1000 символов)
        if p.last() == Some(&"**") {
            let fixed = p.len() - 1;
            return path.len() > fixed
                && path.len() <= fixed + 4
                && p[..fixed].iter().zip(&path).all(|(a, b)| seg(a, b))
                && path[fixed..].iter().all(|b| segment_ok(b, 4096) && *b != "." && *b != "..");
        }
        p.len() == path.len() && p.iter().zip(&path).all(|(a, b)| seg(a, b))
    })
}

/// Читает тело ответа кусками и обрывает загрузку, как только лимит превышен.
async fn read_limited(mut resp: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    if let Some(len) = resp.content_length() {
        if len > max as u64 {
            return Err("Ответ слишком большой".into());
        }
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if buf.len() + chunk.len() > max {
            return Err("Ответ слишком большой".into());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let url = checked_url(&url)?;
    let method = match method.to_ascii_uppercase().as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        _ => return Err("Метод не разрешён".into()),
    };

    // К API Яндекс Музыки — только операции из белого списка (с токеном и без ухода на другой хост).
    // Остальные домены Яндекса (файл текста песни, сведения о загрузке трека) — только GET, без тела и без токена.
    let is_api = url.host_str() == Some(API_HOST);
    if is_api {
        if !api_route_allowed(&method, &url) {
            return Err("Эта операция API не разрешена".into());
        }
    } else if method != Method::GET || body.is_some() {
        return Err("К этому адресу разрешены только GET-запросы".into());
    }

    let mut req = if is_api { auth_client() } else { api_client() }.request(method, url.clone());

    // от интерфейса принимаем только безопасные заголовки; Authorization из JavaScript игнорируется
    for (k, v) in headers.unwrap_or_default() {
        if ALLOWED_HEADERS.contains(&k.to_ascii_lowercase().as_str()) && v.len() <= 256 {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    // токен подставляем сами и только для API Яндекс Музыки
    if is_api {
        if let Some(t) = read_token() {
            req = req.header("Authorization", format!("OAuth {t}"));
        }
    }
    if let Some(b) = body {
        if b.len() > MAX_REQUEST_BODY {
            return Err("Тело запроса слишком большое".into());
        }
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let bytes = read_limited(resp, MAX_API_BODY).await?;
    Ok(HttpResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Скачивает аудио для визуализатора. Возвращает «сырые» байты (ArrayBuffer на стороне JS).
#[tauri::command]
pub async fn fetch_bytes(url: String) -> Result<tauri::ipc::Response, String> {
    let url = checked_url(&url)?;
    let resp = media_client()
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let bytes = read_limited(resp, MAX_AUDIO_BODY).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn u(s: &str) -> Url { Url::parse(s).unwrap() }

    #[test]
    fn policy() {
        assert!(url_ok(&u("https://api.music.yandex.net/account/status")));
        assert!(url_ok(&u("https://storage.mds.yandex.net/x")));
        assert!(!url_ok(&u("http://api.music.yandex.net/")));
        assert!(!url_ok(&u("https://api.music.yandex.net:8443/")));
        assert!(!url_ok(&u("https://user:pw@api.music.yandex.net/")));
        assert!(!url_ok(&u("https://evilyandex.net/")));
        assert!(!url_ok(&u("https://yandex.net.evil.com/")));
    }

    #[test]
    fn routes() {
        let a = |m: Method, s: &str| api_route_allowed(&m, &u(&format!("https://{API_HOST}{s}")));
        assert!(a(Method::GET, "/account/status"));
        assert!(a(Method::GET, "/users/123/likes/tracks?if-modified-since-revision=0"));
        assert!(a(Method::POST, "/users/123/likes/tracks/add-multiple"));
        assert!(a(Method::GET, "/tracks/123:456/lyrics?format=LRC&timeStamp=1&sign=x"));
        assert!(a(Method::POST, "/rotor/session/abc-DEF_1/feedback"));
        assert!(a(Method::GET, "/search?text=a&type=all&page=0"));
        assert!(!a(Method::POST, "/account/status"));
        assert!(!a(Method::GET, "/account/settings"));
        assert!(!a(Method::POST, "/users/123/playlists/create"));
        assert!(!a(Method::GET, "/users/123/likes/tracks/extra"));
        assert!(!a(Method::GET, "/tracks/a%2Fb/lyrics"));
        assert!(!a(Method::GET, "/users//likes/tracks"));
        assert!(a(Method::GET, "/get-mp3/U2Fsd_GVk-X18/1791832257?format=json"));
        assert!(!a(Method::GET, "/get-mp3"));
        assert!(!a(Method::POST, "/get-mp3/abc"));
    }
}
