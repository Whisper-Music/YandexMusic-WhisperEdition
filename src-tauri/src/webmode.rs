//! Браузерная версия: тот же интерфейс во вкладке браузера по умолчанию (Настройки → Приложение → «Открыть в браузере»).
//!
//! Как устроено:
//! * маленький HTTP-сервер на 127.0.0.1 (порт из WEB_PORTS) раздаёт файлы интерфейса из ресурсов приложения;
//!   в index.html первым подставляется webshim.js — он изображает `window.__TAURI__` поверх HTTP;
//! * команды Tauri без окна не вызвать, поэтому главное окно прячется и открывает bridge.html — переходник:
//!   вкладка шлёт POST /__web/ipc → событие «web-call» окну → bridge.js зовёт команду → `web_reply` → ответ вкладке.
//!   Два плеера одновременно не играют: интерфейса в окне в это время нет;
//! * события Rust (трей, горячие клавиши, Discord…) уходят во вкладку потоком SSE (/__web/events);
//! * ymlocal:// и wa:// (скачанные треки и поток архива) — пути /__proto/ymlocal/… и /__proto/wa/…;
//! * у вкладки и окна разное хранилище, поэтому при каждом переключении настройки (localStorage) и данные
//!   (IndexedDB: темы, фоны, статистика) переносятся: webstate.js кладёт их сюда (STATE, BLOBS), другая сторона забирает.
//!
//! Безопасность: только 127.0.0.1; ключ на каждое открытие, в ссылке он один раз меняется на cookie
//! (HttpOnly, SameSite=Strict); Host проверяется (защита от DNS rebinding), у POST — Origin и свой заголовок
//! X-Whisper (чужой сайт так запрос не отправит без preflight). Без ключа — ни файлов, ни команд.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicUsize, Ordering::SeqCst};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener};

/// Порт постоянный, насколько получится: у вкладки своё хранилище на каждый адрес (origin).
const WEB_PORTS: [u16; 8] = [47817, 47818, 47819, 47820, 47821, 47822, 47823, 47824];
const MAX_HEAD: usize = 64 * 1024;
/// Тело запроса: тема или фон (видео до 48 МБ) при переносе — с запасом.
const MAX_BODY: usize = 160 * 1048576;
const MAX_CONN: usize = 64;
/// Сколько ждать ответа команды: скачивание альбома, загрузка в архив — долгие.
const CALL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// События, которые ждёт вкладка. «power-save» не нужен: окно спрятано, но интерфейс-то во вкладке.
const EVENTS: [&str; 12] = [
    "bg-drag", "bg-drop", "discord-status", "engine", "notify-poke", "open-link", "room-link", "sleep-end", "sleep-fade",
    "tray-ctl", "update-progress", "mini-state",
];

static WEB: AtomicBool = AtomicBool::new(false);
static PORT: AtomicU16 = AtomicU16::new(0);
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static APP: OnceLock<AppHandle> = OnceLock::new();
static KEY: Mutex<String> = Mutex::new(String::new());
static CALLS: Mutex<Option<HashMap<u64, Call>>> = Mutex::new(None);
static SSE: Mutex<Vec<mpsc::Sender<String>>> = Mutex::new(Vec::new());
/// Перенос: localStorage и список записей IndexedDB (JSON) + большие значения отдельно (по ключу).
static STATE: Mutex<Option<Value>> = Mutex::new(None);
static BLOBS: Mutex<Option<HashMap<String, Blob>>> = Mutex::new(None);

struct Call {
    tx: mpsc::Sender<Reply>,
    body: Option<Vec<u8>>,
}
enum Reply {
    Json(Value),
    Bin(Vec<u8>),
}
struct Blob {
    stamp: String,
    bytes: Vec<u8>,
}

/// Сейчас интерфейс во вкладке браузера.
pub fn active() -> bool {
    WEB.load(SeqCst)
}

// ---------- запуск ----------

/// Подключить события (зовётся один раз из setup).
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    for name in EVENTS {
        app.listen_any(name, move |e| {
            if active() {
                sse_send(&json!({ "event": name, "payload": serde_json::from_str::<Value>(e.payload()).unwrap_or(Value::Null) }).to_string());
            }
        });
    }
}

