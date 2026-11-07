// Кэш приложения: нескачанные треки, которые не нужно каждый раз тянуть с Яндекса (src/cache.js).
//
//   * «популярные» — трек дослушали POP_PLAYS раз: ложится в кэш и живёт дольше всех (удаляется последним);
//   * «текущий плейлист» — уже проигранные треки того, что сейчас слушается (альбом, плейлист, лайки…):
//     при переключении на другой плейлист такие треки (если они не популярные) удаляются;
//   * «Моя волна» — дослушанные треки волны: последние wave_max (по умолчанию 20), старые уходят сами;
//     смена плейлиста их не трогает (волна — не плейлист);
//   * лимит размера: переполнилось — сначала уходят треки плейлиста (старые первыми), потом популярные
//     с наименьшим числом прослушиваний. Лимит 0 — кэш выключен (и очищен).
//
// Где лежит: системная папка кэша приложения (app_cache_dir) / tracks —
//   Windows: %LOCALAPPDATA%\<identifier>\tracks, Linux: $XDG_CACHE_HOME/<identifier>/tracks (обычно ~/.cache/…).
// Скачанные треки (download.rs) сюда не попадают — они и так на диске.
// Играется кэш тем же ymlocal://localhost/track/<id> и своим движком: download::open_local смотрит сюда,
// если трека нет среди скачанных. Файл берётся только по номеру трека и только из этой папки.
use crate::net;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const INDEX_FILE: &str = "index.json";
const INDEX_MAX_BYTES: u64 = 8 * 1024 * 1024;
/// Сколько раз дослушать трек, чтобы он стал «популярным».
const POP_PLAYS: u32 = 3;
/// Сколько треков помнить в счётчике прослушиваний (самые давние забываются).
const PLAYS_MAX: usize = 5000;
const DEFAULT_LIMIT_MB: u64 = 1024;
const MAX_LIMIT_MB: u64 = 100 * 1024;
/// Сколько треков «Моей волны» держать по умолчанию и не больше какого числа.
const DEFAULT_WAVE_MAX: u32 = 20;
const MAX_WAVE: u32 = 500;
static LOCK: Mutex<()> = Mutex::new(());
static INFLIGHT: Mutex<Option<HashSet<String>>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Clone)]
struct Item {
    size: u64,
    ext: String,
    /// популярный — живёт дольше; pl — проигран в текущем плейлисте
    #[serde(default)]
    pop: bool,
    #[serde(default)]
    pl: bool,
    /// дослушан в «Моей волне»
    #[serde(default)]
    wave: bool,
    last: u64,
}

#[derive(Serialize, Deserialize, Default, Clone, Copy)]
struct Plays {
    n: u32,
    last: u64,
}

#[derive(Serialize, Deserialize)]
struct Index {
    limit_mb: u64,
    /// сохранять ли проигранные треки текущего плейлиста
    #[serde(default = "yes")]
    playlist: bool,
    /// ключ текущего плейлиста (src/cache.js: «album:123», «likes»…); другой — треки прошлого удаляются
    #[serde(default)]
    current: Option<String>,
    /// сколько последних треков «Моей волны» хранить (0 — волну не кэшировать)
    #[serde(default = "wave_default")]
    wave_max: u32,
    #[serde(default)]
    items: HashMap<String, Item>,
    #[serde(default)]
    plays: HashMap<String, Plays>,
}

fn yes() -> bool {
    true
}

fn wave_default() -> u32 {
    DEFAULT_WAVE_MAX
}

impl Default for Index {
    fn default() -> Self {
        Self { limit_mb: DEFAULT_LIMIT_MB, playlist: true, current: None, wave_max: DEFAULT_WAVE_MAX, items: HashMap::new(), plays: HashMap::new() }
    }
}

/// Номер трека Яндекса — только цифры (из него собирается имя файла).
fn id_ok(id: &str) -> bool {
    (1..=20).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit())
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map(|d| d.join("tracks")).map_err(|e| format!("Нет папки кэша: {e}"))
}

