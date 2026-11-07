
use crate::net;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const CFG_FILE: &str = "downloads.json";
const INDEX_FILE: &str = "downloaded.json";
static INDEX_LOCK: Mutex<()> = Mutex::new(());
const DEFAULT_SUBDIR: &str = "Моя Музыка";

/// Потолки для файлов настроек: их может переписать любая программа пользователя, и огромный файл
/// не должен съесть память при старте.
const CFG_MAX_BYTES: u64 = 64 * 1024;
const INDEX_MAX_BYTES: u64 = 16 * 1024 * 1024;
const INDEX_MAX_ENTRIES: usize = 20_000;
const PATH_MAX_LEN: usize = 4096;
/// Сколько прежних папок загрузок помнить: треки, скачанные туда до смены папки, остаются доступны.
const PAST_DIRS_MAX: usize = 16;
/// Самый большой звуковой файл, который отдаём на воспроизведение.
const AUDIO_MAX_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Serialize, Deserialize, Default)]
struct DlCfg {
    dir: Option<String>,
    /// Папки, выбранные раньше: из них тоже можно играть уже скачанные туда треки.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    past: Vec<String>,
}

impl DlCfg {
    /// Запомнить текущую папку среди прежних (при смене или сбросе папки).
    fn retire_current(&mut self) {
        let Some(d) = self.dir.take() else { return };
        self.past.retain(|p| p != &d);
        self.past.insert(0, d);
        self.past.truncate(PAST_DIRS_MAX);
    }
}

#[derive(Serialize)]
pub struct DirInfo {
    path: String,
    custom: bool,
}

// ---------------------------------------------------------------------------
// Безопасные чтение и запись небольших файлов настроек
// ---------------------------------------------------------------------------

/// Прочитать файл настроек: только обычный файл (на Unix — не по ссылке), не больше `max` байт.
/// `Ok(None)` — файла нет.
pub(crate) fn read_capped(p: &Path, max: u64) -> std::io::Result<Option<Vec<u8>>> {
    let mut o = std::fs::OpenOptions::new();
    o.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let f = match o.open(p) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let m = f.metadata()?;
    if !m.is_file() {
        return Err(std::io::Error::other("не обычный файл"));
    }
    if m.len() > max {
        return Err(std::io::Error::other("файл слишком большой"));
    }
    let mut buf = Vec::with_capacity(m.len() as usize);
    // не больше max + 1 байта: файл мог вырасти после проверки размера
    f.take(max + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > max {
        return Err(std::io::Error::other("файл слишком большой"));
    }
    Ok(Some(buf))
}

/// Атомарная запись: новый временный файл рядом (create_new — по подложенной ссылке не пишет),
/// fsync, затем переименование поверх старого. Аварийное завершение посреди записи оставляет
/// либо старый файл, либо новый целиком — но не половину.
pub(crate) fn write_atomic(p: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = p.parent().ok_or_else(|| std::io::Error::other("нет папки"))?;
    std::fs::create_dir_all(dir)?;
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut r = [0u8; 8];
    getrandom::fill(&mut r).map_err(|e| std::io::Error::other(e.to_string()))?;
    let tmp = dir.join(format!(".{name}.{}.tmp", r.iter().map(|b| format!("{b:02x}")).collect::<String>()));
    let res = (|| -> std::io::Result<()> {
        let mut o = std::fs::OpenOptions::new();
        o.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let mut f = o.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        // на Windows антивирус или индексатор иногда коротко держат файл — несколько повторов
        let mut last = None;
        for _ in 0..4 {
            match std::fs::rename(&tmp, p) {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last = Some(e);
                    std::thread::sleep(std::time::Duration::from_millis(40));
                }
            }
        }
        Err(last.unwrap_or_else(|| std::io::Error::other("rename")))
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}

// ---------------------------------------------------------------------------
// Папка загрузок
// ---------------------------------------------------------------------------

fn cfg_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(CFG_FILE))
}

fn read_cfg(app: &AppHandle) -> DlCfg {
    cfg_path(app).map(|p| load_cfg(&p)).unwrap_or_default()
}

/// Настройки папки загрузок. Файл есть, но не читается (повреждён) — берём свежую целую автокопию
/// (backup.rs): иначе пропали бы прежние папки, и треки из них перестали бы играть.
fn load_cfg(p: &Path) -> DlCfg {
    let parse = |b: &[u8]| serde_json::from_slice::<DlCfg>(b).ok();
    match read_capped(p, CFG_MAX_BYTES) {
        Ok(None) => DlCfg::default(),
        Ok(Some(b)) if parse(&b).is_some() => parse(&b).unwrap_or_default(),
        broken => {
            let why = broken.err().map(|e| e.to_string()).unwrap_or_else(|| "не JSON".into());
            let Some(dir) = crate::backup::snap_dir_of(p) else { return DlCfg::default() };
            match crate::backup::snap_latest(&dir, "downloads", |b| parse(b).is_some()) {
                Some((ts, b)) => {
                    let _ = write_atomic(p, &b);
                    crate::backup::note_recovered(format!(
                        "Настройки папки загрузок были повреждены ({why}) — восстановлены из автокопии от {}",
                        fmt_ts(ts)
                    ));
                    parse(&b).unwrap_or_default()
                }
                None => DlCfg::default(),
            }
        }
    }
}

fn write_cfg(app: &AppHandle, cfg: &DlCfg) -> Result<(), String> {
    let p = cfg_path(app)?;
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?;
    write_atomic(&p, &bytes).map_err(|e| e.to_string())?;
    if let Some(dir) = crate::backup::snap_dir_of(&p) {
        crate::backup::snap_keep(&dir, "downloads", &bytes, 0, false);
    }
    Ok(())
}

