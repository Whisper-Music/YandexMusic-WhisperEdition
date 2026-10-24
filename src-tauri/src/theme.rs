// Темы .wmt (Whisper Music Theme): сохранение файла темы через системный диалог «Сохранить как».
// Загрузка темы идёт обычным выбором файла на странице (одиночный файл WebView2 отдаёт без лишних вопросов)
// или перетаскиванием в окно (bg.rs).

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const MAX_THEME: usize = 64 * 1024 * 1024; // как MAX_FILE в src/wmt.js (аудит F-07)

fn file_stem(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let s = s.trim_matches(|c: char| c == '.' || c == ' ');
    let s: String = s.chars().take(80).collect();
    if s.is_empty() { "Тема".into() } else { s }
}

/// «%D0%9A%D0%BE…» -> «Ко…» (имя темы приходит в заголовке, где можно только ASCII)
fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Сохранить тему в файл .wmt: текст темы или архив (zip с theme.wmt и background.*), как собрал theme.js.
/// Данные приходят одним двоичным куском (не JSON), имя — в заголовке x-theme-name.
/// Возвращает путь или None, если пользователь передумал.
#[tauri::command]
pub async fn theme_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("Нет данных темы".into());
    };
    let content = body.clone();
    let name = request
        .headers()
        .get("x-theme-name")
        .and_then(|v| v.to_str().ok())
        .map(pct_decode)
        .unwrap_or_default();
    if content.len() > MAX_THEME {
        return Err("Тема получилась слишком большой (больше 300 МБ)".into());
    }
    if !content.starts_with(b"#WMT") && !content.starts_with(b"PK\x03\x04") {
        return Err("Это не файл темы".into());
    }
    let a = app.clone();
    let file = format!("{}.wmt", file_stem(&name));
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_title("Сохранить тему")
            .set_file_name(file)
            .add_filter("Whisper Music Theme", &["wmt"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else { return Ok(None) };
    let mut p = fp.into_path().map_err(|e| e.to_string())?;
    if p.extension().map(|e| !e.eq_ignore_ascii_case("wmt")).unwrap_or(true) {
        p.set_extension("wmt");
    }
    std::fs::write(&p, &content).map_err(|e| format!("Не удалось записать файл: {e}"))?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::{file_stem, pct_decode};
    #[test]
    fn decode() {
        assert_eq!(pct_decode("%D0%9A%D0%BE%D0%BF%D0%B8%D1%8F%20(1)"), "Копия (1)");
        assert_eq!(pct_decode("abc%"), "abc%");
        assert_eq!(pct_decode("a%zz"), "a%zz");
    }
    #[test]
    fn stems() {
        assert_eq!(file_stem("Королевский (копия)"), "Королевский (копия)");
        assert_eq!(file_stem("a/b:c"), "a b c");
        assert_eq!(file_stem("  ..  "), "Тема");
    }
}
