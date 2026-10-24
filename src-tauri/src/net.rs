
use tauri_plugin_http::reqwest::{self, redirect, Client, Method, Url};
use std::{collections::HashMap, sync::OnceLock, time::Duration};

pub const KEYRING_SERVICE: &str = "WhisperEdition";
pub const KEYRING_ACCOUNT: &str = "ym_token";

const API_HOST: &str = "api.music.yandex.net";
const TRUSTED_SUFFIXES: [&str; 5] = ["yandex.net", "yandex.ru", "yandex.com", "yandex.by", "yandex.kz"];

const MAX_API_BODY: usize = 8 * 1024 * 1024;
const MAX_AUDIO_BODY: usize = 120 * 1024 * 1024;
const MAX_REQUEST_BODY: usize = 1024 * 1024;

pub fn host_trusted(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    TRUSTED_SUFFIXES
        .iter()
        .any(|s| h == *s || h.ends_with(&format!(".{s}")))
}

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

fn read_token() -> Option<String> {
    crate::secret::get().ok().flatten()
}

fn build_client(total_secs: u64, same_host: bool) -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        // за многочасовое прослушивание соединения из пула успевают «протухнуть» на стороне сервера/роутера —
        // держим их недолго и поддерживаем keepalive, чтобы запрос не уходил в мёртвый сокет
        .pool_idle_timeout(Duration::from_secs(20))
        .tcp_keepalive(Duration::from_secs(30))
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

// ---------------------------------------------------------------------------
// Типизированный доступ к API Яндекс Музыки (аудит F-02).
//
// Раньше интерфейс присылал сюда метод, адрес, заголовки и тело (http_request), а Rust подставлял токен —
// при XSS это был «прокси от имени пользователя». Теперь интерфейс называет только операцию из списка ниже
// и передаёт её параметры. Метод, хост, шаблон пути, разрешённые параметры запроса и поля формы зашиты здесь;
// номер пользователя (uid) Rust берёт сам из /account/status, а не из интерфейса.
// Операции разделены на чтение (ym_read) и изменение данных аккаунта (ym_write) — у них разные разрешения.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Verb {
    Get,
    Post,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Body {
    None,
    /// application/x-www-form-urlencoded, только перечисленные поля
    Form(&'static [&'static str]),
    /// JSON-объект (запросы «Моей волны»)
    Json,
}

/// Что подставляется вместо `{id}` в пути.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Id {
    No,
    /// трек, альбом, исполнитель: цифры, «123:456», буквы и -_
    Item,
    /// номер плейлиста пользователя
    Kind,
    /// сессия «Моей волны»
    Session,
}

#[derive(Debug)]
struct Op {
    name: &'static str,
    write: bool,
    verb: Verb,
    path: &'static str,
    id: Id,
    query: &'static [&'static str],
    body: Body,
}

const TRACK_IDS: &[&str] = &["track-ids"];

const fn op(name: &'static str, write: bool, verb: Verb, path: &'static str, id: Id, query: &'static [&'static str], body: Body) -> Op {
    Op { name, write, verb, path, id, query, body }
}

