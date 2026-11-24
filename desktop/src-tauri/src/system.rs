//! Start at login (Windows: HKCU Run key; macOS: a LaunchAgent) and opening
//! links in the default browser.

use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
pub use macos::{autostart_enabled, set_autostart};
#[cfg(windows)]
pub use windows::{autostart_enabled, set_autostart};

/// The tray item's label for the start-at-login checkbox.
pub const AUTOSTART_LABEL: &str = if cfg!(target_os = "macos") { "Open at Login" } else { "Start with Windows" };

/* ── Windows ─────────────────────────────────────────────────────────────── */

#[cfg(windows)]
mod windows {
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE},
        RegKey,
    };

    const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const RUN_VALUE: &str = "Smart Tasks";

    fn run_key() -> std::io::Result<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_READ | KEY_WRITE)
    }

    pub fn autostart_enabled() -> bool {
        run_key().and_then(|k| k.get_value::<String, _>(RUN_VALUE)).is_ok()
    }

    pub fn set_autostart(on: bool) -> std::io::Result<()> {
        let key = run_key()?;
        if on {
            let exe = std::env::current_exe()?;
            // Starts straight to the tray.
            key.set_value(RUN_VALUE, &format!("\"{}\" --hidden", exe.display()))
        } else {
            key.delete_value(RUN_VALUE).or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) })
        }
    }
}

/* ── macOS ───────────────────────────────────────────────────────────────── */

#[cfg(target_os = "macos")]
mod macos {
    use std::path::PathBuf;

    const LABEL: &str = "dev.smarttasks.desktop";

    fn plist() -> std::io::Result<PathBuf> {
        let home = std::env::var_os("HOME").ok_or_else(|| std::io::Error::other("HOME is not set"))?;
        Ok(PathBuf::from(home).join("Library/LaunchAgents").join(format!("{LABEL}.plist")))
    }

    pub fn autostart_enabled() -> bool {
        plist().map(|p| p.exists()).unwrap_or(false)
    }

    fn xml_escape(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    }

    /// A per-user LaunchAgent that opens the app at login, straight to the menu bar.
    pub fn set_autostart(on: bool) -> std::io::Result<()> {
        let path = plist()?;
        if !on {
            return std::fs::remove_file(&path).or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) });
        }
        let exe = std::env::current_exe()?;
        let body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>{}</string><string>--hidden</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
"#,
            xml_escape(&exe.to_string_lossy())
        );
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, body)
    }
}

/* ── shared ──────────────────────────────────────────────────────────────── */

/// On by default (reminders should survive a reboot), once: after that the
/// tray checkbox is the user's call. Dev builds never register themselves.
pub fn first_run_autostart(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let Ok(dir) = app.path().app_local_data_dir() else { return };
    let marker = dir.join("autostart-set");
    if marker.exists() {
        // Keep the registered path current (the app moves when reinstalled elsewhere).
        if autostart_enabled() {
            let _ = set_autostart(true);
        }
        return;
    }
    if set_autostart(true).is_ok() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(marker, b"1");
    }
}

/// http(s) links only, in the default browser (no console window on Windows).
pub fn open_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web links can be opened.".into());
    }
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Seconds since the last keyboard or mouse input anywhere on this computer
/// (phones use it to decide whether you are away). 0 where it can't be read.
#[cfg(windows)]
pub fn idle_seconds() -> u64 {
    #[repr(C)]
    struct LastInputInfo {
        size: u32,
        time: u32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
    }
    let mut info = LastInputInfo { size: std::mem::size_of::<LastInputInfo>() as u32, time: 0 };
    // SAFETY: plain Win32 calls with a correctly sized struct.
    unsafe {
        if GetLastInputInfo(&mut info) == 0 {
            return 0;
        }
        u64::from(GetTickCount().wrapping_sub(info.time)) / 1000
    }
}

#[cfg(target_os = "macos")]
pub fn idle_seconds() -> u64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }
    // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = !0.
    // SAFETY: a pure query with constant arguments.
    let s = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
    if s.is_finite() && s > 0.0 { s as u64 } else { 0 }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn idle_seconds() -> u64 {
    0
}
