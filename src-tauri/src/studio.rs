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
    /// расширение файла (mp3 у обрезок; свой трек, перетащенный в окно, — как был: flac, m4a, ogg, wav…)
    #[serde(default = "mp3_ext")]
    pub ext: String,
    /// откуда версия: «cut» — обрезка трека Яндекса, «import» — свой файл (перетащили в окно, dropin.js),
    /// «replace» — свой файл вместо трека Яндекса src_id: на этом компьютере играет он (main.js → studioReplacement)
    #[serde(default = "cut_origin")]
    pub origin: String,
    /// откуда файл: сайт и ссылка (трек по ссылке — linkdl.rs), «file» — свой файл; у обрезок нет.
    /// Нужно синхронизации через архив (libsync.js → /api/library: source), чтобы на телефоне было видно, откуда трек
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ItemSource>,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
pub struct ItemSource {
    /// youtube, soundcloud, vk-video, file (как source.site в docs/LIBRARY-SYNC.md архива)
    pub site: String,
    #[serde(default)]
    pub url: String,
    /// номер на сайте: id видео YouTube, «автор/трек» SoundCloud, «video-1_2» ВК
    #[serde(default)]
    pub id: String,
}

/// Источник из того, что пришло от интерфейса или из архива: ссылка заново проверяется (linkdl::check_url),
/// сайт — только из известных; неизвестное — «file» без ссылки.
fn clean_source(site: &str, url: &str, id: &str) -> ItemSource {
    // на телефоне загрузки по ссылке (linkdl.rs, yt-dlp) нет — трек с ссылкой с компьютера там просто «file»
    #[cfg(desktop)]
    if !url.is_empty() {
        if let Some((u, s, i)) = crate::linkdl::source_info(url) {
            return ItemSource { site: s.into(), url: u, id: i };
        }
    }
    #[cfg(mobile)]
    let _ = url;
    let site = if site.len() <= 24 && !site.is_empty() && site.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        site.to_string()
    } else {
        "file".into()
    };
    ItemSource { site, url: String::new(), id: clean_text(id, 128) }
}

/// Площадка этого приложения в библиотеке архива (/api/library/{service}).
pub const LIB_SERVICE: &str = "yandex";

fn mp3_ext() -> String {
    "mp3".into()
}

fn cut_origin() -> String {
    "cut".into()
}

/// Расширения, с которыми студия хранит файлы (имя файла собирается только из них и номера версии).
const EXTS: [&str; 7] = ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"];

fn ext_ok(e: &str) -> &'static str {
    EXTS.iter().find(|x| x.eq_ignore_ascii_case(e)).copied().unwrap_or("mp3")
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

/// Файл версии с её расширением.
fn path_of(d: &Path, it: &Item) -> PathBuf {
    d.join(format!("{}.{}", it.id, ext_ok(&it.ext)))
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

// (номер трека, файл, взят с диска — скачанный или из кэша; иначе — с Яндекса)
static SRC: Mutex<Option<(String, Arc<Vec<u8>>, bool)>> = Mutex::new(None);

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
    source_from(app, track_id).await.map(|x| x.0)
}

