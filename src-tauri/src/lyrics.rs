//! Тексты песен из LRCLIB (https://lrclib.net) — открытая база текстов, в том числе синхронизированных (LRC).
//! Используется, когда у Яндекса текста нет или его хочется сравнить. Запрос идёт только на lrclib.net:
//! отдельный клиент, без токена Яндекса и без перенаправлений на другие адреса.

use serde::Serialize;
use serde_json::Value;
use std::{sync::OnceLock, time::Duration};
use tauri_plugin_http::reqwest::{redirect, Client, Url};

const HOST: &str = "lrclib.net";
const MAX_BODY: usize = 2 * 1024 * 1024;

fn client() -> &'static Client {
    static C: OnceLock<Client> = OnceLock::new();
    C.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(15))
            .redirect(redirect::Policy::custom(|a| {
                if a.previous().len() < 3 && a.url().scheme() == "https" && a.url().host_str() == Some(HOST) {
                    a.follow()
                } else {
                    a.error("перенаправление за пределы lrclib.net")
                }
            }))
            // LRCLIB просит указывать приложение в User-Agent
            .user_agent(concat!("yandex-desktop/", env!("CARGO_PKG_VERSION"), " (personal desktop client)"))
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

async fn get_json(url: Url) -> Result<Option<Value>, String> {
    let r = client().get(url).send().await.map_err(|e| format!("LRCLIB недоступен: {e}"))?;
    if r.status().as_u16() == 404 {
        return Ok(None);
    }
    if !r.status().is_success() {
        return Err(format!("LRCLIB: HTTP {}", r.status().as_u16()));
    }
    if r.content_length().is_some_and(|n| n as usize > MAX_BODY) {
        return Err("LRCLIB: слишком большой ответ".into());
    }
    let b = r.bytes().await.map_err(|e| e.to_string())?;
    if b.len() > MAX_BODY {
        return Err("LRCLIB: слишком большой ответ".into());
    }
    serde_json::from_slice(&b).map(Some).map_err(|_| "LRCLIB: непонятный ответ".to_string())
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

/// Точный поиск (исполнитель + название + альбом + длительность), а если не нашлось — обычный поиск,
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

    if !artist.is_empty() && !dur_s.is_empty() {
        let q = [("artist_name", artist.as_str()), ("track_name", title.as_str()), ("album_name", album.as_str()), ("duration", dur_s.as_str())];
        if let Some(v) = get_json(url("/api/get", &q)).await? {
            let l = pick(&v);
            if l.synced.is_some() || l.plain.is_some() || l.instrumental {
                return Ok(Some(l));
            }
        }
    }

    let q = [("track_name", title.as_str()), ("artist_name", artist.as_str())];
    let Some(Value::Array(items)) = get_json(url("/api/search", &q)).await? else { return Ok(None) };
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
