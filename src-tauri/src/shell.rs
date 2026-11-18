//! Всё, что есть только у компьютера: трей, кнопки окна без рамки, полный экран, параметры WebView2,
//! настройка главного окна при запуске и его события (закрыть → в трей, размеры, перетаскивание файлов).
//! На телефоне этого нет вовсе — модуль подключается только под cfg(desktop) (lib.rs), а lib.rs держит
//! общее для обеих сборок: модули, протоколы wa:// и ymlocal://, список команд.
use crate::{bg, mini, mixer, notify, power, thumbbar, update, webmode, winstate};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

pub(crate) struct TrayToggle(MenuItem<tauri::Wry>);

// значок в трее и его меню: в режиме мини-плеера (Windows) меню снимается, правый клик открывает мини-плеер
struct TrayHandle {
    tray: tauri::tray::TrayIcon,
    menu: Menu<tauri::Wry>,
}

pub(crate) fn tray_menu(app: &tauri::AppHandle, on: bool) {
    if let Some(h) = app.try_state::<TrayHandle>() {
        let _ = h.tray.set_menu(if on { Some(h.menu.clone()) } else { None });
    }
}

/// Значок в трее (Настройки → Приложение → Трей): чёрный, белый или в цветах стиля. Картинку рисует страница
/// (traymini.js, холст size×size, RGBA) — у Rust нет растеризатора SVG, а цвета стиля знает только страница.
/// `rgba: None` — обычный значок приложения.
#[tauri::command]
pub fn tray_icon(app: tauri::AppHandle, rgba: Option<Vec<u8>>, size: u32) -> Result<(), String> {
    let Some(h) = app.try_state::<TrayHandle>() else { return Ok(()) };
    let img = match rgba {
        Some(px) if (16..=256).contains(&size) && px.len() == (size * size * 4) as usize => {
            tauri::image::Image::new_owned(px, size, size)
        }
        Some(_) => return Err("неверный размер значка".into()),
        None => app.default_window_icon().cloned().ok_or("нет значка приложения")?,
    };
    h.tray.set_icon(Some(img)).map_err(|e| format!("значок не сменился: {e}"))
}

// Язык пунктов меню в трее (Настройки → Интерфейс → Язык; i18n.js зовёт tray_lang). Меню рисует система —
// перевод страницы до него не достаёт, поэтому подписи здесь в двух вариантах: (пункт, по-русски, по-английски).
pub(crate) struct TrayItems {
    items: Vec<(MenuItem<tauri::Wry>, &'static str, &'static str)>,
    en: std::sync::atomic::AtomicBool,
    playing: std::sync::atomic::AtomicBool,
}
fn toggle_text(en: bool, playing: bool) -> &'static str {
    match (en, playing) {
        (false, true) => "Пауза",
        (false, false) => "Играть",
        (true, true) => "Pause",
        (true, false) => "Play",
    }
}

#[tauri::command]
pub fn tray_playing(app: tauri::AppHandle, state: tauri::State<TrayToggle>, items: tauri::State<TrayItems>, playing: bool) {
    use std::sync::atomic::Ordering::Relaxed;
    items.playing.store(playing, Relaxed);
    let _ = state.0.set_text(toggle_text(items.en.load(Relaxed), playing));
    power::on_playing(&app, playing);
}

#[tauri::command]
pub fn tray_lang(state: tauri::State<TrayToggle>, items: tauri::State<TrayItems>, lang: String) {
    use std::sync::atomic::Ordering::Relaxed;
    let en = lang == "en";
    items.en.store(en, Relaxed);
    thumbbar::EN.store(en, Relaxed);
    for (it, ru, eng) in &items.items {
        let _ = it.set_text(if en { *eng } else { *ru });
    }
    let _ = state.0.set_text(toggle_text(en, items.playing.load(Relaxed)));
}

