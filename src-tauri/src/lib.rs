mod auth;
mod bg;
mod desktop;
mod discord;
mod download;
mod hotkeys;
mod lyrics;
mod mini;
mod net;
mod obs;
mod power;
mod secret;
mod sleep;
mod theme;
mod thumbbar;
mod update;
mod whisper;
mod winstate;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

struct TrayToggle(MenuItem<tauri::Wry>);

// значок в трее и его меню: в режиме мини-плеера (Windows) меню снимается, правый клик открывает мини-плеер
struct TrayHandle {
    tray: tauri::tray::TrayIcon,
    menu: Menu<tauri::Wry>,
}

pub(crate) fn tray_menu(app: &tauri::AppHandle, on: bool) {
    if let Some(h) = app.try_state::<TrayHandle>() {
        let _ = h.tray.set_menu(if on { Some(h.menu.clone()) } else { None });
    }
}

#[tauri::command]
fn tray_playing(app: tauri::AppHandle, state: tauri::State<TrayToggle>, playing: bool) {
    let _ = state.0.set_text(if playing { "Пауза" } else { "Играть" });
    power::on_playing(&app, playing);
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

// Без системного автозаполнения: иначе WebView2 при щелчке в поле поиска показывает своё окно
// «Сохранённые сведения» (прошлые запросы, адреса и т.п.). autocomplete="off" в HTML он слушает не всегда.
#[cfg(windows)]
fn no_autofill(w: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
    use windows::core::Interface;
    let _ = w.with_webview(|wv| unsafe {
        if let Ok(core) = wv.controller().CoreWebView2() {
            if let Ok(s) = core.Settings() {
                if let Ok(s4) = s.cast::<ICoreWebView2Settings4>() {
                    let _ = s4.SetIsGeneralAutofillEnabled(false);
                    let _ = s4.SetIsPasswordAutosaveEnabled(false);
                }
            }
        }
    });
}
#[cfg(not(windows))]
fn no_autofill(_: &tauri::WebviewWindow) {}

pub(crate) fn show_main(app: &tauri::AppHandle) {
    power::leave(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn nav_allowed(label: &str, url: &tauri::Url) -> bool {
    match label {
        "main" | "mini" => {
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
        .plugin(hotkeys::plugin())
        // обновления из GitHub Releases — только через команды update.rs, у страницы прямого доступа к плагину нет
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Whisper Archive: потоковое воспроизведение треков архива (wa://localhost/track/<id>,
        // на Windows — http://wa.localhost/...). Только для главного окна: окно входа Яндекса
        // и любые внешние страницы получить треки архива этим путём не могут.
        .register_asynchronous_uri_scheme_protocol("wa", |ctx, request, responder| {
            if ctx.webview_label() != "main" {
                responder.respond(
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::FORBIDDEN)
                        .body(Vec::new())
                        .unwrap_or_default(),
                );
                return;
            }
            tauri::async_runtime::spawn(async move {
                responder.respond(whisper::serve_stream(request).await);
            });
        })
        // Скачанные треки играют прямо с диска (ymlocal://localhost/track/<id>, на Windows —
        // http://ymlocal.localhost/...), без запросов к Яндексу. Тоже только для главного окна.
        .register_asynchronous_uri_scheme_protocol("ymlocal", |ctx, request, responder| {
            if ctx.webview_label() != "main" {
                responder.respond(
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::FORBIDDEN)
                        .body(Vec::new())
                        .unwrap_or_default(),
                );
                return;
            }
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(download::serve_local(&app, &request));
            });
        })
        .invoke_handler(tauri::generate_handler![
            win_minimize,
            win_toggle_max,
            win_is_max,
            win_close,
            win_drag,
            win_set_fullscreen,
            tray_playing,
            // Яндекс Музыка: только именованные операции (net.rs, OPS), без произвольных адресов и методов
            net::ym_read,
            net::ym_write,
            net::ym_track_url,
            net::ym_lyrics,
            net::fetch_bytes,
            desktop::desktop_wallpaper,
            auth::token_exists,
            auth::token_store,
            auth::token_clear,
            auth::yandex_login,
            secret::secret_backend,
            download::download_track,
            download::downloaded_ids,
            download::downloaded_tracks,
            download::downloaded_meta,
            download::download_dir_get,
            download::download_dir_pick,
            download::download_dir_reset,
            download::download_dir_open,
            bg::bg_dir_pick,
            bg::bg_read,
            theme::theme_save,
            // Whisper Archive: у каждой операции своя команда, путь собирает Rust (whisper.rs)
            whisper::wa_token_exists,
            whisper::wa_token_set,
            whisper::wa_token_clear,
            whisper::wa_albums_mine,
            whisper::wa_album,
            whisper::wa_me,
            whisper::wa_stream,
            whisper::wa_auth_request_code,
            whisper::wa_auth_issue,
            whisper::wa_save_track,
            whisper::wa_prefetch,
            whisper::wa_room_create,
            whisper::wa_room_get,
            whisper::wa_room_join,
            whisper::wa_room_leave,
            whisper::wa_room_state,
            whisper::wa_room_suggest,
            whisper::wa_room_dismiss,
            discord::discord_config,
            discord::discord_status,
            discord::discord_retry,
            discord::discord_update,
            mini::tray_mode,
            mini::mini_state,
            mini::mini_state_get,
            mini::mini_ctl,
            hotkeys::hotkeys_set,
            sleep::sleep_start,
            sleep::sleep_cancel,
            sleep::sleep_status,
            lyrics::lyrics_lrclib,
            thumbbar::thumbbar_state,
            obs::obs_config,
            obs::obs_state,
            obs::obs_theme,
            update::update_check,
            update::update_install
        ])
        .setup(|app| {
            secret::init(app.handle());
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_min_size(Some(tauri::LogicalSize::new(780.0, 540.0)));
                let _ = w.set_decorations(false);
                winstate::restore(&w); // размер и место с прошлого запуска; окно создано скрытым и показывается здесь
                no_autofill(&w);
                thumbbar::init(app.handle(), &w); // кнопки под миниатюрой окна на панели задач (Windows)
            }
            let prev = MenuItem::with_id(app, "prev", "Предыдущий", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Пауза / Играть", true, None::<&str>)?;
            let next = MenuItem::with_id(app, "next", "Следующий", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let show = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            // Linux: щелчков по значку нет — мини-плеер открывается пунктом меню
            let mini_item = MenuItem::with_id(app, "mini", "Мини-плеер", true, None::<&str>)?;
            let menu = if cfg!(windows) {
                Menu::with_items(app, &[&prev, &toggle, &next, &sep, &show, &quit])?
            } else {
                Menu::with_items(app, &[&show, &mini_item, &prev, &toggle, &next, &sep, &quit])?
            };
            app.manage(TrayToggle(toggle));
            app.manage(FsSaved::default());
            app.manage(bg::Picked::default());
            app.manage(mini::Shared::default());
            app.manage(update::Pending::default());
            // Трей одинаково создаётся в Windows и Linux, но ведёт себя по-разному:
            // * Windows — левый клик открывает окно, правый показывает меню;
            // * Linux (libayatana-appindicator / StatusNotifierItem) — щелчки по значку приложению
            //   не приходят вообще, по любому клику оболочка сама показывает меню. Поэтому всё,
            //   что умеет значок, продублировано пунктами меню («Открыть» первым делом).
            //   Всплывающая подсказка (tooltip) в Linux не поддерживается и просто игнорируется.
            // * Windows, режим «Мини-плеер» (настройка) — меню у значка снимается (mini::tray_mode),
            //   и правый клик открывает мини-плеер.
            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Моя Музыка")
                .menu(&menu)
                .show_menu_on_left_click(cfg!(not(windows))) // в Linux флаг не действует, меню есть всегда
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        winstate::save(app);
                        app.exit(0);
                    }
                    "mini" => mini::toggle(app, None),
                    id @ ("prev" | "toggle" | "next") => {
                        power::wake(app);
                        let _ = app.emit("tray-ctl", id);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, button_state: MouseButtonState::Up, position, .. } = event {
                        match button {
                            MouseButton::Left => show_main(tray.app_handle()),
                            MouseButton::Right if mini::enabled() => mini::toggle(tray.app_handle(), Some(position)),
                            _ => {}
                        }
                    }
                })
                .build(app)?;
            app.manage(TrayHandle { tray, menu });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        winstate::save(window.app_handle()); // до скрытия: у скрытого окна размеры могут не читаться
                        let _ = window.hide();
                        power::enter(window.app_handle());
                    }
                    WindowEvent::Resized(_) => {
                        power::on_resized(window);
                        winstate::changed(window.app_handle());
                    }
                    WindowEvent::Moved(_) => winstate::changed(window.app_handle()),
                    // перетаскивание файлов/папок в окно принимает Rust (bg.rs), а не веб-страница
                    WindowEvent::DragDrop(ev) => bg::on_drag(window.app_handle(), ev),
                    _ => {}
                }
            } else if window.label() == "mini" {
                if let WindowEvent::Focused(false) = event {
                    mini::on_blur(window.app_handle());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
