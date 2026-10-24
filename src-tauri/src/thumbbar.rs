//! Кнопки под миниатюрой окна на панели задач Windows (видны при наведении на значок приложения):
//! «В лайки», «Предыдущий», «Пауза / Играть», «Следующий».
//!
//! Устроено через ITaskbarList3: кнопки можно добавить только после того, как Windows создаст значок окна
//! на панели задач (сообщение «TaskbarButtonCreated»; приходит и после перезапуска Проводника), поэтому окно
//! подклассируется и ловит это сообщение. Нажатия приходят в WM_COMMAND (THBN_CLICKED) и уходят на страницу
//! тем же событием, что кнопки трея и горячие клавиши (`tray-ctl`). Значки «пауза/играть» и «сердечко»
//! страница переключает командой thumbbar_state. Всё, что касается COM и окна, — только в главном потоке.

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter};
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_DISABLED, THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON,
        THB_TOOLTIP, THUMBBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconFromResourceEx, GetSystemMetrics, RegisterWindowMessageW, HICON, LR_DEFAULTCOLOR, SM_CXSMICON, SM_CYSMICON, WM_COMMAND,
    };

    const ID_LIKE: u32 = 1;
    const ID_PREV: u32 = 2;
    const ID_TOGGLE: u32 = 3;
    const ID_NEXT: u32 = 4;
    const SUBCLASS_ID: usize = 0x5442; // «TB»

    struct Icons {
        prev: HICON,
        next: HICON,
        play: HICON,
        pause: HICON,
        like: HICON,
        liked: HICON,
    }

    #[derive(Clone, Copy, PartialEq)]
    struct View {
        has: bool,
        playing: bool,
        liked: bool,
    }

    struct St {
        hwnd: HWND,
        tb: Option<ITaskbarList3>,
        added: bool,
        icons: Icons,
        view: View,
    }

    thread_local! { static ST: RefCell<Option<St>> = const { RefCell::new(None) }; }
    static APP: OnceLock<AppHandle> = OnceLock::new();
    static CREATED_MSG: OnceLock<u32> = OnceLock::new();

    fn icon(png: &[u8]) -> HICON {
        unsafe {
            let (cx, cy) = (GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON));
            CreateIconFromResourceEx(png, true, 0x0003_0000, cx, cy, LR_DEFAULTCOLOR).unwrap_or_default()
        }
    }

    fn button(id: u32, icon: HICON, tip: &str, enabled: bool) -> THUMBBUTTON {
        let mut b = THUMBBUTTON {
            dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
            iId: id,
            hIcon: icon,
            dwFlags: if enabled { THBF_ENABLED } else { THBF_DISABLED },
            ..Default::default()
        };
        for (i, c) in tip.encode_utf16().take(b.szTip.len() - 1).enumerate() {
            b.szTip[i] = c;
        }
        b
    }

    fn buttons(s: &St) -> [THUMBBUTTON; 4] {
        let v = s.view;
        [
            button(ID_LIKE, if v.liked { s.icons.liked } else { s.icons.like }, if v.liked { "Убрать из лайков" } else { "В лайки" }, v.has),
            button(ID_PREV, s.icons.prev, "Предыдущий", v.has),
            button(ID_TOGGLE, if v.playing { s.icons.pause } else { s.icons.play }, if v.playing { "Пауза" } else { "Играть" }, v.has),
            button(ID_NEXT, s.icons.next, "Следующий", v.has),
        ]
    }

    fn taskbar(s: &mut St) -> Option<ITaskbarList3> {
        if s.tb.is_none() {
            s.tb = unsafe {
                CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER)
                    .ok()
                    .filter(|tb| tb.HrInit().is_ok())
            };
        }
        s.tb.clone()
    }

    fn push(s: &mut St) {
        let Some(tb) = taskbar(s) else { return };
        let b = buttons(s);
        unsafe {
            if s.added {
                let _ = tb.ThumbBarUpdateButtons(s.hwnd, &b);
            } else if tb.ThumbBarAddButtons(s.hwnd, &b).is_ok() {
                s.added = true;
            }
        }
    }

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
        if CREATED_MSG.get() == Some(&msg) {
            // значок на панели задач создан (или Проводник перезапустился) — кнопки добавляются заново
            ST.with(|c| {
                if let Ok(mut g) = c.try_borrow_mut() {
                    if let Some(s) = g.as_mut() {
                        s.added = false;
                        s.tb = None;
                        push(s);
                    }
                }
            });
        } else if msg == WM_COMMAND && ((wp.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
            let action = match (wp.0 & 0xffff) as u32 {
                ID_LIKE => "like",
                ID_PREV => "prev",
                ID_TOGGLE => "toggle",
                ID_NEXT => "next",
                _ => "",
            };
            if !action.is_empty() {
                if let Some(app) = APP.get() {
                    crate::power::wake(app);
                    let _ = app.emit("tray-ctl", action);
                }
                return LRESULT(0);
            }
        }
        DefSubclassProc(hwnd, msg, wp, lp)
    }

    pub fn init(app: &AppHandle, window: &tauri::WebviewWindow) {
        let Ok(h) = window.hwnd() else { return };
        let hwnd = HWND(h.0 as _);
        let _ = APP.set(app.clone());
        let _ = CREATED_MSG.set(unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) });
        let icons = Icons {
            prev: icon(include_bytes!("../icons/thumb/prev.png")),
            next: icon(include_bytes!("../icons/thumb/next.png")),
            play: icon(include_bytes!("../icons/thumb/play.png")),
            pause: icon(include_bytes!("../icons/thumb/pause.png")),
            like: icon(include_bytes!("../icons/thumb/like.png")),
            liked: icon(include_bytes!("../icons/thumb/liked.png")),
        };
        let mut s = St { hwnd, tb: None, added: false, icons, view: View { has: false, playing: false, liked: false } };
        push(&mut s); // если значок уже есть на панели задач — кнопки появятся сразу
        ST.with(|c| *c.borrow_mut() = Some(s));
        unsafe {
            let _ = SetWindowSubclass(hwnd, Some(proc), SUBCLASS_ID, 0);
        }
    }

    pub fn set(app: &AppHandle, has: bool, playing: bool, liked: bool) {
        let _ = app.run_on_main_thread(move || {
            ST.with(|c| {
                if let Ok(mut g) = c.try_borrow_mut() {
                    if let Some(s) = g.as_mut() {
                        let v = View { has, playing, liked };
                        if s.view != v || !s.added {
                            s.view = v;
                            push(s);
                        }
                    }
                }
            });
        });
    }
}

#[cfg(windows)]
pub fn init(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    imp::init(app, window);
}
#[cfg(not(windows))]
pub fn init(_: &tauri::AppHandle, _: &tauri::WebviewWindow) {}

/// Состояние кнопок под миниатюрой: есть ли трек, играет ли он, в лайках ли он.
#[tauri::command]
pub fn thumbbar_state(app: tauri::AppHandle, has: bool, playing: bool, liked: bool) {
    #[cfg(windows)]
    imp::set(&app, has, playing, liked);
    #[cfg(not(windows))]
    let _ = (app, has, playing, liked);
}
