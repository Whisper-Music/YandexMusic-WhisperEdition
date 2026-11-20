const COMMANDS: &[&str] = &[
    "win_minimize",
    "win_toggle_max",
    "win_is_max",
    "win_close",
    "win_drag",
    "win_set_fullscreen",
    "tray_playing",
    "tray_lang",
    "web_open",
    "web_finish",
    "web_active",
    "web_reply",
    "web_body",
    "web_state_put",
    "web_state_get",
    "web_stamps",
    "web_blob_put",
    "web_blob_get",
    "tray_icon",
    "audio_devices_unlock",
    "audio_endpoints",
    "audio_edges",
    "engine_available",
    "engine_load",
    "engine_play",
    "engine_pause",
    "engine_seek",
    "engine_stop",
    "engine_gain",
    "ym_read",
    "ym_write",
    "ym_track_url",
    "ym_track_format",
    "ym_lyrics",
    "fetch_bytes",
    "desktop_wallpaper",
    "token_exists",
    "token_store",
    "token_clear",
    "yandex_login",
    "secret_backend",
    "download_track",
    "download_delete",
    "cache_info",
    "cache_ids",
    "cache_config",
    "cache_clear",
    "cache_forget",
    "cache_open_dir",
    "cache_played",
    "downloaded_ids",
    "downloaded_tracks",
    "downloaded_meta",
    "download_dir_get",
    "download_dir_pick",
    "download_dir_reset",
    "download_dir_open",
    "dl_index_restore",
    "backup_save",
    "snap_list",
    "snap_settings_save",
    "snap_settings_read",
    "recovery_status",
    "bg_dir_pick",
    "audio_pick",
    "bg_read",
    "theme_save",
    "export_save",
    "link_check",
    "link_tool_status",
    "link_tool_install",
    "link_tool_remove",
    "link_download",
    "link_cancel",
    "themelib_fetch",
    "wa_token_exists",
    "wa_token_set",
    "wa_token_clear",
    "wa_albums_mine",
    "wa_album",
    "wa_album_share",
    "wa_invite_open",
    "wa_me",
    "wa_stream",
    "wa_auth_request_code",
    "wa_auth_issue",
    "wa_save_track",
    "studio_source",
    "studio_info",
    "drop_audio_info",
    "drop_audio_local",
    "drop_audio_archive",
    "studio_save",
    "studio_list",
    "studio_update",
    "studio_delete",
    "studio_export",
    "studio_to_archive",
    "studio_room_cache",
    "wa_lib_list",
    "wa_lib_changes",
    "wa_friends_list",
    "wa_friends_search",
    "wa_friend_request",
    "wa_friend_accept",
    "wa_friend_remove",
    "wa_friend_block",
    "wa_friend_unblock",
    "wa_user_profile",
    "wa_image",
    "wa_my_profile",
    "wa_my_nickname",
    "wa_my_avatar",
    "wa_my_avatar_remove",
    "studio_lib_upload",
    "studio_lib_restore",
    "wa_room_cache_track",
    "wa_prefetch",
    "wa_room_create",
    "wa_room_get",
    "wa_room_join",
    "wa_room_leave",
    "wa_room_state",
    "wa_room_suggest",
    "wa_room_dismiss",
    "wa_room_transfer",
    "wa_room_ping",
    "wa_room_missing",
    "wa_room_wink",
    "wa_room_kick",
    "wa_room_unban",
    "wa_room_lock",
    "notify_show",
    "notify_take",
    "notify_layout",
    "notify_ctl",
    "wa_room_friends",
    "wa_room_friend_forget",
    "wa_room_invite",
    "wa_room_invites",
    "wa_room_presence",
    "wa_room_invite_dismiss",
    "wa_room_theme_share",
    "wa_room_theme_get",
    "wa_room_theme_remove",
    "room_link_take",
    "open_link_take",
    "app_ready",
    "discord_config",
    "discord_status",
    "discord_retry",
    "discord_update",
    "tray_mode",
    "mini_state",
    "mini_state_get",
    "mini_ctl",
    "hotkeys_set",
    "sleep_start",
    "sleep_cancel",
    "sleep_status",
    "lyrics_lrclib",
    "thumbbar_state",
    "system_fonts",
    "sys_idle_ms",
    "obs_config",
    "obs_state",
    "obs_theme",
    "wapi_start",
    "wapi_stop",
    "wapi_body",
    "wapi_reply",
    "wapi_apps",
    "wapi_send",
    "wapi_fetch",
    "update_check",
    "update_install",
];

/// Всё из frontendDist (../src) Tauri встраивает в exe, а в release ещё и сжимает brotli в один поток.
/// Попавшая туда чужая папка сборки (src/core/rust/check/target — 2 ГБ после `cargo check` ядра) растянула
/// сборку на часы: она «висела» на `yandex-desktop`. Поэтому в release — сразу понятная ошибка, в dev — предупреждение.
fn check_frontend() {
    const LIMIT: u64 = 100 * 1024 * 1024;
    println!("cargo:rerun-if-changed=../src"); // папка целиком: появится мусор — проверка запустится снова
    let (mut total, mut stack, mut junk) = (0u64, vec![std::path::PathBuf::from("../src")], Vec::new());
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue }; // ссылки не открываем: file_type их не разворачивает
            if ft.is_dir() {
                if matches!(e.file_name().to_str(), Some("target" | "node_modules")) {
                    junk.push(e.path());
                } else {
                    stack.push(e.path());
                }
            } else if ft.is_file() {
                total += e.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    if junk.is_empty() && total <= LIMIT {
        return;
    }
    let mut msg = String::from("в src/ лишнее — Tauri встроит это в приложение и сборка растянется надолго.");
    for p in &junk {
        msg += &format!("\n  удали папку сборки: {}", p.display());
    }
    if total > LIMIT {
        msg += &format!("\n  файлов в src/ на {} МБ (предел — {} МБ)", total >> 20, LIMIT >> 20);
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        eprintln!("\n{msg}\n");
        std::process::exit(1);
    }
    for line in msg.lines() {
        println!("cargo:warning={}", line.trim());
    }
}

fn main() {
    check_frontend();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
