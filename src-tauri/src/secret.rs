//! Хранение токена входа — отдельно для каждой системы.
//!
//! * Windows — «Диспетчер учётных данных» (Credential Manager).
//! * Linux — Secret Service (GNOME Keyring, KWallet, KeePassXC…). Если в системе нет ни одной
//!   «связки ключей» (минимальные оконные менеджеры: i3, Openbox и т. п.), токен кладётся в файл
//!   в папке настроек приложения с правами 0600 — читать его может только сам пользователь.
//!   Как только связка ключей появится, при следующем входе токен переедет туда, а файл удалится.
use crate::net::{KEYRING_ACCOUNT, KEYRING_SERVICE};
use keyring::Entry;

fn entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

/// Папка настроек приложения: запоминается при старте (нужна только запасному хранилищу Linux).
pub fn init(app: &tauri::AppHandle) {
    imp::init(app);
}

pub fn get() -> Result<Option<String>, String> {
    imp::get()
}

pub fn set(token: &str) -> Result<(), String> {
    imp::set(token)
}

pub fn clear() -> Result<(), String> {
    imp::clear()
}

#[cfg(not(target_os = "linux"))]
mod imp {
    use super::entry;

    pub fn init(_: &tauri::AppHandle) {}

    pub fn get() -> Result<Option<String>, String> {
        match entry()?.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(token: &str) -> Result<(), String> {
        entry()?.set_password(token).map_err(|e| e.to_string())
    }

    pub fn clear() -> Result<(), String> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use super::entry;
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
    use std::path::PathBuf;
    use std::sync::OnceLock;
    use tauri::Manager;

    const FALLBACK_FILE: &str = "token.secret";
    static DIR: OnceLock<PathBuf> = OnceLock::new();

    pub fn init(app: &tauri::AppHandle) {
        if let Ok(d) = app.path().app_config_dir() {
            let _ = DIR.set(d);
        }
    }

    fn file() -> Option<PathBuf> {
        DIR.get().map(|d| d.join(FALLBACK_FILE))
    }

    fn file_read() -> Option<String> {
        let p = file()?;
        let t = fs::read_to_string(p).ok()?;
        let t = t.trim().to_string();
        (!t.is_empty()).then_some(t)
    }

    fn file_write(token: &str) -> Result<(), String> {
        let p = file().ok_or("Не удалось найти папку настроек приложения")?;
        if let Some(dir) = p.parent() {
            fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(dir)
                .map_err(|e| e.to_string())?;
        }
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&p)
            .map_err(|e| e.to_string())?;
        // файл мог существовать раньше с другими правами
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
        f.write_all(token.as_bytes()).map_err(|e| e.to_string())
    }

    fn file_remove() {
        if let Some(p) = file() {
            let _ = fs::remove_file(p);
        }
    }

    pub fn get() -> Result<Option<String>, String> {
        match entry().and_then(|e| e.get_password().map_err(|e| e.to_string())) {
            Ok(t) => Ok(Some(t)),
            // нет записи в связке ключей или нет самой связки — смотрим запасной файл
            Err(_) => Ok(file_read()),
        }
    }

    pub fn set(token: &str) -> Result<(), String> {
        match entry().and_then(|e| e.set_password(token).map_err(|e| e.to_string())) {
            Ok(()) => {
                file_remove();
                Ok(())
            }
            Err(_) => file_write(token)
                .map_err(|e| format!("Не удалось сохранить токен ни в связку ключей, ни в файл: {e}")),
        }
    }

    pub fn clear() -> Result<(), String> {
        if let Ok(e) = entry() {
            let _ = e.delete_credential();
        }
        file_remove();
        Ok(())
    }
}
