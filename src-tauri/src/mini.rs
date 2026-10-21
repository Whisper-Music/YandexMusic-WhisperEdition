//! Мини-плеер у значка в трее (настройка «Значок в трее»: «Меню» или «Мини-плеер»).
//!
//! * Windows — в режиме мини-плеера у значка снимается меню, и правый клик открывает маленькое окно
//!   с обложкой, названием и кнопками. Левый клик, как и раньше, открывает главное окно.
//! * Linux — щелчки по значку приложению не приходят (меню показывает сама оболочка),
//!   поэтому мини-плеер открывается пунктом меню «Мини-плеер».
//!
//! Окно создаётся при первом открытии и уничтожается через 30 с после того, как его скрыли:
//! пока приложение лежит в трее, лишний WebView память не держит.
//! Команды из мини-плеера идут через Rust (mini_ctl): главное окно в трее может быть
//! «заморожено» режимом экономии, power::wake его будит — так же, как пункты меню трея.

use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "mini";
const W: f64 = 360.0;
const H: f64 = 136.0;

static ENABLED: AtomicBool = AtomicBool::new(false);
static HIDE_GEN: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct Shared {
    state: Mutex<Value>,
    shown_at: Mutex<Option<Instant>>,
    hidden_at: Mutex<Option<Instant>>,
}

pub fn enabled() -> bool {
    ENABLED.load(SeqCst)
}

/// Включить/выключить режим мини-плеера. Меню у значка в Windows снимается/возвращается в lib.rs.
#[tauri::command]
pub fn tray_mode(app: AppHandle, mini: bool) {
    ENABLED.store(mini, SeqCst);
    crate::tray_menu(&app, !mini || !cfg!(windows));
    if !mini {
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.destroy();
        }
    }
}

/// Главное окно сообщает, что играет (название, обложка, режимы, позиция).
#[tauri::command]
pub fn mini_state(app: AppHandle, s: tauri::State<Shared>, state: Value) {
    *s.state.lock().unwrap() = state.clone();
    if app.get_webview_window(LABEL).is_some() {
        let _ = app.emit_to(LABEL, "mini-state", state);
    }
}

#[tauri::command]
pub fn mini_state_get(s: tauri::State<Shared>) -> Value {
    s.state.lock().unwrap().clone()
}

/// Кнопки мини-плеера.
#[tauri::command]
pub fn mini_ctl(app: AppHandle, action: String) {
    match action.as_str() {
        "prev" | "toggle" | "next" | "shuffle" | "repeat" => {
            crate::power::wake(&app);
            let _ = app.emit("tray-ctl", action);
        }
        "open" => {
            hide(&app);
            crate::show_main(&app);
        }
        "hide" => hide(&app),
        "quit" => {
            crate::winstate::save(&app);
            app.exit(0);
        }
        _ => {}
    }
}

fn hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            *app.state::<Shared>().hidden_at.lock().unwrap() = Some(Instant::now());
            schedule_destroy(app);
        }
    }
}

fn schedule_destroy(app: &AppHandle) {
    let gen = HIDE_GEN.fetch_add(1, SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        if HIDE_GEN.load(SeqCst) != gen {
            return; // за это время окно снова открывали
        }
        if let Some(w) = app.get_webview_window(LABEL) {
            if !w.is_visible().unwrap_or(true) {
                let _ = w.destroy();
            }
        }
    });
}

/// Потеря фокуса — окно прячется, как обычное всплывающее меню.
pub fn on_blur(app: &AppHandle) {
    let just_shown = app.state::<Shared>().shown_at.lock().unwrap().is_some_and(|t| t.elapsed() < Duration::from_millis(350));
    if !just_shown {
        hide(app);
    }
}

/// Показать мини-плеер у точки щелчка (или в углу экрана, если точки нет — Linux).
/// Повторный щелчок по значку, пока окно открыто, его закрывает.
pub fn toggle(app: &AppHandle, at: Option<PhysicalPosition<f64>>) {
    let st = app.state::<Shared>();
    // щелчок по значку сначала уводит фокус (окно прячется), потом приходит сам щелчок — это «закрыть»
    if st.hidden_at.lock().unwrap().is_some_and(|t| t.elapsed() < Duration::from_millis(400)) {
        return;
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        if w.is_visible().unwrap_or(false) {
            hide(app);
            return;
        }
    }
    let w = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => match WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("mini.html".into()))
            .title("Мини-плеер")
            .inner_size(W, H)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .shadow(true)
            .build()
        {
            Ok(w) => w,
            Err(_) => return,
        },
    };
    HIDE_GEN.fetch_add(1, SeqCst); // отменить отложенное уничтожение

    // место: над точкой щелчка (панель задач обычно внизу), в пределах рабочей области монитора
    let scale = w.scale_factor().unwrap_or(1.0);
    let (pw, ph) = ((W * scale).round() as i32, (H * scale).round() as i32);
    let mon = match at {
        Some(p) => app.monitor_from_point(p.x, p.y).ok().flatten(),
        None => None,
    }
    .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = mon {
        let wa = m.work_area();
        let (l, t) = (wa.position.x, wa.position.y);
        let (r, b) = (l + wa.size.width as i32, t + wa.size.height as i32);
        let gap = (12.0 * scale) as i32;
        let (mut x, mut y) = match at {
            Some(p) => (p.x as i32 - pw / 2, p.y as i32 - ph - gap),
            None => (r - pw - gap, t + gap), // Linux: значки трея обычно в верхней панели справа
        };
        if y < t + gap {
            y = at.map(|p| p.y as i32 + gap).unwrap_or(t + gap); // панель задач сверху — открываемся вниз
        }
        x = x.clamp(l + gap, (r - pw - gap).max(l + gap));
        y = y.clamp(t + gap, (b - ph - gap).max(t + gap));
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    }
    *st.shown_at.lock().unwrap() = Some(Instant::now());
    let _ = w.show();
    let _ = w.set_focus();
    let state = st.state.lock().unwrap().clone();
    let _ = app.emit_to(LABEL, "mini-state", state);
}