const OPS: &[Op] = &[
    // --- чтение ---
    op("account_status", false, Verb::Get, "/account/status", Id::No, &[], Body::None),
    op("likes", false, Verb::Get, "/users/{uid}/likes/tracks", Id::No, &[], Body::None),
    op("dislikes", false, Verb::Get, "/users/{uid}/dislikes/tracks", Id::No, &[], Body::None),
    op("tracks", false, Verb::Post, "/tracks", Id::No, &[], Body::Form(TRACK_IDS)),
    op("track_download_info", false, Verb::Get, "/tracks/{id}/download-info", Id::Item, &[], Body::None),
    op("track_lyrics", false, Verb::Get, "/tracks/{id}/lyrics", Id::Item, &["format", "timeStamp", "sign"], Body::None),
    op("album", false, Verb::Get, "/albums/{id}/with-tracks", Id::Item, &[], Body::None),
    op("artist_brief", false, Verb::Get, "/artists/{id}/brief-info", Id::Item, &[], Body::None),
    op("artist_albums", false, Verb::Get, "/artists/{id}/direct-albums", Id::Item, &["page", "page-size", "sort-by"], Body::None),
    op("artist_tracks", false, Verb::Get, "/artists/{id}/tracks", Id::Item, &["page", "page-size"], Body::None),
    op("search", false, Verb::Get, "/search", Id::No, &["text", "type", "page"], Body::None),
    op("genres", false, Verb::Get, "/genres", Id::No, &[], Body::None),
    op("wave_settings", false, Verb::Get, "/rotor/wave/settings", Id::No, &["language"], Body::None),
    op("rotor_new", false, Verb::Post, "/rotor/session/new", Id::No, &[], Body::Json),
    op("rotor_tracks", false, Verb::Post, "/rotor/session/{id}/tracks", Id::Session, &[], Body::Json),
    op("playlists", false, Verb::Get, "/users/{uid}/playlists/list", Id::No, &[], Body::None),
    op("playlist", false, Verb::Get, "/users/{uid}/playlists/{id}", Id::Kind, &[], Body::None),
    op("playlist_recs", false, Verb::Get, "/users/{uid}/playlists/{id}/recommendations", Id::Kind, &[], Body::None),
    // --- изменение данных аккаунта ---
    op("like_add", true, Verb::Post, "/users/{uid}/likes/tracks/add-multiple", Id::No, &[], Body::Form(TRACK_IDS)),
    op("like_remove", true, Verb::Post, "/users/{uid}/likes/tracks/remove", Id::No, &[], Body::Form(TRACK_IDS)),
    op("dislike_add", true, Verb::Post, "/users/{uid}/dislikes/tracks/add-multiple", Id::No, &[], Body::Form(TRACK_IDS)),
    op("dislike_remove", true, Verb::Post, "/users/{uid}/dislikes/tracks/remove", Id::No, &[], Body::Form(TRACK_IDS)),
    op("rotor_feedback", true, Verb::Post, "/rotor/session/{id}/feedback", Id::Session, &[], Body::Json),
    op("playlist_create", true, Verb::Post, "/users/{uid}/playlists/create", Id::No, &[], Body::Form(&["title", "visibility"])),
    op("playlist_rename", true, Verb::Post, "/users/{uid}/playlists/{id}/name", Id::Kind, &[], Body::Form(&["value"])),
    op("playlist_change", true, Verb::Post, "/users/{uid}/playlists/{id}/change", Id::Kind, &[], Body::Form(&["kind", "revision", "diff"])),
    op("playlist_change_rel", true, Verb::Post, "/users/{uid}/playlists/{id}/change-relative", Id::Kind, &[], Body::Form(&["kind", "revision", "diff"])),
    op("playlist_delete", true, Verb::Post, "/users/{uid}/playlists/{id}/delete", Id::Kind, &[], Body::None),
];

const MAX_QUERY_VALUE: usize = 512;
const MAX_JSON_REQUEST: usize = 64 * 1024;

fn segment_ok(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_:.".contains(c)) && s != "." && s != ".."
}

fn id_ok(kind: Id, s: &str) -> bool {
    match kind {
        Id::No => true,
        Id::Item => segment_ok(s, 64) && !s.contains('.'),
        Id::Kind => (1..=20).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()),
        Id::Session => segment_ok(s, 128),
    }
}

fn find_op(name: &str) -> Option<&'static Op> {
    OPS.iter().find(|o| o.name == name)
}

/// Номер пользователя для путей /users/{uid}/…: Rust узнаёт его сам у /account/status по сохранённому токену.
fn uid_cache() -> &'static std::sync::Mutex<Option<String>> {
    static U: OnceLock<std::sync::Mutex<Option<String>>> = OnceLock::new();
    U.get_or_init(|| std::sync::Mutex::new(None))
}

/// Вход, выход, смена токена — прежний uid больше не наш.
pub fn forget_uid() {
    *uid_cache().lock().unwrap_or_else(|e| e.into_inner()) = None;
}

