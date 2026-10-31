//! Тексты песен из LRCLIB (https://lrclib.net) — открытая база текстов, в том числе синхронизированных (LRC).
//! Используется, когда у Яндекса текста нет или его хочется сравнить. Запрос идёт только на lrclib.net:
//! отдельный клиент, без токена Яндекса и без перенаправлений на другие адреса.
//!
//! LRCLIB бывает нестабилен: ограничивает частоту запросов (429 с Retry-After), иногда долго думает над точным
//! поиском (/api/get) и закрывает простаивающие соединения. Поэтому: один повтор при сбое, точный поиск при ошибке
//! не обрывает всё — дальше идёт обычный (/api/search), а ошибка уходит в JS с понятной причиной в начале строки
//! («limit:», «timeout:», «net:», «http:») — по ней интерфейс пишет, что случилось, а не «проверь интернет».

use serde::Serialize;
use serde_json::Value;
use std::{sync::OnceLock, time::Duration};
use tauri_plugin_http::reqwest::{redirect, Client, StatusCode, Url};

const HOST: &str = "lrclib.net";
const MAX_BODY: usize = 2 * 1024 * 1024;

fn client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(15))
            // сервер закрывает простаивающие соединения раньше, чем их выбросил бы пул, — тогда следующий запрос
            // уходил в уже мёртвое соединение и падал с «connection closed». Держим соединения недолго.
            .pool_idle_timeout(Duration::from_secs(20))
            .redirect(redirect::Policy::custom(|a| {
                if a.previous().len() < 3 && a.url().scheme() == "https" && a.url().host_str() == Some(HOST) {
                    a.follow()
                } else {
                    a.error("перенаправление за пределы lrclib.net")
                }
            }))
            // LRCLIB просит указывать приложение, версию и ссылку — «опознанным» клиентам лимит запросов выше
            .user_agent(concat!(
                "YandexMusic-WhisperEdition/",
                env!("CARGO_PKG_VERSION"),
                " (https://github.com/Whisper-Music/YandexMusic-WhisperEdition)"
            ))
            .build()
            .expect("не удалось создать HTTP-клиент для LRCLIB")
    })
}

#[derive(Serialize, Default)]
pub struct Lyrics {
    synced: Option<String>,
    plain: Option<String>,
    instrumental: bool,
}

fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}

/// Ошибка, после которой есть смысл попробовать ещё раз (и через сколько).
enum Fail {
    Retry(String, Duration),
    Final(String),
}

async fn get_once(url: &Url) -> Result<Option<Value>, Fail> {
    let mut r = match client().get(url.clone()).send().await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => return Err(Fail::Retry(format!("timeout: LRCLIB долго не отвечает ({e})"), Duration::from_millis(300))),
        Err(e) => return Err(Fail::Retry(format!("net: LRCLIB недоступен ({e})"), Duration::from_millis(500))),
    };
    let st = r.status();
    if st == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if st == StatusCode::TOO_MANY_REQUESTS {
        // ждём столько, сколько просит сервер, но не дольше 5 с — дольше человек ждать не станет
        let wait = r
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(2)
            .min(5);
        return Err(Fail::Retry("limit: LRCLIB просит подождать — слишком много запросов".into(), Duration::from_secs(wait)));
    }
    if st.is_server_error() {
        return Err(Fail::Retry(format!("http: LRCLIB: ошибка сервера {}", st.as_u16()), Duration::from_millis(800)));
    }
    if !st.is_success() {
        return Err(Fail::Final(format!("http: LRCLIB: HTTP {}", st.as_u16())));
    }
    if r.content_length().is_some_and(|n| n as usize > MAX_BODY) {
        return Err(Fail::Final("http: LRCLIB: слишком большой ответ".into()));
    }
    // кусками и с обрывом на лимите: без Content-Length (chunked) bytes() прочитал бы ответ любого размера
    let mut b: Vec<u8> = Vec::new();
    loop {
        match r.chunk().await {
            Ok(Some(chunk)) => {
                if b.len() + chunk.len() > MAX_BODY {
                    return Err(Fail::Final("http: LRCLIB: слишком большой ответ".into()));
                }
                b.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) if e.is_timeout() => return Err(Fail::Retry(format!("timeout: LRCLIB долго не отвечает ({e})"), Duration::from_millis(300))),
            Err(e) => return Err(Fail::Retry(format!("net: ответ LRCLIB оборвался ({e})"), Duration::from_millis(500))),
        }
    }
    serde_json::from_slice(&b).map(Some).map_err(|_| Fail::Final("http: LRCLIB: непонятный ответ".to_string()))
}

