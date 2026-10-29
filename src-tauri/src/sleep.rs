//! Режим сна: через заданное время музыка плавно затихает и останавливается, а компьютер (если выбрано) выключается.
//!
//! Таймер живёт здесь, а не в странице: страницу в трее может заморозить режим экономии (power.rs) или притормозить
//! браузер, а выключить компьютер нужно в любом случае. Время сверяется с системными часами каждую секунду —
//! если компьютер успел уснуть и проснуться, таймер не «растягивается».
//!
//! События странице:
//! * `sleep-fade` (сколько секунд до конца) — пора плавно убавлять громкость;
//! * `sleep-end` — время вышло: остановить музыку.
//! Выключение — системной командой с минутой на отмену (Windows показывает предупреждение; `sleep_cancel` отменяет).
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const FADE_SECS: u64 = 180; // последние 3 минуты музыка тихо затихает
const SHUTDOWN_DELAY_SECS: u32 = 60; // минута на отмену выключения

static GEN: AtomicU64 = AtomicU64::new(0);
static DEADLINE: AtomicU64 = AtomicU64::new(0); // мс от эпохи; 0 — режим выключен
static SHUTDOWN: AtomicBool = AtomicBool::new(false);
static SHUTDOWN_SENT: AtomicBool = AtomicBool::new(false);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Serialize)]
pub struct SleepState {
    deadline: u64,
    shutdown: bool,
}

/// Выключение компьютера — действие с серьёзными последствиями, поэтому его подтверждает системное окно,
/// которое показывает Rust, а не страница: чужой код в интерфейсе (XSS) сам «нажать» его не может.
async fn confirm_shutdown(app: &AppHandle, minutes: u32) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let when = if minutes.is_multiple_of(60) { format!("{} ч", minutes / 60) } else if minutes > 60 { format!("{} ч {} мин", minutes / 60, minutes % 60) } else { format!("{minutes} мин") };
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = a
            .dialog()
            .message(format!("Через {when} музыка остановится, а компьютер выключится. Включить?"))
            .title("Режим сна")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("Включить".into(), "Отмена".into()));
        if let Some(w) = tauri::Manager::get_webview_window(&a, "main") {
            d = d.parent(&w);
        }
        d.blocking_show()
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub async fn sleep_start(app: AppHandle, minutes: u32, shutdown: bool) -> Result<SleepState, String> {
    if !(1..=24 * 60).contains(&minutes) {
        return Err("Время должно быть от 1 минуты до 24 часов".into());
    }
    if shutdown && !confirm_shutdown(&app, minutes).await {
        return Err("Выключение компьютера не подтверждено".into());
    }
    let deadline = now_ms() + minutes as u64 * 60_000;
    let gen = GEN.fetch_add(1, SeqCst) + 1;
    DEADLINE.store(deadline, SeqCst);
    SHUTDOWN.store(shutdown, SeqCst);
    std::thread::spawn(move || {
        let mut faded = false;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if GEN.load(SeqCst) != gen {
                return; // отменили или перезапустили
            }
            let now = now_ms();
            let left = deadline.saturating_sub(now) / 1000;
            if !faded && left <= FADE_SECS {
                faded = true;
                crate::power::wake(&app);
                let _ = app.emit("sleep-fade", left);
            }
            if now >= deadline {
                crate::power::wake(&app);
                let _ = app.emit("sleep-end", ());
                DEADLINE.store(0, SeqCst);
                if SHUTDOWN.load(SeqCst) {
                    std::thread::sleep(Duration::from_secs(3)); // странице — время остановить музыку и сохраниться
                    if GEN.load(SeqCst) == gen {
                        crate::winstate::save(&app);
                        if power_off().is_ok() {
                            SHUTDOWN_SENT.store(true, SeqCst);
                        }
                    }
                }
                return;
            }
        }
    });
    Ok(SleepState { deadline, shutdown })
}

#[tauri::command]
pub fn sleep_cancel() {
    GEN.fetch_add(1, SeqCst);
    DEADLINE.store(0, SeqCst);
    if SHUTDOWN_SENT.swap(false, SeqCst) {
        abort_power_off();
    }
}

#[tauri::command]
pub fn sleep_status() -> Option<SleepState> {
    let d = DEADLINE.load(SeqCst);
    (d != 0).then(|| SleepState { deadline: d, shutdown: SHUTDOWN.load(SeqCst) })
}

#[cfg(windows)]
fn run(prog: &str, args: &[&str]) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new(prog).args(args).creation_flags(CREATE_NO_WINDOW).spawn().map(|_| ())
}
#[cfg(not(windows))]
fn run(prog: &str, args: &[&str]) -> std::io::Result<()> {
    std::process::Command::new(prog).args(args).spawn().map(|_| ())
}

fn power_off() -> std::io::Result<()> {
    let t = SHUTDOWN_DELAY_SECS.to_string();
    if cfg!(windows) {
        run("shutdown", &["/s", "/t", t.as_str(), "/c", "Режим сна: компьютер выключится через минуту. Отменить можно в плеере."])
    } else if cfg!(target_os = "macos") {
        run("osascript", &["-e", "tell application \"System Events\" to shut down"])
    } else {
        run("shutdown", &["-h", "+1"]).or_else(|_| run("systemctl", &["poweroff"]))
    }
}

fn abort_power_off() {
    if cfg!(windows) {
        let _ = run("shutdown", &["/a"]);
    } else if cfg!(not(target_os = "macos")) {
        let _ = run("shutdown", &["-c"]);
    }
}
