//! Хранение секретов (токен входа в Яндекс, ключ Whisper Archive) — отдельно для каждой системы.
//!
//! * Windows — «Диспетчер учётных данных» (Credential Manager).
//! * Linux — Secret Service (GNOME Keyring, KWallet, KeePassXC…). Если в системе нет ни одной
//!   «связки ключей» (минимальные оконные менеджеры: i3, Openbox и т. п.), секрет кладётся в файл
//!   в папке настроек приложения с правами 0600 — читать его может только сам пользователь.
//!   Это открытый текст на диске (аудит F-08), поэтому:
//!     - тихо это не происходит: команда secret_backend сообщает интерфейсу, где лежат секреты,
//!       и он показывает предупреждение;
//!     - как только связка ключей появится, секрет переезжает туда при первом же чтении, а файл удаляется;
//!     - сборка/запуск с YANDEX_DESKTOP_STRICT_KEYRING=1 запасной файл не использует вовсе
//!       (вход без связки ключей тогда невозможен — для «боевых» установок).
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

/// Где сейчас лежат секреты: "keyring" — системное хранилище, "file" — запасной файл (Linux),
/// "none" — секрета нет. Интерфейс по этому показывает предупреждение о файле.
#[derive(serde::Serialize)]
pub struct Backend {
    ym: &'static str,
    wa: &'static str,
}

#[tauri::command]
pub fn secret_backend() -> Backend {
    Backend { ym: imp::backend(YM), wa: imp::backend(WA) }
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

    pub fn backend(slot: Slot) -> &'static str {
        match get(slot) {
            Ok(Some(_)) => "keyring",
            _ => "none",
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

    const MAX_SECRET: u64 = 16 * 1024;

    /// Файл с секретом читается, только если это обычный файл (не ссылка), он наш и закрыт от других:
    /// иначе чужой процесс мог подложить свой «токен» или ссылку на другой файл. O_NOFOLLOW — проверка
    /// делается по открытому дескриптору, а не по пути, так что подменить файл между проверкой и чтением нельзя.
    fn file_read(slot: Slot) -> Option<String> {
        use std::io::Read;
        use std::os::unix::fs::MetadataExt;
        let p = file(slot)?;
        let mut f = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&p)
            .ok()?;
        let m = f.metadata().ok()?;
        // SAFETY: geteuid не имеет побочных эффектов и не может завершиться ошибкой
        let me = unsafe { libc::geteuid() };
        if !m.is_file() || m.uid() != me || m.len() > MAX_SECRET {
            return None;
        }
        if m.mode() & 0o077 != 0 {
            // права открыты шире, чем нужно (скопировали, распаковали из архива) — закрываем
            let _ = f.set_permissions(fs::Permissions::from_mode(0o600));
        }
        let mut t = String::new();
        // Read::by_ref явно: в области видимости и Read, и Write (у File оба трейта дают by_ref → E0034)
        Read::by_ref(&mut f).take(MAX_SECRET).read_to_string(&mut t).ok()?;
        let t = t.trim().to_string();
        (!t.is_empty()).then_some(t)
    }

    /// Запись через новый временный файл (O_EXCL, 0600) и атомарное переименование: старый файл никогда
    /// не открывается на запись, поэтому подложенная на его место ссылка не приведёт к записи токена
    /// в чужой файл, а прерванная запись не оставит половину токена.
    fn file_write(slot: Slot, token: &str) -> Result<(), String> {
        let p = file(slot).ok_or("Не удалось найти папку настроек приложения")?;
        let dir = p.parent().ok_or("Не удалось найти папку настроек приложения")?;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
            .map_err(|e| e.to_string())?;
        // папка могла существовать раньше с правами 0755 — секреты в ней видны по именам, закрываем
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
        let mut r = [0u8; 8];
        getrandom::fill(&mut r).map_err(|e| e.to_string())?;
        let tmp = dir.join(format!(".{}.{}.tmp", slot.file, r.iter().map(|b| format!("{b:02x}")).collect::<String>()));
        let res = (|| -> std::io::Result<()> {
            let mut f = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&tmp)?;
            f.write_all(token.as_bytes())?;
            f.sync_all()?;
            fs::rename(&tmp, &p)
        })();
        if res.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        res.map_err(|e| e.to_string())
    }

    fn file_remove(slot: Slot) {
        if let Some(p) = file(slot) {
            let _ = fs::remove_file(p);
        }
    }

    /// Запасной файл запрещён переменной окружения YANDEX_DESKTOP_STRICT_KEYRING=1.
    fn strict() -> bool {
        std::env::var_os("YANDEX_DESKTOP_STRICT_KEYRING").is_some_and(|v| v == "1")
    }

    pub fn get(slot: Slot) -> Result<Option<String>, String> {
        let e = entry(slot);
        match e.as_ref().map_err(|e| e.clone()).and_then(|e| e.get_password().map_err(|err| match err {
            keyring::Error::NoEntry => String::new(),
            other => other.to_string(),
        })) {
            Ok(t) => {
                file_remove(slot); // секрет уже в связке ключей — старый файл не нужен
                Ok(Some(t))
            }
            // связка ключей работает, но записи нет: если остался файл — переносим его туда и удаляем
            Err(msg) if msg.is_empty() => {
                let Some(t) = file_read(slot) else { return Ok(None) };
                if let Ok(en) = &e {
                    if en.set_password(&t).is_ok() && en.get_password().ok().as_deref() == Some(t.as_str()) {
                        file_remove(slot);
                    }
                }
                Ok(Some(t))
            }
            // связки ключей нет вовсе — запасной файл (если не запрещён)
            Err(_) if strict() => Ok(None),
            Err(_) => Ok(file_read(slot)),
        }
    }

    pub fn set(slot: Slot, token: &str) -> Result<(), String> {
        match entry(slot).and_then(|e| e.set_password(token).map_err(|e| e.to_string())) {
            Ok(()) => {
                file_remove(slot);
                Ok(())
            }
            Err(e) if strict() => Err(format!(
                "Связка ключей недоступна ({e}), а хранение в файле отключено (YANDEX_DESKTOP_STRICT_KEYRING=1). \
                 Установи и запусти GNOME Keyring, KWallet или KeePassXC (Secret Service)"
            )),
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

    pub fn backend(slot: Slot) -> &'static str {
        let _ = get(slot); // заодно перенесёт файл в связку ключей, если она появилась
        if file(slot).is_some_and(|p| p.exists()) {
            "file"
        } else if entry(slot).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok() {
            "keyring"
        } else {
            "none"
        }
    }
}
