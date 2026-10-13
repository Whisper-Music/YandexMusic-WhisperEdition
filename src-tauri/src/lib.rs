mod auth;
mod desktop;
mod download;
mod net;
mod power;
mod secret;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

struct TrayToggle(MenuItem<tauri::Wry>);

#[tauri::command]
fn tray_playing(app: tauri::AppHandle, state: tauri::State<TrayToggle>, playing: bool) {
    let _ = state.0.set_text(if playing { "Пауза" } else { "Играть" });
    power::on_playing(&app, playing);
}

#[tauri::command]
fn md5_hex(input: String) -> String {
    format!("{:x}", md5::compute(input))
}

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
    let _ = window.close();
}
// Положение и размер окна до полноэкранного режима, чтобы вернуть всё как было.
#[derive(Default)]
struct FsSaved(std::sync::Mutex<Option<(bool, tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>);

// Окно без системной рамки, да ещё развёрнутое, Windows переводит в полный экран не до конца:
// панель задач остаётся видна (пустой полосой). Поэтому сначала снимаем «развёрнуто»,
// затем включаем полный экран и на всякий случай сами растягиваем окно ровно на монитор.
// В Linux полный экран делает оконный менеджер сам: ручные set_position/set_size там только мешают
// (окно может «прыгнуть» или остаться не на весь экран), поэтому подгонка — только для Windows.
#[tauri::command]
fn win_set_fullscreen(window: tauri::WebviewWindow, saved: tauri::State<FsSaved>, on: bool) {
    let mut st = saved.0.lock().unwrap();
    if on {
        if st.is_none() {
            let was_max = window.is_maximized().unwrap_or(false);
            if was_max {
                let _ = window.unmaximize();
            }
            let pos = window.outer_position().unwrap_or_default();
            let size = window.outer_size().unwrap_or_default();
            *st = Some((was_max, pos, size));
        }
        let _ = window.set_fullscreen(true);
        #[cfg(windows)]
        if let Ok(Some(m)) = window.current_monitor() {
            let _ = window.set_position(*m.position());
            let _ = window.set_size(*m.size());
        }
        let _ = window.set_focus();
    } else {
        let _ = window.set_fullscreen(false);
        if let Some((was_max, pos, size)) = st.take() {
            if cfg!(windows) {
                let _ = window.set_size(size);
                let _ = window.set_position(pos);
            } else {
                let _ = (pos, size); // в Linux прежний размер окну вернёт оконный менеджер
            }
            if was_max {
                let _ = window.maximize();
            }
        }
    }
}
#[tauri::command]
fn win_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

fn show_main(app: &tauri::AppHandle) {
    power::leave(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn nav_allowed(label: &str, url: &tauri::Url) -> bool {
    match label {
        "main" => {
            let host = url.host_str().unwrap_or("");
            (url.scheme() == "tauri" && host == "localhost")
                || (matches!(url.scheme(), "http" | "https") && host == "tauri.localhost" && url.port().is_none())
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
        // Должен быть первым плагином. Повторный запуск (ярлык, меню приложений) не плодит копии,
        // а достаёт уже запущенное окно — в том числе из трея. В Linux это ещё и страховка:
        // в GNOME без расширения AppIndicator значка в трее не видно вовсе, и без этого
        // спрятанное окно было бы не вернуть.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("nav-guard")
                .on_navigation(|webview, url| nav_allowed(webview.label(), url))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            md5_hex,
            win_minimize,
            win_toggle_max,
            win_is_max,
            win_close,
            win_drag,
            win_set_fullscreen,
            tray_playing,
            net::http_request,
            net::fetch_bytes,
            desktop::desktop_wallpaper,
            auth::token_exists,
            auth::token_store,
            auth::token_clear,
            auth::yandex_login,
            download::download_track,
            download::downloaded_ids,
            download::download_dir_get,
            download::download_dir_pick,
            download::download_dir_reset,
            download::download_dir_open
        ])
        .setup(|app| {
            secret::init(app.handle());
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_min_size(Some(tauri::LogicalSize::new(780.0, 540.0)));
                let _ = w.set_decorations(false);
            }
            let prev = MenuItem::with_id(app, "prev", "Предыдущий", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Пауза / Играть", true, None::<&str>)?;
            let next = MenuItem::with_id(app, "next", "Следующий", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let show = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&prev, &toggle, &next, &sep, &show, &quit])?;
            app.manage(TrayToggle(toggle));
            app.manage(FsSaved::default());
            // Трей одинаково создаётся в Windows и Linux, но ведёт себя по-разному:
            // * Windows — левый клик открывает окно, правый показывает меню;
            // * Linux (libayatana-appindicator / StatusNotifierItem) — щелчки по значку приложению
            //   не приходят вообще, по любому клику оболочка сама показывает меню. Поэтому всё,
            //   что умеет значок, продублировано пунктами меню («Открыть» первым делом).
            //   Всплывающая подсказка (tooltip) в Linux не поддерживается и просто игнорируется.
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Моя Музыка")
                .menu(&menu)
                .show_menu_on_left_click(cfg!(not(windows))) // в Linux флаг не действует, меню есть всегда
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    id @ ("prev" | "toggle" | "next") => {
                        power::wake(app);
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
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                        power::enter(window.app_handle());
                    }
                    WindowEvent::Resized(_) => power::on_resized(window),
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
