//! Края трека для «Пропускать тишину» и «Плавных переходов» (Воспроизведение; страница — transitions.js).
//! Трек целиком декодируется (symphonia) и меряется окнами по 50 мс: где начинается и кончается звук и насколько
//! громко звучат первые и последние секунды. Для треков Яндекса берётся экономное качество — громкость и тишина
//! те же, а качать меньше. Тяжёлое — в отдельном потоке; результат страница помнит сама.

use serde::Serialize;
use std::io::Cursor;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::AppHandle;

/// Окно замера, с.
const WIN: f64 = 0.05;
/// Тише этого (RMS окна, dBFS) — тишина.
const SILENT_DB: f64 = -50.0;
/// Сколько секунд в начале и в конце звучащей части меряем для перехода.
const EDGE: f64 = 3.0;

#[derive(Serialize, Default, Debug)]
pub struct Edges {
    /// длительность файла, с
    dur: f64,
    /// где начинается звук (0 — тишины в начале нет), с
    start: f64,
    /// где звук кончается (= dur — тишины в конце нет), с
    end: f64,
    /// громкость первых EDGE секунд звука и последних, dBFS (RMS)
    head_db: f64,
    tail_db: f64,
}

fn db(e: f64) -> f64 {
    if e <= 1e-12 { -120.0 } else { 10.0 * e.log10() }
}

/// Энергия (средний квадрат, моно) по окнам WIN.
fn windows_of(ms: Box<dyn MediaSource>, ext: Option<&str>) -> Result<(Vec<f64>, f64), String> {
    let mut hint = Hint::new();
    if let Some(e) = ext {
        hint.with_extension(e);
    }
    let mss = MediaSourceStream::new(ms, Default::default());
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|e| format!("формат не распознан ({e})"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("нет звуковой дорожки")?;
    let tid = track.id;
    let rate = track.codec_params.sample_rate.ok_or("неизвестная частота")? as f64;
    let mut dec = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("кодек не поддерживается ({e})"))?;
    let per = ((rate * WIN) as usize).max(1);
    let (mut out, mut acc, mut n, mut frames) = (Vec::new(), 0.0f64, 0usize, 0u64);
    let mut sb: Option<SampleBuffer<f32>> = None;
    loop {
        let pkt = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(_)) | Err(SymError::ResetRequired) => break,
            Err(e) => return Err(e.to_string()),
        };
        if pkt.track_id() != tid {
            continue;
        }
        let buf = match dec.decode(&pkt) {
            Ok(b) => b,
            Err(SymError::DecodeError(_)) => continue, // битый кадр — пропускаем, как и плеер
            Err(e) => return Err(e.to_string()),
        };
        let spec = *buf.spec();
        let ch = spec.channels.count().max(1);
        if sb.as_ref().is_none_or(|s| s.capacity() < buf.capacity() * ch) {
            sb = Some(SampleBuffer::new(buf.capacity() as u64, spec));
        }
        let s = sb.as_mut().unwrap();
        s.copy_interleaved_ref(buf);
        for f in s.samples().chunks(ch) {
            let m = f.iter().map(|&x| x as f64).sum::<f64>() / ch as f64;
            acc += m * m;
            n += 1;
            frames += 1;
            if n == per {
                out.push(acc / n as f64);
                acc = 0.0;
                n = 0;
            }
        }
    }
    if n > 0 {
        out.push(acc / n as f64);
    }
    Ok((out, frames as f64 / rate))
}

fn measure(w: &[f64], dur: f64) -> Edges {
    let loud = |e: &f64| db(*e) > SILENT_DB;
    let (Some(first), Some(last)) = (w.iter().position(loud), w.iter().rposition(loud)) else {
        return Edges { dur, start: 0.0, end: dur, head_db: -120.0, tail_db: -120.0 };
    };
    // запас по краям: не обрезать тихую атаку и хвост реверберации
    let mut start = (first as f64 * WIN - 0.05).max(0.0);
    let mut end = ((last + 1) as f64 * WIN + 0.25).min(dur);
    if start < 0.4 {
        start = 0.0; // меньше 0,4 с — это не тишина, а обычный «вдох» перед музыкой
    }
    if dur - end < 0.6 {
        end = dur;
    }
    let k = (EDGE / WIN) as usize;
    let avg = |s: &[f64]| if s.is_empty() { -120.0 } else { db(s.iter().sum::<f64>() / s.len() as f64) };
    let head = &w[first..(first + k).min(last + 1)];
    let tail = &w[(last + 1).saturating_sub(k).max(first)..=last];
    Edges { dur, start, end, head_db: avg(head), tail_db: avg(tail) }
}

/// kind: "local" (скачанный, кэш, своя версия из студии — номер трека), "ym" (Яндекс), "wa" (Whisper Archive, uuid).
#[tauri::command]
pub async fn audio_edges(app: AppHandle, kind: String, id: String) -> Result<Edges, String> {
    let (ms, ext): (Box<dyn MediaSource>, Option<String>) = match kind.as_str() {
        "local" => {
            let (f, p, _) = crate::download::open_local(&app, &id).ok_or("файл не найден")?;
            (Box::new(f), p.extension().and_then(|e| e.to_str()).map(str::to_string))
        }
        "ym" => {
            let url = crate::net::track_url_q(&id, true).await?;
            (Box::new(Cursor::new(crate::net::fetch_media(&url).await?)), Some("mp3".into()))
        }
        "wa" => (Box::new(Cursor::new(crate::whisper::wa_track_bytes(&id).await?)), None),
        _ => return Err("неизвестный источник".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (w, dur) = windows_of(ms, ext.as_deref())?;
        Ok(measure(&w, dur))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn track(silent_head: f64, loud: f64, silent_tail: f64, level: f64) -> (Vec<f64>, f64) {
        let mut w = vec![0.0; (silent_head / WIN) as usize];
        w.extend(std::iter::repeat_n(level, (loud / WIN) as usize));
        w.extend(std::iter::repeat_n(0.0, (silent_tail / WIN) as usize));
        let dur = w.len() as f64 * WIN;
        (w, dur)
    }
    #[test]
    fn finds_silence() {
        let (w, dur) = track(2.0, 60.0, 5.0, 0.01);
        let e = measure(&w, dur);
        assert!((e.start - 1.95).abs() < 0.01, "{e:?}");
        assert!((e.end - 62.25).abs() < 0.01, "{e:?}");
        assert!((e.head_db - (-20.0)).abs() < 0.1, "{e:?}");
    }
    #[test]
    fn short_gaps_are_kept() {
        let (w, dur) = track(0.2, 30.0, 0.3, 0.01);
        let e = measure(&w, dur);
        assert_eq!(e.start, 0.0);
        assert_eq!(e.end, dur);
    }
    #[test]
    fn all_silent() {
        let (w, dur) = track(3.0, 0.0, 0.0, 0.0);
        let e = measure(&w, dur);
        assert_eq!((e.start, e.end), (0.0, dur));
    }
}