/// Время автокопии для сообщения: «2026-11-01 14:05 UTC».
fn fmt_ts(ts: u64) -> String {
    let days = (ts / 86400) as i64;
    let (h, m) = ((ts % 86400) / 3600, (ts % 3600) / 60);
    // дни от 1970-01-01 → дата (алгоритм Хиннанта, civil_from_days)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(mo <= 2);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02} UTC")
}

fn default_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .audio_dir()
        .or_else(|_| app.path().download_dir())
        .map_err(|e| e.to_string())?;
    Ok(base.join(DEFAULT_SUBDIR))
}

fn current_dir(app: &AppHandle) -> Result<(PathBuf, bool), String> {
    match read_cfg(app).dir.map(PathBuf::from) {
        Some(p) if p.is_absolute() => Ok((p, true)),
        _ => Ok((default_dir(app)?, false)),
    }
}

/// Папки, из которых разрешено играть скачанные треки: текущая, папка по умолчанию и прежние,
/// выбранные пользователем. Пути канонические (без «..», символических ссылок и junction) —
/// с ними сравнивается настоящее расположение открытого файла. Несуществующие папки пропускаются,
/// корень диска папкой загрузок не считается.
fn roots(app: &AppHandle) -> Vec<PathBuf> {
    let cfg = read_cfg(app);
    let cands = current_dir(app)
        .map(|(p, _)| p)
        .into_iter()
        .chain(default_dir(app))
        .chain(cfg.past.iter().map(PathBuf::from).filter(|p| p.is_absolute()));
    canon_roots(cands)
}

fn canon_roots(cands: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for c in cands {
        let Ok(c) = c.canonicalize() else { continue };
        if c.is_dir() && c.parent().is_some() && !out.contains(&c) {
            out.push(c);
        }
    }
    out
}

/// Лежит ли канонический путь внутри одной из папок (саму папку файлом не считаем).
fn under_roots(canon: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|r| canon != r && canon.starts_with(r))
}

fn info(app: &AppHandle) -> Result<DirInfo, String> {
    let (p, custom) = current_dir(app)?;
    Ok(DirInfo { path: p.to_string_lossy().into_owned(), custom })
}

fn sanitize_name(raw: &str) -> String {
    let mut s: String = raw
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect();
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = s.trim_matches(|c: char| c == '.' || c == ' ');
    let mut s: String = s.chars().take(150).collect();
    s = s.trim_end_matches(|c: char| c == '.' || c == ' ').to_string();
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit());
    if s.is_empty() || reserved {
        s = format!("Трек {s}").trim().to_string();
    }
    s
}

/// Переложить готовый временный файл под свободным именем «Трек.mp3», «Трек (2).mp3», …
/// Раньше имя выбиралось проверкой exists(), а потом делался rename, который молча заменяет файл:
/// если между проверкой и переименованием там появлялся файл (или его подкладывали), он перезаписывался.
/// Теперь имя занимается атомарно: жёсткая ссылка не создаётся поверх существующего файла.
/// На дисках без жёстких ссылок (FAT32/exFAT, часть сетевых) — прежний способ.
fn place_no_clobber(tmp: &Path, dir: &Path, stem: &str, ext: &str) -> std::io::Result<PathBuf> {
    let names = std::iter::once(format!("{stem}.{ext}")).chain((2..10_000).map(|n| format!("{stem} ({n}).{ext}")));
    for name in names {
        let cand = dir.join(name);
        match std::fs::hard_link(tmp, &cand) {
            Ok(()) => {
                let _ = std::fs::remove_file(tmp);
                return Ok(cand);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                if std::fs::symlink_metadata(&cand).is_ok() {
                    continue;
                }
                std::fs::rename(tmp, &cand)?;
                return Ok(cand);
            }
        }
    }
    Err(std::io::Error::other("не нашлось свободного имени файла"))
}

fn sniff_ext(b: &[u8]) -> &'static str {
    if b.starts_with(b"fLaC") {
        "flac"
    } else if b.len() > 8 && &b[4..8] == b"ftyp" {
        "m4a"
    } else if b.len() > 1 && b[0] == 0xFF && (b[1] & 0xF6) == 0xF0 {
        "aac"
    } else {
        "mp3"
    }
}

fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
}

// ---------------------------------------------------------------------------
// Индекс скачанных треков
// ---------------------------------------------------------------------------

// Запись индекса скачанных треков. Старый формат — просто путь к файлу (строка), новый — объект
// с путём, кратким описанием трека (название, исполнители, обложка, длительность — чтобы показать
// список без сети) и временем скачивания. Старые записи читаются как есть и дополняются описанием позже.
#[derive(Serialize, Deserialize, Clone)]
#[serde(untagged)]
enum Entry {
    Full {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        meta: Option<serde_json::Value>,
        #[serde(default)]
        ts: u64,
    },
    Path(String),
}

impl Entry {
    fn path(&self) -> &str {
        match self {
            Entry::Full { path, .. } | Entry::Path(path) => path,
        }
    }
    fn meta(&self) -> Option<&serde_json::Value> {
        match self {
            Entry::Full { meta, .. } => meta.as_ref(),
            Entry::Path(_) => None,
        }
    }
    fn ts(&self) -> u64 {
        match self {
            Entry::Full { ts, .. } if *ts > 0 => *ts,
            _ => std::fs::symlink_metadata(self.path())
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
        }
    }
}

type Index = BTreeMap<String, Entry>;

const META_MAX: usize = 16 * 1024;

