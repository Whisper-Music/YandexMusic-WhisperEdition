//! Свой звуковой движок: эксклюзивный режим WASAPI (только Windows).
//!
//! Обычно звук играет движок окна (WebView2): Windows смешивает его со звуками других программ и приводит
//! к формату системного микшера. Здесь трек декодируется в Rust (symphonia) и отдаётся устройству напрямую,
//! в его собственной частоте дискретизации, без микшера Windows («бит-в-бит», пока громкость 100 %
//! и нормализация ничего не меняет).
//!
//! Устройство: интерфейс (engine.js) — объект с теми же свойствами и событиями, что у <audio>, поэтому
//! main.js работает с ним как с обычным плеером. Источник трека Rust берёт сам по номеру: Яндекс (ссылка
//! из net.rs), скачанный файл (download.rs) или Whisper Archive (whisper.rs) — произвольных адресов нет.
//! Каждый трек — отдельный поток воспроизведения; команды (пауза, перемотка, стоп) идут в него каналом,
//! позиция и конец трека — событием «engine» в главное окно. У событий номер загрузки (gen): устаревшие
//! интерфейс отбрасывает.
//!
//! Ошибки с префиксом «WASAPI:» — проблема устройства или формата: интерфейс возвращается в общий режим
//! и играет трек обычным путём. «LOCAL:» — скачанный файл пропал.

use serde::Serialize;
use std::sync::{
    atomic::{AtomicU32, AtomicU64, Ordering::SeqCst},
    mpsc, Mutex, OnceLock,
};
use tauri::AppHandle;

#[derive(Serialize, Clone, Default)]
pub struct LoadInfo {
    gen: u64,
    /// длительность, если файл её сообщает (у части MP3 — нет)
    duration: f64,
    codec: String,
    src_rate: u32,
    /// разрядность источника (у MP3/AAC её нет — 0)
    src_bits: u32,
    src_channels: u32,
    out_rate: u32,
    /// значащие биты на выходе и размер контейнера (24 в 32 и т.п.)
    out_bits: u16,
    out_container: u16,
    out_channels: u16,
    /// выход в 32-бит float (устройство приняло только его)
    out_float: bool,
    /// частота трека не подошла устройству — звук пересчитывается в частоту устройства
    resampled: bool,
    period_ms: f64,
}

#[allow(dead_code)]
enum Cmd {
    Play,
    Pause,
    Seek(f64),
    Stop,
}

struct Session {
    gen: u64,
    tx: mpsc::Sender<Cmd>,
}

struct Engine {
    cur: Mutex<Option<Session>>,
    gen: AtomicU64,
    /// цифровая громкость (громкость × нормализация), f32 в битах; 1.0 — без изменений
    gain: AtomicU32,
}

fn engine() -> &'static Engine {
    static E: OnceLock<Engine> = OnceLock::new();
    E.get_or_init(|| Engine { cur: Mutex::new(None), gen: AtomicU64::new(0), gain: AtomicU32::new(1.0f32.to_bits()) })
}

#[allow(dead_code)]
fn gain_now() -> f32 {
    f32::from_bits(engine().gain.load(SeqCst))
}

fn send(cmd: Cmd) -> Result<(), String> {
    let cur = engine().cur.lock().unwrap_or_else(|e| e.into_inner());
    match cur.as_ref() {
        Some(s) => s.tx.send(cmd).map_err(|_| "движок остановлен".to_string()),
        None => Err("в движке ничего не загружено".into()),
    }
}

fn stop_current() {
    if let Some(s) = engine().cur.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = s.tx.send(Cmd::Stop);
    }
}

fn device_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 256 && s.chars().all(|c| c.is_ascii_alphanumeric() || "{}.-_#\\?&".contains(c))
}

#[tauri::command]
pub fn engine_available() -> bool {
    cfg!(windows)
}

#[tauri::command]
pub fn engine_play() -> Result<(), String> {
    send(Cmd::Play)
}

#[tauri::command]
pub fn engine_pause() -> Result<(), String> {
    send(Cmd::Pause)
}

#[tauri::command]
pub fn engine_seek(pos: f64) -> Result<(), String> {
    if !pos.is_finite() || pos < 0.0 {
        return Err("некорректная позиция".into());
    }
    send(Cmd::Seek(pos))
}

/// gen — номер загрузки, которую нужно остановить: команда, пришедшая позже новой загрузки, её не тронет.
#[tauri::command]
pub fn engine_stop(gen: Option<u64>) {
    let mut cur = engine().cur.lock().unwrap_or_else(|e| e.into_inner());
    if gen.is_none() || cur.as_ref().map(|s| Some(s.gen) == gen).unwrap_or(false) {
        if let Some(s) = cur.take() {
            let _ = s.tx.send(Cmd::Stop);
        }
    }
}

