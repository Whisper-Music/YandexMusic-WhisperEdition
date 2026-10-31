// src-tauri/src/whisper_yandex.rs — Whisper Archive и Яндекс: что архив делает с треками именно этого сервиса.
// Общая часть (ключ, вход, загрузка, воспроизведение, комнаты) — в whisper/, она про Яндекс ничего не знает.
//
// «Сохранить в архив»: Rust сам скачивает mp3 и обложку с Яндекса (только доверенные адреса, net::fetch_media)
// и передаёт их в whisper::upload — тот отправляет multipart-запросом в новый альбом или в существующий.

use crate::whisper::{upload, WaResponse};

/// Скачивает трек с Яндекса и сохраняет в архив.
///  * `album_id` задан — трек добавляется в этот альбом (он должен принадлежать владельцу ключа);
///  * иначе создаётся новый приватный альбом `album_title` с обложкой: `cover_url` (адрес Яндекса)
///    или `cover_bytes` (картинка, нарисованная интерфейсом, если у трека нет обложки).
#[tauri::command]
pub async fn wa_save_track(
    track_id: String,
    file_name: String,
    album_id: Option<String>,
    album_title: Option<String>,
    cover_url: Option<String>,
    cover_bytes: Option<Vec<u8>>,
) -> Result<WaResponse, String> {
    // ключ, id альбома и бюджет загрузок — до скачивания: без них качать с Яндекса незачем
    let up = upload::begin(album_id.as_deref(), cover_bytes.as_ref().map(|b| b.len()))?;

    // ссылку на файл Rust получает сам по номеру трека — произвольный адрес для скачивания интерфейс не передаёт
    let audio_url = crate::net::track_mp3_url(&track_id)
        .await
        .map_err(|e| format!("не удалось получить трек с Яндекса: {e}"))?;
    let audio = crate::net::fetch_media(&audio_url)
        .await
        .map_err(|e| format!("не удалось скачать трек с Яндекса: {e}"))?;
    if audio.len() > upload::MAX_TRACK_UPLOAD {
        return Err("трек больше 100 МБ — архив такие не принимает".into());
    }
    let track = upload::TrackFile::new(&file_name, &audio)
        .ok_or_else(|| "Яндекс отдал файл в неизвестном формате".to_string())?;

    if let Some(id) = album_id {
        return up.to_album(&id, track).await;
    }

    let title = upload::album_title(album_title.as_deref())?;
    let cover = match (cover_url, cover_bytes) {
        (Some(u), _) => crate::net::fetch_media(&u)
            .await
            .map_err(|e| format!("не удалось скачать обложку с Яндекса: {e}"))?,
        (None, Some(b)) => b,
        (None, None) => return Err("Для нового альбома нужна обложка".into()),
    };
    up.new_album(&title, &cover, track).await
}
