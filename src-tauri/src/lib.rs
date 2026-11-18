// Одна библиотека — две сборки: компьютер (Windows, Linux) и телефон (Android; iOS — позже).
// Модули с пометкой cfg(desktop) — то, чего на телефоне нет или что там делается по-другому
// (трей, мини-плеер, глобальные клавиши, свой WASAPI-движок, окна уведомлений, браузерная версия, обновления).
// Общее — запросы к Яндексу, вход, скачивание, кэш, архив, студия — собирается для обеих.
// На телефоне часть помощников общих модулей не нужна (перетаскивание файлов в окно, Discord, OBS, keyring) —
// это не ошибка, поэтому предупреждения о неиспользуемом там выключены; на компьютере они работают как обычно.
#![cfg_attr(mobile, allow(dead_code, unused_imports, unused_mut))]
#[cfg(desktop)]
mod audiodev;
mod auth;
mod backup;
mod bg;
mod cache;
mod deeplink;
#[cfg(desktop)]
mod desktop;
// Discord и виджет OBS — общие, из ядра (подмодуль src/core); своё у приложения — в whisper_host.rs
#[cfg(desktop)]
#[path = "../../src/core/rust/discord.rs"]
mod discord;
mod download;
mod edges;
#[cfg(desktop)]
mod engine;
mod export;
#[cfg(desktop)]
mod fonts;
#[cfg(desktop)]
mod hotkeys;
#[cfg(desktop)]
mod idle;
#[cfg(desktop)]
mod linkdl;
mod lyrics;
#[cfg(desktop)]
mod mini;
#[cfg(desktop)]
mod mixer;
mod net;
#[cfg(desktop)]
mod notify;
#[cfg(desktop)]
#[path = "../../src/core/rust/obs.rs"]
mod obs;
#[cfg(desktop)]
mod power;
mod secret;
#[cfg(desktop)]
mod shell;
mod sleep;
mod studio;
mod theme;
mod themelib;
#[cfg(desktop)]
mod thumbbar;
#[cfg(desktop)]
mod update;
// Whisper Archive: общая часть приходит с ядром (подмодуль whisper-core в src/core), своё у приложения —
// whisper_host (хранилище ключа, семафор, Origin, подпись) и whisper_yandex (что архив делает с треками Яндекса)
#[path = "../../src/core/rust/whisper/mod.rs"]
mod whisper;
mod whisper_host;
mod whisper_yandex;
#[cfg(desktop)]
mod webmode;
#[cfg(desktop)]
mod winstate;
use tauri::Manager;

#[cfg(desktop)]
pub(crate) use shell::{show_main, tray_menu};

/// На телефоне окно одно и всегда на экране: «показать главное окно» (ссылка whisper://, уведомление) — ничего не делает.
#[cfg(mobile)]
pub(crate) fn show_main(_: &tauri::AppHandle) {}

/// Своя страница приложения (а не чужой сайт).
pub(crate) fn app_page(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    (url.scheme() == "tauri" && host == "localhost")
        || (matches!(url.scheme(), "http" | "https") && host == "tauri.localhost" && url.port().is_none())
        || (cfg!(debug_assertions) && url.scheme() == "http" && matches!(host, "127.0.0.1" | "localhost"))
        // телефон в режиме разработки (tauri android dev) грузит страницу с сервера разработки — по адресу компьютера в сети
        || (cfg!(all(mobile, debug_assertions)) && url.scheme() == "http" && url.port().is_some())
}

fn nav_allowed(webview: &tauri::Webview, url: &tauri::Url) -> bool {
    match webview.label() {
        // на телефоне второго окна нет: вход в Яндекс идёт прямо в главном (auth.rs, mobile_nav)
        #[cfg(mobile)]
        "main" => app_page(url) || auth::mobile_nav(webview, url),
        #[cfg(desktop)]
        "main" | "mini" | "notify" => app_page(url),
        "yandex-auth" => auth::auth_nav_allowed(url),
        _ => false,
    }
}

