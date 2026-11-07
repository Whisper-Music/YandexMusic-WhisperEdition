// «Студия» (src/studio.js): свои версии треков. Пока одна функция — обрезать трек.
//
// Исходник — mp3 трека: скачанный файл, если он mp3, иначе Rust сам берёт его у Яндекса по номеру (адрес файла
// интерфейс не передаёт). Обрезка — без перекодирования: из mp3 вырезаются целые кадры (по ~26 мс), качество
// остаётся как у исходника, а работа занимает доли секунды. Первый кадр после разреза может звучать чуть неточно
// (так устроен mp3 — «резервуар битов»), на слух это щелчок не громче обычного начала трека.
//
// Версии лежат в <папка данных приложения>/studio: файлы studio-<32 hex>.mp3 и index.json (название, откуда вырезано,
// границы, локальный лайк). Номер версии — «studio-…»: по нему её играет плеер, как скачанный трек
// (download::open_local → open, ymlocal://…/track/studio-…, свой движок). В архив версия уходит тем же путём,
// что «Сохранить в архив» (studio_to_archive — как wa_save_track, только файл свой).

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::whisper::{upload, WaResponse};

const MAX_ITEMS: usize = 300;
const MAX_SRC: usize = 100 * 1024 * 1024;
const MIN_LEN_MS: u64 = 1000;
const MAX_META: usize = 4096;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    /// номер трека Яндекса, из которого вырезано
    pub src_id: String,
    pub title: String,
    /// как показывать: исполнители, обложка, альбом (то, что прислал интерфейс; не больше 4 КБ)
    #[serde(default)]
    pub meta: serde_json::Value,
    pub start_ms: u64,
    pub end_ms: u64,
    pub duration_ms: u64,
    #[serde(default)]
    pub liked: bool,
    /// когда лайкнута (секунды) — по нему версия встаёт на своё место среди лайков Яндекса; 0 — не лайкнута
    #[serde(default)]
    pub liked_at: u64,
    pub created: u64,
    pub size: u64,
}

static LOCK: Mutex<()> = Mutex::new(());

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("studio");
    std::fs::create_dir_all(&d).map_err(|e| format!("не удалось создать папку студии: {e}"))?;
    Ok(d)
}

