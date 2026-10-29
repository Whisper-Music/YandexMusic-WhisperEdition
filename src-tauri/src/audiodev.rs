//! Выбор устройства вывода звука (main.js, вкладка настроек «Звук» и меню «⋯» нижней панели).
//!
//! Звук играет сама страница (<audio> / Web Audio), устройство задаётся через setSinkId. Список устройств
//! страница получает из navigator.mediaDevices.enumerateDevices(), но Chromium (WebView2) отдаёт названия и
//! идентификаторы динамиков только после разрешения на микрофон. Микрофон приложению не нужен, поэтому:
//! * разрешение на микрофон по умолчанию ЗАПРЕЩЕНО (страница не может включить его сама, окна-вопроса нет);
//! * команда audio_devices_unlock на 5 секунд открывает «окно»: следующий запрос микрофона от страницы
//!   приложения разрешается один раз и только до закрытия программы (в профиле WebView2 не запоминается).
//!   Страница тут же закрывает поток (main.js: outUnlock) — нужен только сам факт разрешения.
//! Окно входа Яндекса и любые другие страницы этим путём ничего не получают: обработчик стоит только на главном окне
//! и проверяет адрес страницы.

#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering::SeqCst};

#[cfg(windows)]
static GRANT_UNTIL: AtomicU64 = AtomicU64::new(0);

