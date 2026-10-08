use std::{collections::HashMap, sync::OnceLock};
use tauri_plugin_http::reqwest;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[tauri::command]
fn md5_hex(input: String) -> String {
    format!("{:x}", md5::compute(input))
}

#[derive(serde::Serialize)]
struct HttpResp {
    status: u16,
    body: String,
}

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

#[tauri::command]
async fn http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResp, String> {
    let client = CLIENT.get_or_init(reqwest::Client::new);
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(m, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResp { status, body })
}

// Управление окном для собственной верхней панели
#[tauri::command]
fn win_minimize(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}
#[tauri::command]
fn win_toggle_max(window: tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}
#[tauri::command]
fn win_is_max(window: tauri::WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}
#[tauri::command]
fn win_close(window: tauri::WebviewWindow) {
    let _ = window.close(); // дальше сработает CloseRequested: окно уйдёт в трей
}
#[tauri::command]
fn win_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

// Скачивание файла целиком (нужно визуализатору: звук должен быть «своим» для браузера)
#[tauri::command]
async fn fetch_bytes(url: String) -> Result<tauri::ipc::Response, String> {
    let client = CLIENT.get_or_init(reqwest::Client::new);
    let resp = client
        .get(&url)
        .header("User-Agent", "Yandex-Music-API")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![md5_hex, http_request, fetch_bytes, win_minimize, win_toggle_max, win_is_max, win_close, win_drag])
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_min_size(Some(tauri::LogicalSize::new(780.0, 540.0)));
                let _ = w.set_decorations(false); // системную рамку убираем, рисуем свою
            }
            let show = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Моя Музыка")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // крестик прячет окно в трей, музыка продолжает играть
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