fn remember_uid(body: &str) {
    let v: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return,
    };
    let uid = match v.pointer("/result/account/uid") {
        Some(serde_json::Value::Number(n)) => n.to_string(),
        Some(serde_json::Value::String(s)) => s.clone(),
        _ => return,
    };
    if (1..=20).contains(&uid.len()) && uid.bytes().all(|b| b.is_ascii_digit()) {
        *uid_cache().lock().unwrap_or_else(|e| e.into_inner()) = Some(uid);
    }
}

async fn current_uid() -> Result<String, String> {
    if let Some(u) = uid_cache().lock().unwrap_or_else(|e| e.into_inner()).clone() {
        return Ok(u);
    }
    let (status, body) = send_with(find_op("account_status").expect("account_status"), None, None, None, None, None).await?;
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}: {}", snippet(&body)));
    }
    remember_uid(&body);
    uid_cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or_else(|| "Нет входа в аккаунт Яндекса".to_string())
}

fn snippet(s: &str) -> String {
    s.chars().take(200).collect()
}

/// application/x-www-form-urlencoded тем же кодировщиком, что и параметры адреса.
fn form_encode(pairs: &[(&str, &str)]) -> String {
    let mut u = Url::parse("https://x.invalid/").expect("static url");
    {
        let mut q = u.query_pairs_mut();
        for (k, v) in pairs {
            q.append_pair(k, v);
        }
    }
    u.query().unwrap_or("").to_string()
}

/// Адрес запроса по шаблону операции. Пользовательские значения попадают только в проверенные сегменты пути
/// и в параметры, имена которых перечислены у операции.
fn build_url(op: &Op, uid: Option<&str>, id: Option<&str>, query: Option<&HashMap<String, String>>) -> Result<Url, String> {
    let mut path = op.path.to_string();
    if path.contains("{uid}") {
        let u = uid.ok_or("Нет входа в аккаунт Яндекса")?;
        if !(1..=20).contains(&u.len()) || !u.bytes().all(|b| b.is_ascii_digit()) {
            return Err("Некорректный номер пользователя".into());
        }
        path = path.replace("{uid}", u);
    }
    match (op.id, id) {
        (Id::No, None) => {}
        (Id::No, Some(_)) => return Err("Этой операции не нужен id".into()),
        (_, None) => return Err("Не указан id".into()),
        (k, Some(v)) => {
            if !id_ok(k, v) {
                return Err("Некорректный id".into());
            }
            path = path.replace("{id}", v);
        }
    }
    let mut url = Url::parse(&format!("https://{API_HOST}{path}")).map_err(|_| "Некорректный адрес".to_string())?;
    if let Some(q) = query {
        let mut keys: Vec<&String> = q.keys().collect();
        keys.sort();
        for k in keys {
            if !op.query.contains(&k.as_str()) {
                return Err(format!("Параметр «{k}» этой операции не разрешён"));
            }
        }
        let v = &q;
        let mut pairs = url.query_pairs_mut();
        for k in op.query {
            if let Some(val) = v.get(*k) {
                if val.len() > MAX_QUERY_VALUE || val.chars().any(|c| c.is_control()) {
                    return Err("Слишком длинный параметр запроса".into());
                }
                pairs.append_pair(k, val);
            }
        }
    }
    if url.query() == Some("") {
        url.set_query(None);
    }
    Ok(url)
}