/// Описание трека принимаем только объектом и разумного размера — это всего лишь подсказка для офлайн-списка.
fn clean_meta(meta: Option<serde_json::Value>) -> Option<serde_json::Value> {
    let m = meta.filter(|m| m.is_object())?;
    let len = serde_json::to_vec(&m).map(|v| v.len()).unwrap_or(usize::MAX);
    (len <= META_MAX).then_some(m)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(INDEX_FILE))
}

/// Разобрать индекс, отбрасывая отдельные испорченные записи, а не весь файл: некорректный номер трека,
/// пустой или слишком длинный путь, неизвестный формат записи, лишние записи сверх INDEX_MAX_ENTRIES.
/// `None` — файл вообще не JSON-объект.
fn parse_index(bytes: &[u8]) -> Option<Index> {
    let raw: BTreeMap<String, serde_json::Value> = serde_json::from_slice(bytes).ok()?;
    let mut out = Index::new();
    for (id, v) in raw {
        if out.len() >= INDEX_MAX_ENTRIES {
            break;
        }
        if !id_ok(&id) {
            continue;
        }
        let Ok(mut e) = serde_json::from_value::<Entry>(v) else { continue };
        if e.path().is_empty() || e.path().len() > PATH_MAX_LEN || e.path().contains('\0') {
            continue;
        }
        if let Entry::Full { meta, .. } = &mut e {
            *meta = clean_meta(meta.take());
        }
        out.insert(id, e);
    }
    Some(out)
}

/// Повреждённый или подозрительно большой индекс не затирается следующей записью, а откладывается
/// рядом (downloaded.json.broken-<время>), чтобы список можно было восстановить вручную.
fn quarantine(p: &Path, why: &str) {
    let bad = p.with_file_name(format!("{INDEX_FILE}.broken-{}", now_secs()));
    match std::fs::rename(p, &bad) {
        Ok(()) => eprintln!("[download] индекс скачанных треков не прочитан ({why}), отложен в {}", bad.display()),
        Err(e) => eprintln!("[download] индекс скачанных треков не прочитан ({why}) и не отложен: {e}"),
    }
}

fn load_index(p: &Path) -> Index {
    let why = match read_capped(p, INDEX_MAX_BYTES) {
        Ok(None) => return Index::new(),
        Ok(Some(b)) => match parse_index(&b) {
            Some(idx) => return idx,
            None => "не JSON".to_string(),
        },
        Err(e) => e.to_string(),
    };
    quarantine(p, &why);
    restore_index(p, &why).unwrap_or_default()
}

/// Повреждённый индекс заменяется свежей целой автокопией (backup.rs), чтобы скачанные треки не пропали из списка.
fn restore_index(p: &Path, why: &str) -> Option<Index> {
    let dir = crate::backup::snap_dir_of(p)?;
    let (ts, b) = crate::backup::snap_latest(&dir, "downloaded", |b| parse_index(b).is_some())?;
    let idx = parse_index(&b)?;
    let _ = write_atomic(p, &b);
    crate::backup::note_recovered(format!(
        "Список скачанных треков был повреждён ({why}) — восстановлен из автокопии от {} ({} треков). \
         Повреждённый файл отложен рядом как {INDEX_FILE}.broken-…",
        fmt_ts(ts),
        idx.len()
    ));
    Some(idx)
}

fn save_index(p: &Path, index: &Index) -> Result<(), String> {
    if index.len() > INDEX_MAX_ENTRIES {
        return Err("в списке скачанных слишком много треков".into());
    }
    let bytes = serde_json::to_vec(index).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > INDEX_MAX_BYTES {
        return Err("список скачанных треков слишком большой".into());
    }
    write_atomic(p, &bytes).map_err(|e| e.to_string())?;
    // автокопия не чаще раза в час: при повреждении теряются максимум последние минуты
    if let Some(dir) = crate::backup::snap_dir_of(p) {
        crate::backup::snap_keep(&dir, "downloaded", &bytes, 3600, false);
    }
    Ok(())
}

/// Восстановить список скачанных из автокопии по имени (настройки → «Резервные копии»).
/// Текущий список перед этим сам становится автокопией — откат можно отменить. Возвращает число треков.
#[tauri::command]
pub fn dl_index_restore(app: AppHandle, name: String) -> Result<usize, String> {
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let p = index_path(&app)?;
    let dir = crate::backup::snap_dir_of(&p).ok_or("Не удалось найти папку настроек")?;
    let b = crate::backup::snap_read_in(&dir, "downloaded", &name)?;
    let idx = parse_index(&b).ok_or("Автокопия повреждена")?;
    if let Ok(Some(cur)) = read_capped(&p, INDEX_MAX_BYTES) {
        crate::backup::snap_keep(&dir, "downloaded", &cur, 0, true);
    }
    save_index(&p, &idx)?;
    Ok(idx.len())
}

/// Вызывать под INDEX_LOCK.
fn read_index(app: &AppHandle) -> Index {
    index_path(app).map(|p| load_index(&p)).unwrap_or_default()
}

/// Вызывать под INDEX_LOCK.
fn write_index(app: &AppHandle, index: &Index) -> Result<(), String> {
    save_index(&index_path(app)?, index)
}