#[tauri::command]
pub fn win_minimize(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}
#[tauri::command]
pub fn win_toggle_max(window: tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}
#[tauri::command]
pub fn win_is_max(window: tauri::WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}
#[tauri::command]
pub fn win_close(window: tauri::WebviewWindow) {
    let _ = window.close();
}
// Положение и размер окна до полноэкранного режима, чтобы вернуть всё как было.
#[derive(Default)]
pub(crate) struct FsSaved(std::sync::Mutex<Option<(bool, tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>);

// Окно без системной рамки, да ещё развёрнутое, Windows переводит в полный экран не до конца:
// панель задач остаётся видна (пустой полосой). Поэтому сначала снимаем «развёрнуто»,
// затем включаем полный экран и на всякий случай сами растягиваем окно ровно на монитор.
// В Linux полный экран делает оконный менеджер сам: ручные set_position/set_size там только мешают
// (окно может «прыгнуть» или остаться не на весь экран), поэтому подгонка — только для Windows.
#[tauri::command]
pub fn win_set_fullscreen(window: tauri::WebviewWindow, saved: tauri::State<FsSaved>, on: bool) {
    let mut st = saved.0.lock().unwrap();
    if on {
        if st.is_none() {
            let was_max = window.is_maximized().unwrap_or(false);
            if was_max {
                let _ = window.unmaximize();
            }
            let pos = window.outer_position().unwrap_or_default();
            let size = window.outer_size().unwrap_or_default();
            *st = Some((was_max, pos, size));
        }
        let _ = window.set_fullscreen(true);
        #[cfg(windows)]
        if let Ok(Some(m)) = window.current_monitor() {
            let _ = window.set_position(*m.position());
            let _ = window.set_size(*m.size());
        }
        let _ = window.set_focus();
    } else {
        let _ = window.set_fullscreen(false);
        if let Some((was_max, pos, size)) = st.take() {
            if cfg!(windows) {
                let _ = window.set_size(size);
                let _ = window.set_position(pos);
            } else {
                let _ = (pos, size); // в Linux прежний размер окну вернёт оконный менеджер
            }
            if was_max {
                let _ = window.maximize();
            }
        }
    }
}
#[tauri::command]
pub fn win_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

// Без системного автозаполнения: иначе WebView2 при щелчке в поле поиска показывает своё окно
// «Сохранённые сведения» (прошлые запросы, адреса и т.п.). autocomplete="off" в HTML он слушает не всегда.
#[cfg(windows)]
fn no_autofill(w: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
    use windows::core::Interface;
    let _ = w.with_webview(|wv| unsafe {
        if let Ok(core) = wv.controller().CoreWebView2() {
            if let Ok(s) = core.Settings() {
                if let Ok(s4) = s.cast::<ICoreWebView2Settings4>() {
                    let _ = s4.SetIsGeneralAutofillEnabled(false);
                    let _ = s4.SetIsPasswordAutosaveEnabled(false);
                }
            }
        }
    });
}
#[cfg(not(windows))]
fn no_autofill(_: &tauri::WebviewWindow) {}

pub(crate) fn show_main(app: &tauri::AppHandle) {
    // интерфейс сейчас во вкладке браузера: «Открыть» из трея — вернуть его в окно (окно покажет web_finish)
    if webmode::active() {
        webmode::leave(app);
        return;
    }
    power::leave(app);
    if let Some(w) = app.get_webview_window("main") {
        winstate::show_first(&w); // окно ещё не показывалось с запуска — показать как при запуске (с развёрнутостью)
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Параметры движка окна (WebView2) — до создания первого окна, одни на все окна (иначе WebView2 откажется создать
/// второе окно с другими параметрами). Переменная окружения действует на все окна сразу.
///
/// AudioServiceOutOfProcess выключен: обычно звук играет отдельный процесс WebView2 в песочнице (внук приложения),
/// и «Захват звука приложения» в OBS (захват по дереву процессов, Windows 10 2004+) к нему подключается, но тишина.
/// Без него звук идёт из браузерного процесса WebView2 — прямого потомка приложения, и захват его слышит.
/// msWebOOUI, msPdfOOUI, msSmartScreenProtection — то, что Tauri выключает сам: значение переменной заменяет его
/// список, поэтому повторяем его целиком. Своё значение переменной (для отладки) не трогаем.
pub(crate) fn webview_args() {
    #[cfg(windows)]
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,AudioServiceOutOfProcess",
        );
    }
}

/// Плагины только для компьютера. Single-instance должен быть первым плагином: повторный запуск (ярлык,
/// меню приложений) не плодит копии, а достаёт уже запущенное окно — в том числе из трея. В Linux это ещё
/// и страховка: в GNOME без расширения AppIndicator значка в трее не видно вовсе, и без этого спрятанное окно
/// было бы не вернуть. Ссылку whisper://, открытую при уже запущенном приложении, он же передаёт плагину
/// deep-link (deeplink.rs).
pub(crate) fn first_plugins(b: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    b.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
}

pub(crate) fn plugins(b: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    b.plugin(crate::hotkeys::plugin())
        // обновления из GitHub Releases — только через команды update.rs, у страницы прямого доступа к плагину нет
        .plugin(tauri_plugin_updater::Builder::new().build())
}

/// Настройка главного окна и трея при запуске (из .setup в lib.rs).
pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_min_size(Some(tauri::LogicalSize::new(780.0, 540.0)));
        let _ = w.set_decorations(false);
        winstate::restore(&w); // размер и место с прошлого запуска; окно создано скрытым, показывает его страница (app_ready), когда применит стиль
        no_autofill(&w);
        crate::audiodev::init(&w); // микрофон запрещён; разовое разрешение — только для списка устройств вывода
        thumbbar::init(app.handle(), &w); // кнопки под миниатюрой окна на панели задач (Windows)
    }
    let prev = MenuItem::with_id(app, "prev", "Предыдущий", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Пауза / Играть", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Следующий", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    // Linux: щелчков по значку нет — мини-плеер открывается пунктом меню
    let mini_item = MenuItem::with_id(app, "mini", "Мини-плеер", true, None::<&str>)?;
    let menu = if cfg!(windows) {
        Menu::with_items(app, &[&prev, &toggle, &next, &sep, &show, &quit])?
    } else {
        Menu::with_items(app, &[&show, &mini_item, &prev, &toggle, &next, &sep, &quit])?
    };
    webmode::init(app.handle());
    mixer::init(app.handle()); // в микшере громкости — имя и значок приложения, а не «Microsoft Edge WebView2»
    app.manage(TrayItems {
        items: vec![
            (prev, "Предыдущий", "Previous"),
            (next, "Следующий", "Next"),
            (show, "Открыть", "Open"),
            (quit, "Выход", "Quit"),
            (mini_item, "Мини-плеер", "Mini player"),
        ],
        en: Default::default(),
        playing: Default::default(),
    });
    app.manage(TrayToggle(toggle));
    app.manage(FsSaved::default());
    app.manage(mini::Shared::default());
    app.manage(notify::Shared::default());
    app.manage(update::Pending::default());
    // Трей одинаково создаётся в Windows и Linux, но ведёт себя по-разному:
    // * Windows — левый клик открывает окно, правый показывает меню;
    // * Linux (libayatana-appindicator / StatusNotifierItem) — щелчки по значку приложению
    //   не приходят вообще, по любому клику оболочка сама показывает меню. Поэтому всё,
    //   что умеет значок, продублировано пунктами меню («Открыть» первым делом).
    //   Всплывающая подсказка (tooltip) в Linux не поддерживается и просто игнорируется.
    // * Windows, режим «Мини-плеер» (настройка) — меню у значка снимается (mini::tray_mode),
    //   и правый клик открывает мини-плеер.
    let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Моя Музыка")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(not(windows))) // в Linux флаг не действует, меню есть всегда
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => {
                winstate::save(app);
                app.exit(0);
            }
            "mini" => mini::toggle(app, None),
            id @ ("prev" | "toggle" | "next") => {
                power::wake(app);
                let _ = app.emit("tray-ctl", id);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state: MouseButtonState::Up, position, .. } = event {
                match button {
                    MouseButton::Left => show_main(tray.app_handle()),
                    MouseButton::Right if mini::enabled() => mini::toggle(tray.app_handle(), Some(position)),
                    _ => {}
                }
            }
        })
        .build(app)?;
    app.manage(TrayHandle { tray, menu });
    Ok(())
}

/// События окон компьютера: закрыть главное — спрятать в трей, размеры и место, перетаскивание файлов, мини-плеер.
pub(crate) fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() == "main" {
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                winstate::save(window.app_handle()); // до скрытия: у скрытого окна размеры могут не читаться
                let _ = window.hide();
                power::enter(window.app_handle());
            }
            WindowEvent::Resized(_) => {
                power::on_resized(window);
                winstate::changed(window.app_handle());
            }
            WindowEvent::Moved(_) => winstate::changed(window.app_handle()),
            // перетаскивание файлов/папок в окно принимает Rust (bg.rs), а не веб-страница
            WindowEvent::DragDrop(ev) => bg::on_drag(window.app_handle(), ev),
            _ => {}
        }
    } else if window.label() == "mini" {
        if let WindowEvent::Focused(false) = event {
            mini::on_blur(window.app_handle());
        }
    }
}