#[tauri::command]
pub fn engine_gain(gain: f32) {
    if gain.is_finite() {
        engine().gain.store(gain.clamp(0.0, 4.0).to_bits(), SeqCst);
    }
}

/// Загрузить трек и начать играть с позиции start. kind: "ym" (Яндекс, id трека, quality "high"/"low"),
/// "local" (скачанный, id трека), "wa" (Whisper Archive, uuid). device — id устройства Windows (audio_endpoints)
/// или нет — устройство по умолчанию.
#[tauri::command]
#[allow(unused_variables)]
pub async fn engine_load(
    app: AppHandle,
    kind: String,
    id: String,
    quality: Option<String>,
    device: Option<String>,
    start: f64,
    gain: Option<f32>,
) -> Result<LoadInfo, String> {
    #[cfg(not(windows))]
    {
        Err("WASAPI: эксклюзивный режим есть только в Windows".into())
    }
    #[cfg(windows)]
    {
        let gen = engine().gen.fetch_add(1, SeqCst) + 1;
        stop_current(); // прошлый трек замолкает сразу, пока грузится новый
        if let Some(g) = gain {
            engine_gain(g);
        }
        let device = device.filter(|d| device_ok(d));
        let src = match kind.as_str() {
            "ym" => {
                let url = crate::net::track_url_q(&id, quality.as_deref() == Some("low")).await?;
                wasapi::Src::Bytes(crate::net::fetch_media(&url).await?, Some("mp3"))
            }
            "local" => wasapi::Src::File(crate::download::local_path(&app, &id).ok_or("LOCAL: скачанный файл не найден")?),
            "wa" => wasapi::Src::Bytes(crate::whisper::wa_track_bytes(&id).await?, None),
            _ => return Err("неизвестный источник".into()),
        };
        if engine().gen.load(SeqCst) != gen {
            return Err("загрузка устарела".into());
        }
        let (tx, rx) = mpsc::channel();
        let (rtx, rrx) = mpsc::sync_channel(1);
        let start = if start.is_finite() && start > 0.0 { start } else { 0.0 };
        let app2 = app.clone();
        std::thread::Builder::new()
            .name("whisper-wasapi".into())
            .spawn(move || wasapi::run(app2, gen, src, device, start, rx, rtx))
            .map_err(|e| format!("WASAPI: не удалось запустить поток: {e}"))?;
        {
            let mut cur = engine().cur.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(old) = cur.take() {
                let _ = old.tx.send(Cmd::Stop);
            }
            *cur = Some(Session { gen, tx });
        }
        let info = tauri::async_runtime::spawn_blocking(move || rrx.recv())
            .await
            .map_err(|_| "WASAPI: движок остановился".to_string())?
            .map_err(|_| "WASAPI: движок остановился".to_string())??;
        Ok(info)
    }
}