/// Файла по этому пути больше нет (удалён пользователем) — запись можно убрать из индекса.
fn gone(p: &str) -> bool {
    matches!(std::fs::symlink_metadata(p), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
}

/// Индекс для показа: из файла убираются записи удалённых треков (он сохраняется очищенным),
/// а в ответ попадают только файлы, которые действительно можно играть — из папок загрузок.
/// Записи вне папок загрузок не удаляются, а просто не показываются.
fn live_index(app: &AppHandle) -> Index {
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut index = read_index(app);
    let before = index.len();
    index.retain(|_, e| !gone(e.path()));
    if index.len() != before {
        let _ = write_index(app, &index);
    }
    let roots = roots(app);
    index.retain(|_, e| playable_in(Path::new(e.path()), &roots));
    index
}

// ---------------------------------------------------------------------------
// Проверка и открытие скачанного файла
// ---------------------------------------------------------------------------

const AUDIO_EXTS: [&str; 7] = ["mp3", "m4a", "mp4", "aac", "flac", "ogg", "opus"];

fn audio_ext_ok(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| AUDIO_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Быстрая проверка по пути (для списка): абсолютный путь, расширение звукового файла,
/// обычный файл, а не ссылка (symlink / reparse point), разумный размер.
/// Само чтение всё равно идёт только через open_audio — с проверкой открытого дескриптора.
fn playable(p: &Path) -> bool {
    if !p.is_absolute() || !audio_ext_ok(p) {
        return false;
    }
    match std::fs::symlink_metadata(p) {
        Ok(m) => m.file_type().is_file() && m.len() > 0 && m.len() <= AUDIO_MAX_BYTES,
        Err(_) => false,
    }
}

/// То же плюс: файл лежит внутри одной из папок загрузок.
fn playable_in(p: &Path, roots: &[PathBuf]) -> bool {
    playable(p) && p.canonicalize().is_ok_and(|c| under_roots(&c, roots))
}

/// Настоящий путь файла, открытого по дескриптору (Windows: GetFinalPathNameByHandleW — та же функция,
/// которой пользуется std::fs::canonicalize, поэтому формат «\\?\C:\…» совпадает с путями папок).
#[cfg(windows)]
fn handle_path(f: &std::fs::File) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED};
    let h = HANDLE(f.as_raw_handle());
    let mut buf = vec![0u16; 512];
    for _ in 0..2 {
        // FILE_NAME_NORMALIZED | VOLUME_NAME_DOS (= 0): путь вида «\\?\C:\…», как у canonicalize
        // SAFETY: дескриптор открыт и живёт, пока жив `f`; буфер передаётся срезом с его длиной
        let n = unsafe { GetFinalPathNameByHandleW(h, &mut buf, FILE_NAME_NORMALIZED) } as usize;
        if n == 0 {
            return None;
        }
        if n < buf.len() {
            return Some(PathBuf::from(std::ffi::OsString::from_wide(&buf[..n])));
        }
        buf.resize(n + 1, 0);
    }
    None
}

