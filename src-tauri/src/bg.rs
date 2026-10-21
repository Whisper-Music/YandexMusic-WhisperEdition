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
const MAX_READ: u64 = 1024 * 1024 * 1024; // видеообои бывают большими, но не больше 1 ГБ

#[derive(Default)]
pub struct Picked(Mutex<Vec<PathBuf>>);

#[derive(Serialize, Clone)]
pub struct Entry {
    id: usize,
    name: String,
    size: u64,
}

fn walk(p: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if out.len() >= MAX_FILES {
        return;
    }
    let Ok(meta) = std::fs::symlink_metadata(p) else { return };
    if meta.is_file() {
        out.push(p.to_path_buf());
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
        .map(|(id, p)| Entry {
            id,
            name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            size: std::fs::metadata(p).map(|m| m.len()).unwrap_or(0),
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

/// Содержимое файла из последнего выбора/перетаскивания — по номеру в списке.
#[tauri::command]
pub fn bg_read(state: tauri::State<Picked>, id: usize, max_bytes: Option<u64>) -> Result<tauri::ipc::Response, String> {
    let path = state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .cloned()
        .ok_or("Файл больше недоступен — выбери папку ещё раз")?;
    // Лимит задаёт вызывающий (тема, картинка, видео, project.json), но не выше общего потолка.
    // Читаем не больше лимита + 1 байт: файл мог вырасти между проверкой размера и чтением.
    let limit = max_bytes.unwrap_or(MAX_READ).min(MAX_READ);
    let name = || path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let too_big = || format!("Файл «{}» больше {}", name(), if limit >= 1048576 { format!("{} МБ", limit / 1048576) } else { format!("{} КБ", limit / 1024) });
    let file = std::fs::File::open(&path).map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    if len > limit {
        return Err(too_big());
    }
    let mut bytes = Vec::with_capacity(len as usize);
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|e| format!("Не удалось прочитать файл: {e}"))?;
    if bytes.len() as u64 > limit {
        return Err(too_big());
    }
    Ok(tauri::ipc::Response::new(bytes))
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
