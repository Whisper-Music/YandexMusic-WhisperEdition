// src-tauri/src/desktop.rs — обои рабочего стола для фона приложения.
//
// Команда desktop_wallpaper отдаёт интерфейсу файл ТЕКУЩИХ обоев Windows (байты, ArrayBuffer на стороне JS).
// Путь не принимается от интерфейса: его определяет сама система (SystemParametersInfoW), а запасной путь —
// файл TranscodedWallpaper в профиле пользователя, куда Windows кладёт копию текущих обоев (в том числе для
// слайд-шоу и «Windows: интересное»). Читаем только картинки и не больше 50 МБ.

#[cfg(windows)]
mod imp {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt, path::PathBuf};

    #[link(name = "user32")]
    extern "system" {
        fn SystemParametersInfoW(
            ui_action: u32,
            ui_param: u32,
            pv_param: *mut core::ffi::c_void,
            f_win_ini: u32,
        ) -> i32;
    }

    const SPI_GETDESKWALLPAPER: u32 = 0x0073;
    const MAX_BYTES: u64 = 50 * 1024 * 1024; // тот же предел, что у фона в интерфейсе (imgguard.js)

    /// Путь к обоям, который сообщает система.
    fn system_path() -> Option<PathBuf> {
        let mut buf = [0u16; 520];
        let ok = unsafe {
            SystemParametersInfoW(
                SPI_GETDESKWALLPAPER,
                buf.len() as u32,
                buf.as_mut_ptr() as *mut core::ffi::c_void,
                0,
            )
        };
        if ok == 0 {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        if len == 0 {
            return None;
        }
        Some(PathBuf::from(OsString::from_wide(&buf[..len])))
    }

    fn looks_like_image(p: &PathBuf) -> bool {
        let name_ok = p
            .file_name()
            .map(|n| n.to_string_lossy().eq_ignore_ascii_case("TranscodedWallpaper"))
            .unwrap_or(false);
        let ext_ok = p
            .extension()
            .map(|e| {
                matches!(
                    e.to_string_lossy().to_ascii_lowercase().as_str(),
                    "jpg" | "jpeg" | "jfif" | "png" | "bmp" | "webp" | "gif" | "avif"
                )
            })
            .unwrap_or(false);
        name_ok || ext_ok
    }

    pub fn read_wallpaper() -> Result<Vec<u8>, String> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(p) = system_path() {
            candidates.push(p);
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            candidates.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Themes\TranscodedWallpaper"));
        }
        for p in candidates {
            if !p.is_file() || !looks_like_image(&p) {
                continue;
            }
            let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
            if meta.len() > MAX_BYTES {
                return Err("Файл обоев больше 50 МБ".into());
            }
            return std::fs::read(&p).map_err(|e| e.to_string());
        }
        Err("Не удалось найти картинку обоев: возможно, на рабочем столе однотонный цвет. Выбери картинку вручную.".into())
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn read_wallpaper() -> Result<Vec<u8>, String> {
        Err("Эта функция работает только в Windows".into())
    }
}

/// Файл текущих обоев рабочего стола.
#[tauri::command]
pub async fn desktop_wallpaper() -> Result<tauri::ipc::Response, String> {
    imp::read_wallpaper().map(tauri::ipc::Response::new)
}
