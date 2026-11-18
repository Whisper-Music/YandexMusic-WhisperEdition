// Сколько компьютер простаивает (без мыши и клавиатуры) — для статуса «отошёл» у друзей (core/together.js через
// kit.idleMs в yandex.js). Нужно именно системное время: музыку обычно слушают, работая в других окнах, и по вводу
// в своём окне приложение решило бы, что ты отошёл, хотя ты за компьютером.
// Windows — GetLastInputInfo; на других системах ответа нет (None) — тогда together.js судит по своему окну.

#[tauri::command]
pub fn sys_idle_ms() -> Option<u64> {
    idle_ms()
}

#[cfg(windows)]
fn idle_ms() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: li — своя структура с верным cbSize, функция только заполняет её
    if !unsafe { GetLastInputInfo(&mut li) }.as_bool() {
        return None;
    }
    // оба счётчика — 32-битные миллисекунды с запуска системы и переполняются раз в 49 дней: разность — wrapping
    let now = unsafe { GetTickCount() };
    Some(u64::from(now.wrapping_sub(li.dwTime)))
}

#[cfg(not(windows))]
fn idle_ms() -> Option<u64> {
    None
}
