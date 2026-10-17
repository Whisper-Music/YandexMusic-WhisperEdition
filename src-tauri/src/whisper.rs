// src-tauri/src/whisper.rs — подключение Whisper Archive (раздел «Для разработчиков» в настройках).
//
//  * API-ключ wa_… хранится так же, как токен Яндекса (secret.rs: Диспетчер учётных данных / связка ключей Linux),
//    и в JavaScript не отдаётся: интерфейс передаёт его сюда один раз при сохранении;
//  * запросы идут только на https://origin.whisper-archive.ru и только к путям /api/…: чтение (GET) — любые,
//    запись (POST) — лишь вход по почте и загрузка трека, произвольных POST-запросов из интерфейса нет;
//  * перенаправления разрешены только в пределах того же хоста — ключ не может уйти на чужой адрес;
//  * ключ отправляется в заголовке Authorization: Bearer wa_…, как описано в схеме API;
//  * вход по почте (код из письма) — POST /api/auth/request-code и /api/auth/token: выданный ключ сразу уходит
//    в хранилище, в JavaScript возвращается только никнейм;
//  * «Сохранить в архив»: Rust сам скачивает mp3 и обложку с Яндекса (только доверенные адреса, net::fetch_checked)
//    и отправляет их multipart-запросом в новый альбом (POST /api/albums) или в существующий (POST /api/albums/{id}/tracks).

use crate::secret::{self, WA};
use serde::Serialize;
use std::{sync::OnceLock, time::Duration};
use tauri_plugin_http::reqwest::{self, redirect, Client, Url};

const BASE: &str = "https://origin.whisper-archive.ru";
const HOST: &str = "origin.whisper-archive.ru";

const MAX_JSON_BODY: usize = 16 * 1024 * 1024; // списки альбомов — до 16 МБ
const MAX_AUDIO_BODY: usize = 400 * 1024 * 1024; // файл трека (в архиве может быть FLAC/WAV) — до 400 МБ

fn read_token() -> Result<String, String> {
    secret::get_in(WA)?.ok_or_else(|| "Токен Whisper Archive не задан".to_string())
}

fn token_looks_valid(t: &str) -> bool {
    t.starts_with("wa_")
        && (8..=512).contains(&t.len())
        && t.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '+' | '/' | '=' | '~')
        })
}

fn build_client(total_secs: u64) -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(total_secs))
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("слишком много перенаправлений");
            }
            let u = attempt.url();
            if u.scheme() == "https" && u.host_str() == Some(HOST) && u.port().is_none() {
                attempt.follow()
            } else {
                attempt.error("перенаправление на другой адрес запрещено")
            }
        }))
        .build()
        .expect("не удалось создать HTTP-клиент")
}

fn json_client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| build_client(30))
}

fn media_client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| build_client(600))
}

/// Только /api/…, без «..», двойных слешей, параметров и посторонних символов.
fn api_url(path: &str) -> Result<Url, String> {
    let ok = path.starts_with("/api/")
        && path.len() <= 200
        && !path.contains("..")
        && !path.contains("//")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'/' || b == b'-' || b == b'_');
    if !ok {
        return Err("Недопустимый путь к API Whisper Archive".into());
    }
    Url::parse(&format!("{BASE}{path}")).map_err(|_| "Некорректный адрес".to_string())
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

