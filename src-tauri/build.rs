const COMMANDS: &[&str] = &[
    "md5_hex",
    "win_minimize",
    "win_toggle_max",
    "win_is_max",
    "win_close",
    "win_drag",
    "win_set_fullscreen",
    "tray_playing",
    "http_request",
    "fetch_bytes",
    "desktop_wallpaper",
    "token_exists",
    "token_store",
    "token_clear",
    "yandex_login",
    "download_track",
    "downloaded_ids",
    "downloaded_tracks",
    "downloaded_meta",
    "download_dir_get",
    "download_dir_pick",
    "download_dir_reset",
    "download_dir_open",
    "bg_dir_pick",
    "bg_read",
    "theme_save",
    "wa_token_exists",
    "wa_token_set",
    "wa_token_clear",
    "wa_get",
    "wa_stream",
    "wa_auth_request_code",
    "wa_auth_issue",
    "wa_save_track",
    "wa_prefetch",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