/// Список команд: сначала общие для компьютера и телефона, потом — переданные (только для своей сборки).
/// generate_handler! можно вызвать лишь один раз, а пометок cfg на отдельных командах он не понимает —
/// поэтому общий список живёт здесь, а дополнения подставляются как есть (tt — без разбора).
macro_rules! commands {
    ($($extra:tt)*) => {
        tauri::generate_handler![
            // края трека: тишина и громкость начала/конца (edges.rs, transitions.js)
            edges::audio_edges,
            // Яндекс Музыка: только именованные операции (net.rs, OPS), без произвольных адресов и методов
            net::ym_read,
            net::ym_write,
            net::ym_track_url,
            net::ym_track_format,
            net::ym_lyrics,
            net::fetch_bytes,
            auth::token_exists,
            auth::token_store,
            auth::token_clear,
            auth::yandex_login,
            secret::secret_backend,
            download::download_track,
            download::download_delete,
            // кэш приложения: популярные нескачанные треки и проигранное из текущего плейлиста (cache.rs)
            cache::cache_info,
            cache::cache_ids,
            cache::cache_config,
            cache::cache_clear,
            cache::cache_forget,
            cache::cache_open_dir,
            cache::cache_played,
            download::downloaded_ids,
            download::downloaded_tracks,
            download::downloaded_meta,
            download::download_dir_get,
            download::download_dir_pick,
            download::download_dir_reset,
            download::download_dir_open,
            download::dl_index_restore,
            // резервные копии и автокопии на случай повреждения данных (backup.rs)
            backup::backup_save,
            backup::snap_list,
            backup::snap_settings_save,
            backup::snap_settings_read,
            backup::recovery_status,
            bg::bg_dir_pick,
            bg::audio_pick,
            bg::bg_read,
            theme::theme_save,
            export::export_save,
            // Whisper Archive: у каждой операции своя команда, путь собирает Rust (src/core/rust/whisper/)
            whisper::wa_token_exists,
            whisper::wa_token_set,
            whisper::wa_token_clear,
            whisper::wa_albums_mine,
            whisper::wa_album,
            whisper::wa_album_share,
            whisper::wa_invite_open,
            whisper::wa_me,
            whisper::wa_stream,
            whisper::auth::wa_auth_request_code,
            whisper::auth::wa_auth_issue,
            whisper_yandex::wa_save_track,
            // «Студия» (studio.rs): обрезка треков, свои версии с локальным лайком, отправка в архив
            studio::studio_source,
            studio::studio_info,
            studio::drop_audio_info,
            studio::drop_audio_local,
            studio::drop_audio_archive,
            studio::studio_save,
            studio::studio_list,
            studio::studio_update,
            studio::studio_delete,
            studio::studio_export,
            studio::studio_to_archive,
            studio::studio_room_cache,
            // синхронизация своих треков через архив (libsync.js; ядро — whisper/library.rs)
            whisper::library::wa_lib_list,
            whisper::library::wa_lib_changes,
            whisper::friends::wa_friends_list,
            whisper::friends::wa_friends_search,
            whisper::friends::wa_friend_request,
            whisper::friends::wa_friend_accept,
            whisper::friends::wa_friend_remove,
            whisper::friends::wa_friend_block,
            whisper::friends::wa_friend_unblock,
            whisper::friends::wa_user_profile,
            whisper::friends::wa_image,
            whisper::profile::wa_my_profile,
            whisper::profile::wa_my_nickname,
            whisper::profile::wa_my_avatar,
            whisper::profile::wa_my_avatar_remove,
            studio::studio_lib_upload,
            studio::studio_lib_restore,
            whisper_yandex::wa_room_cache_track,
            whisper::stream::wa_prefetch,
            whisper::rooms::wa_room_create,
            whisper::rooms::wa_room_get,
            whisper::rooms::wa_room_join,
            whisper::rooms::wa_room_leave,
            whisper::rooms::wa_room_state,
            whisper::rooms::wa_room_suggest,
            whisper::rooms::wa_room_dismiss,
            whisper::rooms::wa_room_transfer,
            whisper::rooms::wa_room_ping,
            whisper::rooms::wa_room_missing,
            whisper::rooms::wa_room_wink,
            whisper::rooms::wa_room_kick,
            whisper::rooms::wa_room_unban,
            whisper::rooms::wa_room_lock,
            whisper::rooms::wa_room_friends,
            whisper::rooms::wa_room_friend_forget,
            whisper::rooms::wa_room_invite,
            whisper::rooms::wa_room_invites,
            whisper::rooms::wa_room_presence,
            whisper::rooms::wa_room_invite_dismiss,
            whisper::rooms::wa_room_theme_share,
            whisper::rooms::wa_room_theme_get,
            whisper::rooms::wa_room_theme_remove,
            sleep::sleep_start,
            sleep::sleep_cancel,
            sleep::sleep_status,
            lyrics::lyrics_lrclib,
            themelib::themelib_fetch,
            deeplink::room_link_take,
            deeplink::open_link_take,
            $($extra)*
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    shell::webview_args();
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = shell::first_plugins(builder);
    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("nav-guard")
                .on_navigation(|webview, url| nav_allowed(webview, url))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    let builder = shell::plugins(builder);
    #[cfg(desktop)]
    let builder = builder.invoke_handler(commands![
        shell::win_minimize,
        shell::win_toggle_max,
        shell::win_is_max,
        shell::win_close,
        shell::win_drag,
        shell::win_set_fullscreen,
        shell::tray_playing,
        shell::tray_lang,
        shell::tray_icon,
        // браузерная версия (webmode.rs)
        webmode::web_open,
        webmode::web_finish,
        webmode::web_active,
        webmode::web_reply,
        webmode::web_body,
        webmode::web_state_put,
        webmode::web_state_get,
        webmode::web_stamps,
        webmode::web_blob_put,
        webmode::web_blob_get,
        audiodev::audio_devices_unlock,
        audiodev::audio_endpoints,
        // свой звуковой движок (эксклюзивный WASAPI)
        engine::engine_available,
        engine::engine_load,
        engine::engine_play,
        engine::engine_pause,
        engine::engine_seek,
        engine::engine_stop,
        engine::engine_gain,
        desktop::desktop_wallpaper,
        linkdl::link_check,
        linkdl::link_tool_status,
        linkdl::link_tool_install,
        linkdl::link_tool_remove,
        linkdl::link_download,
        linkdl::link_cancel,
        notify::notify_show,
        notify::notify_take,
        notify::notify_layout,
        notify::notify_ctl,
        discord::discord_config,
        discord::discord_status,
        discord::discord_retry,
        discord::discord_update,
        mini::tray_mode,
        mini::mini_state,
        mini::mini_state_get,
        mini::mini_ctl,
        hotkeys::hotkeys_set,
        thumbbar::thumbbar_state,
        fonts::system_fonts,
        idle::sys_idle_ms,
        obs::obs_config,
        obs::obs_state,
        obs::obs_theme,
        update::update_check,
        update::update_install,
        winstate::app_ready
    ]);
    #[cfg(mobile)]
    let builder = builder.invoke_handler(commands![]);
    builder
        // Whisper Archive: потоковое воспроизведение треков архива (wa://localhost/track/<id>,
        // на Windows и Android — http://wa.localhost/...). Только для главного окна: окно входа Яндекса
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
                responder.respond(whisper::stream::serve_stream(request).await);
            });
        })
        // Скачанные треки играют прямо с диска (ymlocal://localhost/track/<id>, на Windows и Android —
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
        .setup(|app| {
            secret::init(app.handle());
            deeplink::init(app.handle()); // ссылки whisper://room/КОД (приглашения в комнату) и whisper://track|album|artist/…
            app.manage(bg::Picked::default());
            #[cfg(desktop)]
            shell::setup(app)?;
            Ok(())
        })
        .on_window_event(|_window, _event| {
            #[cfg(desktop)]
            shell::on_window_event(_window, _event);
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            // приложение закрывается совсем (не «свернуть в трей») — друзья сразу видят «не в сети», а не через 70 с
            if let tauri::RunEvent::Exit = event {
                tauri::async_runtime::block_on(whisper::rooms::presence_offline());
            }
        });
}
