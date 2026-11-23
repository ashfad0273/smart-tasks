//! Loopback endpoint the Chrome extension asks before showing a notification
//! (lib/desktop.ts): "is the desktop app covering this account?". If yes, the
//! extension stays quiet and the app's toast is the only one.
//!
//!   GET http://127.0.0.1:47813/v1/handles?kind=reminders|agent&uid=…  →  {"handles":true|false}
//!
//! Only answers about an account id the caller already knows, and only
//! extension origins may read the answer (CORS), so web pages learn nothing.
//!
//! It is also where Google sign-in lands: the app opens Google in the default
//! browser with redirect_uri http://127.0.0.1:47813/google. Google puts the ID
//! token in the URL fragment, which never reaches a server, so that page hands
//! the fragment to /google/done, which passes it to the waiting sign-in. Only
//! while a sign-in is in progress, and only once.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, RwLock};
use std::time::Duration;

pub const PORT: u16 = 47813;

static STATE: RwLock<(Vec<String>, Vec<String>)> = RwLock::new((Vec::new(), Vec::new()));
static LISTENING: AtomicBool = AtomicBool::new(false);
type SignIn = mpsc::Sender<Result<String, String>>;
static GOOGLE: Mutex<Option<SignIn>> = Mutex::new(None);

/// Start waiting for Google's redirect. A sign-in already waiting is cancelled.
pub fn expect_google() -> Result<mpsc::Receiver<Result<String, String>>, String> {
    if !LISTENING.load(Ordering::Relaxed) {
        return Err(format!("Google sign-in needs port {PORT}, which another app is using."));
    }
    let (tx, rx) = mpsc::channel();
    if let Some(old) = GOOGLE.lock().map_err(|e| e.to_string())?.replace(tx) {
        let _ = old.send(Err("Sign-in was cancelled.".into()));
    }
    Ok(rx)
}

const GOOGLE_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Smart Tasks</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10191c;color:#fff;font:15px -apple-system,"Segoe UI",system-ui,sans-serif;text-align:center}
.c{padding:32px}h1{font-size:22px;margin:16px 0 6px}p{color:#798a8e;margin:0}.i{width:56px;height:56px;border-radius:16px;margin:auto;background:linear-gradient(135deg,#6ff0dc,#2794bd);display:grid;place-items:center;font-size:30px;color:#0b1a1c;font-weight:700}</style>
<div class="c"><div class="i">&#10003;</div><h1 id="t">Signing you in&hellip;</h1><p id="m">One moment.</p></div>
<script>
var q = location.hash.slice(1) || location.search.slice(1);
fetch('/google/done?' + q).then(function (r) {
  var ok = r.ok && /id_token=/.test(q);
  document.getElementById('t').textContent = ok ? 'You’re signed in' : 'Sign-in didn’t finish';
  document.getElementById('m').textContent = ok ? 'You can close this tab and go back to Smart Tasks.' : 'Go back to Smart Tasks and try again.';
  history.replaceState(null, '', '/google');
  if (ok) setTimeout(function () { window.close(); }, 1500);
});
</script>"#;

pub fn set(reminders: Vec<String>, agent: Vec<String>) {
    if let Ok(mut s) = STATE.write() {
        *s = (reminders, agent);
    }
}

pub fn serve() {
    // Port taken (another copy, another app): the extension simply keeps notifying.
    let Ok(listener) = TcpListener::bind(("127.0.0.1", PORT)) else { return };
    LISTENING.store(true, Ordering::Relaxed);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let _ = handle(stream);
        }
    });
}

fn handle(mut s: TcpStream) -> std::io::Result<()> {
    s.set_read_timeout(Some(Duration::from_secs(2)))?;
    // Read the request head (the sign-in callback carries a ~1-2 KB token).
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    while buf.len() < 32 * 1024 && !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = s.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let req = String::from_utf8_lossy(&buf);
    let mut lines = req.lines();
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, target) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    let origin = lines
        .take_while(|l| !l.is_empty())
        .find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("origin")).map(|(_, v)| v.trim().to_string()));

    let mut cors = String::new();
    if let Some(o) = origin.filter(|o| o.starts_with("chrome-extension://")) {
        cors = format!(
            "Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Private-Network: true\r\n"
        );
    }

    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let mut content_type = "application/json";
    let (status, body) = match (method, path) {
        ("OPTIONS", _) => ("204 No Content", String::new()),
        ("GET", "/google") => {
            content_type = "text/html; charset=utf-8";
            ("200 OK", GOOGLE_PAGE.to_string())
        }
        ("GET", "/google/done") => match GOOGLE.lock().ok().and_then(|mut g| g.take()) {
            Some(tx) => {
                let _ = tx.send(Ok(query.to_string()));
                ("200 OK", "{}".into())
            }
            None => ("410 Gone", "{}".into()),
        },
        ("GET", "/v1/handles") => {
            let param = |name: &str| {
                query.split('&').find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == name).map(|(_, v)| decode(v)))
            };
            let uid = param("uid").unwrap_or_default();
            let handles = STATE.read().map(|s| {
                let list = if param("kind").as_deref() == Some("agent") { &s.1 } else { &s.0 };
                !uid.is_empty() && list.iter().any(|u| *u == uid)
            });
            ("200 OK", format!("{{\"handles\":{}}}", handles.unwrap_or(false)))
        }
        _ => ("404 Not Found", "{}".into()),
    };
    write!(
        s,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nCache-Control: no-store\r\n{cors}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Minimal %XX / + decoding for the query string.
fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 3;
                        continue;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
