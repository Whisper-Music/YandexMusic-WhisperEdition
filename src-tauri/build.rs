// Собственные Rust-команды объявлены в манифесте приложения: без него Tauri разрешает их любому окну.
// С манифестом каждая команда доступна только окнам, которым её явно выдали в capabilities/*.json.
const COMMANDS: &[&str] = &[
    "md5_hex",
    "win_minimize",
    "win_toggle_max",
    "win_is_max",
    "win_close",
    "win_drag",
    "tray_playing",
    "http_request",
    "fetch_bytes",
    "desktop_wallpaper",
    "token_exists",
    "token_store",
    "token_clear",
    "yandex_login",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
