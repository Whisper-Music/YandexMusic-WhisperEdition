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