/// Открыть скачанный файл для чтения так, чтобы прочитать можно было только звуковой файл
/// из папки загрузок, даже если индекс переписан, а файлы на диске подменяются прямо во время проверки.
///
///  1. По пути: имя со звуковым расширением, сам путь — не ссылка, канонический путь внутри папки загрузок.
///  2. Открытие: на Unix с O_NOFOLLOW (ссылку на месте файла не откроет) и O_NONBLOCK (FIFO не повесит чтение).
///  3. Повторная проверка уже открытого дескриптора — именно из него потом идёт чтение, так что окна
///     между проверкой и чтением нет:
///     * обычный файл разумного размера;
///     * Windows — настоящий путь дескриптора (после всех ссылок и junction) внутри папки загрузок;
///     * Unix — (устройство, inode) дескриптора совпадает с файлом по заново вычисленному каноническому
///       пути, а тот внутри папки загрузок.
///
/// Файлы OneDrive открываются обычным способом (без FILE_FLAG_OPEN_REPARSE_POINT), поэтому играют как раньше.
fn open_audio(p: &Path, roots: &[PathBuf]) -> std::io::Result<(std::fs::File, u64)> {
    use std::io::{Error, ErrorKind};
    let denied = |why: &str| Error::new(ErrorKind::PermissionDenied, why.to_string());
    if !p.is_absolute() || !audio_ext_ok(p) {
        return Err(denied("не звуковой файл"));
    }
    if !std::fs::symlink_metadata(p)?.file_type().is_file() {
        return Err(denied("ссылка вместо файла"));
    }
    if !under_roots(&p.canonicalize()?, roots) {
        return Err(denied("файл вне папки загрузок"));
    }

    let mut o = std::fs::OpenOptions::new();
    o.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let f = o.open(p)?;
    let m = f.metadata()?;
    if !m.is_file() || m.len() == 0 || m.len() > AUDIO_MAX_BYTES {
        return Err(denied("не обычный файл или неподходящий размер"));
    }

    #[cfg(windows)]
    {
        let real = handle_path(&f).ok_or_else(|| denied("не удалось узнать путь открытого файла"))?;
        if !under_roots(&real, roots) {
            return Err(denied("файл подменён: открыт файл вне папки загрузок"));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let canon = p.canonicalize()?;
        let at = std::fs::metadata(&canon)?;
        if !under_roots(&canon, roots) || at.dev() != m.dev() || at.ino() != m.ino() {
            return Err(denied("файл подменён во время открытия"));
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        if !under_roots(&p.canonicalize()?, roots) {
            return Err(denied("файл вне папки загрузок"));
        }
    }
    Ok((f, m.len()))
}

/// Открыть скачанный трек для воспроизведения (свой движок и ymlocal://): файл берётся только
/// из своего индекса по номеру трека и только из папки загрузок. Возвращает открытый файл, путь
/// (для подсказки формата) и размер.
pub fn open_local(app: &AppHandle, id: &str) -> Option<(std::fs::File, PathBuf, u64)> {
    if !id_ok(id) {
        return None;
    }
    // своя версия из «Студии» (studio.rs): играет так же, как скачанный трек
    if id.starts_with("studio-") {
        return crate::studio::open(app, id);
    }
    let found = {
        let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        read_index(app).get(id).map(|e| PathBuf::from(e.path()))
    };
    // не скачан — может быть в кэше приложения (cache.rs: популярные и проигранные треки плейлиста)
    let Some(p) = found else { return crate::cache::open(app, id) };
    match open_audio(&p, &roots(app)) {
        Ok((f, len)) => Some((f, p, len)),
        Err(e) => {
            eprintln!("[download] трек {id} не открыт: {e}");
            None
        }
    }
}

#[tauri::command]
pub fn downloaded_ids(app: AppHandle) -> Vec<String> {
    live_index(&app).into_keys().collect()
}

#[derive(Serialize)]
pub struct DlItem {
    id: String,
    name: String,
    meta: Option<serde_json::Value>,
    ts: u64,
}

/// Скачанные треки с описанием — из них собирается список «Лайков» без интернета.
#[tauri::command]
pub fn downloaded_tracks(app: AppHandle) -> Vec<DlItem> {
    live_index(&app)
        .into_iter()
        .map(|(id, e)| DlItem {
            name: Path::new(e.path())
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            meta: e.meta().cloned(),
            ts: e.ts(),
            id,
        })
        .collect()
}

#[derive(Deserialize)]
pub struct MetaItem {
    id: String,
    meta: serde_json::Value,
}

/// Дописать описание трекам, скачанным раньше (когда описание ещё не сохранялось).
#[tauri::command]
pub fn downloaded_meta(app: AppHandle, items: Vec<MetaItem>) -> Result<(), String> {
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut index = read_index(&app);
    let mut changed = false;
    for it in items.into_iter().take(5000) {
        if !id_ok(&it.id) {
            continue;
        }
        let Some(e) = index.get_mut(&it.id) else { continue };
        if e.meta().is_some() {
            continue;
        }
        let Some(meta) = clean_meta(Some(it.meta)) else { continue };
        let ts = e.ts();
        *e = Entry::Full { path: e.path().to_string(), meta: Some(meta), ts };
        changed = true;
    }
    if changed {
        write_index(&app, &index)?;
    }
    Ok(())
}

#[tauri::command]
pub fn download_dir_get(app: AppHandle) -> Result<DirInfo, String> {
    info(&app)
}

#[tauri::command]
pub async fn download_dir_pick(app: AppHandle) -> Result<Option<DirInfo>, String> {
    let (start, _) = current_dir(&app)?;
    let start = if start.is_dir() { Some(start) } else { start.parent().map(Path::to_path_buf).filter(|p| p.is_dir()) };
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = a.dialog().file().set_title("Папка для скачанных треков");
        if let Some(s) = start {
            d = d.set_directory(s);
        }
        d.blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let p = fp.into_path().map_err(|e| e.to_string())?;
    if !p.is_absolute() || !p.is_dir() {
        return Err("Не удалось открыть эту папку".into());
    }
    if p.parent().is_none() {
        return Err("Выбери папку, а не весь диск".into());
    }
    let mut cfg = read_cfg(&app);
    cfg.retire_current();
    let picked = p.to_string_lossy().into_owned();
    cfg.past.retain(|d| d != &picked);
    cfg.dir = Some(picked);
    write_cfg(&app, &cfg)?;
    info(&app).map(Some)
}

#[tauri::command]
pub fn download_dir_reset(app: AppHandle) -> Result<DirInfo, String> {
    let mut cfg = read_cfg(&app);
    cfg.retire_current();
    write_cfg(&app, &cfg)?;
    info(&app)
}

#[tauri::command]
pub fn download_dir_open(app: AppHandle) -> Result<(), String> {
    let (dir, _) = current_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Временный файл для скачивания (аудит F-06): случайное имя (128 бит из getrandom) и создание только
/// нового файла (create_new = O_EXCL / CREATE_NEW). Если по этому пути уже лежит что угодно, в том числе
/// подставленная ссылка (symlink), открытие завершится ошибкой, а не запишет данные по ссылке.
/// Пишем через открытый дескриптор, а не повторным открытием по пути.
fn write_temp(dir: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    use std::io::Write;
    for _ in 0..8 {
        let mut r = [0u8; 16];
        getrandom::fill(&mut r).map_err(|e| std::io::Error::other(e.to_string()))?;
        let name: String = r.iter().map(|b| format!("{b:02x}")).collect();
        let tmp = dir.join(format!(".{name}.part"));
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o644);
        }
        let mut f = match opts.open(&tmp) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        };
        // открыли действительно обычный файл, а не что-то подставленное
        if !f.metadata()?.is_file() {
            return Err(std::io::Error::other("временный файл подменён"));
        }
        if let Err(e) = f.write_all(bytes).and_then(|_| f.sync_all()) {
            drop(f);
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        return Ok(tmp);
    }
    Err(std::io::Error::other("не удалось создать временный файл"))
}

#[tauri::command]
pub async fn download_track(
    app: AppHandle,
    name: String,
    id: String,
    meta: Option<serde_json::Value>,
) -> Result<String, String> {
    if !id_ok(&id) {
        return Err("Некорректный номер трека".into());
    }
    // ссылку на файл Rust получает сам по номеру трека (интерфейс адрес для скачивания не передаёт)
    let url = net::track_mp3_url(&id).await?;
    let bytes = net::fetch_media(&url).await?;
    if bytes.len() < 1024 {
        return Err("Сервер вернул пустой файл".into());
    }
    let (dir, _) = current_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    let stem = sanitize_name(&name);
    let ext = sniff_ext(&bytes);
    let tmp = write_temp(&dir, &bytes).map_err(|e| format!("Не удалось записать файл: {e}"))?;
    drop(bytes);
    let path = match place_no_clobber(&tmp, &dir, &stem, ext) {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("Не удалось сохранить файл: {e}"));
        }
    };
    let saved = path.to_string_lossy().into_owned();
    {
        let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut index = read_index(&app);
        if !index.contains_key(&id) && index.len() >= INDEX_MAX_ENTRIES {
            return Err(format!("Файл сохранён ({saved}), но список скачанных переполнен ({INDEX_MAX_ENTRIES} треков)"));
        }
        index.insert(id, Entry::Full { path: saved.clone(), meta: clean_meta(meta), ts: now_secs() });
        write_index(&app, &index).map_err(|e| format!("Файл сохранён ({saved}), но не попал в список скачанных: {e}"))?;
    }
    Ok(saved)
}