async fn send_get(client: &Client, url: Url, token: &str) -> Result<reqwest::Response, String> {
    client
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json, audio/*;q=0.9, */*;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Whisper Archive недоступен: {e}"))
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
pub struct WaResponse {
    status: u16,
    body: String,
}

/// Есть ли сохранённый ключ (сам ключ наружу не отдаётся).
#[tauri::command]
pub fn wa_token_exists() -> Result<bool, String> {
    secret::get_in(WA).map(|t| t.is_some())
}

/// Проверяет ключ запросом к серверу и только после этого сохраняет.
#[tauri::command]
pub async fn wa_token_set(token: String) -> Result<(), String> {
    let t = token.trim().to_string();
    if !token_looks_valid(&t) {
        return Err("токен должен начинаться с wa_ и не содержать пробелов".into());
    }
    let resp = send_get(json_client(), api_url("/api/albums/mine")?, &t).await?;
    match resp.status().as_u16() {
        200..=299 => {}
        401 | 403 => return Err("сервер не принял токен — проверь его на странице /developers".into()),
        s => return Err(format!("не удалось проверить токен: сервер ответил HTTP {s}")),
    }
    clear_stream_cache();
    secret::set_in(WA, &t)
}

#[tauri::command]
pub fn wa_token_clear() -> Result<(), String> {
    clear_stream_cache();
    secret::clear_in(WA)
}

/// GET к API архива с ключом из хранилища. Возвращает статус и текст ответа.
#[tauri::command]
pub async fn wa_get(path: String) -> Result<WaResponse, String> {
    let url = api_url(&path)?;
    let token = read_token()?;
    let resp = send_get(json_client(), url, &token).await?;
    let status = resp.status().as_u16();
    let bytes = read_limited(resp, MAX_JSON_BODY).await?;
    Ok(WaResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Файл трека из архива (/api/tracks/{id}/stream) «сырыми» байтами — в JS это ArrayBuffer.
#[tauri::command]
pub async fn wa_stream(id: String) -> Result<tauri::ipc::Response, String> {
    if !is_uuid(&id) {
        return Err("Некорректный id трека".into());
    }
    let token = read_token()?;
    let url = api_url(&format!("/api/tracks/{id}/stream"))?;
    let resp = send_get(media_client(), url, &token).await?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let bytes = read_limited(resp, MAX_AUDIO_BODY).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------------------------------------------------------------------------
// Вход по почте: код из письма -> ключ приложения (доступ на чтение и запись, 30 дней).
// ---------------------------------------------------------------------------

/// Так приложение будет подписано в списке ключей на странице /developers (не длиннее 40 символов).
const DEVICE_NAME: &str = "Whisper Edition (Яндекс Музыка)";
const MAX_SMALL_BODY: usize = 1024 * 1024;

fn email_ok(e: &str) -> bool {
    (3..=254).contains(&e.len())
        && e.contains('@')
        && !e.chars().any(|c| c.is_whitespace() || c.is_control())
}

async fn post_json(path: &str, body: serde_json::Value) -> Result<WaResponse, String> {
    let resp = json_client()
        .post(api_url(path)?)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("Whisper Archive недоступен: {e}"))?;
    let status = resp.status().as_u16();
    let bytes = read_limited(resp, MAX_SMALL_BODY).await?;
    Ok(WaResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Шаг 1: отправить код на почту. Никнейм нужен только для регистрации нового аккаунта.
#[tauri::command]
pub async fn wa_auth_request_code(email: String, nickname: Option<String>) -> Result<WaResponse, String> {
    let email = email.trim().to_string();
    if !email_ok(&email) {
        return Err("Проверь адрес почты".into());
    }
    let nickname = nickname.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    if let Some(n) = &nickname {
        if n.chars().count() > 32 || n.chars().any(|c| c.is_control()) {
            return Err("Никнейм слишком длинный".into());
        }
    }
    post_json(
        "/api/auth/request-code",
        serde_json::json!({ "email": email, "nickname": nickname }),
    )
    .await
}

#[derive(Serialize)]
pub struct WaLogin {
    ok: bool,
    status: u16,
    /// Текст ошибки сервера; при успехе пустой (тело ответа с ключом в JavaScript не отдаётся).
    body: String,
    nickname: Option<String>,
}

/// Шаг 2: обменять код на ключ. Ключ сразу кладётся в системное хранилище.
#[tauri::command]
pub async fn wa_auth_issue(email: String, code: String) -> Result<WaLogin, String> {
    let email = email.trim().to_string();
    let code = code.trim().to_string();
    if !email_ok(&email) {
        return Err("Проверь адрес почты".into());
    }
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Код должен состоять из 6 цифр".into());
    }
    let r = post_json(
        "/api/auth/token",
        serde_json::json!({ "email": email, "code": code, "deviceName": DEVICE_NAME }),
    )
    .await?;
    if !(200..300).contains(&r.status) {
        return Ok(WaLogin { ok: false, status: r.status, body: r.body, nickname: None });
    }
    let v: serde_json::Value =
        serde_json::from_str(&r.body).map_err(|_| "Сервер вернул неожиданный ответ".to_string())?;
    let token = v
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| "В ответе сервера нет ключа".to_string())?;
    if !token_looks_valid(token) {
        return Err("Сервер выдал ключ в неожиданном виде".into());
    }
    clear_stream_cache();
    secret::set_in(WA, token)?;
    let nickname = v
        .pointer("/user/nickname")
        .and_then(|x| x.as_str())
        .map(|s| s.chars().take(64).collect());
    Ok(WaLogin { ok: true, status: r.status, body: String::new(), nickname })
}

// ---------------------------------------------------------------------------
// Сохранение трека Яндекса в архив.
// ---------------------------------------------------------------------------

const MAX_TRACK_UPLOAD: usize = 100 * 1024 * 1024; // лимит сервера на один трек
const MAX_COVER_UPLOAD: usize = 10 * 1024 * 1024; // лимит сервера на обложку
const MAX_ALBUM_TITLE: usize = 75;

/// Формат обложки по первым байтам: сервер требует, чтобы расширение совпадало с содержимым.
fn image_kind(b: &[u8]) -> Option<(&'static str, &'static str)> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("cover.jpg", "image/jpeg"))
    } else if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("cover.png", "image/png"))
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some(("cover.webp", "image/webp"))
    } else {
        None
    }
}