fn build_body(op: &Op, form: Option<&HashMap<String, String>>, json: Option<&serde_json::Value>) -> Result<Option<(&'static str, String)>, String> {
    match op.body {
        Body::None => {
            if form.is_some() || json.is_some() {
                return Err("Этой операции не нужно тело запроса".into());
            }
            Ok(None)
        }
        Body::Form(fields) => {
            if json.is_some() {
                return Err("Эта операция принимает только форму".into());
            }
            let f = form.ok_or("Не заполнена форма запроса")?;
            if let Some(k) = f.keys().find(|k| !fields.contains(&k.as_str())) {
                return Err(format!("Поле «{k}» этой операции не разрешено"));
            }
            let pairs: Vec<(&str, &str)> = fields.iter().filter_map(|k| f.get(*k).map(|v| (*k, v.as_str()))).collect();
            let body = form_encode(&pairs);
            if body.len() > MAX_REQUEST_BODY {
                return Err("Тело запроса слишком большое".into());
            }
            Ok(Some(("application/x-www-form-urlencoded", body)))
        }
        Body::Json => {
            if form.is_some() {
                return Err("Эта операция принимает только JSON".into());
            }
            let j = json.ok_or("Не заполнено тело запроса")?;
            if !j.is_object() {
                return Err("Тело запроса должно быть объектом".into());
            }
            let body = j.to_string();
            if body.len() > MAX_JSON_REQUEST {
                return Err("Тело запроса слишком большое".into());
            }
            Ok(Some(("application/json", body)))
        }
    }
}

fn ym_headers(req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    req.header("User-Agent", "Yandex-Music-API")
        .header("X-Yandex-Music-Client", "YandexMusicAndroid/24023231")
}

async fn send_api(
    op: &Op,
    id: Option<&str>,
    query: Option<&HashMap<String, String>>,
    form: Option<&HashMap<String, String>>,
    json: Option<&serde_json::Value>,
) -> Result<(u16, String), String> {
    let uid = if op.path.contains("{uid}") { Some(current_uid().await?) } else { None };
    send_with(op, uid.as_deref(), id, query, form, json).await
}

async fn send_with(
    op: &Op,
    uid: Option<&str>,
    id: Option<&str>,
    query: Option<&HashMap<String, String>>,
    form: Option<&HashMap<String, String>>,
    json: Option<&serde_json::Value>,
) -> Result<(u16, String), String> {
    let url = build_url(op, uid, id, query)?;
    let body = build_body(op, form, json)?;
    let method = match op.verb {
        Verb::Get => Method::GET,
        Verb::Post => Method::POST,
    };
    let mut req = ym_headers(auth_client().request(method, url));
    if let Some(t) = read_token() {
        req = req.header("Authorization", format!("OAuth {t}"));
    }
    if let Some((ctype, b)) = body {
        req = req.header("Content-Type", ctype).body(b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let bytes = read_limited(resp, MAX_API_BODY).await?;
    let body = String::from_utf8_lossy(&bytes).into_owned();
    if op.name == "account_status" && (200..300).contains(&status) {
        remember_uid(&body);
    }
    Ok((status, body))
}

async fn run_op(
    write: bool,
    op: String,
    id: Option<String>,
    query: Option<HashMap<String, String>>,
    form: Option<HashMap<String, String>>,
    json: Option<serde_json::Value>,
) -> Result<String, String> {
    let o = find_op(&op).filter(|o| o.write == write).ok_or_else(|| format!("Операция «{op}» не разрешена"))?;
    let (status, body) = send_api(o, id.as_deref(), query.as_ref(), form.as_ref(), json.as_ref()).await?;
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}: {}", snippet(&body)));
    }
    Ok(body)
}

/// Чтение из API Яндекс Музыки: операция из списка OPS (write = false). Возвращает текст JSON-ответа.
#[tauri::command]
pub async fn ym_read(
    op: String,
    id: Option<String>,
    query: Option<HashMap<String, String>>,
    form: Option<HashMap<String, String>>,
    json: Option<serde_json::Value>,
) -> Result<String, String> {
    run_op(false, op, id, query, form, json).await
}

/// Изменение данных аккаунта (лайки, плейлисты, отзывы «Моей волне»): операции OPS с write = true.
#[tauri::command]
pub async fn ym_write(
    op: String,
    id: Option<String>,
    query: Option<HashMap<String, String>>,
    form: Option<HashMap<String, String>>,
    json: Option<serde_json::Value>,
) -> Result<String, String> {
    run_op(true, op, id, query, form, json).await
}