/// Запрос с одним повтором при временном сбое.
async fn get_json(url: Url) -> Result<Option<Value>, String> {
    match get_once(&url).await {
        Ok(v) => Ok(v),
        Err(Fail::Final(e)) => Err(e),
        Err(Fail::Retry(_, wait)) => {
            tokio::time::sleep(wait).await;
            get_once(&url).await.map_err(|f| match f {
                Fail::Retry(e, _) | Fail::Final(e) => e,
            })
        }
    }
}

fn pick(v: &Value) -> Lyrics {
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string).filter(|x| !x.trim().is_empty());
    Lyrics {
        synced: s("syncedLyrics"),
        plain: s("plainLyrics"),
        instrumental: v.get("instrumental").and_then(Value::as_bool).unwrap_or(false),
    }
}

fn url(path: &str, q: &[(&str, &str)]) -> Url {
    let mut u = Url::parse(&format!("https://{HOST}{path}")).unwrap();
    u.query_pairs_mut().extend_pairs(q.iter().filter(|(_, v)| !v.is_empty()));
    u
}

/// Точный поиск (исполнитель + название + альбом + длительность), а если не нашлось или он не ответил — обычный поиск,
/// из которого берётся вариант с ближайшей длительностью (и с синхронизированным текстом, если такой есть).
#[tauri::command]
pub async fn lyrics_lrclib(artist: String, title: String, album: Option<String>, duration: Option<f64>) -> Result<Option<Lyrics>, String> {
    let artist = clean(&artist, 300);
    let title = clean(&title, 300);
    let album = clean(album.as_deref().unwrap_or(""), 300);
    if title.is_empty() {
        return Ok(None);
    }
    let dur = duration.filter(|d| d.is_finite() && *d > 0.0 && *d < 6.0 * 3600.0);
    let dur_s = dur.map(|d| (d.round() as u64).to_string()).unwrap_or_default();

    // ошибку точного поиска запоминаем, но не сдаёмся: обычный поиск часто отвечает, когда точный — нет
    let mut first_err: Option<String> = None;
    if !artist.is_empty() && !dur_s.is_empty() {
        let q = [("artist_name", artist.as_str()), ("track_name", title.as_str()), ("album_name", album.as_str()), ("duration", dur_s.as_str())];
        match get_json(url("/api/get", &q)).await {
            Ok(Some(v)) => {
                let l = pick(&v);
                if l.synced.is_some() || l.plain.is_some() || l.instrumental {
                    return Ok(Some(l));
                }
            }
            Ok(None) => {}
            // лимит запросов — второй запрос сразу упрётся в него же
            Err(e) if e.starts_with("limit:") => return Err(e),
            Err(e) => first_err = Some(e),
        }
    }

    let q = [("track_name", title.as_str()), ("artist_name", artist.as_str())];
    let items = match get_json(url("/api/search", &q)).await {
        Ok(Some(Value::Array(items))) => items,
        Ok(_) => return Ok(None),
        Err(e) => return Err(first_err.unwrap_or(e)),
    };
    let score = |v: &Value| {
        let d = v.get("duration").and_then(Value::as_f64).unwrap_or(0.0);
        let off = dur.map(|x| (x - d).abs()).unwrap_or(0.0);
        let synced = v.get("syncedLyrics").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty());
        (off, synced)
    };
    // длительность расходится больше чем на 8 секунд — скорее всего, другая версия трека
    let best = items
        .iter()
        .filter(|v| score(v).0 <= 8.0)
        .min_by(|a, b| {
            let (oa, sa) = score(a);
            let (ob, sb) = score(b);
            sb.cmp(&sa).then(oa.partial_cmp(&ob).unwrap_or(std::cmp::Ordering::Equal))
        });
    Ok(best.map(pick).filter(|l| l.synced.is_some() || l.plain.is_some() || l.instrumental))
}