#[cfg(windows)]
mod wasapi {
    use super::{gain_now, Cmd, LoadInfo};
    use serde::Serialize;
    use std::io::Cursor;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    use symphonia::core::audio::{SampleBuffer, SignalSpec};
    use symphonia::core::codecs::{Decoder, DecoderOptions};
    use symphonia::core::errors::Error as SymError;
    use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
    use symphonia::core::io::{MediaSource, MediaSourceStream};
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;
    use symphonia::core::units::Time;
    use tauri::{AppHandle, Emitter};
    use windows::core::{w, GUID, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, S_OK, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioClient, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
        WAVEFORMATEXTENSIBLE_0,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::{
        AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW, CreateEventW, WaitForSingleObject,
    };

    pub enum Src {
        Bytes(Vec<u8>, Option<&'static str>),
        File(PathBuf),
    }

    #[derive(Serialize, Clone)]
    struct Ev<'a> {
        gen: u64,
        kind: &'a str,
        pos: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        msg: Option<String>,
    }

    fn emit(app: &AppHandle, gen: u64, kind: &str, pos: f64, msg: Option<String>) {
        let _ = app.emit_to("main", "engine", Ev { gen, kind, pos, msg });
    }

    /// Понятный текст для частых ошибок WASAPI (коды AUDCLNT_E_*).
    fn hr_text(e: &windows::core::Error) -> String {
        let code = e.code().0 as u32;
        let t = match code {
            0x8889_000A => "устройство занято: его уже держит в эксклюзивном режиме другая программа".to_string(),
            0x8889_000E => "Windows запрещает эксклюзивный режим для этого устройства (Свойства устройства → Дополнительно → «Разрешить приложениям использовать устройство в монопольном режиме»)".to_string(),
            0x8889_0008 => "устройство не принимает этот формат в эксклюзивном режиме".to_string(),
            0x8889_0004 => "устройство отключено или изменено".to_string(),
            0x8889_0006 => "служба звука Windows не отвечает".to_string(),
            _ => format!("ошибка 0x{code:08X}"),
        };
        format!("WASAPI: {t}")
    }

    // ---------------------------------------------------------------- пересчёт частоты
    //
    // Многие устройства (особенно USB-гарнитуры и HDMI) в эксклюзивном режиме принимают только свою частоту —
    // обычно 48 кГц, а треки почти всегда 44,1 кГц. Тогда звук пересчитывается: оконный sinc (окно Кайзера, β = 9),
    // 64 отвода, 256 фаз с линейной интерполяцией между ними; срез чуть ниже частоты Найквиста меньшей из частот.
    // Подавление побочных составляющих — порядка −100 дБ, коэффициенты каждой фазы нормированы (громкость не меняется).

    fn bessel_i0(x: f64) -> f64 {
        let (mut sum, mut term, mut k) = (1.0f64, 1.0f64, 1.0f64);
        loop {
            term *= (x / (2.0 * k)) * (x / (2.0 * k));
            sum += term;
            if term < sum * 1e-12 {
                return sum;
            }
            k += 1.0;
        }
    }

    struct Resampler {
        /// входных кадров на один выходной
        step: f64,
        /// позиция следующего выходного кадра во входном буфере (в кадрах)
        pos: f64,
        /// вход, стерео L R; в начале — история (HALF − 1 кадров)
        inb: Vec<f32>,
        table: Vec<f32>,
    }

    const HALF: usize = 32;
    const PHASES: usize = 256;

    impl Resampler {
        fn new(src: u32, out: u32) -> Self {
            let step = src as f64 / out as f64;
            let cutoff = if step > 1.0 { 1.0 / step } else { 1.0 } * 0.97;
            let beta = 9.0;
            let i0b = bessel_i0(beta);
            let taps = 2 * HALF;
            let mut table = vec![0f32; (PHASES + 1) * taps];
            for p in 0..=PHASES {
                let frac = p as f64 / PHASES as f64;
                let row = &mut table[p * taps..(p + 1) * taps];
                let mut sum = 0f64;
                let mut tmp = [0f64; 2 * HALF];
                for (j, c) in tmp.iter_mut().enumerate() {
                    // отвод j — входной кадр idx + j − (HALF − 1); x — расстояние от точки вывода
                    let x = j as f64 - (HALF as f64 - 1.0) - frac;
                    let h = if x.abs() < 1e-12 { cutoff } else { (std::f64::consts::PI * cutoff * x).sin() / (std::f64::consts::PI * x) };
                    let r = x / HALF as f64;
                    let w = if r.abs() >= 1.0 { 0.0 } else { bessel_i0(beta * (1.0 - r * r).sqrt()) / i0b };
                    *c = h * w;
                    sum += *c;
                }
                for (dst, c) in row.iter_mut().zip(tmp.iter()) {
                    *dst = (c / sum) as f32;
                }
            }
            let mut r = Resampler { step, pos: 0.0, inb: Vec::new(), table };
            r.reset();
            r
        }

        fn reset(&mut self) {
            self.inb.clear();
            self.inb.resize((HALF - 1) * 2, 0.0);
            self.pos = (HALF - 1) as f64;
        }

        /// Добавить входные кадры (стерео) и выдать всё, что уже можно посчитать.
        fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
            self.inb.extend_from_slice(input);
            let frames = self.inb.len() / 2;
            let taps = 2 * HALF;
            loop {
                let idx = self.pos as usize;
                if idx + HALF >= frames {
                    break;
                }
                let fp = (self.pos - idx as f64) * PHASES as f64;
                let p = (fp as usize).min(PHASES - 1);
                let t = (fp - p as f64) as f32;
                let r0 = &self.table[p * taps..(p + 1) * taps];
                let r1 = &self.table[(p + 1) * taps..(p + 2) * taps];
                let base = (idx + 1 - HALF) * 2;
                let x = &self.inb[base..base + taps * 2];
                let (mut l, mut r) = (0f32, 0f32);
                for j in 0..taps {
                    let c = r0[j] + (r1[j] - r0[j]) * t;
                    l += x[j * 2] * c;
                    r += x[j * 2 + 1] * c;
                }
                out.push(l);
                out.push(r);
                self.pos += self.step;
            }
            // использованное отбрасываем, оставляя историю для следующих отсчётов
            let keep_from = (self.pos as usize).saturating_sub(HALF - 1);
            if keep_from > 0 {
                self.inb.drain(..keep_from * 2);
                self.pos -= keep_from as f64;
            }
        }

        /// Конец трека: дописать хвост (вход дополняется тишиной).
        fn flush(&mut self, out: &mut Vec<f32>) {
            let zeros = vec![0f32; HALF * 2 * 2];
            self.process(&zeros, out);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::Resampler;

        // синус 1 кГц: после пересчёта значения совпадают с идеальным синусом в новой частоте
        fn check(src: u32, out: u32) {
            let f = 1000.0f64;
            let n = src as usize; // 1 секунда
            let mut input = Vec::with_capacity(n * 2);
            for k in 0..n {
                let v = (2.0 * std::f64::consts::PI * f * k as f64 / src as f64).sin() as f32 * 0.5;
                input.push(v);
                input.push(-v);
            }
            let mut r = Resampler::new(src, out);
            let mut o = Vec::new();
            for chunk in input.chunks(2 * 1000) {
                r.process(chunk, &mut o);
            }
            r.flush(&mut o);
            let frames = o.len() / 2;
            assert!((frames as i64 - out as i64).abs() < 200, "кадров {frames}");
            let mut err = 0f64;
            for k in 500..(out as usize - 500) {
                let want = (2.0 * std::f64::consts::PI * f * k as f64 / out as f64).sin() * 0.5;
                err = err.max((o[k * 2] as f64 - want).abs()).max((o[k * 2 + 1] as f64 + want).abs());
            }
            assert!(err < 1e-3, "{src}→{out}: ошибка {err}");
        }

        #[test]
        fn up_44_48() {
            check(44_100, 48_000);
        }
        #[test]
        fn down_48_44() {
            check(48_000, 44_100);
        }
        #[test]
        fn up_44_96() {
            check(44_100, 96_000);
        }
    }

    // ---------------------------------------------------------------- декодер

    struct Dec {
        format: Box<dyn FormatReader>,
        decoder: Box<dyn Decoder>,
        track: u32,
        rate: u32,
        tb: Option<symphonia::core::units::TimeBase>,
        sb: Option<SampleBuffer<f32>>,
        sb_spec: Option<SignalSpec>,
        /// декодированное, стерео, чередование L R
        buf: Vec<f32>,
        rd: usize,
        /// сколько кадров выбросить после точной перемотки (пакет начинается раньше нужного места)
        skip: u64,
        eof: bool,
        /// пересчёт частоты (если устройство не приняло частоту трека) и его входной буфер
        rs: Option<Resampler>,
        tmp: Vec<f32>,
    }

    impl Dec {
        fn open(src: Src) -> Result<(Dec, LoadInfo), String> {
            let mut hint = Hint::new();
            let ms: Box<dyn MediaSource> = match src {
                Src::Bytes(b, ext) => {
                    if let Some(e) = ext {
                        hint.with_extension(e);
                    }
                    Box::new(Cursor::new(b))
                }
                Src::File(p) => {
                    if let Some(e) = p.extension().and_then(|e| e.to_str()) {
                        hint.with_extension(e);
                    }
                    Box::new(std::fs::File::open(&p).map_err(|_| "LOCAL: скачанный файл не открывается".to_string())?)
                }
            };
            let mss = MediaSourceStream::new(ms, Default::default());
            let fo = FormatOptions { enable_gapless: true, ..Default::default() };
            let probed = symphonia::default::get_probe()
                .format(&hint, mss, &fo, &MetadataOptions::default())
                .map_err(|e| format!("WASAPI: формат файла не распознан ({e})"))?;
            let format = probed.format;
            let track = format
                .tracks()
                .iter()
                .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
                .ok_or("WASAPI: в файле нет звуковой дорожки")?;
            let p = track.codec_params.clone();
            let track_id = track.id;
            let rate = p.sample_rate.ok_or("WASAPI: неизвестная частота дискретизации")?;
            let decoder = symphonia::default::get_codecs()
                .make(&p, &DecoderOptions::default())
                .map_err(|e| format!("WASAPI: кодек не поддерживается ({e})"))?;
            let codec = symphonia::default::get_codecs()
                .get_codec(p.codec)
                .map(|d| d.short_name.to_string())
                .unwrap_or_default();
            let duration = match (p.n_frames, p.time_base) {
                (Some(n), Some(tb)) => {
                    let t = tb.calc_time(n);
                    t.seconds as f64 + t.frac
                }
                (Some(n), None) => n as f64 / rate as f64,
                _ => 0.0,
            };
            let info = LoadInfo {
                duration,
                codec,
                src_rate: rate,
                src_bits: p.bits_per_sample.unwrap_or(0),
                src_channels: p.channels.map(|c| c.count() as u32).unwrap_or(2),
                ..Default::default()
            };
            Ok((
                Dec { format, decoder, track: track_id, rate, tb: p.time_base, sb: None, sb_spec: None, buf: Vec::new(), rd: 0, skip: 0, eof: false, rs: None, tmp: Vec::new() },
                info,
            ))
        }

        fn avail(&self) -> usize {
            (self.buf.len() - self.rd) / 2
        }

        fn fill(&mut self, frames: usize) {
            if self.rd > 0 && (self.rd == self.buf.len() || self.rd > 1 << 16) {
                self.buf.drain(..self.rd);
                self.rd = 0;
            }
            while self.avail() < frames && !self.eof {
                self.decode_one();
            }
        }

        /// Конец файла: с пересчётом частоты дописываем его хвост.
        fn finish(&mut self) {
            if !self.eof {
                self.eof = true;
                if let Some(rs) = self.rs.as_mut() {
                    rs.flush(&mut self.buf);
                }
            }
        }

        fn decode_one(&mut self) {
            if self.rs.is_some() {
                // пересчёт частоты: декодируем во временный буфер и пропускаем его через ресемплер
                let before = self.buf.len();
                let mut guard = 0;
                while self.buf.len() == before && !self.eof && guard < 64 {
                    guard += 1;
                    self.decode_raw(true);
                    if !self.tmp.is_empty() {
                        let rs = self.rs.as_mut().expect("resampler");
                        rs.process(&self.tmp, &mut self.buf);
                        self.tmp.clear();
                    }
                }
            } else {
                self.decode_raw(false);
            }
        }

        fn decode_raw(&mut self, to_tmp: bool) {
            loop {
                let pkt = match self.format.next_packet() {
                    Ok(p) => p,
                    Err(SymError::ResetRequired) => {
                        self.decoder.reset();
                        continue;
                    }
                    Err(_) => {
                        self.finish();
                        return;
                    }
                };
                if pkt.track_id() != self.track {
                    continue;
                }
                match self.decoder.decode(&pkt) {
                    Ok(ab) => {
                        let spec = *ab.spec();
                        let ch = spec.channels.count().max(1);
                        let need = ab.capacity() * ch;
                        if self.sb.as_ref().map(|s| s.capacity() < need).unwrap_or(true) || self.sb_spec != Some(spec) {
                            self.sb = Some(SampleBuffer::<f32>::new(ab.capacity() as u64, spec));
                            self.sb_spec = Some(spec);
                        }
                        let sb = self.sb.as_mut().expect("sample buffer");
                        sb.copy_interleaved_ref(ab);
                        let dst = if to_tmp { &mut self.tmp } else { &mut self.buf };
                        for f in sb.samples().chunks_exact(ch) {
                            if self.skip > 0 {
                                self.skip -= 1;
                                continue;
                            }
                            let l = f[0];
                            let r = if ch > 1 { f[1] } else { l };
                            dst.push(l);
                            dst.push(r);
                        }
                        return;
                    }
                    Err(SymError::DecodeError(_)) => continue, // битый пакет — пропускаем, как плееры
                    Err(SymError::ResetRequired) => {
                        self.decoder.reset();
                        continue;
                    }
                    Err(_) => {
                        self.finish();
                        return;
                    }
                }
            }
        }

        /// Точная перемотка; возвращает позицию в секундах, с которой пойдёт звук.
        fn seek(&mut self, t: f64) -> f64 {
            self.buf.clear();
            self.rd = 0;
            self.eof = false;
            self.skip = 0;
            self.tmp.clear();
            if let Some(rs) = self.rs.as_mut() {
                rs.reset();
            }
            match self.format.seek(SeekMode::Accurate, SeekTo::Time { time: Time::from(t.max(0.0)), track_id: Some(self.track) }) {
                Ok(s) => {
                    self.decoder.reset();
                    let secs = |ts: u64| match self.tb {
                        Some(tb) => {
                            let x = tb.calc_time(ts);
                            x.seconds as f64 + x.frac
                        }
                        None => ts as f64 / self.rate as f64,
                    };
                    let (req, act) = (secs(s.required_ts), secs(s.actual_ts));
                    if req > act {
                        self.skip = ((req - act) * self.rate as f64).round() as u64;
                    }
                    req
                }
                Err(_) => {
                    self.eof = true; // дальше конца — трек закончился
                    t
                }
            }
        }
    }

    // ---------------------------------------------------------------- устройство

    #[derive(Clone, Copy)]
    struct Fmt {
        rate: u32,
        container: u16,
        valid: u16,
        float: bool,
    }

    struct Out {
        client: IAudioClient,
        render: IAudioRenderClient,
        event: HANDLE,
        frames: u32,
        fmt: Fmt,
        period: i64,
        rng: u32,
        /// источник с потерями или громкость не 100 % — при выводе в 16 бит добавляем TPDF-дизеринг
        dither16: bool,
    }

    impl Drop for Out {
        fn drop(&mut self) {
            unsafe {
                let _ = self.client.Stop();
                let _ = CloseHandle(self.event);
            }
        }
    }

    fn wfx(f: Fmt) -> WAVEFORMATEXTENSIBLE {
        let block = 2 * f.container / 8;
        let mut w = WAVEFORMATEXTENSIBLE::default();
        w.Format = WAVEFORMATEX {
            wFormatTag: 0xFFFE, // WAVE_FORMAT_EXTENSIBLE
            nChannels: 2,
            nSamplesPerSec: f.rate,
            nAvgBytesPerSec: f.rate * block as u32,
            nBlockAlign: block,
            wBitsPerSample: f.container,
            cbSize: 22,
        };
        w.Samples = WAVEFORMATEXTENSIBLE_0 { wValidBitsPerSample: f.valid };
        w.dwChannelMask = 0x3; // SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT
        // KSDATAFORMAT_SUBTYPE_PCM / KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
        w.SubFormat = GUID::from_u128(if f.float { 0x00000003_0000_0010_8000_00aa00389b71 } else { 0x00000001_0000_0010_8000_00aa00389b71 });
        w
    }

    impl Out {
        /// Открыть устройство в эксклюзивном режиме. Сначала — в частоте трека (тогда звук идёт бит-в-бит);
        /// не принимает — в родной частоте устройства (как в настройках Windows), затем 48 / 96 / 88,2 / 192 кГц,
        /// и звук пересчитывается (Resampler). Разрядность — лучшая из поддерживаемых: для 16-битного источника
        /// сначала 16 бит, иначе 24 бит (в 32- или 24-битном контейнере), 32 бит, в крайнем случае 32-бит float.
        unsafe fn open(device: Option<&str>, rate: u32, src_bits: u32) -> Result<Out, String> {
            let en: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(|e| hr_text(&e))?;
            let dev: IMMDevice = match device {
                Some(id) => {
                    let wid: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
                    unsafe { en.GetDevice(PCWSTR(wid.as_ptr())) }.or_else(|_| unsafe { en.GetDefaultAudioEndpoint(eRender, eConsole) })
                }
                None => unsafe { en.GetDefaultAudioEndpoint(eRender, eConsole) },
            }
            .map_err(|e| hr_text(&e))?;
            let mut client: IAudioClient = unsafe { dev.Activate(CLSCTX_ALL, None) }.map_err(|e| hr_text(&e))?;

            let order: &[(u16, u16, bool)] = if src_bits == 16 {
                &[(16, 16, false), (32, 24, false), (24, 24, false), (32, 32, false), (32, 32, true)]
            } else {
                &[(32, 24, false), (24, 24, false), (32, 32, false), (16, 16, false), (32, 32, true)]
            };
            // родная частота устройства — частота его микшера в общем режиме
            let native = unsafe { client.GetMixFormat() }
                .ok()
                .filter(|p| !p.is_null())
                .map(|p| unsafe {
                    let r = (*p).nSamplesPerSec;
                    windows::Win32::System::Com::CoTaskMemFree(Some(p as _));
                    r
                })
                .unwrap_or(0);
            let mut rates = vec![rate];
            for r in [native, 48_000, 96_000, 88_200, 192_000, 44_100] {
                if r >= 8_000 && !rates.contains(&r) {
                    rates.push(r);
                }
            }
            let mut chosen = None;
            'find: for &r in &rates {
                for &(container, valid, float) in order {
                    let f = Fmt { rate: r, container, valid, float };
                    let w = wfx(f);
                    let hr = unsafe { client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &w as *const _ as *const WAVEFORMATEX, None) };
                    if hr == S_OK {
                        chosen = Some(f);
                        break 'find;
                    }
                    let code = hr.0 as u32;
                    if code == 0x8889_000A || code == 0x8889_000E {
                        return Err(hr_text(&windows::core::Error::from(hr)));
                    }
                }
            }
            let fmt = chosen.ok_or_else(|| {
                let n = if native > 0 { format!(" (в Windows оно настроено на {} Гц)", native) } else { String::new() };
                format!("WASAPI: устройство не принимает ни один стереоформат в эксклюзивном режиме{n}")
            })?;
            let src_rate = rate;
            let rate = fmt.rate;
            let w = wfx(fmt);
            let pw = &w as *const _ as *const WAVEFORMATEX;

            // период: не меньше 20 мс — устойчиво даже при нагрузке, задержка для музыки не важна
            let (mut def, mut min) = (0i64, 0i64);
            let _ = unsafe { client.GetDevicePeriod(Some(&mut def), Some(&mut min)) };
            let mut period = def.max(min).max(200_000);
            let flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
            match unsafe { client.Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, flags, period, period, pw, None) } {
                Ok(()) => {}
                Err(e) if e.code().0 as u32 == 0x8889_0019 => {
                    // AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED: период под выравнивание буфера устройства и новая попытка
                    let frames = unsafe { client.GetBufferSize() }.map_err(|e| hr_text(&e))?;
                    period = ((10_000_000f64 * frames as f64 / rate as f64) + 0.5) as i64;
                    client = unsafe { dev.Activate(CLSCTX_ALL, None) }.map_err(|e| hr_text(&e))?;
                    unsafe { client.Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, flags, period, period, pw, None) }.map_err(|e| hr_text(&e))?;
                }
                Err(e) => return Err(hr_text(&e)),
            }
            let event = unsafe { CreateEventW(None, false, false, PCWSTR::null()) }.map_err(|e| hr_text(&e))?;
            if let Err(e) = unsafe { client.SetEventHandle(event) } {
                let _ = unsafe { CloseHandle(event) };
                return Err(hr_text(&e));
            }
            let render: IAudioRenderClient = match unsafe { client.GetService() } {
                Ok(r) => r,
                Err(e) => {
                    let _ = unsafe { CloseHandle(event) };
                    return Err(hr_text(&e));
                }
            };
            let frames = unsafe { client.GetBufferSize() }.map_err(|e| hr_text(&e))?;
            Ok(Out { client, render, event, frames, fmt, period, rng: 0x9E37_79B9, dither16: src_bits != 16 || src_rate != fmt.rate })
        }

        fn block(&self) -> usize {
            2 * self.fmt.container as usize / 8
        }

        fn tpdf(&mut self) -> f64 {
            // два равномерных шума ±0,5 младшего разряда (xorshift)
            let mut next = || {
                self.rng ^= self.rng << 13;
                self.rng ^= self.rng >> 17;
                self.rng ^= self.rng << 5;
                self.rng as f64 / u32::MAX as f64 - 0.5
            };
            next() + next()
        }

        /// Заполнить весь буфер устройства; возвращает, сколько кадров было настоящим звуком (остальное — тишина).
        unsafe fn write(&mut self, dec: &mut Dec, gain: f32) -> Result<usize, String> {
            let n = self.frames as usize;
            dec.fill(n);
            let p = unsafe { self.render.GetBuffer(self.frames) }.map_err(|e| hr_text(&e))?;
            let block = self.block();
            let out = unsafe { std::slice::from_raw_parts_mut(p, n * block) };
            let take = dec.avail().min(n);
            let unity = gain == 1.0;
            let dither = self.fmt.container == 16 && (self.dither16 || !unity);
            let (rd, fmt) = (dec.rd, self.fmt);
            for i in 0..take * 2 {
                let s = dec.buf[rd + i];
                let s = if unity { s as f64 } else { s as f64 * gain as f64 };
                if fmt.float {
                    let v = s.clamp(-1.0, 1.0) as f32;
                    out[i * 4..i * 4 + 4].copy_from_slice(&v.to_le_bytes());
                    continue;
                }
                match (fmt.container, fmt.valid) {
                    (16, _) => {
                        let mut x = s * 32768.0;
                        if dither {
                            x += self.tpdf();
                        }
                        let v = x.round().clamp(-32768.0, 32767.0) as i16;
                        out[i * 2..i * 2 + 2].copy_from_slice(&v.to_le_bytes());
                    }
                    (24, _) => {
                        let v = (s * 8_388_608.0).round().clamp(-8_388_608.0, 8_388_607.0) as i32;
                        out[i * 3..i * 3 + 3].copy_from_slice(&v.to_le_bytes()[..3]);
                    }
                    (32, 24) => {
                        let v = (s * 8_388_608.0).round().clamp(-8_388_608.0, 8_388_607.0) as i32;
                        out[i * 4..i * 4 + 4].copy_from_slice(&(v << 8).to_le_bytes());
                    }
                    _ => {
                        let v = (s * 2_147_483_648.0).round().clamp(-2_147_483_648.0, 2_147_483_647.0) as i32;
                        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_le_bytes());
                    }
                }
            }
            out[take * block..].fill(0);
            dec.rd += take * 2;
            unsafe { self.render.ReleaseBuffer(self.frames, 0) }.map_err(|e| hr_text(&e))?;
            Ok(take)
        }
    }

    // ---------------------------------------------------------------- поток воспроизведения

    pub fn run(
        app: AppHandle,
        gen: u64,
        src: Src,
        device: Option<String>,
        start: f64,
        rx: mpsc::Receiver<Cmd>,
        ready: mpsc::SyncSender<Result<LoadInfo, String>>,
    ) {
        unsafe {
            let inited = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            let mut task = 0u32;
            let mmcss = AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task).ok();
            let mut ready = Some(ready);
            if let Err(msg) = run_inner(&app, gen, src, device, start, &rx, &mut ready) {
                match ready.take() {
                    Some(r) => {
                        let _ = r.send(Err(msg));
                    }
                    None => emit(&app, gen, "error", 0.0, Some(msg)),
                }
            }
            if let Some(h) = mmcss {
                let _ = AvRevertMmThreadCharacteristics(h);
            }
            if inited {
                CoUninitialize();
            }
        }
    }

    unsafe fn run_inner(
        app: &AppHandle,
        gen: u64,
        src: Src,
        device: Option<String>,
        start: f64,
        rx: &mpsc::Receiver<Cmd>,
        ready: &mut Option<mpsc::SyncSender<Result<LoadInfo, String>>>,
    ) -> Result<(), String> {
        let (mut dec, mut info) = Dec::open(src)?;
        let mut base = if start > 0.0 { dec.seek(start) } else { 0.0 };
        let mut out = unsafe { Out::open(device.as_deref(), dec.rate, info.src_bits) }?;
        let rate = out.fmt.rate as f64;
        info.gen = gen;
        info.out_rate = out.fmt.rate;
        info.out_bits = out.fmt.valid;
        info.out_container = out.fmt.container;
        info.out_channels = 2;
        info.out_float = out.fmt.float;
        info.period_ms = out.period as f64 / 10_000.0;
        // устройство не приняло частоту трека — пересчитываем в его частоту
        if out.fmt.rate != dec.rate {
            dec.rs = Some(Resampler::new(dec.rate, out.fmt.rate));
            info.resampled = true;
        }

        // первый буфер — до запуска, чтобы устройство не начало с пустоты
        let mut frames_out = unsafe { out.write(&mut dec, gain_now()) }? as u64;
        unsafe { out.client.Start() }.map_err(|e| hr_text(&e))?;
        if let Some(r) = ready.take() {
            let _ = r.send(Ok(info));
        }

        let mut playing = true;
        let mut ended = false;
        let mut drain = 0u32;
        let mut misses = 0u32;
        let mut last = Instant::now();
        loop {
            let cmd = if playing {
                match rx.try_recv() {
                    Ok(c) => Some(c),
                    Err(mpsc::TryRecvError::Empty) => None,
                    Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
                }
            } else {
                match rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(c) => Some(c),
                    Err(mpsc::RecvTimeoutError::Timeout) => None,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
                }
            };
            if let Some(c) = cmd {
                match c {
                    Cmd::Stop => return Ok(()),
                    Cmd::Pause => {
                        if playing {
                            let _ = unsafe { out.client.Stop() };
                            playing = false;
                        }
                    }
                    Cmd::Play => {
                        if !playing {
                            if ended {
                                let _ = unsafe { out.client.Reset() };
                                base = dec.seek(0.0);
                                frames_out = unsafe { out.write(&mut dec, gain_now()) }? as u64;
                                ended = false;
                                drain = 0;
                            }
                            unsafe { out.client.Start() }.map_err(|e| hr_text(&e))?;
                            playing = true;
                            misses = 0;
                        }
                    }
                    Cmd::Seek(t) => {
                        let was = playing;
                        if was {
                            let _ = unsafe { out.client.Stop() };
                        }
                        let _ = unsafe { out.client.Reset() };
                        base = dec.seek(t);
                        ended = false;
                        drain = 0;
                        frames_out = unsafe { out.write(&mut dec, gain_now()) }? as u64;
                        if was {
                            unsafe { out.client.Start() }.map_err(|e| hr_text(&e))?;
                        }
                        emit(app, gen, "seeked", base, None);
                    }
                }
                continue;
            }
            if !playing {
                continue;
            }
            if unsafe { WaitForSingleObject(out.event, 1000) } != WAIT_OBJECT_0 {
                misses += 1;
                if misses >= 3 {
                    return Err("WASAPI: устройство перестало принимать звук".into());
                }
                continue;
            }
            misses = 0;
            let n = unsafe { out.write(&mut dec, gain_now()) }?;
            frames_out += n as u64;
            if dec.eof && dec.avail() == 0 {
                // хвост трека ещё в буфере устройства — даём ему доиграть
                drain += 1;
                if drain >= 3 {
                    let _ = unsafe { out.client.Stop() };
                    playing = false;
                    ended = true;
                    emit(app, gen, "ended", base + frames_out as f64 / rate, None);
                    continue;
                }
            }
            if last.elapsed() >= Duration::from_millis(200) {
                last = Instant::now();
                // позиция того, что уже отдано устройству (минус один буфер — то, что ещё не прозвучало)
                let played = frames_out.saturating_sub(out.frames as u64);
                emit(app, gen, "pos", base + played as f64 / rate, None);
            }
        }
    }
}
