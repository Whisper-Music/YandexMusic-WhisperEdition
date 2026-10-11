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
    match url.host_str() {
        Some(h) if host_trusted(h) => Ok(url),
        _ => Err("Адрес не входит в список разрешённых".into()),
    }
}

/// Токен из системного хранилища (в JavaScript он не передаётся).
fn read_token() -> Option<String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .ok()?
        .get_password()
        .ok()
}

fn build_client(total_secs: u64) -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(total_secs))
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("слишком много перенаправлений");
            }
            let ok = attempt.url().scheme() == "https"
                && attempt.url().host_str().map(host_trusted).unwrap_or(false);
            if ok {
                attempt.follow()
            } else {
                attempt.error("перенаправление на непроверенный адрес")
            }
        }))
        .build()
        .expect("не удалось создать HTTP-клиент")
}

fn api_client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| build_client(30))
}

fn media_client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| build_client(180))
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

    let mut req = api_client().request(method, url.clone());

    // от интерфейса принимаем только безопасные заголовки; Authorization из JavaScript игнорируется
    for (k, v) in headers.unwrap_or_default() {
        if ALLOWED_HEADERS.contains(&k.to_ascii_lowercase().as_str()) {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    // токен подставляем сами и только для API Яндекс Музыки
    if url.host_str() == Some(API_HOST) {
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