/// «Удалить с диска» в меню трека: файл стирается, запись — из списка скачанных.
/// Удаляется только файл из своего индекса, только звуковой и только из папок загрузок: путь интерфейс не передаёт.
/// Файл вне папок загрузок (или уже исчезнувший) не трогаем — просто забываем запись.
#[tauri::command]
pub fn download_delete(app: AppHandle, id: String) -> Result<(), String> {
    if !id_ok(&id) {
        return Err("Некорректный номер трека".into());
    }
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut index = read_index(&app);
    let Some(e) = index.get(&id) else { return Ok(()) };
    let p = PathBuf::from(e.path());
    if playable_in(&p, &roots(&app)) {
        if let Err(e) = std::fs::remove_file(&p) {
            if e.kind() != std::io::ErrorKind::NotFound {
                // Windows не даёт стереть открытый файл: трек сейчас играет со своего движка или из ymlocal://
                return Err(format!("Не удалось удалить файл: {e}"));
            }
        }
    }
    index.remove(&id);
    write_index(&app, &index)
}

// ---------------------------------------------------------------------------
// Локальное воспроизведение: <audio src="ymlocal://localhost/track/<id>"> (на Windows —
// http://ymlocal.localhost/track/<id>) играет скачанный файл прямо с диска, без запросов к Яндексу.
// Отдаётся кусками по Range — перемотка работает сразу, в память не грузится весь файл.
// Файл берётся только из своего индекса по номеру трека и только из папки загрузок (open_local).
// ---------------------------------------------------------------------------

use std::io::{Seek, SeekFrom};
use tauri::http::{header, Request, Response, StatusCode};

const LOCAL_CHUNK: u64 = 2 * 1024 * 1024;

fn audio_ctype(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("flac") => "audio/flac",
        Some("m4a") | Some("mp4") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("ogg") | Some("opus") => "audio/ogg",
        Some("wav") => "audio/wav",
        _ => "audio/mpeg",
    }
}

fn local_resp(status: StatusCode, origin: &Option<String>) -> tauri::http::response::Builder {
    let mut b = Response::builder().status(status).header(header::CACHE_CONTROL, "no-store");
    // запрос приходит только из главного окна (проверка в lib.rs); CORS нужен визуализатору —
    // разрешаем ровно Origin страниц приложения, а не любой присланный (аудит F-11)
    if let Some(o) = net::app_origin(origin.as_deref()) {
        b = b.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, o).header(header::VARY, "Origin");
    }
    b
}

fn local_err(status: StatusCode, msg: &str, origin: &Option<String>) -> Response<Vec<u8>> {
    local_resp(status, origin)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap_or_default()
}