async fn api_result(op: &str, id: &str, query: Option<HashMap<String, String>>) -> Result<serde_json::Value, String> {
    let body = run_op(false, op.into(), Some(id.into()), query, None, None).await?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|_| "Сервер вернул не JSON".to_string())?;
    Ok(v.get("result").cloned().unwrap_or(serde_json::Value::Null))
}

/// GET к проверенному адресу Яндекса, который пришёл в ответе API (download-info, файл текста).
/// Если это сам api.music.yandex.net (так бывает у download-info), токен подставляется, как и раньше,
/// а перенаправления разрешены только в пределах того же хоста; к другим хостам токен не уходит.
async fn plain_get(url: Url, max: usize) -> Result<Vec<u8>, String> {
    let req = if url.host_str() == Some(API_HOST) {
        let r = ym_headers(auth_client().get(url));
        match read_token() {
            Some(t) => r.header("Authorization", format!("OAuth {t}")),
            None => r,
        }
    } else {
        ym_headers(api_client().get(url))
    };
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}"));
    }
    read_limited(resp, max).await
}

/// Соль подписи ссылок /get-mp3/: так требует протокол Яндекс Музыки. MD5 здесь — не защита,
/// а совместимость с сервером; для паролей, токенов и своих подписей MD5 не используется (аудит F-12).
const MP3_SALT: &str = "XGRlBW9FXlekgbPrRHuSiA";

fn host_shape_ok(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 253
        && h.split('.').all(|l| !l.is_empty() && l.len() <= 63 && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}

fn word_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 256 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn mp3_path_ok(p: &str) -> bool {
    p.starts_with('/')
        && p.len() <= 4096 // у Яндекса путь бывает длиннее 1 КБ
        && !p.contains("..")
        && p.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-./%".contains(&b))
}

fn mp3_link(host: &str, path: &str, ts: &str, s: &str) -> Result<String, String> {
    let host = host.to_ascii_lowercase();
    if !host_shape_ok(&host) || !host_trusted(&host) || !mp3_path_ok(path) || !word_ok(ts) || !word_ok(s) {
        return Err("сервер вернул неожиданный адрес файла".into());
    }
    let sign = format!("{:x}", md5::compute(format!("{MP3_SALT}{}{s}", &path[1..])));
    Ok(format!("https://{host}/get-mp3/{sign}/{ts}{path}"))
}

/// Прямая ссылка на MP3 трека (лучшее качество): download-info → JSON с host/path → подпись.
pub async fn track_mp3_url(id: &str) -> Result<String, String> {
    if !id_ok(Id::Item, id) {
        return Err("Некорректный номер трека".into());
    }
    let infos = api_result("track_download_info", id, None).await?;
    let best = infos
        .as_array()
        .into_iter()
        .flatten()
        .filter(|i| i.get("codec").and_then(|c| c.as_str()) == Some("mp3"))
        .max_by_key(|i| i.get("bitrateInKbps").and_then(|b| b.as_u64()).unwrap_or(0))
        .ok_or("для этого трека нет MP3-версии")?;
    let raw = best.get("downloadInfoUrl").and_then(|u| u.as_str()).unwrap_or("");
    let mut url = checked_url(raw).map_err(|_| "сервер вернул неожиданный адрес файла".to_string())?;
    url.query_pairs_mut().append_pair("format", "json");
    let info: serde_json::Value = serde_json::from_slice(&plain_get(url, MAX_API_BODY).await?)
        .map_err(|_| "сервер вернул неожиданный ответ".to_string())?;
    let field = |k: &str| match info.get(k) {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    mp3_link(&field("host"), &field("path"), &field("ts"), &field("s"))
}

/// Ссылка для плеера <audio> (подпись MD5 теперь считает Rust — команды md5_hex больше нет).
#[tauri::command]
pub async fn ym_track_url(id: String) -> Result<String, String> {
    track_mp3_url(&id).await
}

/// Текст песни: /tracks/{id}/lyrics (подпись sign считает интерфейс по открытому ключу протокола)
/// и сразу же сам файл текста по ссылке из ответа. Возвращает текст (LRC или обычный).
#[tauri::command]
pub async fn ym_lyrics(id: String, format: String, time_stamp: u64, sign: String) -> Result<String, String> {
    if !matches!(format.as_str(), "LRC" | "TEXT") {
        return Err("Неизвестный формат текста".into());
    }
    if sign.len() > 128 || !sign.bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b)) {
        return Err("Некорректная подпись".into());
    }
    let q = HashMap::from([
        ("format".to_string(), format),
        ("timeStamp".to_string(), time_stamp.to_string()),
        ("sign".to_string(), sign),
    ]);
    let r = api_result("track_lyrics", &id, Some(q)).await?;
    let raw = r.get("downloadUrl").and_then(|u| u.as_str()).ok_or("текста нет")?;
    let url = checked_url(raw).map_err(|_| "сервер вернул неожиданный адрес текста".to_string())?;
    let bytes = plain_get(url, 2 * 1024 * 1024).await?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

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

async fn fetch_checked(url: &str) -> Result<Vec<u8>, String> {
    let url = checked_url(url)?;
    let resp = media_client()
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    read_limited(resp, MAX_AUDIO_BODY).await
}

/// Медиа Яндекса (обложки avatars.yandex.net, аудио *.storage.yandex.net и подписанные ссылки
/// api.music.yandex.net/get-mp3/…): только хосты *.yandex.net, без токена. С API-хоста — только /get-mp3/.
pub fn media_url_ok(raw: &str) -> bool {
    let Ok(u) = checked_url(raw) else { return false };
    let h = u.host_str().unwrap_or("").to_ascii_lowercase();
    h.ends_with(".yandex.net") && (h != API_HOST || u.path().starts_with("/get-mp3/"))
}

pub async fn fetch_media(url: &str) -> Result<Vec<u8>, String> {
    if !media_url_ok(url) {
        return Err("Адрес не входит в список разрешённых".into());
    }
    fetch_checked(url).await
}

#[tauri::command]
pub async fn fetch_bytes(url: String) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(fetch_media(&url).await?))
}

