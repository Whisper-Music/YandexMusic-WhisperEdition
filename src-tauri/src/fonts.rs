// Список шрифтов, установленных в системе, — для выбора шрифта интерфейса в настройках (Оформление → Шрифт).
// Читаются только заголовки файлов шрифтов (fontdb), сами файлы в память не грузятся.
// Windows: C:\Windows\Fonts и шрифты, поставленные «только для себя» (%LOCALAPPDATA%\Microsoft\Windows\Fonts);
// Linux: каталоги из настроек fontconfig.

#[tauri::command]
pub async fn system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut names: Vec<String> = db
            .faces()
            .filter_map(|f| f.families.first().map(|(n, _)| n.trim().to_string()))
            // «.SF NS» и подобные — служебные системные шрифты, в списке им не место
            .filter(|n| !n.is_empty() && !n.starts_with('.') && !n.starts_with('@'))
            .collect();
        names.sort_by_key(|n| n.to_lowercase());
        names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        names
    })
    .await
    .map_err(|e| e.to_string())
}