/// Расширение аудиофайла по первым байтам (только форматы, которые принимает сервер).
fn audio_kind(b: &[u8]) -> Option<(&'static str, &'static str)> {
    if b.starts_with(b"ID3") || (b.len() > 1 && b[0] == 0xFF && (b[1] & 0xE0) == 0xE0) {
        Some(("mp3", "audio/mpeg"))
    } else if b.starts_with(b"fLaC") {
        Some(("flac", "audio/flac"))
    } else if b.starts_with(b"OggS") {
        Some(("ogg", "audio/ogg"))
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WAVE" {
        Some(("wav", "audio/wav"))
    } else if b.len() > 8 && &b[4..8] == b"ftyp" {
        Some(("m4a", "audio/mp4"))
    } else {
        None
    }
}

/// Имя файла = название трека в архиве («Исполнитель - Название»): убираем то, что сломает путь или заголовок.
fn clean_stem(name: &str) -> String {
    let mapped: String = name
        .chars()
        .map(|c| if c.is_control() || r#"\/:*?"<>|"#.contains(c) { ' ' } else { c })
        .collect();
    let mut s = mapped.split_whitespace().collect::<Vec<_>>().join(" ");
    s = s.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    let s: String = s.chars().take(180).collect();
    if s.is_empty() { "Трек".into() } else { s }
}

fn clean_title(t: &str) -> String {
    let s = t
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    s.chars().take(MAX_ALBUM_TITLE).collect::<String>().trim().to_string()
}

fn random_boundary() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut s = String::from("----WhisperEdition");
    for i in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        s.push_str(&format!("{:016x}", h.finish()));
    }
    s
}

/// RFC 5987: имя файла в кодировке UTF-8 для filename*.
fn pct_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Простой multipart/form-data без внешних зависимостей.
struct Multipart {
    boundary: String,
    body: Vec<u8>,
}

impl Multipart {
    fn new() -> Self {
        Self { boundary: random_boundary(), body: Vec::new() }
    }

    fn text(&mut self, name: &str, value: &str) {
        self.body.extend_from_slice(
            format!(
                "--{}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n",
                self.boundary
            )
            .as_bytes(),
        );
    }

