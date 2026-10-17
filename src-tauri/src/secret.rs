//! Хранение секретов (токен входа в Яндекс, ключ Whisper Archive) — отдельно для каждой системы.
//!
//! * Windows — «Диспетчер учётных данных» (Credential Manager).
//! * Linux — Secret Service (GNOME Keyring, KWallet, KeePassXC…). Если в системе нет ни одной
//!   «связки ключей» (минимальные оконные менеджеры: i3, Openbox и т. п.), секрет кладётся в файл
//!   в папке настроек приложения с правами 0600 — читать его может только сам пользователь.
//!   Как только связка ключей появится, при следующем сохранении секрет переедет туда, а файл удалится.
use crate::net::{KEYRING_ACCOUNT, KEYRING_SERVICE};
use keyring::Entry;

/// Где лежит секрет: запись в связке ключей и имя запасного файла (нужен только на Linux).
#[derive(Clone, Copy)]
pub struct Slot {
    account: &'static str,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    file: &'static str,
}

/// Токен Яндекс Музыки.
const YM: Slot = Slot { account: KEYRING_ACCOUNT, file: "token.secret" };
/// API-ключ Whisper Archive (wa_…).
pub const WA: Slot = Slot { account: "wa_token", file: "wa_token.secret" };

fn entry(slot: Slot) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, slot.account).map_err(|e| e.to_string())
}

/// Папка настроек приложения: запоминается при старте (нужна только запасному хранилищу Linux).
pub fn init(app: &tauri::AppHandle) {
    imp::init(app);
}

pub fn get() -> Result<Option<String>, String> {
    imp::get(YM)
}

pub fn set(token: &str) -> Result<(), String> {
    imp::set(YM, token)
}

pub fn clear() -> Result<(), String> {
    imp::clear(YM)
}

pub fn get_in(slot: Slot) -> Result<Option<String>, String> {
    imp::get(slot)
}

pub fn set_in(slot: Slot, token: &str) -> Result<(), String> {
    imp::set(slot, token)
}

pub fn clear_in(slot: Slot) -> Result<(), String> {
    imp::clear(slot)
}

#[cfg(not(target_os = "linux"))]
mod imp {
    use super::{entry, Slot};

    pub fn init(_: &tauri::AppHandle) {}

    pub fn get(slot: Slot) -> Result<Option<String>, String> {
        match entry(slot)?.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(slot: Slot, token: &str) -> Result<(), String> {
        entry(slot)?.set_password(token).map_err(|e| e.to_string())
    }

    pub fn clear(slot: Slot) -> Result<(), String> {
        match entry(slot)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use super::{entry, Slot};
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
    use std::path::PathBuf;
    use std::sync::OnceLock;
    use tauri::Manager;

    static DIR: OnceLock<PathBuf> = OnceLock::new();

    pub fn init(app: &tauri::AppHandle) {
        if let Ok(d) = app.path().app_config_dir() {
            let _ = DIR.set(d);
        }
    }

    fn file(slot: Slot) -> Option<PathBuf> {
        DIR.get().map(|d| d.join(slot.file))
    }

    fn file_read(slot: Slot) -> Option<String> {
        let p = file(slot)?;
        let t = fs::read_to_string(p).ok()?;
        let t = t.trim().to_string();
        (!t.is_empty()).then_some(t)
    }

    fn file_write(slot: Slot, token: &str) -> Result<(), String> {
        let p = file(slot).ok_or("Не удалось найти папку настроек приложения")?;
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

    fn file_remove(slot: Slot) {
        if let Some(p) = file(slot) {
            let _ = fs::remove_file(p);
        }
    }

    pub fn get(slot: Slot) -> Result<Option<String>, String> {
        match entry(slot).and_then(|e| e.get_password().map_err(|e| e.to_string())) {
            Ok(t) => Ok(Some(t)),
            // нет записи в связке ключей или нет самой связки — смотрим запасной файл
            Err(_) => Ok(file_read(slot)),
        }
    }

    pub fn set(slot: Slot, token: &str) -> Result<(), String> {
        match entry(slot).and_then(|e| e.set_password(token).map_err(|e| e.to_string())) {
            Ok(()) => {
                file_remove(slot);
                Ok(())
            }
            Err(_) => file_write(slot, token)
                .map_err(|e| format!("Не удалось сохранить токен ни в связку ключей, ни в файл: {e}")),
        }
    }

    pub fn clear(slot: Slot) -> Result<(), String> {
        if let Ok(e) = entry(slot) {
            let _ = e.delete_credential();
        }
        file_remove(slot);
        Ok(())
    }
}
