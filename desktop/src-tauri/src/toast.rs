//! Notifications with buttons: Windows toasts, or macOS Notification Center
//! banners. Clicks come back to the web side as a `toast` event:
//! {id, button: null | index}, which the chrome.notifications shim turns into
//! onClicked / onButtonClicked.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "macos")]
pub use macos::{register, show};
#[cfg(windows)]
pub use windows::{register, show};

pub struct Toast {
    pub id: String,
    pub title: String,
    pub message: String,
    pub context: Option<String>,
    pub buttons: Vec<String>,
    pub sticky: bool,
    pub silent: bool,
}

#[derive(Serialize, Clone)]
struct Activated {
    id: String,
    button: Option<u32>,
}

fn activated(app: &AppHandle, id: String, button: Option<u32>) {
    let _ = app.emit("toast", Activated { id, button });
}

/* ── Windows ─────────────────────────────────────────────────────────────── */

#[cfg(windows)]
mod windows {
    use std::path::PathBuf;
    use std::sync::OnceLock;

    use tauri::{AppHandle, Manager};
    use tauri_winrt_notification::{Duration, IconCrop, Scenario, Toast as WinToast};
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    use super::{activated, Toast};

    static APP_ID: OnceLock<String> = OnceLock::new();
    static ICON: OnceLock<PathBuf> = OnceLock::new();

    const ICON_PNG: &[u8] = include_bytes!("../icons/128x128.png");

    /// Unpackaged apps need their AppUserModelID registered (name + icon) for
    /// Windows to show their toasts. The installer's Start menu shortcut carries
    /// the same ID, so toasts group under "Smart Tasks" either way.
    pub fn register(app: &AppHandle) {
        let id = app.config().identifier.clone();
        let icon = app
            .path()
            .app_local_data_dir()
            .map(|d| d.join("toast-icon.png"))
            .ok()
            .and_then(|p| {
                std::fs::create_dir_all(p.parent()?).ok()?;
                std::fs::write(&p, ICON_PNG).ok()?;
                Some(p)
            });
        if let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(format!("Software\\Classes\\AppUserModelId\\{id}")) {
            let _ = key.set_value("DisplayName", &"Smart Tasks");
            if let Some(p) = &icon {
                let _ = key.set_value("IconUri", &p.to_string_lossy().to_string());
            }
        }
        let _ = APP_ID.set(id);
        if let Some(p) = icon {
            let _ = ICON.set(p);
        }
    }

    pub fn show(app: &AppHandle, t: Toast) -> Result<(), String> {
        let app_id = APP_ID.get().map(String::as_str).unwrap_or(WinToast::POWERSHELL_APP_ID);
        let mut toast = WinToast::new(app_id).title(&t.title).text1(&t.message);
        if let Some(ctx) = &t.context {
            toast = toast.text2(ctx);
        }
        if let Some(icon) = ICON.get() {
            toast = toast.icon(icon, IconCrop::Square, "");
        }
        for (i, label) in t.buttons.iter().enumerate() {
            toast = toast.add_button(label, &i.to_string());
        }
        if t.sticky && !t.buttons.is_empty() {
            // Stays on screen until handled, like requireInteraction in Chrome.
            toast = toast.scenario(Scenario::Reminder);
        } else {
            toast = toast.duration(Duration::Short);
        }
        if t.silent {
            toast = toast.sound(None);
        }
        let handle = app.clone();
        let id = t.id;
        toast
            .on_activated(move |action| {
                activated(&handle, id.clone(), action.and_then(|a| a.parse::<u32>().ok()));
                Ok(())
            })
            .show()
            .map_err(|e| e.to_string())
    }
}

/* ── macOS ───────────────────────────────────────────────────────────────── */

#[cfg(target_os = "macos")]
mod macos {
    use mac_notification_sys::{set_application, MainButton, Notification, NotificationResponse};
    use tauri::AppHandle;

    use super::{activated, Toast};

    /// Banners are delivered on behalf of our bundle id (name and icon come
    /// from the installed .app). In a dev run there is no bundle: macOS then
    /// shows them under the default app instead.
    pub fn register(app: &AppHandle) {
        let _ = set_application(&app.config().identifier);
    }

    /// Notification Center offers one action button plus an "other" button:
    /// one button → the action; two (Done / Snooze) → action + other;
    /// more → an options drop-down. Sending blocks until the user responds,
    /// so each banner waits on its own thread.
    pub fn show(app: &AppHandle, t: Toast) -> Result<(), String> {
        let app = app.clone();
        // Banner vs alert (stays until handled) is the user's choice in System Settings.
        let _ = t.sticky;
        std::thread::spawn(move || {
            let labels: Vec<&str> = t.buttons.iter().map(String::as_str).collect();
            let mut n = Notification::new();
            n.title(&t.title).message(&t.message).maybe_subtitle(t.context.as_deref());
            match labels.as_slice() {
                [] => {}
                [one] => {
                    n.main_button(MainButton::SingleAction(one));
                }
                [first, second] => {
                    n.main_button(MainButton::SingleAction(first)).close_button(second);
                }
                all => {
                    n.main_button(MainButton::DropdownActions("Options", all));
                }
            }
            if !t.silent {
                n.default_sound();
            }
            n.wait_for_click(true);
            let index = |name: &str| t.buttons.iter().position(|b| b == name).map(|i| i as u32);
            match n.send() {
                Ok(NotificationResponse::Click) => activated(&app, t.id.clone(), None),
                Ok(NotificationResponse::ActionButton(name)) | Ok(NotificationResponse::CloseButton(name)) => {
                    if let Some(i) = index(&name) {
                        activated(&app, t.id.clone(), Some(i));
                    }
                }
                _ => {}
            }
        });
        Ok(())
    }
}
