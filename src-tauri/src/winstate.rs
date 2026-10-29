//! Запоминает размер, положение и «развёрнуто на весь экран» главного окна между запусками.
//!
//! Сохраняется в window.json (папка настроек приложения):
//! * при скрытии окна в трей и при выходе;
//! * через секунду после того, как окно перестали двигать/менять размер — на случай,
//!   если приложение закроют не через «Выход» (выключение компьютера, снятие задачи).
//! Размер и место запоминаются только для обычного окна: у развёрнутого окна они равны экрану,
//! поэтому для него хранится флаг «развёрнуто» плюс прежние размеры — к ним окно вернётся,
//! если его потом «восстановить». Полноэкранный режим (текст песни, визуализатор) не запоминается.
//!
//! Окно создаётся скрытым (tauri.conf.json: "visible": false) и показывается уже на своём месте —
//! без «прыжка» из маленького окна в большое.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering::SeqCst};
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const FILE: &str = "window.json";
static GEN: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
struct State {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    maximized: bool,
}

fn path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(FILE))
}

fn load(app: &AppHandle) -> Option<State> {
    let s: State = serde_json::from_slice(&std::fs::read(path(app)?).ok()?).ok()?;
    (s.w >= 200 && s.h >= 150 && s.w <= 20000 && s.h <= 20000).then_some(s)
}

/// Сохранить текущее состояние главного окна (если его есть смысл сохранять).
pub fn save(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    if !w.is_visible().unwrap_or(false) || w.is_fullscreen().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
        // окно в трее (его состояние сохранено при скрытии), полный экран и свёрнутое окно
        // не запоминаем — остаётся прошлое состояние
        return;
    }
    let maximized = w.is_maximized().unwrap_or(false);
    let mut s = load(app).unwrap_or_default();
    s.maximized = maximized;
    if !maximized {
        let (Ok(p), Ok(sz)) = (w.outer_position(), w.inner_size()) else { return };
        if sz.width < 200 || sz.height < 150 {
            return;
        }
        s.x = p.x;
        s.y = p.y;
        s.w = sz.width;
        s.h = sz.height;
    } else if s.w == 0 {
        return; // развёрнуто, а обычного размера ещё ни разу не видели — нечего сохранять
    }
    let Some(file) = path(app) else { return };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(data) = serde_json::to_vec(&s) {
        let tmp = file.with_extension("json.tmp");
        if std::fs::write(&tmp, data).is_ok() {
            let _ = std::fs::rename(&tmp, &file);
        }
    }
}

/// Окно двигают или меняют размер — сохраняем через секунду после последнего изменения.
pub fn changed(app: &AppHandle) {
    let gen = GEN.fetch_add(1, SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(1));
        if GEN.load(SeqCst) == gen {
            save(&app);
        }
    });
}

/// Окно было развёрнуто на весь экран — развернуть, когда его покажут (у скрытого окна maximize само показывает окно).
static PENDING_MAX: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Первый показ окна при запуске. Зовёт страница (команда app_ready), когда уже применила сохранённый стиль, —
/// так не видно, как интерфейс сначала рисуется встроенным «Неоном», а потом перекрашивается в свою тему.
/// Страница не ответила за 5 с (сломалась, очень медленный компьютер) — окно всё равно показывается (show_fallback).
pub fn show_first(w: &WebviewWindow) {
    use std::sync::atomic::Ordering::SeqCst;
    if SHOWN.swap(true, SeqCst) {
        return; // уже показано: повторный вызов после «Обновить» (F5) ничего не делает
    }
    if PENDING_MAX.swap(false, SeqCst) {
        let _ = w.maximize();
    }
    let _ = w.show();
    let _ = w.set_focus();
}

/// Страховка: окно показывается через 5 с, даже если страница так и не сообщила, что готова.
pub fn show_fallback(w: &WebviewWindow) {
    let w = w.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        let w2 = w.clone();
        let _ = w.run_on_main_thread(move || show_first(&w2));
    });
}

/// При запуске: вернуть окно на место (размер, позиция, развёрнутость). Показывает его show_first.
pub fn restore(w: &WebviewWindow) {
    if let Some(s) = load(w.app_handle()) {
        // место — только если оно хоть на каком-то мониторе (монитор могли отключить)
        let visible = w.available_monitors().unwrap_or_default().iter().any(|m| {
            let (mp, ms) = (m.position(), m.size());
            let (cx, cy) = (s.x + 80, s.y + 20); // точка у левого верхнего угла заголовка
            cx >= mp.x && cy >= mp.y && cx < mp.x + ms.width as i32 && cy < mp.y + ms.height as i32
        });
        let _ = w.set_size(PhysicalSize::new(s.w, s.h));
        if visible {
            let _ = w.set_position(PhysicalPosition::new(s.x, s.y));
        } else {
            let _ = w.center();
        }
        if s.maximized {
            PENDING_MAX.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    show_fallback(w);
}

/// Страница применила сохранённый стиль — можно показывать окно (src/boot.js).
#[tauri::command]
pub fn app_ready(window: WebviewWindow) {
    if window.label() == "main" {
        show_first(&window);
    }
}
