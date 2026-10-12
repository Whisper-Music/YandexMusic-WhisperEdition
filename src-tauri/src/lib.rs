mod auth;
mod desktop;
mod net;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

// пункт трея «Пауза / Играть»: текст меняется в зависимости от состояния плеера
struct TrayToggle(MenuItem<tauri::Wry>);

#[tauri::command]
fn tray_playing(state: tauri::State<TrayToggle>, playing: bool) {
    let _ = state.0.set_text(if playing { "⏸  Пауза" } else { "▶  Играть" });
}

#[tauri::command]
fn md5_hex(input: String) -> String {
    format!("{:x}", md5::compute(input))
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

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Страж навигации для ВСЕХ окон: главное окно не может уйти со своего локального интерфейса
/// (иначе чужая страница оказалась бы в окне с правами на команды), окно входа — только на страницы Яндекса
/// по https, любые другие окна никуда не переходят.
fn nav_allowed(label: &str, url: &tauri::Url) -> bool {
    match label {
        "main" => {
            let host = url.host_str().unwrap_or("");
            (url.scheme() == "tauri" && host == "localhost")
                || (matches!(url.scheme(), "http" | "https") && host == "tauri.localhost" && url.port().is_none())
                // `tauri dev` отдаёт интерфейс своим сервером на http://127.0.0.1:<порт>;
                // разрешено только в отладочной сборке, в релизе этого адреса нет
                || (cfg!(debug_assertions)
                    && url.scheme() == "http"
                    && matches!(host, "127.0.0.1" | "localhost"))
        }
        "yandex-auth" => auth::auth_nav_allowed(url),
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("nav-guard")
                .on_navigation(|webview, url| nav_allowed(webview.label(), url))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            md5_hex,
            win_minimize,
            win_toggle_max,
            win_is_max,
            win_close,
            win_drag,
            tray_playing,
            net::http_request,
            net::fetch_bytes,
            desktop::desktop_wallpaper,
            auth::token_exists,
            auth::token_store,
            auth::token_clear,
            auth::yandex_login
        ])
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_min_size(Some(tauri::LogicalSize::new(780.0, 540.0)));
                let _ = w.set_decorations(false); // системную рамку убираем, рисуем свою
            }
            let prev = MenuItem::with_id(app, "prev", "⏮  Предыдущий", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "⏯  Пауза / Играть", true, None::<&str>)?;
            let next = MenuItem::with_id(app, "next", "⏭  Следующий", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let show = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&prev, &toggle, &next, &sep, &show, &quit])?;
            app.manage(TrayToggle(toggle));
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Моя Музыка")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    // кнопки плеера: отправляем команду в страницу, там она вызывает те же обработчики, что и нижняя панель
                    id @ ("prev" | "toggle" | "next") => {
                        let _ = app.emit("tray-ctl", id);
                    }
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
            // прячем в трей только главное окно; остальные (например, окно входа в Яндекс) должны закрываться по-настоящему
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