fn file_of(dir: &std::path::Path, id: &str, it: &Item) -> PathBuf {
    let ext = if matches!(it.ext.as_str(), "mp3" | "flac" | "m4a" | "aac" | "ogg") { it.ext.as_str() } else { "mp3" };
    dir.join(format!("{id}.{ext}"))
}

fn read(app: &AppHandle) -> Index {
    let Ok(d) = dir(app) else { return Index::default() };
    match crate::download::read_capped(&d.join(INDEX_FILE), INDEX_MAX_BYTES) {
        Ok(Some(b)) => serde_json::from_slice(&b).unwrap_or_default(),
        _ => Index::default(),
    }
}

fn write(app: &AppHandle, idx: &Index) -> Result<(), String> {
    let d = dir(app)?;
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let tmp = d.join(".index.json.part");
    let body = serde_json::to_vec(idx).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, d.join(INDEX_FILE)).map_err(|e| e.to_string())
}

fn remove_item(d: &std::path::Path, idx: &mut Index, id: &str) {
    if let Some(it) = idx.items.remove(id) {
        let _ = std::fs::remove_file(file_of(d, id, &it));
    }
}

/// Освободить место до лимита: сначала треки плейлиста (не популярные), старые первыми; потом популярные —
/// реже слушаемые первыми. `keep` — только что добавленный трек, его не трогаем.
fn evict(d: &std::path::Path, idx: &mut Index, keep: Option<&str>) {
    let limit = idx.limit_mb.saturating_mul(1024 * 1024);
    let mut total: u64 = idx.items.values().map(|i| i.size).sum();
    if total <= limit {
        return;
    }
    let mut order: Vec<(String, bool, u32, u64, u64)> = idx
        .items
        .iter()
        .filter(|(id, _)| Some(id.as_str()) != keep)
        .map(|(id, it)| (id.clone(), it.pop, idx.plays.get(id).map_or(0, |p| p.n), it.last, it.size))
        .collect();
    // (не популярные раньше популярных, меньше прослушиваний раньше, давнее раньше)
    order.sort_by(|a, b| a.1.cmp(&b.1).then(a.2.cmp(&b.2)).then(a.3.cmp(&b.3)));
    for (id, _, _, _, size) in order {
        if total <= limit {
            break;
        }
        remove_item(d, idx, &id);
        total = total.saturating_sub(size);
    }
}

/// Треки только из волны (не популярные и не из плейлиста): остаются последние wave_max, старые удаляются.
fn trim_wave(d: &std::path::Path, idx: &mut Index) {
    let mut w: Vec<(String, u64)> = idx.items.iter().filter(|(_, it)| it.wave && !it.pop && !it.pl).map(|(id, it)| (id.clone(), it.last)).collect();
    if w.len() <= idx.wave_max as usize {
        return;
    }
    w.sort_by(|a, b| b.1.cmp(&a.1)); // свежие первыми
    for (id, _) in w.into_iter().skip(idx.wave_max as usize) {
        remove_item(d, idx, &id);
    }
}

/// Другой плейлист — проигранные треки прошлого (кроме популярных) больше не нужны.
/// Треки волны остаются: у них свой счёт (trim_wave).
fn switch_playlist(d: &std::path::Path, idx: &mut Index, ctx: Option<&str>) {
    if idx.current.as_deref() == ctx {
        return;
    }
    idx.current = ctx.map(str::to_string);
    let old: Vec<String> = idx.items.iter().filter(|(_, it)| it.pl && !it.pop && !it.wave).map(|(id, _)| id.clone()).collect();
    for id in old {
        remove_item(d, idx, &id);
    }
    for it in idx.items.values_mut() {
        it.pl = false;
    }
}