/// Файл трека и откуда он: true — с диска (скачанный или кэш), false — с Яндекса.
async fn source_from(app: &AppHandle, track_id: &str) -> Result<(Arc<Vec<u8>>, bool), String> {
    let id = track_num(track_id)?;
    if let Some((k, v, f)) = SRC.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if *k == id {
            return Ok((v.clone(), *f));
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
    let from_disk = bytes.is_some();
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
    *SRC.lock().unwrap_or_else(|e| e.into_inner()) = Some((id, v.clone(), from_disk));
    Ok((v, from_disk))
}

/// Что видно о файле mp3 без декодирования (сводка в студии; темп, тональность и громкость считает studio.js по звуку).
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mp3Info {
    /// «MPEG-1 Layer III» и т. п.
    pub codec: String,
    /// средний битрейт, кбит/с
    pub bitrate: u32,
    /// переменный битрейт (VBR) — у кадров разный битрейт или есть заголовок Xing
    pub vbr: bool,
    pub sample_rate: u32,
    pub channels: u8,
    /// stereo | joint | dual | mono
    pub mode: String,
    pub frames: usize,
    pub duration_ms: u64,
    pub size: u64,
    /// есть теги ID3v2 (размер, байт)
    pub id3: u64,
}

fn mp3_info(b: &[u8]) -> Option<Mp3Info> {
    let f = frames(b);
    let &(first, _, _) = f.first()?;
    let (_, _, sr, ver, mode) = frame_at(b, first)?;
    let layer_ver = match ver {
        3 => "MPEG-1",
        2 => "MPEG-2",
        _ => "MPEG-2.5",
    };
    // VBR: служебный кадр Xing перед звуком (у CBR от LAME — «Info») или у кадров разные битрейты
    let i0 = id3_len(b);
    let xing = frame_at(b, i0).is_some_and(|(_, _, _, v, m)| i0 < first && is_vbr_tag(b, i0, v, m))
        && b.get(i0..).is_some_and(|x| x.windows(4).take(64).any(|w| w == b"Xing" || w == b"VBRI"));
    let mut br = std::collections::HashSet::new();
    for &(i, _, _) in f.iter().step_by((f.len() / 400).max(1)) {
        if let Some(h) = b.get(i + 2) {
            br.insert(h >> 4);
        }
        if br.len() > 1 {
            break;
        }
    }
    let duration_ms = duration_ms(b);
    let audio_bytes: usize = f.iter().map(|x| x.1).sum();
    let bitrate = if duration_ms > 0 { (audio_bytes as f64 * 8.0 / duration_ms as f64).round() as u32 } else { 0 };
    Some(Mp3Info {
        codec: format!("{layer_ver} Layer III"),
        bitrate,
        vbr: xing || br.len() > 1,
        sample_rate: sr,
        channels: if mode == 3 { 1 } else { 2 },
        mode: ["stereo", "joint", "dual", "mono"][mode as usize & 3].into(),
        frames: f.len(),
        duration_ms,
        size: b.len() as u64,
        id3: i0 as u64,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    /// с диска (скачанный или кэш) или с Яндекса
    pub from_disk: bool,
    #[serde(flatten)]
    pub mp3: Mp3Info,
}

/// Сводка о файле трека в студии (формат, битрейт, частота, каналы…). Файл тот же, что у studio_source (уже в памяти).
#[tauri::command]
pub async fn studio_info(app: AppHandle, track_id: String) -> Result<SourceInfo, String> {
    let (b, from_disk) = source_from(&app, &track_id).await?;
    let mp3 = tauri::async_runtime::spawn_blocking(move || mp3_info(&b)).await.map_err(|e| e.to_string())?;
    Ok(SourceInfo { from_disk, mp3: mp3.ok_or("Не удалось разобрать файл трека")? })
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
        let item = Item {
            id, src_id, title, meta, start_ms: s, end_ms: e, duration_ms: e - s, liked: false, liked_at: 0,
            created: now_secs(), size: cut.len() as u64, ext: mp3_ext(), origin: cut_origin(), source: None,
        };
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
    let live: Vec<Item> = all.iter().filter(|i| path_of(&d, i).is_file()).cloned().collect();
    if live.len() != all.len() {
        let _ = save_index(&d, &live);
    }
    Ok(live)
}

/// Локальный лайк и название. liked_at (секунды) — время лайка с другого устройства (libsync.js): версия встаёт
/// в «Лайках» туда же, где она там; без него — момент нажатия.
#[tauri::command]
pub fn studio_update(app: AppHandle, id: String, liked: Option<bool>, title: Option<String>, liked_at: Option<u64>) -> Result<Item, String> {
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
    if let Some(at) = liked_at.filter(|a| *a > 0) {
        if it.liked {
            it.liked_at = at.min(now_secs() + 86400);
        }
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
    let (gone, items): (Vec<Item>, Vec<Item>) = load_index(&d).into_iter().partition(|i| i.id == id);
    save_index(&d, &items)?;
    for it in &gone {
        let _ = std::fs::remove_file(path_of(&d, it));
    }
    Ok(())
}

/// Открыть файл версии для воспроизведения (download::open_local — ymlocal:// и свой движок).
pub fn open(app: &AppHandle, id: &str) -> Option<(std::fs::File, PathBuf, u64)> {
    if !id_ok(id) {
        return None;
    }
    let d = dir(app).ok()?;
    let it = load_index(&d).into_iter().find(|i| i.id == id)?;
    let p = path_of(&d, &it);
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
    let bytes = std::fs::read(path_of(&d, &item)).map_err(|e| format!("файл версии не читается: {e}"))?;
    Ok((item, bytes))
}

/// Сохранить файл версии куда-нибудь на диск (системный диалог). None — пользователь передумал.
#[tauri::command]
pub async fn studio_export(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let (item, bytes) = read_item_file(&app, &id)?;
    let ext = ext_ok(&item.ext);
    let name = format!("{}.{ext}", upload::clean_stem(&item.title));
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog().file().set_title("Сохранить версию").set_file_name(name).add_filter(ext.to_uppercase(), &[ext]).blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let mut p = fp.into_path().map_err(|e| e.to_string())?;
    if p.extension().map(|e| !e.eq_ignore_ascii_case(ext)).unwrap_or(true) {
        p.set_extension(ext);
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
    send_to_archive(up, &audio, &file_name, album_id, album_title, cover_url, cover_bytes).await
}

/// Файл → в альбом архива (album_id) или в новый приватный альбом (album_title + обложка: адрес Яндекса или картинка).
async fn send_to_archive(
    up: upload::Upload,
    audio: &[u8],
    file_name: &str,
    album_id: Option<String>,
    album_title: Option<String>,
    cover_url: Option<String>,
    cover_bytes: Option<Vec<u8>>,
) -> Result<WaResponse, String> {
    let track = upload::TrackFile::new(file_name, audio).ok_or_else(|| "Файл в неизвестном формате — подойдут mp3, flac, m4a, ogg, wav".to_string())?;
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

// ---------------------------------------------------------------------------
// трек, перетащенный в окно (dropin.js): файл выбрал пользователь, Rust читает его по номеру из списка (bg.rs)
// ---------------------------------------------------------------------------

const MAX_DROP: u64 = upload::MAX_TRACK_UPLOAD as u64;

/// Вид аудиофайла по первым байтам (не по расширению): mp3, flac, m4a, ogg/opus, wav. None — не звук.
fn audio_ext(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"fLaC") {
        return Some("flac");
    }
    if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WAVE" {
        return Some("wav");
    }
    if b.starts_with(b"OggS") {
        return Some(if b.windows(8).take(200).any(|w| w == b"OpusHead") { "opus" } else { "ogg" });
    }
    if b.len() > 12 && &b[4..8] == b"ftyp" {
        return Some("m4a");
    }
    if b.len() > 2 && b[0] == 0xFF && (b[1] & 0xF6) == 0xF0 {
        return Some("aac");
    }
    if b.starts_with(b"ID3") || !frames(b).is_empty() {
        return Some("mp3");
    }
    None
}

/// Текст тега ID3v2 (кодировка — первый байт кадра).
fn id3_text(v: &[u8]) -> String {
    let (enc, d) = match v.split_first() {
        Some((e, d)) => (*e, d),
        None => return String::new(),
    };
    let s = match enc {
        1 | 2 => {
            let be = enc == 2 || d.starts_with(&[0xFE, 0xFF]);
            let d = if d.starts_with(&[0xFF, 0xFE]) || d.starts_with(&[0xFE, 0xFF]) { &d[2..] } else { d };
            let u: Vec<u16> = d.chunks_exact(2).map(|c| if be { u16::from_be_bytes([c[0], c[1]]) } else { u16::from_le_bytes([c[0], c[1]]) }).collect();
            String::from_utf16_lossy(&u)
        }
        3 => String::from_utf8_lossy(d).into_owned(),
        _ => d.iter().map(|&c| c as char).collect(), // ISO-8859-1
    };
    clean_text(s.split('\0').next().unwrap_or(""), 200)
}

/// Название, исполнитель, альбом из тегов: ID3v2.3/2.4 (mp3) или Vorbis comment (flac).
fn audio_tags(b: &[u8]) -> (String, String, String) {
    let (mut t, mut a, mut al) = (String::new(), String::new(), String::new());
    if b.len() > 10 && &b[0..3] == b"ID3" && (b[3] == 3 || b[3] == 4) {
        let end = id3_len(b).min(b.len());
        let v4 = b[3] == 4;
        let mut i = 10;
        while i + 10 <= end {
            let id = &b[i..i + 4];
            if id[0] == 0 {
                break;
            }
            let sz = &b[i + 4..i + 8];
            let n = if v4 {
                ((sz[0] as usize & 0x7F) << 21) | ((sz[1] as usize & 0x7F) << 14) | ((sz[2] as usize & 0x7F) << 7) | (sz[3] as usize & 0x7F)
            } else {
                u32::from_be_bytes([sz[0], sz[1], sz[2], sz[3]]) as usize
            };
            let (s0, s1) = (i + 10, (i + 10).saturating_add(n));
            if s1 > end || n == 0 {
                break;
            }
            match id {
                b"TIT2" => t = id3_text(&b[s0..s1]),
                b"TPE1" => a = id3_text(&b[s0..s1]),
                b"TALB" => al = id3_text(&b[s0..s1]),
                _ => {}
            }
            i = s1;
        }
    } else if b.starts_with(b"fLaC") {
        let mut i = 4;
        while i + 4 <= b.len() {
            let last = b[i] & 0x80 != 0;
            let kind = b[i] & 0x7F;
            let n = ((b[i + 1] as usize) << 16) | ((b[i + 2] as usize) << 8) | b[i + 3] as usize;
            let (s0, s1) = (i + 4, i + 4 + n);
            if s1 > b.len() {
                break;
            }
            if kind == 4 {
                let blk = &b[s0..s1];
                let rd = |o: usize| blk.get(o..o + 4).map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]]) as usize);
                if let Some(vl) = rd(0) {
                    let mut o = 4 + vl;
                    let cnt = rd(o).unwrap_or(0).min(1000);
                    o += 4;
                    for _ in 0..cnt {
                        let Some(l) = rd(o) else { break };
                        let Some(kv) = blk.get(o + 4..o + 4 + l) else { break };
                        o += 4 + l;
                        let kv = String::from_utf8_lossy(kv);
                        if let Some((k, v)) = kv.split_once('=') {
                            match k.to_ascii_uppercase().as_str() {
                                "TITLE" if t.is_empty() => t = clean_text(v, 200),
                                "ARTIST" if a.is_empty() => a = clean_text(v, 200),
                                "ALBUM" if al.is_empty() => al = clean_text(v, 200),
                                _ => {}
                            }
                        }
                    }
                }
                break;
            }
            if last {
                break;
            }
            i = s1;
        }
    }
    (t, a, al)
}

