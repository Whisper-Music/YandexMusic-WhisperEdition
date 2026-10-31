// Что приложение даёт общей части Whisper Archive. Это ЕДИНСТВЕННЫЙ файл папки whisper/, который у каждого
// приложения свой: остальные одинаковые. Другому приложению (Whisper VK…) достаточно заменить здесь пути
// на свои модули и подпись ключа.

/// Ключ wa_… в системном хранилище (Диспетчер учётных данных / связка ключей Linux — secret.rs).
pub(super) fn token_get() -> Result<Option<String>, String> {
    crate::secret::get_in(crate::secret::WA)
}
pub(super) fn token_set(token: &str) -> Result<(), String> {
    crate::secret::set_in(crate::secret::WA, token)
}
pub(super) fn token_clear() -> Result<(), String> {
    crate::secret::clear_in(crate::secret::WA)
}

/// Место для большого файла в памяти (общий для приложения семафор: треки сервиса, свой движок, архив).
pub(super) use crate::net::heavy_slot;

/// Origin страниц приложения: протокол wa:// разрешает CORS только ему (аудит F-11).
pub(super) use crate::net::app_origin;

/// Так приложение будет подписано в списке ключей на странице /developers (не длиннее 40 символов).
pub(super) const DEVICE_NAME: &str = "Whisper Edition (Яндекс Музыка)";