    fn file(&mut self, name: &str, filename: &str, content_type: &str, data: &[u8]) {
        // в кавычках — само имя (так шлют браузеры), в filename* — то же имя по RFC 5987
        let quoted: String = filename.chars().filter(|c| *c != '"' && *c != '\\' && !c.is_control()).collect();
        self.body.extend_from_slice(
            format!(
                "--{}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{quoted}\"; filename*=UTF-8''{}\r\nContent-Type: {content_type}\r\n\r\n",
                self.boundary,
                pct_encode(filename)
            )
            .as_bytes(),
        );
        self.body.extend_from_slice(data);
        self.body.extend_from_slice(b"\r\n");
    }

    fn finish(mut self) -> (String, Vec<u8>) {
        self.body.extend_from_slice(format!("--{}--\r\n", self.boundary).as_bytes());
        (format!("multipart/form-data; boundary={}", self.boundary), self.body)
    }
}

async fn post_multipart(path: &str, token: &str, form: Multipart) -> Result<WaResponse, String> {
    let (ctype, body) = form.finish();
    let resp = media_client()
        .post(api_url(path)?)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .header("Content-Type", ctype)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Whisper Archive недоступен: {e}"))?;
    let status = resp.status().as_u16();
    let bytes = read_limited(resp, MAX_SMALL_BODY).await?;
    Ok(WaResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Скачивает трек с Яндекса и сохраняет в архив.
///  * `album_id` задан — трек добавляется в этот альбом (он должен принадлежать владельцу ключа);
///  * иначе создаётся новый приватный альбом `album_title` с обложкой: `cover_url` (адрес Яндекса)
///    или `cover_bytes` (картинка, нарисованная интерфейсом, если у трека нет обложки).
#[tauri::command]
pub async fn wa_save_track(
    audio_url: String,
    file_name: String,
    album_id: Option<String>,
    album_title: Option<String>,
    cover_url: Option<String>,
    cover_bytes: Option<Vec<u8>>,
) -> Result<WaResponse, String> {
    let token = read_token()?;
    if let Some(id) = &album_id {
        if !is_uuid(id) {
            return Err("Некорректный id альбома".into());
        }
    }

    let audio = crate::net::fetch_checked(&audio_url)
        .await
        .map_err(|e| format!("не удалось скачать трек с Яндекса: {e}"))?;
    if audio.len() > MAX_TRACK_UPLOAD {
        return Err("трек больше 100 МБ — архив такие не принимает".into());
    }
    let (ext, audio_type) =
        audio_kind(&audio).ok_or_else(|| "Яндекс отдал файл в неизвестном формате".to_string())?;
    let track_file = format!("{}.{ext}", clean_stem(&file_name));

    let mut form = Multipart::new();
    if let Some(id) = album_id {
        form.file("tracks", &track_file, audio_type, &audio);
        return post_multipart(&format!("/api/albums/{id}/tracks"), &token, form).await;
    }

    let title = clean_title(album_title.as_deref().unwrap_or(""));
    if title.is_empty() {
        return Err("Не указано название альбома".into());
    }
    let cover = match (cover_url, cover_bytes) {
        (Some(u), _) => crate::net::fetch_checked(&u)
            .await
            .map_err(|e| format!("не удалось скачать обложку с Яндекса: {e}"))?,
        (None, Some(b)) => b,
        (None, None) => return Err("Для нового альбома нужна обложка".into()),
    };
    if cover.is_empty() || cover.len() > MAX_COVER_UPLOAD {
        return Err("Обложка пустая или больше 10 МБ".into());
    }
    let (cover_file, cover_type) =
        image_kind(&cover).ok_or_else(|| "Обложка в неподдерживаемом формате".to_string())?;

    form.text("Title", &title);
    form.text("Visibility", "private");
    form.file("Cover", cover_file, cover_type, &cover);
    form.file("Tracks", &track_file, audio_type, &audio);
    post_multipart("/api/albums", &token, form).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(clean_stem("AC/DC - Back In Black"), "AC DC - Back In Black");
        assert_eq!(clean_stem("  a:b*c?  "), "a b c");
        assert_eq!(clean_stem("..."), "Трек");
        assert_eq!(pct_encode("Ёлка - Ok.mp3"), "%D0%81%D0%BB%D0%BA%D0%B0%20-%20Ok.mp3");
        assert_eq!(clean_title(&"я".repeat(100)).chars().count(), 75);
    }

    #[test]
    fn multipart_layout() {
        let mut m = Multipart::new();
        m.text("Title", "Альбом");
        m.file("Tracks", "Исп - \"Трек\".mp3", "audio/mpeg", b"DATA");
        let b = m.boundary.clone();
        let (ct, body) = m.finish();
        let s = String::from_utf8(body).unwrap();
        assert_eq!(ct, format!("multipart/form-data; boundary={b}"));
        assert!(s.starts_with(&format!("--{b}\r\nContent-Disposition: form-data; name=\"Title\"\r\n\r\nАльбом\r\n")));
        assert!(s.contains("filename=\"Исп - Трек.mp3\"; filename*=UTF-8''"));
        assert!(s.contains("Content-Type: audio/mpeg\r\n\r\nDATA\r\n"));
        assert!(s.ends_with(&format!("--{b}--\r\n")));
    }

    #[test]
    fn sniff() {
        assert_eq!(audio_kind(b"ID3\x04....").unwrap().0, "mp3");
        assert_eq!(image_kind(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap().0, "cover.jpg");
        assert!(image_kind(b"GIF89a").is_none());
        assert!(is_uuid("0f8fad5b-d9cb-469f-a165-70867728950e"));
        assert!(api_url("/api/albums/../x").is_err());
    }
}

// ---------------------------------------------------------------------------
// Потоковое воспроизведение из архива: протокол wa:// (на Windows — http://wa.localhost).
//
// Плеер <audio> не умеет добавлять заголовок Authorization, поэтому раньше трек скачивался целиком
// (30 МБ FLAC ≈ 3 с) и только потом начинал играть. Теперь <audio src="wa://localhost/track/<id>">
// запрашивает трек кусками (Range), Rust подставляет ключ и пересылает Range на сервер (он отвечает 206).
// Первый кусок маленький — старт ≈ одного запроса; первые куски следующих треков можно взять заранее.
// Протокол обслуживает только главное окно (проверка в lib.rs), ключ в ответы не попадает.
// ---------------------------------------------------------------------------

use std::sync::Mutex;
use tauri::http::{header, Request, Response, StatusCode};

const FIRST_CHUNK: u64 = 512 * 1024; // начало трека: чем меньше, тем быстрее старт
const NEXT_CHUNK: u64 = 2 * 1024 * 1024; // дальше — крупнее, чтобы было меньше запросов
const HEAD_CACHE_MAX: usize = 4; // сколько «начал» треков держать в памяти (≈ 2 МБ)

#[derive(Clone)]
struct Head {
    total: u64,
    ctype: String,
    bytes: Vec<u8>,
}

fn head_cache() -> &'static Mutex<Vec<(String, Head)>> {
    static C: OnceLock<Mutex<Vec<(String, Head)>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(Vec::new()))
}

