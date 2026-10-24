// Фон из папки (обои Wallpaper Engine) или перетащенных файлов — без браузерного окна
// «Отправить N файлов на этот сайт?». Это окно WebView2 показывает всякий раз, когда папка попадает
// на страницу обычным путём (<input webkitdirectory> или перетаскивание в веб-страницу), и отключить его нельзя.
// Поэтому папку выбирает и принимает Rust: диалог выбора папки или перетаскивание в окно (событие окна,
// а не веб-страницы). Странице отдаётся только список имён, а содержимое — по номеру из этого списка,
// так что прочитать можно лишь то, что пользователь сам выбрал или перетащил.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

const MAX_DEPTH: usize = 3; // как и раньше в JS: не глубже трёх уровней
const MAX_FILES: usize = 2000;

/// Потолок чтения для каждого сценария (аудит F-05): интерфейс называет сценарий, а не число байт.
fn limit_for(kind: &str) -> Option<u64> {
    const MB: u64 = 1024 * 1024;
    Some(match kind {
        "text" => 4 * MB,    // project.json обоев и т. п.
        "image" => 50 * MB,  // картинка фона (imgguard.js)
        "theme" => 64 * MB,  // файл темы .wmt (wmt.js MAX_FILE)
        "video" => 500 * MB, // видеообои (main.js VIDEO_MAX_BYTES)
        _ => return None,
    })
}

/// Чем был файл, когда его выбрали: перед чтением открытый дескриптор сверяется с этим (аудит F-05).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Ident {
    len: u64,
    modified: Option<std::time::SystemTime>,
    /// Unix: (устройство, inode); Windows: (серийный номер тома, индекс файла). Это «паспорт» файла:
    /// подменённый путь (ссылка, переименование) ведёт к файлу с другим номером.
    file_id: Option<(u64, u64)>,
}

impl Ident {
    #[cfg(unix)]
    fn of(m: &std::fs::Metadata, _path: Option<&Path>) -> Self {
        use std::os::unix::fs::MetadataExt;
        Ident { len: m.len(), modified: m.modified().ok(), file_id: Some((m.dev(), m.ino())) }
    }

    /// На Windows индекс файла даёт только открытый дескриптор: при обходе папки открываем саму запись
    /// (без доступа к данным и без перехода по ссылке — так файлы OneDrive не скачиваются).
    #[cfg(windows)]
    fn of(m: &std::fs::Metadata, path: Option<&Path>) -> Self {
        let file_id = path.and_then(|p| {
            use std::os::windows::fs::OpenOptionsExt;
            const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
            const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
            let f = std::fs::OpenOptions::new()
                .access_mode(0)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(p)
                .ok()?;
            win_file_id(&f)
        });
        Ident { len: m.len(), modified: m.modified().ok(), file_id }
    }

    #[cfg(not(any(unix, windows)))]
    fn of(m: &std::fs::Metadata, _path: Option<&Path>) -> Self {
        Ident { len: m.len(), modified: m.modified().ok(), file_id: None }
    }

    /// То же для уже открытого файла.
    fn of_open(f: &std::fs::File, m: &std::fs::Metadata) -> Self {
        #[cfg(windows)]
        {
            Ident { len: m.len(), modified: m.modified().ok(), file_id: win_file_id(f) }
        }
        #[cfg(not(windows))]
        {
            let _ = f;
            Self::of(m, None)
        }
    }
}

#[cfg(windows)]
fn win_file_id(f: &std::fs::File) -> Option<(u64, u64)> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(f.as_raw_handle()), &mut info) }.ok()?;
    Some((info.dwVolumeSerialNumber as u64, ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64))
}

#[derive(Default)]
pub struct Picked(Mutex<Vec<(PathBuf, Ident)>>);

#[derive(Serialize, Clone)]
pub struct Entry {
    id: usize,
    name: String,
    size: u64,
}

fn walk(p: &Path, depth: usize, out: &mut Vec<(PathBuf, Ident)>) {
    if out.len() >= MAX_FILES {
        return;
    }
    let Ok(meta) = std::fs::symlink_metadata(p) else { return };
    if meta.is_file() {
        out.push((p.to_path_buf(), Ident::of(&meta, Some(p))));
    } else if meta.is_dir() && depth <= MAX_DEPTH {
        let Ok(rd) = std::fs::read_dir(p) else { return };
        let mut kids: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
        kids.sort();
        for k in kids {
            walk(&k, depth + 1, out);
        }
    }
    // ссылки (symlink) не открываем — читаем только то, что реально лежит в выбранной папке
}

fn remember(app: &AppHandle, roots: &[PathBuf]) -> Vec<Entry> {
    let mut files = Vec::new();
    for r in roots {
        walk(r, 0, &mut files);
    }
    let list = files
        .iter()
        .enumerate()
        .map(|(id, (p, ident))| Entry {
            id,
            name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            size: ident.len,
        })
        .collect();
    if let Some(st) = app.try_state::<Picked>() {
        *st.0.lock().unwrap_or_else(|e| e.into_inner()) = files;
    }
    list
}

/// Кнопка «Выбрать папку обоев»: системный диалог выбора папки.
#[tauri::command]
pub async fn bg_dir_pick(app: AppHandle) -> Result<Option<Vec<Entry>>, String> {
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog().file().set_title("Папка обоев (Wallpaper Engine)").blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let p = fp.into_path().map_err(|e| e.to_string())?;
    Ok(Some(remember(&app, &[p])))
}

