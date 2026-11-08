// Свои уведомления, как в Telegram (src/notify.js → окно notifywin.html): друг зовёт в комнату, участник «подмигнул».
// Не системные: маленькое окно без рамки поверх всех, в выбранном углу рабочей области монитора, без значка на панели
// задач и без перехвата фокуса — игра или редактор, в котором сидит человек, остаются активными.
// * Карточки рисует само окно (стопкой, до трёх); его высоту оно сообщает (notify_layout), а место считает Rust по углу.
// * Окно создаётся под первое уведомление и уничтожается, когда последнее закрылось: в трее WebView память не держит.
// * Звук: в Windows — PlaySound из памяти (не зависит от того, разрешён ли звук странице и не «заморожено» ли главное
//   окно режимом экономии); в Linux его играет главное окно (notify_show возвращает false — «звук не сыгран»).
// Включать или нет, что показывать и в каком углу, решает JS (настройки «Уведомления»); здесь — чистка текста и окно.

use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "notify";
/// Ширина окна (логические px): карточка 360 + по 10 по краям на тень (окно прозрачное).
const W: f64 = 380.0;
/// Отступ окна от края рабочей области; вместе с полями страницы выходит ~16 px до карточки.
const GAP: f64 = 6.0;

#[derive(Default)]
pub struct Shared {
    /// ещё не забранные окном уведомления
    pending: Mutex<Vec<Value>>,
    /// сколько уведомлений отдано этому экземпляру окна — чтобы не закрыть его, пока новое ещё в пути
    pushed: Mutex<u64>,
    corner: Mutex<String>,
    height: Mutex<f64>,
}

#[derive(Deserialize)]
pub struct Note {
    kind: Option<String>,
    title: String,
    body: String,
    corner: Option<String>,
    accent: Option<String>,
    accent2: Option<String>,
    #[serde(default)]
    sound: bool,
}

/// Строка для уведомления: без управляющих символов, не длиннее `max` символов (по символам, не байтам).
fn clean(s: &str, max: usize) -> String {
    let t: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() > max { t.chars().take(max - 1).collect::<String>() + "…" } else { t }
}

fn corner(s: Option<&str>) -> &'static str {
    match s.unwrap_or("") {
        "tl" => "tl",
        "tr" => "tr",
        "bl" => "bl",
        _ => "br", // как в Telegram по умолчанию — справа снизу
    }
}

/// Цвет акцента для карточки: только #rgb / #rrggbb / #rrggbbaa (в окно уведомления уходит в CSS-переменную).
fn color(s: Option<String>) -> Value {
    match s.map(|s| s.trim().to_string()) {
        Some(c)
            if matches!(c.len(), 4 | 7 | 9) && c.starts_with('#') && c[1..].chars().all(|h| h.is_ascii_hexdigit()) =>
        {
            Value::String(c)
        }
        _ => Value::Null,
    }
}

/// Показать уведомление. Ok(true) — звук уже сыгран здесь (Windows), Ok(false) — пусть сыграет страница, если нужен.
#[tauri::command]
pub async fn notify_show(app: AppHandle, note: Note) -> Result<bool, String> {
    let title = clean(&note.title, 80);
    let body = clean(&note.body, 240);
    if title.is_empty() {
        return Err("пустой заголовок".into());
    }
    let c = corner(note.corner.as_deref());
    let item = json!({
        "kind": clean(note.kind.as_deref().unwrap_or(""), 16), "title": title, "body": body, "corner": c,
        "accent": color(note.accent), "accent2": color(note.accent2),
    });
    let app2 = app.clone();
    // очередь, счётчик и окно — в главном потоке, по порядку: окна в Windows надёжнее создавать и двигать оттуда,
    // а два уведомления подряд не создадут два окна
    app.run_on_main_thread(move || {
        let st = app2.state::<Shared>();
        *st.corner.lock().unwrap() = c.to_string();
        st.pending.lock().unwrap().push(item);
        match app2.get_webview_window(LABEL) {
            Some(w) => {
                *st.pushed.lock().unwrap() += 1;
                place(&app2, &w);
                let _ = app2.emit_to(LABEL, "notify-poke", ());
            }
            None => open(&app2),
        }
    })
    .map_err(|e| format!("окно уведомления не открылось: {e}"))?;
    Ok(note.sound && sound::play())
}

/// Окно уведомлений забирает накопившееся (при загрузке и по событию notify-poke).
#[tauri::command]
pub fn notify_take(app: AppHandle) -> Vec<Value> {
    std::mem::take(&mut *app.state::<Shared>().pending.lock().unwrap())
}

/// Окно сообщает высоту стопки (логические px). 0 — карточек не осталось: окно закрывается,
/// если забрало всё, что ему отправили (`taken`), иначе — пусть заберёт новое.
#[tauri::command]
pub fn notify_layout(app: AppHandle, h: f64, taken: u64) {
    let st = app.state::<Shared>();
    if h <= 0.0 {
        if *st.pushed.lock().unwrap() != taken || !st.pending.lock().unwrap().is_empty() {
            let _ = app.emit_to(LABEL, "notify-poke", ());
            return;
        }
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.destroy();
        }
        return;
    }
    *st.height.lock().unwrap() = h.clamp(40.0, 900.0);
    if let Some(w) = app.get_webview_window(LABEL) {
        place(&app, &w);
    }
}

/// Щелчок по уведомлению — открыть главное окно.
#[tauri::command]
pub fn notify_ctl(app: AppHandle, action: String) {
    if action == "open" {
        crate::show_main(&app);
    }
}