fn cache_get(id: &str) -> Option<Head> {
    head_cache().lock().ok()?.iter().find(|(k, _)| k == id).map(|(_, h)| h.clone())
}

fn cache_put(id: &str, h: Head) {
    if let Ok(mut c) = head_cache().lock() {
        c.retain(|(k, _)| k != id);
        c.push((id.to_string(), h));
        while c.len() > HEAD_CACHE_MAX {
            c.remove(0);
        }
    }
}

/// Другой аккаунт или выход — старые куски больше не наши.
pub fn clear_stream_cache() {
    if let Ok(mut c) = head_cache().lock() {
        c.clear();
    }
}

/// «bytes=S-E» / «bytes=S-» -> (S, Some(E) | None). Без заголовка или в непонятном виде — с начала.
pub(crate) fn parse_range(v: Option<&str>) -> (u64, Option<u64>) {
    let Some(spec) = v.and_then(|s| s.trim().strip_prefix("bytes=")) else { return (0, None) };
    let first = spec.split(',').next().unwrap_or("").trim();
    let Some((a, b)) = first.split_once('-') else { return (0, None) };
    let start = a.trim().parse::<u64>().unwrap_or(0);
    let end = b.trim().parse::<u64>().ok().filter(|e| *e >= start);
    (start, end)
}

