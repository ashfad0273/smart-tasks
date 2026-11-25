//! Clipboard sync, the local half: notices when you copy something (text or an
//! image) and writes what your other computers copied. The web side encrypts and
//! relays it (desktop/web/clip.ts).
//!
//! Watching is cheap: every 250 ms the OS clipboard's change counter is read
//! (NSPasteboard.changeCount / GetClipboardSequenceNumber), and the content is only
//! read when that number moves. Writes we make ourselves are remembered so they
//! are not sent straight back. An emptied clipboard is never sent: clearing on one
//! computer leaves the others alone.

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use arboard::{Clipboard, ImageData};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Larger copies are skipped (the relay keeps at most this much).
const MAX_BYTES: usize = 20 * 1024 * 1024;

static ON: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);
/// Change counter after our own last write (or when watching started): not a new copy.
static SEEN: Mutex<i64> = Mutex::new(-1);
/// The last copied image as PNG, until the web side takes it.
static IMAGE: Mutex<Option<Vec<u8>>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn counter() -> i64 {
    use objc2_app_kit::NSPasteboard;
    NSPasteboard::generalPasteboard().changeCount() as i64
}

#[cfg(windows)]
fn counter() -> i64 {
    // SAFETY: plain Win32 call with no arguments.
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() as i64 }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn counter() -> i64 {
    0
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Local {
    Text { text: String },
    Image { bytes: usize },
}

fn encode_png(img: &ImageData) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(Cursor::new(&mut out), img.width as u32, img.height as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut w = enc.write_header().ok()?;
        w.write_image_data(&img.bytes).ok()?;
    }
    Some(out)
}

fn decode_png(bytes: &[u8]) -> Result<ImageData<'static>, String> {
    let mut dec = png::Decoder::new(Cursor::new(bytes));
    dec.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
    let mut reader = dec.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or("image too large")?];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::GrayscaleAlpha => buf.chunks(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        _ => return Err("unsupported image".into()),
    };
    Ok(ImageData { width: info.width as usize, height: info.height as usize, bytes: rgba.into() })
}

/// Reads what was just copied: text first (most copies), otherwise an image.
fn read(cb: &mut Clipboard) -> Option<Local> {
    if let Ok(text) = cb.get_text() {
        if !text.is_empty() && text.len() <= MAX_BYTES {
            return Some(Local::Text { text });
        }
        if !text.is_empty() {
            return None;
        }
    }
    let img = cb.get_image().ok()?;
    if img.width == 0 || img.height == 0 {
        return None;
    }
    let png = encode_png(&img)?;
    if png.len() > MAX_BYTES {
        return None;
    }
    let bytes = png.len();
    *IMAGE.lock().unwrap() = Some(png);
    Some(Local::Image { bytes })
}

fn watch(app: AppHandle) {
    let mut cb = match Clipboard::new() {
        Ok(cb) => cb,
        Err(_) => return,
    };
    loop {
        std::thread::sleep(Duration::from_millis(250));
        if !ON.load(Ordering::Relaxed) {
            continue;
        }
        let now = counter();
        {
            let mut seen = SEEN.lock().unwrap();
            if now == *seen {
                continue;
            }
            *seen = now;
        }
        if let Some(item) = read(&mut cb) {
            let _ = app.emit("clip-local", item);
        }
    }
}

/// Start or stop watching. Whatever is on the clipboard when it starts is not sent.
#[tauri::command]
pub fn clip_watch(app: AppHandle, on: bool) {
    *SEEN.lock().unwrap() = counter();
    ON.store(on, Ordering::Relaxed);
    if on && !STARTED.swap(true, Ordering::Relaxed) {
        std::thread::spawn(move || watch(app));
    }
}

/// The image announced by the last "clip-local" event, as PNG bytes.
#[tauri::command]
pub fn clip_take_image() -> tauri::ipc::Response {
    tauri::ipc::Response::new(IMAGE.lock().unwrap().take().unwrap_or_default())
}

/// Puts text from another computer on this clipboard (and doesn't send it back).
#[tauri::command]
pub fn clip_write_text(text: String) -> Result<(), String> {
    let mut seen = SEEN.lock().unwrap();
    Clipboard::new().and_then(|mut cb| cb.set_text(text)).map_err(|e| e.to_string())?;
    *seen = counter();
    Ok(())
}

/// Puts an image (PNG bytes as the raw request body) from another computer on this clipboard.
#[tauri::command]
pub fn clip_write_image(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected image bytes".into());
    };
    let img = decode_png(bytes)?;
    let mut seen = SEEN.lock().unwrap();
    Clipboard::new().and_then(|mut cb| cb.set_image(img)).map_err(|e| e.to_string())?;
    *seen = counter();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_round_trip() {
        let bytes: Vec<u8> = (0..(7 * 5 * 4)).map(|i| (i * 37 % 256) as u8).collect();
        let img = ImageData { width: 7, height: 5, bytes: bytes.clone().into() };
        let png = encode_png(&img).expect("encode");
        let back = decode_png(&png).expect("decode");
        assert_eq!((back.width, back.height), (7, 5));
        assert_eq!(back.bytes.as_ref(), bytes.as_slice());
    }
}