/// Монитор, на котором главное окно (даже спрятанное в трей — последний известный), иначе основной.
fn monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    app.get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
}

fn rect(app: &AppHandle) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let st = app.state::<Shared>();
    let c = st.corner.lock().unwrap().clone();
    let h = *st.height.lock().unwrap();
    let m = monitor(app)?;
    let sc = m.scale_factor();
    let wa = m.work_area();
    let (pw, ph, gap) = ((W * sc).round() as i32, (h * sc).round() as i32, (GAP * sc).round() as i32);
    let (l, t) = (wa.position.x, wa.position.y);
    let (r, b) = (l + wa.size.width as i32, t + wa.size.height as i32);
    let ph = ph.min(b - t);
    let x = if c.ends_with('l') { l + gap } else { r - pw - gap };
    let y = if c.starts_with('t') { t + gap } else { b - ph - gap };
    Some((PhysicalPosition::new(x, y.max(t)), PhysicalSize::new(pw.max(1) as u32, ph.max(1) as u32)))
}

fn place(app: &AppHandle, w: &tauri::WebviewWindow) {
    if let Some((p, s)) = rect(app) {
        let _ = w.set_position(p);
        let _ = w.set_size(s);
    }
}

fn open(app: &AppHandle) {
    let st = app.state::<Shared>();
    *st.pushed.lock().unwrap() = st.pending.lock().unwrap().len() as u64;
    *st.height.lock().unwrap() = 100.0; // до первой отрисовки — примерно одна карточка
    let Ok(w) = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("notifywin.html".into()))
        .title("Уведомление")
        .inner_size(W, 100.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false) // тень рисуют сами карточки: у прозрачного окна системная обвела бы и пустые поля
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
    else {
        return;
    };
    place(app, &w);
    show_quiet(&w);
}

/// Показать, не забирая фокус у текущей программы.
#[cfg(windows)]
fn show_quiet(w: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    match w.hwnd() {
        Ok(h) => unsafe {
            let _ = ShowWindow(HWND(h.0 as _), SW_SHOWNOACTIVATE);
        },
        Err(_) => {
            let _ = w.show();
        }
    }
}
#[cfg(not(windows))]
fn show_quiet(w: &tauri::WebviewWindow) {
    let _ = w.show();
}

/// Короткий двойной «дзынь» (как у мессенджеров): два тона подряд с мягкой атакой и затуханием, WAV 16 бит моно.
/// Тот же звук для Linux строит notify.js (chimeWav) — меняешь здесь, поменяй и там.
pub(crate) fn chime_wav() -> Vec<u8> {
    const SR: u32 = 44100;
    const DUR: f32 = 0.45;
    let n = (SR as f32 * DUR) as usize;
    let tau = std::f32::consts::TAU;
    let mut pcm = Vec::with_capacity(n * 2);
    for i in 0..n {
        let t = i as f32 / SR as f32;
        let tone = |f: f32, start: f32, amp: f32| {
            let u = t - start;
            if u < 0.0 {
                return 0.0;
            }
            let env = (u / 0.006).min(1.0) * (-u * 9.0).exp();
            amp * env * ((tau * f * u).sin() + 0.25 * (tau * 2.0 * f * u).sin())
        };
        let fade = ((DUR - t) / 0.03).clamp(0.0, 1.0); // без щелчка в конце
        let v = (tone(987.8, 0.0, 0.32) + tone(1318.5, 0.09, 0.30)) * fade * 0.6;
        pcm.extend_from_slice(&((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    let mut w = Vec::with_capacity(44 + pcm.len());
    w.extend_from_slice(b"RIFF");
    w.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes()); // PCM
    w.extend_from_slice(&1u16.to_le_bytes()); // моно
    w.extend_from_slice(&SR.to_le_bytes());
    w.extend_from_slice(&(SR * 2).to_le_bytes());
    w.extend_from_slice(&2u16.to_le_bytes());
    w.extend_from_slice(&16u16.to_le_bytes());
    w.extend_from_slice(b"data");
    w.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    w.extend_from_slice(&pcm);
    w
}

#[cfg(windows)]
mod sound {
    use std::sync::OnceLock;
    use windows::core::PCWSTR;
    use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};

    // буфер должен жить, пока звук играет асинхронно, — держим его всё время работы приложения
    static WAV: OnceLock<Vec<u8>> = OnceLock::new();

    pub fn play() -> bool {
        let wav = WAV.get_or_init(super::chime_wav);
        unsafe { PlaySoundW(PCWSTR(wav.as_ptr() as *const u16), None, SND_MEMORY | SND_ASYNC | SND_NODEFAULT).as_bool() }
    }
}
#[cfg(not(windows))]
mod sound {
    pub fn play() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{chime_wav, clean, corner};

    #[test]
    fn cleans() {
        assert_eq!(clean("  Вадим\nзовёт\t в комнату ", 80), "Вадим зовёт в комнату");
        assert_eq!(clean("абвгдежзик", 5), "абвг…");
        assert_eq!(clean("", 10), "");
    }

    #[test]
    fn corners() {
        assert_eq!(corner(Some("tl")), "tl");
        assert_eq!(corner(Some("что-то")), "br");
        assert_eq!(corner(None), "br");
    }

    #[test]
    fn wav() {
        let w = chime_wav();
        assert_eq!(&w[..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(w[40..44].try_into().unwrap()) as usize, w.len() - 44);
    }
}