fn start() -> Result<u16, String> {
    let p = PORT.load(SeqCst);
    if p != 0 {
        return Ok(p);
    }
    let (listener, port) = WEB_PORTS
        .iter()
        .find_map(|&p| TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, p)).ok().map(|l| (l, p)))
        .ok_or_else(|| format!("порты {}–{} заняты другими программами", WEB_PORTS[0], WEB_PORTS[WEB_PORTS.len() - 1]))?;
    std::thread::Builder::new()
        .name("web-server".into())
        .spawn(move || {
            for s in listener.incoming().flatten() {
                if ACTIVE.fetch_add(1, SeqCst) >= MAX_CONN {
                    ACTIVE.fetch_sub(1, SeqCst);
                    continue;
                }
                let spawned = std::thread::Builder::new().name("web-conn".into()).spawn(move || {
                    handle(s, port);
                    ACTIVE.fetch_sub(1, SeqCst);
                });
                if spawned.is_err() {
                    ACTIVE.fetch_sub(1, SeqCst);
                }
            }
        })
        .map_err(|e| e.to_string())?;
    PORT.store(port, SeqCst);
    Ok(port)
}

fn new_key() -> Result<String, String> {
    let mut b = [0u8; 24];
    getrandom::fill(&mut b).map_err(|e| e.to_string())?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn same(a: &str, b: &str) -> bool {
    !a.is_empty() && a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ---------- HTTP ----------

struct Req {
    method: String,
    path: String,
    query: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}
impl Req {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
    fn param(&self, name: &str) -> String {
        for part in self.query.split('&') {
            if let Some((k, v)) = part.split_once('=') {
                if k == name {
                    return pct_decode(v);
                }
            }
        }
        String::new()
    }
    fn cookie(&self, name: &str) -> String {
        self.header("cookie")
            .unwrap_or("")
            .split(';')
            .filter_map(|c| c.trim().split_once('='))
            .find(|(k, _)| *k == name)
            .map(|(_, v)| v.to_string())
            .unwrap_or_default()
    }
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn read_req(s: &mut TcpStream) -> Option<Req> {
    let _ = s.set_read_timeout(Some(Duration::from_secs(30)));
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        let n = s.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break p;
        }
        if buf.len() > MAX_HEAD {
            return None;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_string();
    let target = first.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let len: usize = headers.iter().find(|(k, _)| k == "content-length").and_then(|(_, v)| v.parse().ok()).unwrap_or(0);
    if len > MAX_BODY {
        return None;
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = s.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target, String::new()),
    };
    Some(Req { method, path: pct_decode(&path), query, headers, body })
}

const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self' blob:; \
img-src 'self' data: blob: https://*.yandex.net https://*.yandex.ru https://cdn.discordapp.com/avatars/; \
media-src 'self' blob: https://*.yandex.net; connect-src 'self'; font-src 'self' data: blob:; \
object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

fn send(s: &mut TcpStream, status: &str, ctype: &str, extra: &[(&str, String)], body: &[u8]) {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\n\
         X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {CSP}\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in extra {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body);
    let _ = s.flush();
}
fn send_json(s: &mut TcpStream, status: &str, v: &Value) {
    send(s, status, "application/json; charset=utf-8", &[], v.to_string().as_bytes());
}

/// Страница «нет доступа» — вкладка без ключа или после перезапуска приложения.
fn denied(s: &mut TcpStream) {
    let html = "<!doctype html><meta charset=utf-8><title>Whisper</title><body style=\"font:16px sans-serif;padding:40px\">\
        <h2>Нет доступа</h2><p>Открой браузерную версию из приложения: Настройки → Приложение → «Открыть в браузере».</p>\
        <p>Open the browser version from the app: Settings → App → “Open in browser”.</p>";
    // style= здесь — у страницы-заглушки нет своего CSS; CSP для неё мягче
    let head = format!(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\n\
         Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nConnection: close\r\n\r\n",
        html.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(html.as_bytes());
}

fn handle(mut s: TcpStream, port: u16) {
    let Some(req) = read_req(&mut s) else { return };
    let Some(app) = APP.get().cloned() else { return };
    // только наш адрес: иначе чужой домен, указывающий на 127.0.0.1, читал бы ответы (DNS rebinding)
    let host_ok = matches!(req.header("host"), Some(h) if h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"));
    if !host_ok {
        return send(&mut s, "421 Misdirected Request", "text/plain", &[], b"");
    }
    let key = KEY.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if req.path == "/__web/start" {
        if !same(&req.param("k"), &key) {
            return denied(&mut s);
        }
        let page = asset(&app, "webstart.html").unwrap_or_default();
        return send(
            &mut s,
            "200 OK",
            "text/html; charset=utf-8",
            &[("Set-Cookie", format!("wk={key}; HttpOnly; SameSite=Strict; Path=/"))],
            &page,
        );
    }
    if !same(&req.cookie("wk"), &key) {
        return denied(&mut s);
    }
    if req.method != "GET" && req.method != "HEAD" {
        let host = req.header("host").unwrap_or("");
        let origin_ok = req.header("origin") == Some(&format!("http://{host}"));
        if !origin_ok || req.header("x-whisper") != Some("1") {
            return send(&mut s, "403 Forbidden", "text/plain", &[], b"");
        }
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("POST", "/__web/ipc") => ipc(&mut s, &app, req),
        ("GET", "/__web/events") => events(s),
        ("GET", "/__web/mode") => send_json(&mut s, "200 OK", &json!({ "web": active() })),
        ("GET", "/__web/state") => send_json(&mut s, "200 OK", &state_get()),
        ("POST", "/__web/state") => match serde_json::from_slice::<Value>(&req.body) {
            Ok(v) => {
                state_put(v);
                send_json(&mut s, "200 OK", &json!({ "ok": true }))
            }
            Err(_) => send(&mut s, "400 Bad Request", "text/plain", &[], b""),
        },
        ("GET", "/__web/stamps") => send_json(&mut s, "200 OK", &stamps()),
        ("GET", "/__web/blob") => match blob_get(&req.param("k")) {
            Some(b) => send(&mut s, "200 OK", "application/octet-stream", &[], &b),
            None => send(&mut s, "404 Not Found", "text/plain", &[], b""),
        },
        ("POST", "/__web/blob") => {
            blob_put(req.param("k"), req.param("s"), req.body);
            send_json(&mut s, "200 OK", &json!({ "ok": true }))
        }
        ("POST", "/__web/return") => {
            leave(&app);
            send_json(&mut s, "200 OK", &json!({ "ok": true }))
        }
        (m, p) if (m == "GET" || m == "HEAD") && p.starts_with("/__proto/") => proto(&mut s, &app, &req),
        (m, p) if m == "GET" || m == "HEAD" => static_file(&mut s, &app, p),
        _ => send(&mut s, "405 Method Not Allowed", "text/plain", &[], b""),
    }
}

fn asset(app: &AppHandle, path: &str) -> Option<Vec<u8>> {
    app.asset_resolver().get(path.trim_start_matches('/').to_string()).map(|a| a.bytes().to_vec())
}

fn mime_of(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "wmt" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

fn static_file(s: &mut TcpStream, app: &AppHandle, path: &str) {
    if path.split('/').any(|p| p == ".." || p.contains('\\')) {
        return send(s, "400 Bad Request", "text/plain", &[], b"");
    }
    let p = if path == "/" { "/index.html" } else { path };
    // окна, которые во вкладке не нужны (они — у приложения)
    if matches!(p, "/bridge.html" | "/mini.html" | "/notifywin.html") {
        return send(s, "404 Not Found", "text/plain", &[], b"");
    }
    let Some(mut body) = asset(app, p) else {
        return send(s, "404 Not Found", "text/plain", &[], b"");
    };
    if p == "/index.html" {
        // шим — самым первым скриптом, раньше boot.js: тот уже обращается к window.__TAURI__
        let html = String::from_utf8_lossy(&body).replacen("<head>", "<head>\n  <script src=\"/webshim.js\"></script>", 1);
        body = html.into_bytes();
    }
    send(s, "200 OK", mime_of(p), &[], &body);
}

/// ymlocal:// и wa:// — те же обработчики, что у окна (download.rs, whisper/stream.rs).
fn proto(s: &mut TcpStream, app: &AppHandle, req: &Req) {
    let rest = &req.path["/__proto/".len()..];
    let (scheme, tail) = rest.split_once('/').unwrap_or((rest, ""));
    let mut b = tauri::http::Request::builder().method(req.method.as_str()).uri(format!("http://{scheme}.localhost/{tail}"));
    for (k, v) in &req.headers {
        if matches!(k.as_str(), "range" | "if-range") {
            b = b.header(k.as_str(), v.as_str());
        }
    }
    let Ok(r) = b.body(Vec::new()) else { return send(s, "400 Bad Request", "text/plain", &[], b"") };
    let resp = match scheme {
        "ymlocal" => crate::download::serve_local(app, &r),
        "wa" => tauri::async_runtime::block_on(crate::whisper::stream::serve_stream(r)),
        _ => return send(s, "404 Not Found", "text/plain", &[], b""),
    };
    let status = resp.status();
    let mut head = format!("HTTP/1.1 {} {}\r\n", status.as_u16(), status.canonical_reason().unwrap_or(""));
    for (k, v) in resp.headers() {
        // CORS вкладке не нужен (тот же адрес), длину считаем сами
        let k = k.as_str();
        if k.starts_with("access-control-") || k == "content-length" || k == "connection" {
            continue;
        }
        if let Ok(v) = v.to_str() {
            head.push_str(&format!("{k}: {v}\r\n"));
        }
    }
    let body = resp.body();
    head.push_str(&format!("Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len()));
    let _ = s.write_all(head.as_bytes());
    if req.method != "HEAD" {
        let _ = s.write_all(body);
    }
}

// ---------- команды через переходник ----------

fn ipc(s: &mut TcpStream, app: &AppHandle, req: Req) {
    if !active() {
        return send_json(s, "409 Conflict", &json!({ "ok": false, "err": "Приложение снова открыто в окне — эта вкладка больше не управляет им" }));
    }
    let json_body = req.header("content-type").is_some_and(|c| c.starts_with("application/json"));
    let (cmd, args, raw, headers) = if json_body {
        let v: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
        (v["cmd"].as_str().unwrap_or("").to_string(), v.get("args").cloned().unwrap_or(Value::Null), None, json!({}))
    } else {
        // тело — байты (тема, резервная копия), заголовки команды — x-h-*
        let mut h = serde_json::Map::new();
        for (k, v) in &req.headers {
            if let Some(n) = k.strip_prefix("x-h-") {
                h.insert(n.to_string(), Value::String(v.clone()));
            }
        }
        (req.param("cmd"), Value::Null, Some(req.body), Value::Object(h))
    };
    let cmd_ok = !cmd.is_empty() && cmd.len() <= 80 && cmd.bytes().all(|c| c.is_ascii_alphanumeric() || b"_:|-".contains(&c));
    if !cmd_ok || cmd.starts_with("web_") {
        return send_json(s, "400 Bad Request", &json!({ "ok": false, "err": "неверная команда" }));
    }
    let id = NEXT_ID.fetch_add(1, SeqCst);
    let (tx, rx) = mpsc::channel();
    let is_raw = raw.is_some();
    CALLS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(id, Call { tx, body: raw });
    let sent = app.emit_to("main", "web-call", json!({ "id": id, "cmd": cmd, "args": args, "raw": is_raw, "headers": headers }));
    let reply = if sent.is_ok() { rx.recv_timeout(CALL_TIMEOUT).ok() } else { None };
    CALLS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).remove(&id);
    match reply {
        Some(Reply::Json(v)) => send_json(s, "200 OK", &v),
        Some(Reply::Bin(b)) => send(s, "200 OK", "application/octet-stream", &[], &b),
        None => send_json(s, "200 OK", &json!({ "ok": false, "err": "приложение не ответило" })),
    }
}

fn main_only(w: &tauri::WebviewWindow) -> Result<(), String> {
    if w.label() == "main" { Ok(()) } else { Err("только для главного окна".into()) }
}

/// Тело команды с байтами — переходник забирает его отдельно (в событии только JSON).
#[tauri::command]
pub fn web_body(window: tauri::WebviewWindow, id: u64) -> Result<tauri::ipc::Response, String> {
    main_only(&window)?;
    let mut g = CALLS.lock().unwrap_or_else(|e| e.into_inner());
    let b = g.get_or_insert_with(HashMap::new).get_mut(&id).and_then(|c| c.body.take()).unwrap_or_default();
    Ok(tauri::ipc::Response::new(b))
}

/// Ответ команды от переходника: JSON { id, ok, val | err } или байты (заголовок x-id).
#[tauri::command]
pub fn web_reply(window: tauri::WebviewWindow, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    main_only(&window)?;
    let (id, reply) = match request.body() {
        tauri::ipc::InvokeBody::Json(v) => {
            let id = v["id"].as_u64().unwrap_or(0);
            let ok = v["ok"].as_bool().unwrap_or(false);
            let r = if ok { json!({ "ok": true, "val": v.get("val").cloned().unwrap_or(Value::Null) }) } else { json!({ "ok": false, "err": v.get("err").cloned().unwrap_or(Value::Null) }) };
            (id, Reply::Json(r))
        }
        tauri::ipc::InvokeBody::Raw(b) => {
            let id = request.headers().get("x-id").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0);
            (id, Reply::Bin(b.clone()))
        }
    };
    let g = CALLS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = g.as_ref().and_then(|m| m.get(&id)) {
        let _ = c.tx.send(reply);
    }
    Ok(())
}

// ---------- события во вкладку ----------

fn sse_send(msg: &str) {
    let mut g = SSE.lock().unwrap_or_else(|e| e.into_inner());
    g.retain(|tx| tx.send(msg.to_string()).is_ok());
}

fn events(mut s: TcpStream) {
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n";
    if s.write_all(head.as_bytes()).is_err() {
        return;
    }
    let (tx, rx) = mpsc::channel::<String>();
    SSE.lock().unwrap_or_else(|e| e.into_inner()).push(tx);
    loop {
        let out = match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(m) => format!("data: {m}\n\n"),
            Err(mpsc::RecvTimeoutError::Timeout) => ": ping\n\n".to_string(), // заодно замечаем закрытую вкладку
            Err(_) => break,
        };
        if s.write_all(out.as_bytes()).and_then(|_| s.flush()).is_err() {
            break;
        }
    }
}

// ---------- перенос настроек и данных ----------

fn state_get() -> Value {
    STATE.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or(Value::Null)
}
fn state_put(v: Value) {
    // большие значения, на которые новый список больше не ссылается, не держим в памяти
    let keep: std::collections::HashSet<String> = v["idb"]
        .as_array()
        .map(|a| a.iter().filter(|e| e["type"] == "blob").filter_map(|e| e["k"].as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    BLOBS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).retain(|k, _| keep.contains(k));
    *STATE.lock().unwrap_or_else(|e| e.into_inner()) = Some(v);
}
fn stamps() -> Value {
    let g = BLOBS.lock().unwrap_or_else(|e| e.into_inner());
    Value::Object(g.as_ref().map(|m| m.iter().map(|(k, b)| (k.clone(), Value::String(b.stamp.clone()))).collect()).unwrap_or_default())
}
fn blob_get(k: &str) -> Option<Vec<u8>> {
    BLOBS.lock().unwrap_or_else(|e| e.into_inner()).as_ref()?.get(k).map(|b| b.bytes.clone())
}
fn blob_put(k: String, stamp: String, bytes: Vec<u8>) {
    if k.is_empty() || k.len() > 200 {
        return;
    }
    BLOBS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(k, Blob { stamp, bytes });
}

#[tauri::command]
pub fn web_state_put(window: tauri::WebviewWindow, state: Value) -> Result<(), String> {
    main_only(&window)?;
    state_put(state);
    Ok(())
}
#[tauri::command]
pub fn web_state_get(window: tauri::WebviewWindow) -> Result<Value, String> {
    main_only(&window)?;
    Ok(state_get())
}
#[tauri::command]
pub fn web_stamps(window: tauri::WebviewWindow) -> Result<Value, String> {
    main_only(&window)?;
    Ok(stamps())
}
#[tauri::command]
pub fn web_blob_get(window: tauri::WebviewWindow, key: String) -> Result<tauri::ipc::Response, String> {
    main_only(&window)?;
    Ok(tauri::ipc::Response::new(blob_get(&key).unwrap_or_default()))
}
/// Байты значения IndexedDB; ключ и отметка — в заголовках x-key, x-stamp (URI-кодированы).
#[tauri::command]
pub fn web_blob_put(window: tauri::WebviewWindow, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    main_only(&window)?;
    let h = |n: &str| request.headers().get(n).and_then(|v| v.to_str().ok()).map(pct_decode).unwrap_or_default();
    let tauri::ipc::InvokeBody::Raw(b) = request.body() else { return Err("ожидались байты".into()) };
    blob_put(h("x-key"), h("x-stamp"), b.clone());
    Ok(())
}

// ---------- переключение ----------

/// Окно → вкладка. Настройки страница уже положила (web_state_put / web_blob_put). Возвращает адрес вкладки.
#[tauri::command]
pub fn web_open(app: AppHandle, window: tauri::WebviewWindow) -> Result<String, String> {
    main_only(&window)?;
    use tauri_plugin_opener::OpenerExt;
    let port = start()?;
    let key = new_key()?;
    *KEY.lock().unwrap_or_else(|e| e.into_inner()) = key.clone();
    let url = format!("http://127.0.0.1:{port}/__web/start?k={key}");
    app.opener().open_url(&url, None::<&str>).map_err(|e| format!("браузер не открылся: {e}"))?;
    WEB.store(true, SeqCst);
    // окно — переходник: без интерфейса и плеера
    let mut u = window.url().map_err(|e| e.to_string())?;
    u.set_path("/bridge.html");
    u.set_query(None);
    u.set_fragment(None);
    let _ = window.hide();
    window.navigate(u).map_err(|e| e.to_string())?;
    Ok(url)
}

/// Вкладка → окно: переходник забирает настройки и потом зовёт web_finish. Вкладке — «вернулись в приложение».
pub fn leave(app: &AppHandle) {
    if !active() {
        return;
    }
    sse_send(&json!({ "event": "web-return", "payload": Value::Null }).to_string());
    let _ = app.emit_to("main", "web-return", ());
}

/// Переходник перенёс настройки — окно снова приложение.
#[tauri::command]
pub fn web_finish(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    main_only(&window)?;
    WEB.store(false, SeqCst);
    // ждущие ответа команды вкладки — сразу с ошибкой
    if let Some(m) = CALLS.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        for (_, c) in m.drain() {
            let _ = c.tx.send(Reply::Json(json!({ "ok": false, "err": "приложение снова открыто в окне" })));
        }
    }
    KEY.lock().unwrap_or_else(|e| e.into_inner()).clear(); // старая вкладка больше ничего не может
    let mut u = window.url().map_err(|e| e.to_string())?;
    u.set_path("/index.html");
    u.set_query(None);
    window.navigate(u).map_err(|e| e.to_string())?;
    crate::show_main(&app);
    Ok(())
}

#[tauri::command]
pub fn web_active() -> bool {
    active()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decode() {
        assert_eq!(pct_decode("a%20b+c"), "a b c");
        assert_eq!(pct_decode("theme%3Aneo"), "theme:neo");
        assert_eq!(pct_decode("100%"), "100%");
        assert_eq!(pct_decode("%zz"), "%zz");
    }
    #[test]
    fn keys() {
        assert!(same("abc", "abc"));
        assert!(!same("", ""));
        assert!(!same("abc", "abd"));
    }
}
