// Системные уведомления (src/notify.js): друг зовёт в комнату, участник «подмигнул».
// Страница сама уведомления не показывает (WebView2 / WebKitGTK их не поддерживают одинаково), поэтому — через
// tauri-plugin-notification: в Windows — центр уведомлений, в Linux — D-Bus (org.freedesktop.Notifications).
// Включать или нет, и что показывать, решает JS (настройки «Уведомления»); здесь — только чистка текста.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Строка для уведомления: без управляющих символов, не длиннее `max` символов (по символам, не байтам).
fn clean(s: &str, max: usize) -> String {
    let t: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() > max { t.chars().take(max - 1).collect::<String>() + "…" } else { t }
}

/// Показать системное уведомление: заголовок (≤ 80 символов) и текст (≤ 240).
#[tauri::command]
pub async fn sys_notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    let title = clean(&title, 80);
    let body = clean(&body, 240);
    if title.is_empty() {
        return Err("пустой заголовок".into());
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("уведомление не показано: {e}"))
}

#[cfg(test)]
mod tests {
    use super::clean;

    #[test]
    fn cleans() {
        assert_eq!(clean("  Вадим\nзовёт\t в комнату ", 80), "Вадим зовёт в комнату");
        assert_eq!(clean("абвгдежзик", 5), "абвг…");
        assert_eq!(clean("", 10), "");
    }
}