/// «bytes S-E/TOTAL» -> (S, TOTAL)
fn parse_content_range(v: &str) -> Option<(u64, u64)> {
    let rest = v.trim().strip_prefix("bytes ")?;
    let (range, total) = rest.split_once('/')?;
    let (s, _) = range.split_once('-')?;
    Some((s.trim().parse().ok()?, total.trim().parse().ok()?))
}

struct Chunk {
    status: u16,
    start: u64,
    total: Option<u64>,
    ctype: String,
    bytes: Vec<u8>,
}

async fn fetch_range(id: &str, token: &str, start: u64, end: u64) -> Result<Chunk, String> {
    let resp = json_client()
        .get(api_url(&format!("/api/tracks/{id}/stream"))?)
        .header("Authorization", format!("Bearer {token}"))
        .header("Range", format!("bytes={start}-{end}"))
        .send()
        .await
        .map_err(|e| format!("Whisper Archive недоступен: {e}"))?;
    let status = resp.status().as_u16();
    let h = resp.headers();
    let ctype = h
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .filter(|v| v.starts_with("audio/") || *v == "application/octet-stream")
        .unwrap_or("audio/mpeg")
        .to_string();
    let range = h
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_content_range);
    let limit = if status == 206 { (end - start + 1) as usize + 4096 } else { MAX_AUDIO_BODY };
    let bytes = if status == 200 || status == 206 { read_limited(resp, limit).await? } else { Vec::new() };
    Ok(Chunk {
        status,
        start: range.map(|r| r.0).unwrap_or(0),
        total: range.map(|r| r.1),
        ctype,
        bytes,
    })
}

fn cors(mut b: tauri::http::response::Builder, origin: &Option<String>) -> tauri::http::response::Builder {
    // запрос приходит только из главного окна (lib.rs), поэтому его Origin можно вернуть как есть:
    // это нужно визуализатору (анализ звука работает только с CORS-разрешённым источником)
    if let Some(o) = origin {
        b = b.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, o.as_str()).header(header::VARY, "Origin");
    }
    b
}

fn partial(ctype: &str, start: u64, total: u64, body: Vec<u8>, origin: &Option<String>) -> Response<Vec<u8>> {
    let end = start + body.len() as u64 - 1;
    cors(Response::builder(), origin)
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, ctype)
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_default()
}

fn plain(status: StatusCode, msg: &str, origin: &Option<String>) -> Response<Vec<u8>> {
    cors(Response::builder(), origin)
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap_or_default()
}