/// Открыть трек из кэша для воспроизведения (download::open_local, если трек не скачан).
pub fn open(app: &AppHandle, id: &str) -> Option<(std::fs::File, PathBuf, u64)> {
    if !id_ok(id) {
        return None;
    }
    // Индекс не читаем: ymlocal:// просит файл кусками по 2 МБ, и разбирать индекс на каждый кусок незачем.
    // Имя файла собирается только из цифр номера и известного расширения — за пределы папки кэша не выйти.
    let d = dir(app).ok()?;
    let p = ["mp3", "flac", "m4a", "aac", "ogg"].iter().map(|e| d.join(format!("{id}.{e}"))).find(|p| p.is_file())?;
    let f = std::fs::File::open(&p).ok()?;
    let m = f.metadata().ok()?;
    if !m.is_file() || m.len() == 0 {
        return None;
    }
    Some((f, p, m.len()))
}

#[derive(Serialize)]
pub struct CacheInfo {
    dir: String,
    bytes: u64,
    count: usize,
    popular: usize,
    limit_mb: u64,
    playlist: bool,
    wave_max: u32,
    /// занято по видам (каждый трек считается один раз: популярный → плейлист → волна)
    pop_bytes: u64,
    pl_bytes: u64,
    wave_bytes: u64,
    pl_count: usize,
    wave_count: usize,
}

/// Вид трека в кэше для подсчёта места: 0 — популярный, 1 — плейлист, 2 — волна.
fn kind(it: &Item) -> u8 {
    if it.pop {
        0
    } else if it.pl {
        1
    } else if it.wave {
        2
    } else {
        1
    }
}

#[tauri::command]
pub fn cache_info(app: AppHandle) -> Result<CacheInfo, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let idx = read(&app);
    let sum = |k: u8| idx.items.values().filter(|i| kind(i) == k).map(|i| i.size).sum::<u64>();
    let cnt = |k: u8| idx.items.values().filter(|i| kind(i) == k).count();
    Ok(CacheInfo {
        dir: dir(&app)?.to_string_lossy().into_owned(),
        bytes: idx.items.values().map(|i| i.size).sum(),
        count: idx.items.len(),
        popular: cnt(0),
        limit_mb: idx.limit_mb,
        playlist: idx.playlist,
        wave_max: idx.wave_max,
        pop_bytes: sum(0),
        pl_bytes: sum(1),
        wave_bytes: sum(2),
        pl_count: cnt(1),
        wave_count: cnt(2),
    })
}

/// Номера треков в кэше — интерфейс по ним решает, играть ли трек с диска.
#[tauri::command]
pub fn cache_ids(app: AppHandle) -> Vec<String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read(&app).items.into_keys().collect()
}

/// Настройки: лимит (МБ, 0 — кэш выключен), «сохранять текущий плейлист» и сколько треков «Моей волны» хранить
/// (0 — волну не кэшировать). Возвращает номера, что остались.
#[tauri::command]
pub fn cache_config(app: AppHandle, limit_mb: Option<u64>, playlist: Option<bool>, wave_max: Option<u32>) -> Result<Vec<String>, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let d = dir(&app)?;
    let mut idx = read(&app);
    if let Some(mb) = limit_mb {
        idx.limit_mb = mb.min(MAX_LIMIT_MB);
    }
    if let Some(on) = playlist {
        idx.playlist = on;
        if !on {
            switch_playlist(&d, &mut idx, None);
        }
    }
    if let Some(n) = wave_max {
        idx.wave_max = n.min(MAX_WAVE);
        trim_wave(&d, &mut idx);
    }
    if idx.limit_mb == 0 {
        let ids: Vec<String> = idx.items.keys().cloned().collect();
        for id in ids {
            remove_item(&d, &mut idx, &id);
        }
    } else {
        evict(&d, &mut idx, None);
    }
    write(&app, &idx)?;
    Ok(idx.items.into_keys().collect())
}

