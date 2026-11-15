//! Имя и значок приложения в микшере громкости Windows.
//!
//! Звук страницы играет не наш процесс, а дочерний процесс WebView2 (msedgewebview2.exe) — поэтому в микшере
//! вместо приложения было «Microsoft Edge WebView2». У звукового сеанса Windows есть своё имя и значок
//! (IAudioSessionControl::SetDisplayName / SetIconPath), и их можно поставить и чужому сеансу. Раз в пару секунд
//! смотрим сеансы на всех включённых устройствах вывода: сеанс процесса, который ведёт начало от нашего
//! (WebView2 — наш потомок), или самого приложения (свой WASAPI-движок) получает имя и значок приложения.
//! Чужие процессы не трогаем. Сеанс WebView пересоздаёт (новое устройство, перезапуск звука) — поэтому опрос.

#[cfg(windows)]
pub fn init(_app: &tauri::AppHandle) {
    // не productName из tauri.conf.json: там служебное «yandex-desktop» (имя файла установщика)
    let name = String::from("Yandex Music — Whisper Edition");
    let icon = std::env::current_exe()
        .map(|p| format!("{},0", p.display()))
        .unwrap_or_default();
    let _ = std::thread::Builder::new()
        .name("mixer-name".into())
        .spawn(move || imp::run(&name, &icon));
}

#[cfg(not(windows))]
pub fn init(_app: &tauri::AppHandle) {}

#[cfg(windows)]
mod imp {
    use std::collections::HashMap;
    use std::time::Duration;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::{
        eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };

    const EVERY: Duration = Duration::from_secs(2);

    pub fn run(name: &str, icon: &str) {
        // SAFETY: COM для этого потока; поток живёт до выхода из приложения
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let wname: Vec<u16> = name.encode_utf16().chain([0]).collect();
        let wicon: Vec<u16> = icon.encode_utf16().chain([0]).collect();
        let me = std::process::id();
        // pid → «наш ли»: снимок процессов делается, только когда появился незнакомый pid
        let mut ours: HashMap<u32, bool> = HashMap::new();
        loop {
            // SAFETY: вызовы COM с проверкой результатов; строки — свои буферы с нулём на конце
            let _ = unsafe { pass(me, name, &wname, &wicon, &mut ours) };
            std::thread::sleep(EVERY);
        }
    }

    unsafe fn pass(
        me: u32,
        name: &str,
        wname: &[u16],
        wicon: &[u16],
        ours: &mut HashMap<u32, bool>,
    ) -> windows::core::Result<()> {
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let devs = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        let mut tree: Option<HashMap<u32, u32>> = None;
        for i in 0..devs.GetCount()? {
            let Ok(dev) = devs.Item(i) else { continue };
            let Ok(mgr) = dev.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
            let Ok(list) = mgr.GetSessionEnumerator() else { continue };
            for j in 0..list.GetCount().unwrap_or(0) {
                let Ok(s) = list.GetSession(j) else { continue };
                let Ok(s2) = s.cast::<IAudioSessionControl2>() else { continue };
                let Ok(pid) = s2.GetProcessId() else { continue };
                if pid == 0 {
                    continue; // системные звуки
                }
                let mine = match ours.get(&pid) {
                    Some(v) => *v,
                    None => {
                        let t = tree.get_or_insert_with(|| parents());
                        let v = descends(pid, me, t);
                        ours.insert(pid, v);
                        v
                    }
                };
                if !mine {
                    continue;
                }
                // имя уже наше — не трогаем (иначе микшер перерисовывает строку каждые 2 секунды)
                let cur = s.GetDisplayName().ok().map(|p| {
                    let v = p.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(p.0 as *const _));
                    v
                });
                if cur.as_deref() != Some(name) {
                    let _ = s.SetDisplayName(PCWSTR(wname.as_ptr()), std::ptr::null());
                    if wicon.len() > 1 {
                        let _ = s.SetIconPath(PCWSTR(wicon.as_ptr()), std::ptr::null());
                    }
                }
            }
        }
        // ушедшие процессы забываем, чтобы новый процесс с тем же pid проверился заново
        if ours.len() > 256 {
            ours.clear();
        }
        Ok(())
    }

    /// pid → pid родителя по снимку процессов
    fn parents() -> HashMap<u32, u32> {
        let mut m = HashMap::new();
        // SAFETY: снимок закрывается в конце; PROCESSENTRY32W с правильным dwSize
        unsafe {
            let Ok(h) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return m };
            let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if Process32FirstW(h, &mut e).is_ok() {
                loop {
                    m.insert(e.th32ProcessID, e.th32ParentProcessID);
                    if Process32NextW(h, &mut e).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(h);
        }
        m
    }

    /// процесс — наш или наш потомок (WebView2: приложение → браузерный процесс → звуковой)
    fn descends(mut pid: u32, me: u32, tree: &HashMap<u32, u32>) -> bool {
        for _ in 0..8 {
            if pid == me {
                return true;
            }
            match tree.get(&pid) {
                Some(&p) if p != 0 && p != pid => pid = p,
                _ => return false,
            }
        }
        false
    }
}