#[cfg(windows)]
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Открыть «окно» на одно разрешение микрофона (только для списка устройств вывода).
/// Возвращает false там, где это не нужно или не работает (не Windows, не главное окно).
#[tauri::command]
pub fn audio_devices_unlock(window: tauri::WebviewWindow) -> bool {
    if window.label() != "main" {
        return false;
    }
    #[cfg(windows)]
    {
        GRANT_UNTIL.store(now_ms() + 5000, SeqCst);
        true
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Адрес страницы приложения (http(s)://tauri.localhost или tauri://localhost; в отладке — локальный сервер разработки).
#[cfg(windows)]
fn app_origin(uri: &str) -> bool {
    let Ok(u) = tauri::Url::parse(uri) else { return false };
    let host = u.host_str().unwrap_or("");
    (u.scheme() == "tauri" && host == "localhost")
        || (matches!(u.scheme(), "http" | "https") && host == "tauri.localhost" && u.port().is_none())
        || (cfg!(debug_assertions) && u.scheme() == "http" && matches!(host, "127.0.0.1" | "localhost"))
}

#[cfg(windows)]
pub fn init(w: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PermissionRequestedEventArgs3, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        COREWEBVIEW2_PERMISSION_STATE_DENY,
    };
    use webview2_com::PermissionRequestedEventHandler;
    use windows::core::{Interface, PWSTR};

    let _ = w.with_webview(|wv| unsafe {
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                return Ok(()); // остальные разрешения — как решит WebView2
            }
            let mut uri = PWSTR::null();
            let origin_ok = args.Uri(&mut uri).is_ok() && app_origin(&webview2_com::take_pwstr(uri));
            let until = GRANT_UNTIL.swap(0, SeqCst); // «окно» одноразовое
            let allow = origin_ok && until > now_ms();
            // только до закрытия программы: в профиль WebView2 решение не записывается
            if let Ok(a3) = args.cast::<ICoreWebView2PermissionRequestedEventArgs3>() {
                let _ = a3.SetSavesInProfile(false);
            }
            args.SetState(if allow { COREWEBVIEW2_PERMISSION_STATE_ALLOW } else { COREWEBVIEW2_PERMISSION_STATE_DENY })?;
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}

#[cfg(not(windows))]
pub fn init(_: &tauri::WebviewWindow) {}

// ---------------------------------------------------------------------------
// Сведения о формате устройств вывода (вкладка «Звук» → «Сведения о формате», меню «⋯»).
// Только чтение: формат устройства из настроек Windows (то, что в «Звук → Свойства → Дополнительно»)
// и формат системного микшера, в котором звук реально уходит на устройство в общем режиме.
// Страница сопоставляет устройства по названию (оно совпадает с названием в списке динамиков).
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Default, Clone)]
pub struct WaveFmt {
    rate: u32,
    bits: u16,
    channels: u16,
    float: bool,
}

#[derive(serde::Serialize, Default)]
pub struct Endpoint {
    /// идентификатор устройства Windows — по нему свой движок (engine.rs) открывает устройство
    id: String,
    name: String,
    default: bool,
    /// формат устройства из настроек Windows (может отсутствовать у виртуальных устройств)
    device: Option<WaveFmt>,
    /// формат микшера (общий режим)
    mix: Option<WaveFmt>,
}

/// WAVEFORMATEX / WAVEFORMATEXTENSIBLE из байтов: частота, разрядность (для EXTENSIBLE — значащие биты), каналы, float.
#[cfg(any(windows, test))]
fn parse_wave(b: &[u8]) -> Option<WaveFmt> {
    if b.len() < 16 {
        return None;
    }
    let u16_at = |o: usize| u16::from_le_bytes([b[o], b[o + 1]]);
    let u32_at = |o: usize| u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
    let tag = u16_at(0);
    let mut bits = u16_at(14);
    let mut float = tag == 3; // WAVE_FORMAT_IEEE_FLOAT
    if tag == 0xFFFE && b.len() >= 40 {
        // WAVE_FORMAT_EXTENSIBLE: Samples.wValidBitsPerSample (18), SubFormat GUID (24): Data1 = 3 — float, 1 — PCM
        let valid = u16_at(18);
        if valid > 0 {
            bits = valid;
        }
        float = u32_at(24) == 3;
    }
    Some(WaveFmt { rate: u32_at(4), bits, channels: u16_at(2), float })
}

#[tauri::command]
pub async fn audio_endpoints() -> Vec<Endpoint> {
    tauri::async_runtime::spawn_blocking(endpoints).await.unwrap_or_default()
}

#[cfg(not(windows))]
fn endpoints() -> Vec<Endpoint> {
    Vec::new()
}

#[cfg(windows)]
fn endpoints() -> Vec<Endpoint> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
    };
    use windows::Win32::System::Variant::{VT_BLOB, VT_LPWSTR};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

    // PKEY_Device_FriendlyName и PKEY_AudioEngine_DeviceFormat (свои константы — без лишних features крейта windows)
    const FRIENDLY: PROPERTYKEY = PROPERTYKEY { fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 };
    const DEVFMT: PROPERTYKEY = PROPERTYKEY { fmtid: windows::core::GUID::from_u128(0xf19f064d_082c_4e27_bc73_6882a1bb8e4c), pid: 0 };

    unsafe fn take(p: PWSTR) -> String {
        if p.is_null() {
            return String::new();
        }
        let s = unsafe { p.to_string() }.unwrap_or_default();
        unsafe { CoTaskMemFree(Some(p.0 as _)) };
        s
    }
    unsafe fn prop_string(st: &IPropertyStore, key: &PROPERTYKEY) -> String {
        let Ok(mut pv) = (unsafe { st.GetValue(key) }) else { return String::new() };
        let inner = unsafe { &pv.Anonymous.Anonymous };
        let s = if inner.vt == VT_LPWSTR { unsafe { inner.Anonymous.pwszVal.to_string() }.unwrap_or_default() } else { String::new() };
        let _ = unsafe { PropVariantClear(&mut pv as *mut PROPVARIANT) };
        s
    }
    unsafe fn prop_wave(st: &IPropertyStore, key: &PROPERTYKEY) -> Option<WaveFmt> {
        let mut pv = unsafe { st.GetValue(key) }.ok()?;
        let inner = unsafe { &pv.Anonymous.Anonymous };
        let r = if inner.vt == VT_BLOB {
            let blob = unsafe { &inner.Anonymous.blob };
            if blob.pBlobData.is_null() || blob.cbSize == 0 || blob.cbSize > 4096 {
                None
            } else {
                parse_wave(unsafe { std::slice::from_raw_parts(blob.pBlobData, blob.cbSize as usize) })
            }
        } else {
            None
        };
        let _ = unsafe { PropVariantClear(&mut pv as *mut PROPVARIANT) };
        r
    }

    let mut out = Vec::new();
    unsafe {
        let inited = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        if let Ok(en) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) {
            let def = en.GetDefaultAudioEndpoint(eRender, eConsole).ok().and_then(|d| d.GetId().ok()).map(|p| take(p));
            if let Ok(col) = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                for i in 0..col.GetCount().unwrap_or(0).min(64) {
                    let Ok(d) = col.Item(i) else { continue };
                    let id = d.GetId().map(|p| take(p)).unwrap_or_default();
                    let mut e = Endpoint { default: def.as_deref() == Some(id.as_str()) && !id.is_empty(), id: id.clone(), ..Default::default() };
                    if let Ok(st) = d.OpenPropertyStore(STGM_READ) {
                        e.name = prop_string(&st, &FRIENDLY);
                        e.device = prop_wave(&st, &DEVFMT);
                    }
                    if let Ok(client) = d.Activate::<IAudioClient>(CLSCTX_ALL, None) {
                        if let Ok(p) = client.GetMixFormat() {
                            if !p.is_null() {
                                let wf = &*p;
                                let len = (18 + wf.cbSize as usize).min(64);
                                e.mix = parse_wave(std::slice::from_raw_parts(p as *const u8, len));
                                CoTaskMemFree(Some(p as _));
                            }
                        }
                    }
                    out.push(e);
                }
            }
        }
        if inited {
            CoUninitialize();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::parse_wave;
    #[test]
    fn wave() {
        // PCM 16 бит 44,1 кГц стерео
        let mut b = vec![0u8; 18];
        b[0] = 1; b[2] = 2;
        b[4..8].copy_from_slice(&44100u32.to_le_bytes());
        b[14] = 16;
        let f = parse_wave(&b).unwrap();
        assert_eq!((f.rate, f.bits, f.channels, f.float), (44100, 16, 2, false));
        // EXTENSIBLE: 32 бит контейнер, 24 значащих, float = нет
        let mut e = vec![0u8; 40];
        e[0..2].copy_from_slice(&0xFFFEu16.to_le_bytes()); e[2] = 2;
        e[4..8].copy_from_slice(&48000u32.to_le_bytes());
        e[14] = 32; e[18] = 24; e[24] = 1;
        let f = parse_wave(&e).unwrap();
        assert_eq!((f.rate, f.bits, f.float), (48000, 24, false));
        assert!(parse_wave(&[0u8; 4]).is_none());
    }
}