fn read_drop(app: &AppHandle, pick: usize) -> Result<(Vec<u8>, String, &'static str), String> {
    let (bytes, name) = crate::bg::read_picked(app, pick, MAX_DROP)?;
    let ext = audio_ext(&bytes).ok_or_else(|| format!("«{name}» не похож на аудиофайл — подойдут mp3, flac, m4a, ogg, wav"))?;
    Ok((bytes, name, ext))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropInfo {
    pub name: String,
    pub size: u64,
    pub ext: String,
    /// длительность (мс) — только у mp3 (по кадрам); для остальных её узнаёт интерфейс
    pub duration_ms: u64,
    pub title: String,
    pub artist: String,
    pub album: String,
}

/// Что за трек перетащили: формат, размер, теги (название, исполнитель, альбом).
#[tauri::command]
pub async fn drop_audio_info(app: AppHandle, pick: usize) -> Result<DropInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (b, name, ext) = read_drop(&app, pick)?;
        let (title, artist, album) = audio_tags(&b);
        Ok(DropInfo {
            name,
            size: b.len() as u64,
            ext: ext.into(),
            duration_ms: if ext == "mp3" { duration_ms(&b) } else { 0 },
            title,
            artist,
            album,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Перетащенный трек — к себе на этот компьютер (только здесь, файл в папке студии).
///  * replaces — номер трека Яндекса: файл становится его заменой (origin «replace»): трек остаётся тем же треком
///    (лайк ставится ему самому — это делает интерфейс), а играет вместо него этот файл. Прошлая замена того же трека
///    удаляется: у трека одна замена.
///  * без replaces — свой трек (origin «import»); liked — сразу в «Лайки» (по умолчанию да).
/// meta — как у версий (исполнители, обложка, альбом: от совпавшего трека Яндекса, если нашёлся).
/// link — ссылка, по которой трек скачан (linkadd.js → linkdl.rs): запоминается источником (сайт, ссылка, номер);
/// без неё источник — «file».
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn drop_audio_local(
    app: AppHandle,
    pick: usize,
    title: String,
    meta: serde_json::Value,
    duration: Option<u64>,
    replaces: Option<String>,
    liked: Option<bool>,
    link: Option<String>,
) -> Result<Item, String> {
    let source = clean_source("file", link.as_deref().unwrap_or(""), "");
    let replaces = match replaces {
        Some(r) => Some(track_num(&r)?),
        None => None,
    };
    let title = clean_text(&title, 200);
    if title.is_empty() {
        return Err("Дай треку название".into());
    }
    let meta = clean_meta(meta);
    tauri::async_runtime::spawn_blocking(move || {
        let (b, _, ext) = read_drop(&app, pick)?;
        let dur = if ext == "mp3" { duration_ms(&b) } else { duration.unwrap_or(0).min(24 * 3600 * 1000) };
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let d = dir(&app)?;
        let mut items = load_index(&d);
        if items.len() >= MAX_ITEMS {
            return Err(format!("В студии уже {MAX_ITEMS} треков — удали ненужные"));
        }
        let now = now_secs();
        let like = replaces.is_none() && liked.unwrap_or(true);
        // у трека одна замена: прошлая (если была) уходит вместе с файлом
        if let Some(src) = &replaces {
            let (old, keep): (Vec<Item>, Vec<Item>) = items.drain(..).partition(|i| i.origin == "replace" && &i.src_id == src);
            items = keep;
            for it in &old {
                let _ = std::fs::remove_file(path_of(&d, it));
            }
        }
        let item = Item {
            id: new_id()?, src_id: replaces.clone().unwrap_or_default(), title, meta, start_ms: 0, end_ms: dur, duration_ms: dur,
            liked: like, liked_at: if like { now } else { 0 }, created: now, size: b.len() as u64, ext: ext.into(),
            origin: if replaces.is_some() { "replace".into() } else { "import".into() },
            source: Some(source),
        };
        let tmp = d.join(format!("{}.part", item.id));
        std::fs::write(&tmp, &b).map_err(|e| format!("не удалось записать файл: {e}"))?;
        std::fs::rename(&tmp, path_of(&d, &item)).map_err(|e| format!("не удалось записать файл: {e}"))?;
        items.insert(0, item.clone());
        if let Err(err) = save_index(&d, &items) {
            let _ = std::fs::remove_file(path_of(&d, &item));
            return Err(err);
        }
        Ok(item)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Перетащенный трек — в Whisper Archive: в свой альбом (album_id) или в новый (album_title + обложка).
/// file_name — имя трека в архиве («Исполнитель - Название»: так архив подменяет им версию Яндекса).
#[tauri::command]
pub async fn drop_audio_archive(
    app: AppHandle,
    pick: usize,
    file_name: String,
    album_id: Option<String>,
    album_title: Option<String>,
    cover_url: Option<String>,
    cover_bytes: Option<Vec<u8>>,
) -> Result<WaResponse, String> {
    let up = upload::begin(album_id.as_deref(), cover_bytes.as_ref().map(|b| b.len()))?;
    let a = app.clone();
    let (b, _, _) = tauri::async_runtime::spawn_blocking(move || read_drop(&a, pick)).await.map_err(|e| e.to_string())??;
    send_to_archive(up, &b, &file_name, album_id, album_title, cover_url, cover_bytes).await
}

/// «Слушать вместе»: своя версия — во временный кэш комнаты для гостей (как wa_room_cache_track, только файл свой).
#[tauri::command]
pub async fn studio_room_cache(app: AppHandle, code: String, id: String, file_name: String) -> Result<WaResponse, String> {
    let up = upload::begin(None, None)?;
    let (_, audio) = read_item_file(&app, &id)?;
    let track = upload::TrackFile::new(&file_name, &audio).ok_or_else(|| "Файл версии в неизвестном формате".to_string())?;
    up.to_room_cache(&code, track).await
}

// ---------------------------------------------------------------------------------------------------------------
// синхронизация через архив (libsync.js, ядро — whisper/library.rs, сервер — /api/library, docs/LIBRARY-SYNC.md)
// ---------------------------------------------------------------------------------------------------------------

/// Файл версии → в библиотеку архива (запись с тем же key интерфейс уже отправил: wa_lib_changes).
#[tauri::command]
pub async fn studio_lib_upload(app: AppHandle, id: String) -> Result<WaResponse, String> {
    let a = app.clone();
    let (item, bytes) = tauri::async_runtime::spawn_blocking(move || read_item_file(&a, &id)).await.map_err(|e| e.to_string())??;
    crate::whisper::library::upload_file(LIB_SERVICE, &item.id, &item.title, &bytes).await
}

/// Трек библиотеки с другого устройства — как его описал интерфейс по записи архива (libsync.js → fromLib).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Restore {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub meta: serde_json::Value,
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub src_id: String,
    #[serde(default)]
    pub liked: bool,
    #[serde(default)]
    pub liked_at: u64,
    #[serde(default)]
    pub created: u64,
    #[serde(default)]
    pub start_ms: u64,
    #[serde(default)]
    pub end_ms: u64,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub source: Option<ItemSource>,
}

/// Проверенная версия из Restore (без файла): номер, название, вид, исходник, время — в своих границах.
fn restored(r: Restore, now: u64) -> Result<Item, String> {
    if !id_ok(&r.id) {
        return Err("Некорректный номер версии".into());
    }
    let title = clean_text(&r.title, 200);
    if title.is_empty() {
        return Err("У трека нет названия".into());
    }
    let origin = match r.origin.as_str() {
        "cut" | "replace" | "import" => r.origin.clone(),
        _ => "import".to_string(),
    };
    let src_id = if origin == "import" { String::new() } else { track_num(&r.src_id)? };
    let time = |t: u64| t.min(now + 86400);
    let like = r.liked && origin != "replace";
    let dur = r.duration_ms.min(24 * 3600 * 1000);
    let (start_ms, end_ms) = if origin == "cut" && r.end_ms > r.start_ms { (r.start_ms, r.end_ms) } else { (0, dur) };
    Ok(Item {
        id: r.id,
        src_id,
        title,
        meta: clean_meta(r.meta),
        start_ms,
        end_ms,
        duration_ms: dur,
        liked: like,
        liked_at: if like { time(if r.liked_at > 0 { r.liked_at } else { now }) } else { 0 },
        created: time(if r.created > 0 { r.created } else { now }),
        size: 0,
        ext: mp3_ext(),
        origin,
        source: r.source.map(|s| clean_source(&s.site, &s.url, &s.id)),
    })
}

/// Скачать файл трека из библиотеки архива и положить в студию с тем же номером (на всех устройствах один key),
/// лайком и временем лайка — в «Лайках» он встаёт на то же место. Уже есть — возвращается как есть.
#[tauri::command]
pub async fn studio_lib_restore(app: AppHandle, item: Restore) -> Result<Item, String> {
    let mut item = restored(item, now_secs())?;
    {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let items = load_index(&dir(&app)?);
        if let Some(it) = items.iter().find(|i| i.id == item.id) {
            return Ok(it.clone());
        }
        if items.len() >= MAX_ITEMS {
            return Err(format!("В студии уже {MAX_ITEMS} треков — удали ненужные"));
        }
    }
    let bytes = crate::whisper::library::download_file(LIB_SERVICE, &item.id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let ext = audio_ext(&bytes).ok_or("файл из архива — не звук")?;
        item.ext = ext.into();
        item.size = bytes.len() as u64;
        if ext == "mp3" {
            let d = duration_ms(&bytes);
            if d > 0 {
                item.duration_ms = d;
                if item.origin != "cut" {
                    item.end_ms = d;
                }
            }
        }
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let d = dir(&app)?;
        let mut items = load_index(&d);
        if let Some(it) = items.iter().find(|i| i.id == item.id) {
            return Ok(it.clone()); // пока качали, его уже положили
        }
        // у трека одна замена: прошлая уходит (синхронизация удалит её и в архиве)
        if item.origin == "replace" {
            let (old, keep): (Vec<Item>, Vec<Item>) = items.drain(..).partition(|i| i.origin == "replace" && i.src_id == item.src_id);
            items = keep;
            for it in &old {
                let _ = std::fs::remove_file(path_of(&d, it));
            }
        }
        let tmp = d.join(format!("{}.part", item.id));
        std::fs::write(&tmp, &bytes).map_err(|e| format!("не удалось записать файл: {e}"))?;
        std::fs::rename(&tmp, path_of(&d, &item)).map_err(|e| format!("не удалось записать файл: {e}"))?;
        items.push(item.clone());
        items.sort_by(|a, b| b.created.cmp(&a.created)); // «Мои версии» — новые сверху, как при добавлении
        if let Err(err) = save_index(&d, &items) {
            let _ = std::fs::remove_file(path_of(&d, &item));
            return Err(err);
        }
        Ok(item)
    })
    .await
    .map_err(|e| e.to_string())?
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
    fn drop_kinds_and_tags() {
        assert_eq!(audio_ext(&mp3(10)), Some("mp3"));
        assert_eq!(audio_ext(b"fLaC\0\0\0\0"), Some("flac"));
        assert_eq!(audio_ext(b"RIFF\0\0\0\0WAVEfmt "), Some("wav"));
        assert_eq!(audio_ext(b"just some text, not audio"), None);
        // ID3v2.3: TIT2 (latin-1) и TPE1 (UTF-16 с BOM)
        let mut tag = Vec::new();
        let mut frame = |id: &[u8], body: &[u8]| {
            tag.extend_from_slice(id);
            tag.extend_from_slice(&(body.len() as u32).to_be_bytes());
            tag.extend_from_slice(&[0, 0]);
            tag.extend_from_slice(body);
        };
        frame(b"TIT2", b"\0Song Name");
        let mut a = vec![1u8, 0xFF, 0xFE];
        for u in "Группа".encode_utf16() {
            a.extend_from_slice(&u.to_le_bytes());
        }
        frame(b"TPE1", &a);
        let n = tag.len();
        let mut b = b"ID3\x03\0\0".to_vec();
        b.extend_from_slice(&[(n >> 21) as u8 & 0x7F, (n >> 14) as u8 & 0x7F, (n >> 7) as u8 & 0x7F, n as u8 & 0x7F]);
        b.extend(tag);
        b.extend(mp3(5)[15..].iter());
        let (t, ar, _) = audio_tags(&b);
        assert_eq!((t.as_str(), ar.as_str()), ("Song Name", "Группа"));
        assert_eq!(ext_ok("FLAC"), "flac");
        assert_eq!(ext_ok("../x"), "mp3");
    }

    #[test]
    fn info() {
        let b = mp3(100);
        let i = mp3_info(&b).unwrap();
        assert_eq!(i.codec, "MPEG-1 Layer III");
        assert_eq!((i.sample_rate, i.channels, i.mode.as_str(), i.frames, i.vbr), (44100, 2, "joint", 100, false));
        assert!((127..=129).contains(&i.bitrate), "{}", i.bitrate);
        assert_eq!(i.id3, 15);
        assert!(mp3_info(b"nope").is_none());
    }

    #[test]
    fn sources() {
        let s = clean_source("file", "https://youtu.be/jNQXAC9IVRw", "");
        assert_eq!(s, ItemSource { site: "youtube".into(), url: "https://www.youtube.com/watch?v=jNQXAC9IVRw".into(), id: "jNQXAC9IVRw".into() });
        // чужая ссылка не сохраняется, сайт — только из латиницы
        assert_eq!(clean_source("youtube", "https://evil.example/x", "1"), ItemSource { site: "youtube".into(), url: "".into(), id: "1".into() });
        assert_eq!(clean_source("../x", "", "").site, "file");
        assert_eq!(clean_source("", "", "").site, "file");
        // старый index.json без source читается
        let it: Item = serde_json::from_str(r#"{"id":"studio-0123456789abcdef0123456789abcdef","srcId":"","title":"t","startMs":0,"endMs":1,"durationMs":1,"created":1,"size":1}"#).unwrap();
        assert!(it.source.is_none());
        assert!(!serde_json::to_string(&it).unwrap().contains("source"));
    }

    #[test]
    fn restore_from_library() {
        let now = 1_800_000_000;
        let base = || Restore {
            id: "studio-0123456789abcdef0123456789abcdef".into(), title: " Трек \n с YouTube ".into(), meta: serde_json::json!({ "coverUri": "x" }),
            origin: "import".into(), src_id: "".into(), liked: true, liked_at: 1_700_000_000, created: 1_699_999_000,
            start_ms: 0, end_ms: 0, duration_ms: 1000, source: Some(ItemSource { site: "youtube".into(), url: "https://youtu.be/jNQXAC9IVRw".into(), id: "".into() }),
        };
        let it = restored(base(), now).unwrap();
        assert_eq!(it.title, "Трек с YouTube");
        assert_eq!((it.liked, it.liked_at, it.created, it.end_ms), (true, 1_700_000_000, 1_699_999_000, 1000));
        assert_eq!(it.source.unwrap().id, "jNQXAC9IVRw");
        // время из будущего — не дальше суток
        assert_eq!(restored(Restore { liked_at: u64::MAX, ..base() }, now).unwrap().liked_at, now + 86400);
        // замена: лайк — самому треку Яндекса, у неё нет; без номера трека — нельзя
        let r = restored(Restore { origin: "replace".into(), src_id: "123:456".into(), ..base() }, now).unwrap();
        assert_eq!((r.liked, r.liked_at, r.src_id.as_str()), (false, 0, "123"));
        assert!(restored(Restore { origin: "replace".into(), ..base() }, now).is_err());
        // обрезка помнит границы
        let c = restored(Restore { origin: "cut".into(), src_id: "77".into(), start_ms: 500, end_ms: 900, ..base() }, now).unwrap();
        assert_eq!((c.start_ms, c.end_ms), (500, 900));
        assert!(restored(Restore { id: "studio-../x".into(), ..base() }, now).is_err());
        assert!(restored(Restore { title: " ".into(), ..base() }, now).is_err());
        assert_eq!(restored(Restore { origin: "evil".into(), ..base() }, now).unwrap().origin, "import");
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