/// Открыть выбранный файл и убедиться, что открыт тот самый обычный файл, что был при выборе
/// (аудит F-05): между выбором и чтением другой процесс мог заменить его ссылкой на чужой файл.
///  * Unix — O_NOFOLLOW: ссылка вместо файла не откроется вовсе; плюс сверка (устройство, inode).
///  * Windows — сверка (том, индекс файла) у открытого дескриптора: если путь теперь ведёт по ссылке
///    к другому файлу, номер не совпадёт. Файлы OneDrive при этом читаются как обычно.
///
/// Проверка идёт по дескриптору, из которого потом читаются данные, а не по пути — гонке негде случиться.
fn open_picked(path: &Path, want: &Ident) -> Result<std::fs::File, String> {
    let mut o = std::fs::OpenOptions::new();
    o.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK); // O_NONBLOCK: подменённый FIFO не повесит чтение
    }
    let file = o.open(path).map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Файл подменён — выбери папку ещё раз".into());
    }
    let got = Ident::of_open(&file, &meta);
    let same_file = match (want.file_id, got.file_id) {
        (Some(a), Some(b)) => a == b,
        _ => true, // номер узнать не удалось (редкие файловые системы) — остаются размер и время изменения
    };
    if !same_file || got.len != want.len || got.modified != want.modified {
        return Err("Файл изменился после выбора — выбери папку ещё раз".into());
    }
    Ok(file)
}

/// Содержимое файла из последнего выбора/перетаскивания — по номеру в списке.
/// `kind` — сценарий (text, image, theme, video): от него зависит потолок размера.
#[tauri::command]
pub fn bg_read(state: tauri::State<Picked>, id: usize, kind: String) -> Result<tauri::ipc::Response, String> {
    let limit = limit_for(&kind).ok_or("Неизвестный тип файла")?;
    let (path, ident) = state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .cloned()
        .ok_or("Файл больше недоступен — выбери папку ещё раз")?;
    read_limited(&path, &ident, limit).map(tauri::ipc::Response::new)
}

fn read_limited(path: &Path, ident: &Ident, limit: u64) -> Result<Vec<u8>, String> {
    let name = || path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let too_big = || format!("Файл «{}» больше {}", name(), if limit >= 1048576 { format!("{} МБ", limit / 1048576) } else { format!("{} КБ", limit / 1024) });
    if ident.len > limit {
        return Err(too_big());
    }
    let file = open_picked(path, ident)?;
    // Читаем не больше лимита + 1 байт: файл мог вырасти между проверкой размера и чтением.
    let mut bytes = Vec::with_capacity(ident.len as usize);
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    if bytes.len() as u64 > limit {
        return Err(too_big());
    }
    if bytes.len() as u64 != ident.len {
        return Err("Файл изменился после выбора — выбери папку ещё раз".into());
    }
    Ok(bytes)
}

/// Перетаскивание в окно (lib.rs, WindowEvent::DragDrop): подсветка зоны и сам список файлов.
pub fn on_drag(app: &AppHandle, ev: &tauri::DragDropEvent) {
    use tauri::DragDropEvent as D;
    match ev {
        D::Enter { position, .. } | D::Over { position } => {
            let _ = app.emit_to("main", "bg-drag", serde_json::json!({ "over": true, "x": position.x, "y": position.y }));
        }
        D::Leave => {
            let _ = app.emit_to("main", "bg-drag", serde_json::json!({ "over": false }));
        }
        D::Drop { paths, position } => {
            let list = remember(app, paths);
            let _ = app.emit_to("main", "bg-drop", serde_json::json!({ "x": position.x, "y": position.y, "files": list }));
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("yd-bg-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn reads_picked_file() {
        let d = tmpdir("ok");
        std::fs::write(d.join("a.txt"), b"hello").unwrap();
        let mut out = Vec::new();
        walk(&d, 0, &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(read_limited(&out[0].0, &out[0].1, 1024).unwrap(), b"hello");
        assert!(read_limited(&out[0].0, &out[0].1, 3).is_err()); // больше лимита
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn rejects_changed_file() {
        let d = tmpdir("chg");
        let f = d.join("a.txt");
        std::fs::write(&f, b"hello").unwrap();
        let mut out = Vec::new();
        walk(&d, 0, &mut out);
        std::fs::write(&f, b"something else entirely").unwrap();
        assert!(read_limited(&out[0].0, &out[0].1, 1024).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Выбрали файл, потом его атомарно заменили ссылкой на другой — чтение должно отказать.
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_swap() {
        let d = tmpdir("sl");
        let f = d.join("a.txt");
        std::fs::write(&f, b"hello").unwrap();
        let secret = d.join("secret");
        std::fs::write(&secret, b"hello").unwrap(); // тот же размер — сверка только по длине не помогла бы
        let mut out = Vec::new();
        walk(&d, 0, &mut out);
        let picked = out.iter().find(|(p, _)| p == &f).unwrap().clone();
        let tmp = d.join("swap");
        std::os::unix::fs::symlink(&secret, &tmp).unwrap();
        std::fs::rename(&tmp, &f).unwrap();
        assert!(read_limited(&picked.0, &picked.1, 1024).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn limits() {
        assert_eq!(limit_for("text"), Some(4 * 1024 * 1024));
        assert!(limit_for("video").unwrap() > limit_for("image").unwrap());
        assert_eq!(limit_for("anything"), None);
    }
}