/// Кусок уже открытого (и проверенного) файла — повторного открытия по пути нет.
fn read_part(f: &mut std::fs::File, start: u64, len: u64) -> std::io::Result<Vec<u8>> {
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity(len as usize);
    f.take(len).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Обработчик ymlocal://localhost/track/<id> (регистрируется в lib.rs).
pub fn serve_local(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()).map(str::to_string);
    let Some(id) = req.uri().path().strip_prefix("/track/") else {
        return local_err(StatusCode::NOT_FOUND, "not found", &origin);
    };
    let Some((mut file, path, total)) = open_local(app, id) else {
        return local_err(StatusCode::NOT_FOUND, "трек не скачан", &origin);
    };
    let (start, want_end) = crate::whisper::stream::parse_range(req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()));
    if start >= total {
        return local_resp(StatusCode::RANGE_NOT_SATISFIABLE, &origin)
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .body(Vec::new())
            .unwrap_or_default();
    }
    let end = want_end.unwrap_or(u64::MAX).min(start + LOCAL_CHUNK - 1).min(total - 1);
    let body = match read_part(&mut file, start, end - start + 1) {
        Ok(b) if !b.is_empty() => b,
        Ok(_) => return local_err(StatusCode::INTERNAL_SERVER_ERROR, "файл не читается", &origin),
        Err(e) => return local_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string(), &origin),
    };
    let end = start + body.len() as u64 - 1;
    local_resp(StatusCode::PARTIAL_CONTENT, &origin)
        .header(header::CONTENT_TYPE, audio_ctype(&path))
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("yd-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn temp_files() {
        let dir = tmpdir("tmp");
        let a = write_temp(&dir, b"hello").unwrap();
        let b = write_temp(&dir, b"world").unwrap();
        assert_ne!(a, b);
        assert_eq!(std::fs::read(&a).unwrap(), b"hello");
        let n = a.file_name().unwrap().to_string_lossy().into_owned();
        assert!(n.starts_with('.') && n.ends_with(".part") && n.len() == 1 + 32 + 5);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Заранее подставленная ссылка с «предсказуемым» именем не используется: create_new не идёт по ссылке.
    #[cfg(unix)]
    #[test]
    fn temp_never_follows_symlink() {
        let dir = tmpdir("sl");
        let target = dir.join("victim");
        std::fs::write(&target, b"keep").unwrap();
        let link = dir.join(".x.part");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let mut o = std::fs::OpenOptions::new();
        o.write(true).create_new(true);
        assert!(o.open(&link).is_err());
        let t = write_temp(&dir, b"new").unwrap();
        assert_ne!(t, link);
        assert_eq!(std::fs::read(&target).unwrap(), b"keep");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_clobber_and_playable() {
        let dir = tmpdir("nc");
        std::fs::write(dir.join("Трек.mp3"), b"old").unwrap();
        let t = write_temp(&dir, b"new").unwrap();
        let p = place_no_clobber(&t, &dir, "Трек", "mp3").unwrap();
        assert_eq!(p, dir.join("Трек (2).mp3"));
        assert_eq!(std::fs::read(dir.join("Трек.mp3")).unwrap(), b"old"); // старый файл цел
        assert_eq!(std::fs::read(&p).unwrap(), b"new");
        assert!(!t.exists());
        // играть можно только звуковые файлы, а не что угодно из индекса
        assert!(playable(&p));
        std::fs::write(dir.join("secret.txt"), b"x").unwrap();
        assert!(!playable(&dir.join("secret.txt")));
        assert!(!playable(Path::new("relative.mp3")));
        assert!(!playable(&dir.join("missing.mp3")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Читать можно только звуковой файл из папки загрузок — путь в индексе вне её не откроется.
    #[test]
    fn open_only_inside_roots() {
        let base = tmpdir("roots");
        let music = base.join("music");
        let other = base.join("other");
        std::fs::create_dir_all(music.join("sub")).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(music.join("a.mp3"), b"aaaa").unwrap();
        std::fs::write(music.join("sub").join("b.flac"), b"bbbb").unwrap();
        std::fs::write(other.join("c.mp3"), b"cccc").unwrap();
        std::fs::write(music.join("d.txt"), b"dddd").unwrap();
        let roots = canon_roots([music.clone()]);
        assert_eq!(roots.len(), 1);

        let (mut f, len) = open_audio(&music.join("a.mp3"), &roots).unwrap();
        assert_eq!(len, 4);
        assert_eq!(read_part(&mut f, 1, 2).unwrap(), b"aa");
        assert!(open_audio(&music.join("sub").join("b.flac"), &roots).is_ok());
        assert!(open_audio(&other.join("c.mp3"), &roots).is_err()); // вне папки
        assert!(open_audio(&music.join("..").join("other").join("c.mp3"), &roots).is_err()); // «..» не помогает
        assert!(open_audio(&music.join("d.txt"), &roots).is_err()); // не звук
        assert!(open_audio(&music, &roots).is_err());
        assert!(!playable_in(&other.join("c.mp3"), &roots));
        assert!(playable_in(&music.join("a.mp3"), &roots));
        // корень диска папкой загрузок не бывает
        assert!(canon_roots([PathBuf::from(std::path::MAIN_SEPARATOR_STR)]).is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Ссылка внутри папки загрузок на чужой файл (или на папку снаружи) не открывается.
    #[cfg(unix)]
    #[test]
    fn open_rejects_symlinks() {
        let base = tmpdir("rlink");
        let music = base.join("music");
        let outside = base.join("outside");
        std::fs::create_dir_all(&music).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.mp3"), b"secret").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.mp3"), music.join("link.mp3")).unwrap();
        std::os::unix::fs::symlink(&outside, music.join("dirlink")).unwrap();
        let roots = canon_roots([music.clone()]);
        assert!(open_audio(&music.join("link.mp3"), &roots).is_err());
        assert!(open_audio(&music.join("dirlink").join("secret.mp3"), &roots).is_err());
        assert!(!playable_in(&music.join("dirlink").join("secret.mp3"), &roots));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn names() {
        assert_eq!(sanitize_name("AC/DC — Back in Black"), "AC DC — Back in Black");
        assert_eq!(sanitize_name("..\\..\\evil"), "evil");
        assert_eq!(sanitize_name("a:b*c?d\"e<f>g|h"), "a b c d e f g h");
        assert_eq!(sanitize_name("  ...  "), "Трек");
        assert_eq!(sanitize_name("CON"), "Трек CON");
        assert_eq!(sanitize_name("com1.txt"), "Трек com1.txt");
        assert_eq!(sanitize_name("Компот"), "Компот");
        assert_eq!(sanitize_name(&"я".repeat(300)).chars().count(), 150);
        assert!(!sanitize_name("x\u{0}y\n").contains(['\0', '\n']));
    }

    #[test]
    fn index_compat() {
        let idx = parse_index(br#"{"1":"C:\\a.mp3","2":{"path":"C:\\b.mp3","meta":{"title":"x"},"ts":5}}"#).unwrap();
        assert_eq!(idx["1"].path(), "C:\\a.mp3");
        assert!(idx["1"].meta().is_none());
        assert_eq!(idx["2"].path(), "C:\\b.mp3");
        assert_eq!(idx["2"].meta().unwrap()["title"], "x");
        assert_eq!(idx["2"].ts(), 5);
        assert!(clean_meta(Some(serde_json::json!("str"))).is_none());
        assert!(clean_meta(Some(serde_json::json!({ "t": "я".repeat(20_000) }))).is_none());
    }

    /// Испорченные записи отбрасываются по одной, а не весь индекс.
    #[test]
    fn index_validation() {
        let long = "x".repeat(PATH_MAX_LEN + 1);
        let raw = format!(
            r#"{{"ok":"/m/a.mp3","../bad":"/m/b.mp3","n":5,"empty":"","long":"{long}","meta":{{"path":"/m/c.mp3","meta":[1,2]}}}}"#
        );
        let idx = parse_index(raw.as_bytes()).unwrap();
        assert!(idx.contains_key("ok"));
        assert!(!idx.contains_key("../bad"));
        assert!(!idx.contains_key("n"));
        assert!(!idx.contains_key("empty"));
        assert!(!idx.contains_key("long"));
        assert!(idx["meta"].meta().is_none()); // описание не объект — отброшено
        assert!(parse_index(b"[1,2]").is_none());
        assert!(parse_index(b"{\"a\":").is_none());

        let many: BTreeMap<String, String> = (0..INDEX_MAX_ENTRIES + 10).map(|i| (format!("{i}"), "/m/x.mp3".into())).collect();
        let idx = parse_index(&serde_json::to_vec(&many).unwrap()).unwrap();
        assert_eq!(idx.len(), INDEX_MAX_ENTRIES);
    }

    /// Запись атомарная, повреждённый индекс откладывается, а не затирается.
    #[test]
    fn index_files() {
        let dir = tmpdir("idx");
        let p = dir.join(INDEX_FILE);
        assert!(load_index(&p).is_empty()); // файла нет

        let mut idx = Index::new();
        idx.insert("1".into(), Entry::Full { path: "/m/a.mp3".into(), meta: None, ts: 7 });
        save_index(&p, &idx).unwrap();
        assert_eq!(load_index(&p)["1"].ts(), 7);
        save_index(&p, &Index::new()).unwrap();
        assert!(load_index(&p).is_empty());
        // временных файлов не остаётся: только индекс и папка автокопий
        let names: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names.len(), 2, "{names:?}");
        // первая запись дала автокопию (с одним треком), вторая — слишком рано для новой
        assert_eq!(crate::backup::snap_files(&dir.join("backups"), "downloaded").len(), 1);

        // повреждённый индекс откладывается и заменяется автокопией
        std::fs::write(&p, b"{\"1\": \"/m/a.mp3\"").unwrap(); // оборвана посередине
        let back = load_index(&p);
        assert_eq!(back.len(), 1);
        assert_eq!(back["1"].ts(), 7);
        assert!(p.exists());
        let kept: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(kept.iter().any(|n| n.starts_with("downloaded.json.broken-")));

        // автокопий нет — пустой список, файл отложен
        let _ = std::fs::remove_dir_all(dir.join("backups"));
        std::fs::write(&p, b"[").unwrap();
        assert!(load_index(&p).is_empty());
        assert!(!p.exists());

        let mut too_many = Index::new();
        for i in 0..=INDEX_MAX_ENTRIES {
            too_many.insert(format!("{i}"), Entry::Path("/m/x.mp3".into()));
        }
        assert!(save_index(&p, &too_many).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Повреждённые настройки папки загрузок восстанавливаются из автокопии — прежние папки не теряются.
    #[test]
    fn cfg_recovery() {
        let dir = tmpdir("cfg");
        let p = dir.join(CFG_FILE);
        assert!(load_cfg(&p).dir.is_none());
        let cfg = DlCfg { dir: Some("/music".into()), past: vec!["/old".into()] };
        let bytes = serde_json::to_vec_pretty(&cfg).unwrap();
        write_atomic(&p, &bytes).unwrap();
        crate::backup::snap_keep(&dir.join("backups"), "downloads", &bytes, 0, false);
        std::fs::write(&p, b"\0\0\0").unwrap();
        let back = load_cfg(&p);
        assert_eq!(back.dir.as_deref(), Some("/music"));
        assert_eq!(back.past, vec!["/old".to_string()]);
        assert_eq!(load_cfg(&p).dir.as_deref(), Some("/music")); // файл переписан целым
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dates() {
        assert_eq!(fmt_ts(0), "1970-01-01 00:00 UTC");
        assert_eq!(fmt_ts(1_793_549_669), "2026-11-01 16:14 UTC");
        assert_eq!(fmt_ts(951_782_400), "2000-02-29 00:00 UTC");
    }

    #[test]
    fn capped_read() {
        let dir = tmpdir("cap");
        let p = dir.join("f.json");
        assert!(read_capped(&p, 10).unwrap().is_none());
        std::fs::write(&p, b"0123456789").unwrap();
        assert_eq!(read_capped(&p, 10).unwrap().unwrap().len(), 10);
        assert!(read_capped(&p, 9).is_err());
        assert!(read_capped(&dir, 10).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn past_dirs() {
        let mut c = DlCfg { dir: Some("/a".into()), past: vec!["/b".into(), "/a".into()] };
        c.retire_current();
        assert_eq!(c.dir, None);
        assert_eq!(c.past, vec!["/a".to_string(), "/b".to_string()]);
        c.retire_current(); // нечего убирать
        assert_eq!(c.past.len(), 2);
        for i in 0..40 {
            c.dir = Some(format!("/d{i}"));
            c.retire_current();
        }
        assert_eq!(c.past.len(), PAST_DIRS_MAX);
        assert_eq!(c.past[0], "/d39");
        // старый формат без "past" читается
        let old: DlCfg = serde_json::from_str(r#"{"dir":"/x"}"#).unwrap();
        assert!(old.past.is_empty());
    }

    #[test]
    fn ids() {
        assert!(id_ok("12345"));
        assert!(id_ok("12345:678"));
        assert!(!id_ok(""));
        assert!(!id_ok("../x"));
        assert!(!id_ok("a b"));
        assert!(!id_ok(&"1".repeat(41)));
    }

    #[test]
    fn ext() {
        assert_eq!(sniff_ext(b"ID3\x04rest"), "mp3");
        assert_eq!(sniff_ext(b"fLaC\0\0"), "flac");
        assert_eq!(sniff_ext(b"\0\0\0\x20ftypM4A "), "m4a");
    }
}