/// Обработчик wa://localhost/track/<uuid> (регистрируется в lib.rs).
pub async fn serve_stream(req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let Some(id) = req.uri().path().strip_prefix("/track/").filter(|s| is_uuid(s)).map(str::to_string) else {
        return plain(StatusCode::NOT_FOUND, "not found", &origin);
    };
    let (start, want_end) = parse_range(req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()));

    // начало трека, взятое заранее, — отдаём сразу, без сети
    if start == 0 {
        if let Some(h) = cache_get(&id) {
            let n = h.bytes.len() as u64;
            let end = want_end.map(|e| e.min(n - 1)).unwrap_or(n - 1);
            return partial(&h.ctype, 0, h.total, h.bytes[..=end as usize].to_vec(), &origin);
        }
    }

    let token = match read_token() {
        Ok(t) => t,
        Err(e) => return plain(StatusCode::UNAUTHORIZED, &e, &origin),
    };
    let step = if start == 0 { FIRST_CHUNK } else { NEXT_CHUNK };
    let end = want_end.map(|e| e.min(start + step - 1)).unwrap_or(start + step - 1);
    let c = match fetch_range(&id, &token, start, end).await {
        Ok(c) => c,
        Err(e) => return plain(StatusCode::BAD_GATEWAY, &e, &origin),
    };
    match c.status {
        206 if !c.bytes.is_empty() => {
            let Some(total) = c.total else {
                return plain(StatusCode::BAD_GATEWAY, "нет Content-Range", &origin);
            };
            if c.start == 0 {
                cache_put(&id, Head { total, ctype: c.ctype.clone(), bytes: c.bytes.clone() });
            }
            partial(&c.ctype, c.start, total, c.bytes, &origin)
        }
        // сервер вдруг отдал файл целиком — отдаём как есть
        200 => cors(Response::builder(), &origin)
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, c.ctype.as_str())
            .header(header::CONTENT_LENGTH, c.bytes.len())
            .header(header::CACHE_CONTROL, "no-store")
            .body(c.bytes)
            .unwrap_or_default(),
        416 => plain(StatusCode::RANGE_NOT_SATISFIABLE, "range", &origin),
        401 | 403 => plain(StatusCode::UNAUTHORIZED, "ключ не принят", &origin),
        404 => plain(StatusCode::NOT_FOUND, "трека нет в архиве", &origin),
        s => plain(StatusCode::BAD_GATEWAY, &format!("HTTP {s}"), &origin),
    }
}

/// Заранее взять начало трека (следующего в очереди): тогда он стартует без ожидания сети.
#[tauri::command]
pub async fn wa_prefetch(id: String) -> Result<(), String> {
    if !is_uuid(&id) {
        return Err("Некорректный id трека".into());
    }
    if cache_get(&id).is_some() {
        return Ok(());
    }
    let token = read_token()?;
    let c = fetch_range(&id, &token, 0, FIRST_CHUNK - 1).await?;
    if c.status == 206 && c.start == 0 && !c.bytes.is_empty() {
        if let Some(total) = c.total {
            cache_put(&id, Head { total, ctype: c.ctype, bytes: c.bytes });
        }
    }
    Ok(())
}

#[cfg(test)]
mod stream_tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range(Some("bytes=0-")), (0, None));
        assert_eq!(parse_range(Some("bytes=100-199")), (100, Some(199)));
        assert_eq!(parse_range(Some("bytes=500-100")), (500, None));
        assert_eq!(parse_range(None), (0, None));
        assert_eq!(parse_content_range("bytes 0-524287/30511652"), Some((0, 30511652)));
        assert_eq!(parse_content_range("bytes */100"), None);
    }

    /// Проверка на настоящем сервере (публичный трек, без ключа):
    /// WA_TEST_TRACK=<uuid> cargo test --lib live_stream -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_stream() {
        let id = std::env::var("WA_TEST_TRACK").expect("WA_TEST_TRACK");
        tauri::async_runtime::block_on(async {
            let t0 = std::time::Instant::now();
            let a = fetch_range(&id, "", 0, FIRST_CHUNK - 1).await.unwrap();
            let t1 = t0.elapsed();
            let b = fetch_range(&id, "", FIRST_CHUNK, FIRST_CHUNK + NEXT_CHUNK - 1).await.unwrap();
            let t2 = t0.elapsed() - t1;
            println!("first: {} {}B start={} total={:?} {} in {:?}", a.status, a.bytes.len(), a.start, a.total, a.ctype, t1);
            println!("next:  {} {}B start={} in {:?}", b.status, b.bytes.len(), b.start, t2);
            assert_eq!(a.status, 206);
            assert_eq!(a.bytes.len() as u64, FIRST_CHUNK);
            assert_eq!(b.start, FIRST_CHUNK);
            assert!(a.total.unwrap() > FIRST_CHUNK);
        });
    }
}