fn id_ok(id: &str) -> bool {
    id.len() == 7 + 32 && id.starts_with("studio-") && id[7..].bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn new_id() -> Result<String, String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).map_err(|e| e.to_string())?;
    Ok(format!("studio-{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>()))
}

fn file_of(d: &Path, id: &str) -> PathBuf {
    d.join(format!("{id}.mp3"))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn load_index(d: &Path) -> Vec<Item> {
    std::fs::read(d.join("index.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<Item>>(&b).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|i| id_ok(&i.id))
        .collect()
}

// запись через временный файл: оборванная запись не портит список
fn save_index(d: &Path, items: &[Item]) -> Result<(), String> {
    let tmp = d.join("index.json.tmp");
    let data = serde_json::to_vec_pretty(items).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, data).map_err(|e| format!("не удалось сохранить список студии: {e}"))?;
    std::fs::rename(&tmp, d.join("index.json")).map_err(|e| format!("не удалось сохранить список студии: {e}"))
}

fn clean_text(s: &str, max: usize) -> String {
    let t: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

fn clean_meta(v: serde_json::Value) -> serde_json::Value {
    match serde_json::to_vec(&v) {
        Ok(b) if b.len() <= MAX_META && v.is_object() => v,
        _ => serde_json::Value::Null,
    }
}

// ---------------------------------------------------------------------------
// mp3: разбор кадров и обрезка без перекодирования
// ---------------------------------------------------------------------------

/// Кадр MPEG Layer III по заголовку: (длина в байтах, сэмплов в кадре, частота, версия, режим каналов).
fn frame_at(b: &[u8], i: usize) -> Option<(usize, u32, u32, u8, u8)> {
    let h = b.get(i..i + 4)?;
    if h[0] != 0xFF || (h[1] & 0xE0) != 0xE0 {
        return None;
    }
    let ver = (h[1] >> 3) & 3; // 3 — MPEG1, 2 — MPEG2, 0 — MPEG2.5
    let layer = (h[1] >> 1) & 3; // 1 — Layer III
    if ver == 1 || layer != 1 {
        return None;
    }
    let bi = (h[2] >> 4) as usize;
    let si = ((h[2] >> 2) & 3) as usize;
    if bi == 0 || bi == 15 || si == 3 {
        return None;
    }
    let pad = ((h[2] >> 1) & 1) as usize;
    const BR1: [u32; 15] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const BR2: [u32; 15] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    let (br, sr, samples) = match ver {
        3 => (BR1[bi], [44100, 48000, 32000][si], 1152u32),
        2 => (BR2[bi], [22050, 24000, 16000][si], 576),
        _ => (BR2[bi], [11025, 12000, 8000][si], 576),
    };
    let len = (samples / 8 * br * 1000 / sr) as usize + pad;
    if len < 24 {
        return None;
    }
    Some((len, samples, sr, ver, h[3] >> 6))
}

/// Первый кадр с меткой Xing / Info / VBRI — служебный (длина файла для VBR), а не звук.
fn is_vbr_tag(b: &[u8], i: usize, ver: u8, mode: u8) -> bool {
    let side = match (ver == 3, mode == 3) {
        (true, true) => 17,
        (true, false) => 32,
        (false, true) => 9,
        (false, false) => 17,
    };
    let at = |o: usize, tag: &[u8]| b.get(i + o..i + o + 4) == Some(tag);
    at(4 + side, b"Xing") || at(4 + side, b"Info") || at(4 + 32, b"VBRI")
}

/// ID3v2 в начале файла — пропустить.
fn id3_len(b: &[u8]) -> usize {
    if b.len() < 10 || &b[0..3] != b"ID3" {
        return 0;
    }
    let size = ((b[6] as usize & 0x7F) << 21) | ((b[7] as usize & 0x7F) << 14) | ((b[8] as usize & 0x7F) << 7) | (b[9] as usize & 0x7F);
    let footer = if b[5] & 0x10 != 0 { 10 } else { 0 };
    (10 + size + footer).min(b.len())
}

/// Кадры звука: (начало, длина, начало по времени в мс). Служебный кадр VBR не входит.
fn frames(b: &[u8]) -> Vec<(usize, usize, f64)> {
    let mut out = Vec::new();
    let mut i = id3_len(b);
    let mut t = 0.0f64;
    let mut first = true;
    let mut lost = 0usize;
    while i + 4 <= b.len() {
        match frame_at(b, i) {
            // кадр засчитывается, если за ним следующий кадр или конец файла (иначе это случайные байты 0xFFE…)
            Some((len, samples, sr, ver, mode))
                if i + len == b.len() || (i + len < b.len() && frame_at(b, i + len).is_some()) || i + len + 128 == b.len() =>
            {
                if i + len > b.len() {
                    break;
                }
                let vbr = first && is_vbr_tag(b, i, ver, mode);
                first = false;
                if !vbr {
                    out.push((i, len, t));
                    t += samples as f64 * 1000.0 / sr as f64;
                }
                i += len;
                lost = 0;
            }
            _ => {
                // мусор между кадрами — ищем следующий заголовок, но не бесконечно
                i += 1;
                lost += 1;
                if lost > 64 * 1024 {
                    break;
                }
            }
        }
    }
    out
}

/// Длительность mp3 в мс (по кадрам).
fn duration_ms(b: &[u8]) -> u64 {
    let f = frames(b);
    match f.last() {
        Some(&(i, _, t)) => {
            let (_, s, sr, _, _) = frame_at(b, i).unwrap_or((0, 1152, 44100, 3, 0));
            (t + s as f64 * 1000.0 / sr as f64).round() as u64
        }
        None => 0,
    }
}

/// Вырезать [start, end) мс: целые кадры, чьё начало внутри отрезка. Возвращает байты и настоящие границы.
fn mp3_cut(b: &[u8], start_ms: u64, end_ms: u64) -> Result<(Vec<u8>, u64, u64), String> {
    if end_ms <= start_ms || end_ms - start_ms < MIN_LEN_MS {
        return Err("Отрезок должен быть длиннее секунды".into());
    }
    let f = frames(b);
    if f.is_empty() {
        return Err("Файл трека не похож на mp3".into());
    }
    let (s, e) = (start_ms as f64, end_ms as f64);
    let picked: Vec<&(usize, usize, f64)> = f.iter().filter(|&&(_, _, t)| t + 0.5 >= s && t < e).collect();
    let (Some(a), Some(z)) = (picked.first(), picked.last()) else {
        return Err("В этом отрезке нет звука — проверь границы".into());
    };
    let (_, sm, sr, _, _) = frame_at(b, z.0).unwrap_or((0, 1152, 44100, 3, 0));
    let real_end = z.2 + sm as f64 * 1000.0 / sr as f64;
    let mut out = Vec::with_capacity(picked.iter().map(|x| x.1).sum());
    for &&(i, len, _) in &picked {
        out.extend_from_slice(&b[i..i + len]);
    }
    Ok((out, a.2.round() as u64, real_end.round() as u64))
}

// ---------------------------------------------------------------------------
// исходник: последний трек держим в памяти (разметка, прослушивание и сохранение — без повторной загрузки)
// ---------------------------------------------------------------------------

static SRC: Mutex<Option<(String, Arc<Vec<u8>>)>> = Mutex::new(None);

fn track_num(id: &str) -> Result<String, String> {
    let n = id.split(':').next().unwrap_or("");
    if n.is_empty() || n.len() > 15 || !n.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Обрезать можно только трек Яндекс Музыки".into());
    }
    Ok(n.to_string())
}

fn is_mp3(b: &[u8]) -> bool {
    matches!(upload::audio_kind(b), Some(("mp3", _))) && !frames(b).is_empty()
}

async fn source(app: &AppHandle, track_id: &str) -> Result<Arc<Vec<u8>>, String> {
    let id = track_num(track_id)?;
    if let Some((k, v)) = SRC.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if *k == id {
            return Ok(v.clone());
        }
    }
    // скачанный — с диска (если это mp3), иначе — с Яндекса
    let mut bytes = None;
    if let Some((mut f, _, len)) = crate::download::open_local(app, &id) {
        if len as usize <= MAX_SRC {
            let mut b = Vec::with_capacity(len as usize);
            if f.read_to_end(&mut b).is_ok() && is_mp3(&b) {
                bytes = Some(b);
            }
        }
    }
    let bytes = match bytes {
        Some(b) => b,
        None => {
            let url = crate::net::track_mp3_url(&id).await.map_err(|e| format!("не удалось получить трек с Яндекса: {e}"))?;
            let b = crate::net::fetch_media(&url).await.map_err(|e| format!("не удалось скачать трек с Яндекса: {e}"))?;
            if b.len() > MAX_SRC {
                return Err("Трек больше 100 МБ".into());
            }
            if !is_mp3(&b) {
                return Err("Яндекс отдал не mp3 — такой файл студия пока не режет".into());
            }
            b
        }
    };
    let v = Arc::new(bytes);
    *SRC.lock().unwrap_or_else(|e| e.into_inner()) = Some((id, v.clone()));
    Ok(v)
}

/// Файл трека для разметки в студии (рисует волну и даёт послушать отрезок) — «сырыми» байтами, в JS это ArrayBuffer.
#[tauri::command]
pub async fn studio_source(app: AppHandle, track_id: String) -> Result<tauri::ipc::Response, String> {
    let b = source(&app, &track_id).await?;
    Ok(tauri::ipc::Response::new(b.as_ref().clone()))
}

/// Сохранить отрезок [start_ms, end_ms) трека как свою версию.
#[tauri::command]
pub async fn studio_save(
    app: AppHandle,
    track_id: String,
    start_ms: u64,
    end_ms: u64,
    title: String,
    meta: serde_json::Value,
) -> Result<Item, String> {
    let src = source(&app, &track_id).await?;
    let src_id = track_num(&track_id)?;
    let title = clean_text(&title, 200);
    if title.is_empty() {
        return Err("Дай версии название".into());
    }
    let meta = clean_meta(meta);
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (cut, s, e) = mp3_cut(&src, start_ms, end_ms)?;
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let d = dir(&app2)?;
        let mut items = load_index(&d);
        if items.len() >= MAX_ITEMS {
            return Err(format!("В студии уже {MAX_ITEMS} версий — удали ненужные"));
        }
        let id = new_id()?;
        let tmp = d.join(format!("{id}.part"));
        std::fs::write(&tmp, &cut).map_err(|e| format!("не удалось записать файл: {e}"))?;
        std::fs::rename(&tmp, file_of(&d, &id)).map_err(|e| format!("не удалось записать файл: {e}"))?;
        let item = Item { id, src_id, title, meta, start_ms: s, end_ms: e, duration_ms: e - s, liked: false, liked_at: 0, created: now_secs(), size: cut.len() as u64 };
        items.insert(0, item.clone());
        if let Err(err) = save_index(&d, &items) {
            let _ = std::fs::remove_file(file_of(&d, &item.id));
            return Err(err);
        }
        Ok(item)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Все версии (новые сверху); файл, которого больше нет, из списка выпадает.
#[tauri::command]
pub fn studio_list(app: AppHandle) -> Result<Vec<Item>, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let d = dir(&app)?;
    let all = load_index(&d);
    let live: Vec<Item> = all.iter().filter(|i| file_of(&d, &i.id).is_file()).cloned().collect();
    if live.len() != all.len() {
        let _ = save_index(&d, &live);
    }
    Ok(live)
}

/// Локальный лайк и название.
#[tauri::command]
pub fn studio_update(app: AppHandle, id: String, liked: Option<bool>, title: Option<String>) -> Result<Item, String> {
    if !id_ok(&id) {
        return Err("Некорректный номер версии".into());
    }
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let d = dir(&app)?;
    let mut items = load_index(&d);
    let it = items.iter_mut().find(|i| i.id == id).ok_or("Такой версии нет")?;
    if let Some(l) = liked {
        if l && !it.liked {
            it.liked_at = now_secs();
        } else if !l {
            it.liked_at = 0;
        }
        it.liked = l;
    }
    if let Some(t) = title {
        let t = clean_text(&t, 200);
        if t.is_empty() {
            return Err("Название не может быть пустым".into());
        }
        it.title = t;
    }
    let out = it.clone();
    save_index(&d, &items)?;
    Ok(out)
}

#[tauri::command]
pub fn studio_delete(app: AppHandle, id: String) -> Result<(), String> {
    if !id_ok(&id) {
        return Err("Некорректный номер версии".into());
    }
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let d = dir(&app)?;
    let items: Vec<Item> = load_index(&d).into_iter().filter(|i| i.id != id).collect();
    save_index(&d, &items)?;
    let _ = std::fs::remove_file(file_of(&d, &id));
    Ok(())
}

/// Открыть файл версии для воспроизведения (download::open_local — ymlocal:// и свой движок).
pub fn open(app: &AppHandle, id: &str) -> Option<(std::fs::File, PathBuf, u64)> {
    if !id_ok(id) {
        return None;
    }
    let d = dir(app).ok()?;
    if !load_index(&d).iter().any(|i| i.id == id) {
        return None;
    }
    let p = file_of(&d, id);
    if !std::fs::symlink_metadata(&p).ok()?.file_type().is_file() {
        return None;
    }
    let f = std::fs::File::open(&p).ok()?;
    let len = f.metadata().ok()?.len();
    (len > 0).then_some((f, p, len))
}

fn read_item_file(app: &AppHandle, id: &str) -> Result<(Item, Vec<u8>), String> {
    if !id_ok(id) {
        return Err("Некорректный номер версии".into());
    }
    let d = dir(app)?;
    let item = load_index(&d).into_iter().find(|i| i.id == id).ok_or("Такой версии нет")?;
    let bytes = std::fs::read(file_of(&d, id)).map_err(|e| format!("файл версии не читается: {e}"))?;
    Ok((item, bytes))
}

/// Сохранить файл версии куда-нибудь на диск (системный диалог). None — пользователь передумал.
#[tauri::command]
pub async fn studio_export(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let (item, bytes) = read_item_file(&app, &id)?;
    let name = format!("{}.mp3", upload::clean_stem(&item.title));
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog().file().set_title("Сохранить версию").set_file_name(name).add_filter("MP3", &["mp3"]).blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let mut p = fp.into_path().map_err(|e| e.to_string())?;
    if p.extension().map(|e| !e.eq_ignore_ascii_case("mp3")).unwrap_or(true) {
        p.set_extension("mp3");
    }
    std::fs::write(&p, &bytes).map_err(|e| format!("Не удалось записать файл: {e}"))?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

/// Сохранить версию в Whisper Archive — как wa_save_track, только файл — своя версия, а не трек с Яндекса.
#[tauri::command]
pub async fn studio_to_archive(
    app: AppHandle,
    id: String,
    file_name: String,
    album_id: Option<String>,
    album_title: Option<String>,
    cover_url: Option<String>,
    cover_bytes: Option<Vec<u8>>,
) -> Result<WaResponse, String> {
    let up = upload::begin(album_id.as_deref(), cover_bytes.as_ref().map(|b| b.len()))?;
    let (_, audio) = read_item_file(&app, &id)?;
    let track = upload::TrackFile::new(&file_name, &audio).ok_or_else(|| "Файл версии в неизвестном формате".to_string())?;
    if let Some(aid) = album_id {
        return up.to_album(&aid, track).await;
    }
    let title = upload::album_title(album_title.as_deref())?;
    let cover = match (cover_url, cover_bytes) {
        (Some(u), _) => crate::net::fetch_media(&u).await.map_err(|e| format!("не удалось скачать обложку с Яндекса: {e}"))?,
        (None, Some(b)) => b,
        (None, None) => return Err("Для нового альбома нужна обложка".into()),
    };
    up.new_album(&title, &cover, track).await
}

/// «Слушать вместе»: своя версия — во временный кэш комнаты для гостей (как wa_room_cache_track, только файл свой).
#[tauri::command]
pub async fn studio_room_cache(app: AppHandle, code: String, id: String, file_name: String) -> Result<WaResponse, String> {
    let up = upload::begin(None, None)?;
    let (_, audio) = read_item_file(&app, &id)?;
    let track = upload::TrackFile::new(&file_name, &audio).ok_or_else(|| "Файл версии в неизвестном формате".to_string())?;
    up.to_room_cache(&code, track).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // MPEG1 Layer III, 128 кбит/с, 44100 Гц: кадр 417 байт, 1152 сэмпла (~26,12 мс)
    fn frame(pad: bool) -> Vec<u8> {
        let mut f = vec![0xFF, 0xFB, 0x90 | if pad { 2 } else { 0 }, 0x44];
        f.resize(if pad { 418 } else { 417 }, 0);
        f
    }
    fn mp3(n: usize) -> Vec<u8> {
        let mut b = b"ID3\x03\x00\x00\x00\x00\x00\x05abcde".to_vec();
        for k in 0..n {
            b.extend(frame(k % 3 == 0));
        }
        b
    }

    #[test]
    fn parse_frames() {
        let b = mp3(100);
        let f = frames(&b);
        assert_eq!(f.len(), 100);
        assert_eq!(f[0].0, 15); // после ID3 (10 + 5)
        assert_eq!(duration_ms(&b), (100.0 * 1152.0 * 1000.0 / 44100.0f64).round() as u64);
        assert!(is_mp3(&b));
        assert!(!is_mp3(b"not an mp3 at all"));
    }

    #[test]
    fn cut_frames() {
        let b = mp3(100);
        let (out, s, e) = mp3_cut(&b, 1000, 2000).unwrap();
        let fr = 1152.0 * 1000.0 / 44100.0;
        let first = (1000.0f64 / fr).ceil() as usize; // 39
        let last = ((2000.0f64 / fr).ceil() as usize) - 1; // 76
        assert_eq!(frames(&out).len(), last - first + 1);
        assert_eq!(s, (first as f64 * fr).round() as u64);
        assert_eq!(e, ((last + 1) as f64 * fr).round() as u64);
        assert_eq!(&out[0..2], &[0xFF, 0xFB]);
        assert!(mp3_cut(&b, 1000, 1500).is_err()); // короче секунды
        assert!(mp3_cut(&b, 5000, 9000).is_err()); // за концом
    }

    #[test]
    fn skips_vbr_header() {
        let mut b = Vec::new();
        let mut x = frame(false);
        x[4 + 32..4 + 36].copy_from_slice(b"Xing");
        b.extend(x);
        for _ in 0..10 {
            b.extend(frame(false));
        }
        assert_eq!(frames(&b).len(), 10);
    }

    #[test]
    fn ids() {
        assert!(id_ok("studio-0123456789abcdef0123456789abcdef"));
        assert!(!id_ok("studio-0123456789ABCDEF0123456789abcdef"));
        assert!(!id_ok("studio-../../etc"));
        assert!(!id_ok("12345"));
        assert!(id_ok(&new_id().unwrap()));
        assert_eq!(track_num("123:456").unwrap(), "123");
        assert!(track_num("studio-1").is_err());
    }
}
