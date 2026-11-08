// Что приложение даёт общей части Whisper Archive (src/core/rust/whisper/ — подмодуль whisper-core).
// Это единственное «своё» у приложения в Whisper Archive; общая часть обращается сюда через crate::whisper_host.
// Подключено в lib.rs:
//     #[path = "../../src/core/rust/whisper/mod.rs"]
//     mod whisper;
//     mod whisper_host;

/// Ключ wa_… в системном хранилище (Диспетчер учётных данных Windows / связка ключей Linux / Keychain).
/// В JavaScript ключ не отдаётся никогда.
pub(crate) fn token_get() -> Result<Option<String>, String> {
    crate::secret::get_in(crate::secret::WA)
}
pub(crate) fn token_set(token: &str) -> Result<(), String> {
    crate::secret::set_in(crate::secret::WA, token)
}
pub(crate) fn token_clear() -> Result<(), String> {
    crate::secret::clear_in(crate::secret::WA)
}

/// Место для большого файла в памяти: общий для приложения семафор (треки сервиса, свой движок, архив),
/// чтобы десятки параллельных загрузок не съели память (net.rs).
pub(crate) use crate::net::heavy_slot;

/// Origin страниц приложения: протокол wa:// разрешает CORS только ему (аудит F-11, net.rs).
pub(crate) use crate::net::app_origin;

/// Так приложение будет подписано в списке ключей на странице /developers (не длиннее 40 символов).
pub(crate) const DEVICE_NAME: &str = "Whisper Edition (Яндекс Музыка)";

// ---------- Discord и виджет OBS (rust/discord.rs, rust/obs.rs ядра) ----------

/// Приложение Discord клиента (https://discord.com/developers/applications): его название Discord показывает
/// в строке «Слушает …». ID публичный — это не секрет, все копии клиента подключаются с ним к Discord на своём компьютере.
pub(crate) const DISCORD_APP_ID: &str = "1561411272946352150";
/// Кнопка в профиле Discord: подпись (Discord принимает не длиннее 32 символов) и страница, где клиент можно скачать.
pub(crate) const DISCORD_BUTTON: &str = "Скачать Whisper";
pub(crate) const APP_URL: &str = "https://origin.whisper-archive.ru/apps";

/// Откуда виджет OBS может брать картинки (CSP img-src его страницы): обложки Яндекса.
pub(crate) const OBS_IMG_SRC: &str = "https://*.yandex.net https://*.yandex.ru";
/// Адрес обложки, который можно отдать виджету OBS: https и хост *.yandex.net / *.yandex.ru. Остальное виджет не увидит.
pub(crate) fn cover_ok(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let Some((host, _)) = rest.split_once('/') else { return false };
    let host = host.to_ascii_lowercase();
    url.len() <= 2048
        && host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        && [".yandex.net", ".yandex.ru"].iter().any(|d| host.len() > d.len() && host.ends_with(d))
}

#[cfg(test)]
mod tests {
    #[test]
    fn covers() {
        use super::cover_ok;
        assert!(cover_ok("https://avatars.yandex.net/get-music-content/1/2/200x200"));
        assert!(!cover_ok("https://yandex.net/x"));
        assert!(!cover_ok("https://evil.com/avatars.yandex.net/x"));
        assert!(!cover_ok("https://avatars.yandex.net.evil.com/x"));
        assert!(!cover_ok("http://avatars.yandex.net/x"));
        assert!(!cover_ok("https://avatars.yandex.net"));
    }
}
