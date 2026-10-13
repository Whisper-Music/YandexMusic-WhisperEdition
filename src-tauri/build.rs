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
    "download_dir_get",
    "download_dir_pick",
    "download_dir_reset",
    "download_dir_open",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