/// Origin страниц приложения: ответы своих протоколов (wa://, ymlocal://) разрешают CORS только ему,
/// а не любому присланному Origin (аудит F-11). На Windows страницы открываются с http://tauri.localhost,
/// в Linux и macOS — с tauri://localhost.
pub fn app_origin(origin: Option<&str>) -> Option<&'static str> {
    const ORIGINS: [&str; 3] = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];
    let o = origin?;
    ORIGINS.iter().copied().find(|x| *x == o)
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

    fn url_of(op: &str, id: Option<&str>, q: &[(&str, &str)]) -> Result<String, String> {
        let q: HashMap<String, String> = q.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        build_url(find_op(op).unwrap(), Some("123"), id, if q.is_empty() { None } else { Some(&q) }).map(|u| u.to_string())
    }

    #[test]
    fn ops_table() {
        // имена уникальны, у каждой операции фиксированный хост и путь без «..»
        let mut names: Vec<&str> = OPS.iter().map(|o| o.name).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), OPS.len());
        for o in OPS {
            assert!(o.path.starts_with('/') && !o.path.contains(".."));
            assert_eq!(o.id != Id::No, o.path.contains("{id}"), "{}", o.name);
            // изменения данных — только POST
            if o.write {
                assert_eq!(o.verb, Verb::Post, "{}", o.name);
            }
        }
    }

    #[test]
    fn urls() {
        assert_eq!(url_of("account_status", None, &[]).unwrap(), "https://api.music.yandex.net/account/status");
        assert_eq!(url_of("likes", None, &[]).unwrap(), "https://api.music.yandex.net/users/123/likes/tracks");
        assert_eq!(url_of("playlist", Some("1005"), &[]).unwrap(), "https://api.music.yandex.net/users/123/playlists/1005");
        assert_eq!(
            url_of("search", None, &[("text", "a&b=c/../"), ("type", "all"), ("page", "0")]).unwrap(),
            "https://api.music.yandex.net/search?text=a%26b%3Dc%2F..%2F&type=all&page=0"
        );
        assert!(url_of("search", None, &[("evil", "1")]).is_err());
        assert!(url_of("playlist", Some("../create"), &[]).is_err());
        assert!(url_of("playlist", Some("abc"), &[]).is_err());
        assert!(url_of("playlist", None, &[]).is_err());
        assert!(url_of("account_status", Some("1"), &[]).is_err());
        assert!(url_of("album", Some("a/b"), &[]).is_err());
        assert!(url_of("album", Some(".."), &[]).is_err());
        assert_eq!(url_of("track_download_info", Some("123:456"), &[]).unwrap(), "https://api.music.yandex.net/tracks/123:456/download-info");
        assert_eq!(url_of("rotor_tracks", Some("abc-DEF_1"), &[]).unwrap(), "https://api.music.yandex.net/rotor/session/abc-DEF_1/tracks");
        assert!(build_url(find_op("likes").unwrap(), Some("12/3"), None, None).is_err());
        assert!(build_url(find_op("likes").unwrap(), None, None, None).is_err());
    }

    #[test]
    fn read_write_split() {
        assert!(find_op("like_add").unwrap().write);
        assert!(find_op("playlist_delete").unwrap().write);
        assert!(!find_op("likes").unwrap().write);
        assert!(find_op("http_request").is_none());
        let r = tauri::async_runtime::block_on(run_op(false, "like_add".into(), None, None, None, None));
        assert!(r.unwrap_err().contains("не разрешена"));
        let r = tauri::async_runtime::block_on(run_op(true, "likes".into(), None, None, None, None));
        assert!(r.unwrap_err().contains("не разрешена"));
    }

    #[test]
    fn bodies() {
        let f = |pairs: &[(&str, &str)]| -> HashMap<String, String> { pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() };
        let op = find_op("playlist_create").unwrap();
        let (ct, b) = build_body(op, Some(&f(&[("title", "Мой & плейлист"), ("visibility", "private")])), None).unwrap().unwrap();
        assert_eq!(ct, "application/x-www-form-urlencoded");
        assert_eq!(b, "title=%D0%9C%D0%BE%D0%B9+%26+%D0%BF%D0%BB%D0%B5%D0%B9%D0%BB%D0%B8%D1%81%D1%82&visibility=private");
        assert!(build_body(op, Some(&f(&[("title", "x"), ("owner", "1")])), None).is_err());
        assert!(build_body(op, None, Some(&serde_json::json!({}))).is_err());
        let rotor = find_op("rotor_new").unwrap();
        assert!(build_body(rotor, None, Some(&serde_json::json!({"seeds": ["user:onyourwave"]}))).is_ok());
        assert!(build_body(rotor, None, Some(&serde_json::json!([1, 2]))).is_err());
        assert!(build_body(find_op("playlist_delete").unwrap(), Some(&f(&[])), None).is_err());
    }

    #[test]
    fn mp3() {
        let l = mp3_link("S1.storage.yandex.net", "/get-mp3/x/abc.mp3", "0005f", "deadbeef").unwrap();
        assert!(l.starts_with("https://s1.storage.yandex.net/get-mp3/"));
        assert!(l.ends_with("/0005f/get-mp3/x/abc.mp3"));
        assert!(mp3_link("evil.com", "/a", "1", "2").is_err());
        assert!(mp3_link("s1.storage.yandex.net", "/../a", "1", "2").is_err());
        assert!(mp3_link("s1.storage.yandex.net", "/a?b", "1", "2").is_err());
        assert!(mp3_link("s1.storage.yandex.net:81", "/a", "1", "2").is_err());
        assert!(mp3_link("s1.storage.yandex.net", &format!("/{}", "a".repeat(1100)), "1", "2").is_ok()); // длинные пути бывают
    }

    /// Проверка на настоящем API с токеном из хранилища (только чтение — аккаунт не меняется):
    /// cargo test --lib live_yandex -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_yandex() {
        tauri::async_runtime::block_on(async {
            let r = |op: &str, id: Option<&str>, q: &[(&str, &str)]| {
                let q: HashMap<String, String> = q.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
                let (op, id) = (op.to_string(), id.map(str::to_string));
                async move { run_op(false, op, id, if q.is_empty() { None } else { Some(q) }, None, None).await }
            };
            let st: serde_json::Value = serde_json::from_str(&r("account_status", None, &[]).await.unwrap()).unwrap();
            assert!(st.pointer("/result/account/uid").is_some());
            println!("account_status ok, uid cached: {}", uid_cache().lock().unwrap().is_some());
            let likes: serde_json::Value = serde_json::from_str(&r("likes", None, &[]).await.unwrap()).unwrap();
            let n = likes.pointer("/result/library/tracks").and_then(|t| t.as_array()).map(|a| a.len()).unwrap_or(0);
            println!("likes ok: {n} tracks");
            let s: serde_json::Value = serde_json::from_str(&r("search", None, &[("text", "Кино группа крови"), ("type", "all"), ("page", "0")]).await.unwrap()).unwrap();
            let t = s.pointer("/result/tracks/results/0").expect("search result").clone();
            let tid = t.get("id").map(|v| v.to_string().trim_matches('"').to_string()).unwrap();
            let aid = t.pointer("/albums/0/id").map(|v| v.to_string()).unwrap();
            println!("search ok: track {tid}, album {aid}");
            let al = r("album", Some(&aid), &[]).await.unwrap();
            println!("album ok: {} bytes", al.len());
            let ar = t.pointer("/artists/0/id").map(|v| v.to_string()).unwrap();
            r("artist_brief", Some(&ar), &[]).await.unwrap();
            r("artist_albums", Some(&ar), &[("page", "0"), ("page-size", "20"), ("sort-by", "year")]).await.unwrap();
            r("artist_tracks", Some(&ar), &[("page", "0"), ("page-size", "50")]).await.unwrap();
            println!("artist ok");
            r("genres", None, &[]).await.unwrap();
            r("wave_settings", None, &[("language", "ru")]).await.unwrap();
            r("playlists", None, &[]).await.unwrap();
            r("dislikes", None, &[]).await.unwrap();
            println!("genres/wave/playlists/dislikes ok");
            let tracks = run_op(false, "tracks".into(), None, None, Some(HashMap::from([("track-ids".to_string(), tid.clone())])), None).await.unwrap();
            assert!(tracks.contains(&tid));
            let nw = run_op(false, "rotor_new".into(), None, None, None, Some(serde_json::json!({"seeds": ["user:onyourwave"], "includeTracksInResponse": true}))).await.unwrap();
            println!("tracks ok; rotor_new ok: {} bytes", nw.len());
            let url = track_mp3_url(&tid).await.unwrap();
            assert!(media_url_ok(&url), "{url}");
            let head = fetch_media(&url).await.unwrap();
            println!("track url ok, mp3 {} bytes, starts {:?}", head.len(), &head[..3]);
        });
    }

    #[test]
    fn media_and_origin() {
        assert!(media_url_ok("https://avatars.yandex.net/get-music-content/1/2/400x400"));
        assert!(media_url_ok("https://s97vla.storage.yandex.net/get-mp3/a/b/c"));
        assert!(!media_url_ok("https://api.music.yandex.net/account/status"));
        assert!(media_url_ok("https://api.music.yandex.net/get-mp3/abc/123/U2F/x"));
        assert!(!media_url_ok("https://api.music.yandex.net/users/1/likes/tracks"));
        assert!(!media_url_ok("https://music.yandex.ru/"));
        assert!(!media_url_ok("http://avatars.yandex.net/x"));
        assert_eq!(app_origin(Some("http://tauri.localhost")), Some("http://tauri.localhost"));
        assert_eq!(app_origin(Some("tauri://localhost")), Some("tauri://localhost"));
        assert_eq!(app_origin(Some("https://evil.example")), None);
        assert_eq!(app_origin(Some("null")), None);
        assert_eq!(app_origin(None), None);
    }
}