/// Очистить кэш (счётчик прослушиваний остаётся — популярные снова наберутся сами).
#[tauri::command]
pub fn cache_clear(app: AppHandle) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let d = dir(&app)?;
    let mut idx = read(&app);
    let ids: Vec<String> = idx.items.keys().cloned().collect();
    for id in ids {
        remove_item(&d, &mut idx, &id);
    }
    // на всякий случай — недокачанные куски и файлы, которые не удалились раньше (Windows не стирает открытый файл)
    if let Ok(rd) = std::fs::read_dir(&d) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            let ours = n.ends_with(".part")
                || n.split_once('.').is_some_and(|(stem, ext)| id_ok(stem) && matches!(ext, "mp3" | "flac" | "m4a" | "aac" | "ogg"));
            if ours && e.file_type().is_ok_and(|t| t.is_file()) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    write(&app, &idx)
}

/// Трек из кэша не открылся (повреждён) — забыть его.
#[tauri::command]
pub fn cache_forget(app: AppHandle, id: String) -> Result<(), String> {
    if !id_ok(&id) {
        return Ok(());
    }
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let d = dir(&app)?;
    let mut idx = read(&app);
    remove_item(&d, &mut idx, &id);
    write(&app, &idx)
}

#[tauri::command]
pub fn cache_open_dir(app: AppHandle) -> Result<(), String> {
    let d = dir(&app)?;
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    app.opener().open_path(d.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Трек дослушан (src/cache.js). `ctx` — ключ текущего плейлиста (None — волна и прочее, не плейлист),
/// `wave` — играет «Моя волна», `downloaded` — трек уже скачан (тогда только счётчик). Решает, класть ли трек в кэш, и при необходимости
/// скачивает его с Яндекса. Возвращает true, если трек теперь в кэше.
#[tauri::command]
pub async fn cache_played(app: AppHandle, id: String, ctx: Option<String>, wave: Option<bool>, downloaded: bool) -> Result<bool, String> {
    if !id_ok(&id) {
        return Ok(false);
    }
    let ctx = ctx.filter(|c| (1..=120).contains(&c.len()) && c.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_')));
    let d = dir(&app)?;
    let need = {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut idx = read(&app);
        let t = now();
        let p = idx.plays.entry(id.clone()).or_default();
        p.n = p.n.saturating_add(1);
        p.last = t;
        let pop = p.n >= POP_PLAYS;
        if idx.plays.len() > PLAYS_MAX {
            let mut v: Vec<(String, u64)> = idx.plays.iter().map(|(k, p)| (k.clone(), p.last)).collect();
            v.sort_by_key(|x| x.1);
            for (k, _) in v.into_iter().take(idx.plays.len() - PLAYS_MAX) {
                if !idx.items.contains_key(&k) {
                    idx.plays.remove(&k);
                }
            }
        }
        let in_pl = idx.playlist && ctx.is_some();
        let in_wave = wave == Some(true) && ctx.is_none() && idx.wave_max > 0;
        let target = if idx.playlist { ctx.clone() } else { None };
        switch_playlist(&d, &mut idx, target.as_deref());
        let mut need = false;
        if let Some(it) = idx.items.get_mut(&id) {
            it.pop |= pop;
            it.pl |= in_pl;
            it.wave |= in_wave;
            it.last = t;
        } else if !downloaded && idx.limit_mb > 0 && (pop || in_pl || in_wave) {
            need = true;
        }
        write(&app, &idx)?;
        if !need {
            return Ok(idx.items.contains_key(&id));
        }
        (pop, in_pl, in_wave)
    };
    // один и тот же трек не качаем дважды одновременно
    {
        let mut g = INFLIGHT.lock().unwrap_or_else(|e| e.into_inner());
        let set = g.get_or_insert_with(HashSet::new);
        if !set.insert(id.clone()) {
            return Ok(false);
        }
    }
    let res = fetch_into(&app, &d, &id, need).await;
    if let Ok(mut g) = INFLIGHT.lock() {
        if let Some(s) = g.as_mut() {
            s.remove(&id);
        }
    }
    res
}

async fn fetch_into(app: &AppHandle, d: &std::path::Path, id: &str, (pop, pl, wave): (bool, bool, bool)) -> Result<bool, String> {
    let url = net::track_mp3_url(id).await?;
    let bytes = net::fetch_media(&url).await?;
    if bytes.len() < 1024 {
        return Err("Сервер вернул пустой файл".into());
    }
    let ext = if bytes.starts_with(b"fLaC") { "flac" } else if bytes.len() > 8 && &bytes[4..8] == b"ftyp" { "m4a" } else { "mp3" };
    std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    let item = Item { size: bytes.len() as u64, ext: ext.into(), pop, pl, wave, last: now() };
    let tmp = d.join(format!(".{id}.part"));
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    drop(bytes);
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut idx = read(app);
    // пока качали, кэш выключили, отключили плейлист или волну (а трек не популярный) — не нужен
    if idx.limit_mb == 0 || (!pop && pl && !idx.playlist) || (!pop && !pl && wave && idx.wave_max == 0) {
        let _ = std::fs::remove_file(&tmp);
        return Ok(false);
    }
    std::fs::rename(&tmp, file_of(d, id, &item)).map_err(|e| e.to_string())?;
    idx.items.insert(id.to_string(), item);
    trim_wave(d, &mut idx);
    evict(d, &mut idx, Some(id));
    write(app, &idx)?;
    Ok(idx.items.contains_key(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn it(size: u64, pop: bool, pl: bool, last: u64) -> Item {
        Item { size, ext: "mp3".into(), pop, pl, wave: false, last }
    }

    #[test]
    fn wave_trim_and_switch() {
        let d = std::env::temp_dir().join(format!("yd-cache-wave-{}", std::process::id()));
        let mut idx = Index { wave_max: 2, current: Some("album:1".into()), ..Default::default() };
        for (id, last) in [("1", 10), ("2", 30), ("3", 20)] {
            idx.items.insert(id.into(), Item { wave: true, ..it(1, false, false, last) });
        }
        idx.items.insert("4".into(), Item { wave: true, ..it(1, true, false, 1) }); // популярный — не в счёт волны
        trim_wave(&d, &mut idx);
        assert!(!idx.items.contains_key("1") && idx.items.contains_key("2") && idx.items.contains_key("3") && idx.items.contains_key("4"));
        // смена плейлиста треки волны не трогает
        switch_playlist(&d, &mut idx, Some("album:2"));
        assert!(idx.items.contains_key("2") && idx.items.contains_key("3"));
    }

    #[test]
    fn ids() {
        assert!(id_ok("12345"));
        assert!(!id_ok("12a"));
        assert!(!id_ok("../1"));
        assert!(!id_ok(""));
    }

    #[test]
    fn evict_order() {
        let d = std::env::temp_dir().join(format!("yd-cache-{}", std::process::id()));
        let mut idx = Index { limit_mb: 2, ..Default::default() };
        let mb = 1024 * 1024;
        idx.items.insert("1".into(), it(mb, true, false, 10)); // популярный, давний
        idx.items.insert("2".into(), it(mb, false, true, 50)); // плейлист, свежий
        idx.items.insert("3".into(), it(mb, false, true, 20)); // плейлист, старый
        idx.plays.insert("1".into(), Plays { n: 5, last: 10 });
        evict(&d, &mut idx, None);
        // сверх лимита — 1 МБ: уходит старый трек плейлиста, популярный остаётся
        assert!(idx.items.contains_key("1") && idx.items.contains_key("2") && !idx.items.contains_key("3"));
    }

    #[test]
    fn playlist_switch() {
        let d = std::env::temp_dir().join(format!("yd-cache-sw-{}", std::process::id()));
        let mut idx = Index { current: Some("album:1".into()), ..Default::default() };
        idx.items.insert("1".into(), it(1, true, true, 0));
        idx.items.insert("2".into(), it(1, false, true, 0));
        switch_playlist(&d, &mut idx, Some("album:2"));
        assert!(idx.items.contains_key("1") && !idx.items.contains_key("2"));
        assert!(!idx.items["1"].pl);
        assert_eq!(idx.current.as_deref(), Some("album:2"));
    }
}
