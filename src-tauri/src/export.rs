// Выгрузки в файл: «Статистика» в PDF (listenstats.js), лайки и плейлисты в TXT / CSV / JSON (listexport.js).
// Содержимое собирает страница и присылает одним двоичным куском (не JSON); имя и расширение — в заголовках
// x-file-name и x-file-ext. Файл пишется туда, куда укажет системный диалог «Сохранить как», — как у тем (theme.rs).

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const MAX_FILE: usize = 40 * 1024 * 1024; // открытка — одна картинка на лист, список треков — мегабайты

/// Что можно сохранить: расширение → (подпись фильтра в диалоге, проверка содержимого)
fn kind(ext: &str) -> Option<(&'static str, fn(&[u8]) -> bool)> {
    let text = |b: &[u8]| std::str::from_utf8(b).is_ok();
    Some(match ext {
        "pdf" => ("PDF", |b: &[u8]| b.starts_with(b"%PDF-")),
        "txt" => ("Текст", text),
        "csv" => ("Таблица CSV", text),
        "json" => ("JSON", |b: &[u8]| serde_json::from_slice::<serde_json::Value>(b).is_ok()),
        _ => return None,
    })
}

/// Сохранить выгрузку. Возвращает путь или None, если пользователь передумал.
#[tauri::command]
pub async fn export_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("Нет данных файла".into());
    };
    let content = body.clone();
    if content.len() > MAX_FILE {
        return Err("Файл получился слишком большим".into());
    }
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(crate::theme::pct_decode).unwrap_or_default();
    let ext = header("x-file-ext").to_ascii_lowercase();
    let (label, valid) = kind(&ext).ok_or("Такой файл сохранить нельзя")?;
    if !valid(&content) {
        return Err(format!("Содержимое не похоже на {label}"));
    }
    let name = header("x-file-name");
    let stem = if name.trim().is_empty() { "Whisper Music".to_string() } else { crate::theme::file_stem(&name) };
    let a = app.clone();
    let ext2 = ext.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_title("Сохранить файл")
            .set_file_name(format!("{stem}.{ext2}"))
            .add_filter(label, &[ext2.as_str()])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let mut p = fp.into_path().map_err(|e| e.to_string())?;
    if p.extension().map(|e| !e.eq_ignore_ascii_case(&ext)).unwrap_or(true) {
        p.set_extension(&ext);
    }
    std::fs::write(&p, &content).map_err(|e| format!("Не удалось записать файл: {e}"))?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::kind;
    #[test]
    fn kinds() {
        assert!(kind("pdf").unwrap().1(b"%PDF-1.4 ..."));
        assert!(!kind("pdf").unwrap().1(b"hello"));
        assert!(kind("json").unwrap().1(br#"{"a":1}"#));
        assert!(!kind("json").unwrap().1(b"{oops"));
        assert!(kind("txt").unwrap().1("Исполнитель - Название".as_bytes()));
        assert!(!kind("txt").unwrap().1(&[0xff, 0xfe, 0xfd]));
        assert!(kind("exe").is_none());
    }
}
