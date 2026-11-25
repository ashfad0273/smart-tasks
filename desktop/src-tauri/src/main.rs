//! Smart Tasks for Windows and macOS: a thin Rust shell around the extension's own UI.
//!
//! The web side (desktop/web) runs the shared extension code; this side adds
//! what a browser can't: the window and tray (menu bar on macOS), notifications
//! with buttons, the taskbar / Dock badge, start at login, the global shortcut,
//! a loopback port the Chrome extension asks before notifying (which also
//! receives Google sign-in from the default browser) and updates.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clip;
mod presence;
mod system;
mod toast;

use std::time::Duration;

use serde::Serialize;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::Color,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

const MAIN: &str = "main";
const TRAY: &str = "tray";
#[cfg(target_os = "macos")]
const SHORTCUT: &str = "cmd+alt+k";
#[cfg(not(target_os = "macos"))]
const SHORTCUT: &str = "ctrl+alt+k";
/// The same shortcut, as the tray menu shows it.
#[cfg(target_os = "macos")]
const SHORTCUT_LABEL: &str = "Cmd+Alt+K";
#[cfg(not(target_os = "macos"))]
const SHORTCUT_LABEL: &str = "Ctrl+Alt+K";

/// Hidden windows keep running at full speed so reminders fire on time and
/// the agent chime can play without a click. (The first flag is Tauri's default.)
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
    --disable-background-timer-throttling --disable-renderer-backgrounding \
    --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required";

/* ── window ──────────────────────────────────────────────────────────────── */

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

fn show(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show(app);
        }
    }
}

fn build_window(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Smart Tasks")
        .inner_size(1100.0, 720.0)
        .min_inner_size(400.0, 600.0)
        .resizable(true)
        .maximizable(true)
        .center()
        .visible(visible)
        .background_color(Color(16, 25, 28, 255))
        .additional_browser_args(BROWSER_ARGS)
        // Tauri's file-drop handler swallows HTML5 drag and drop on Windows;
        // the app drags tasks onto categories, and never takes dropped files.
        .disable_drag_drop_handler()
        .build()?;
    // Closing hides to the tray: sync and reminders keep running. Quit lives in the tray menu.
    let handle = w.clone();
    w.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = handle.hide();
        }
    });
    Ok(())
}

/* ── tray ────────────────────────────────────────────────────────────────── */

struct TrayItems {
    startup: CheckMenuItem<tauri::Wry>,
    reminders: CheckMenuItem<tauri::Wry>,
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Smart Tasks", true, Some(SHORTCUT_LABEL))?;
    let sync = MenuItem::with_id(app, "sync", "Sync now", true, None::<&str>)?;
    let startup = CheckMenuItem::with_id(app, "startup", system::AUTOSTART_LABEL, true, system::autostart_enabled(), None::<&str>)?;
    let reminders = CheckMenuItem::with_id(app, "reminders", "Reminders", true, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Smart Tasks", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &sync,
            &PredefinedMenuItem::separator(app)?,
            &startup,
            &reminders,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(TrayItems { startup: startup.clone(), reminders: reminders.clone() });

    TrayIconBuilder::with_id(TRAY)
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .tooltip("Smart Tasks")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => show(app),
            "sync" => {
                let _ = app.emit("tray-sync", ());
            }
            "startup" => {
                let on = !system::autostart_enabled();
                let _ = system::set_autostart(on);
                let _ = app.state::<TrayItems>().startup.set_checked(system::autostart_enabled());
            }
            "reminders" => {
                let items = app.state::<TrayItems>();
                let on = items.reminders.is_checked().unwrap_or(true);
                let _ = app.emit("tray-reminders", on);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/* ── commands (called from desktop/web) ─────────────────────────────────── */

#[tauri::command]
fn show_window(app: AppHandle) {
    show(&app);
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    system::open_url(&url)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn notify(
    app: AppHandle,
    id: String,
    title: String,
    message: String,
    context: Option<String>,
    buttons: Vec<String>,
    sticky: bool,
    silent: bool,
) -> Result<(), String> {
    toast::show(&app, toast::Toast { id, title, message, context, buttons, sticky, silent })
}

/// Plain text to the system clipboard (the "Copy prompt" notification button).
/// The webview can't write the clipboard while the window is hidden, so the OS tool does it.
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("pbcopy");
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("clip");
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash
        c
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let mut cmd = Command::new("xclip");
    #[cfg(not(any(target_os = "macos", windows)))]
    cmd.args(["-selection", "clipboard"]);
    let mut child = cmd.stdin(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    // clip.exe reads UTF-16 when the text starts with a BOM; plain ASCII prompts need nothing special.
    child.stdin.take().ok_or("no stdin")?.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

/// Badge from the web side: tray icon and taskbar overlay already drawn as
/// 32×32 RGBA (Windows), and the plain count for the Dock (macOS).
#[tauri::command]
fn set_badge(app: AppHandle, tooltip: String, tray: Vec<u8>, overlay: Option<Vec<u8>>, text: Option<String>) -> Result<(), String> {
    let err = |e: tauri::Error| e.to_string();
    if let Some(t) = app.tray_by_id(TRAY) {
        if tray.len() == 32 * 32 * 4 {
            t.set_icon(Some(Image::new_owned(tray, 32, 32))).map_err(err)?;
        }
        t.set_tooltip(Some(tooltip)).map_err(err)?;
    }
    if let Some(w) = main_window(&app) {
        #[cfg(windows)]
        {
            let _ = &text;
            let icon = overlay.filter(|o| o.len() == 32 * 32 * 4).map(|o| Image::new_owned(o, 32, 32));
            w.set_overlay_icon(icon).map_err(err)?;
        }
        #[cfg(target_os = "macos")]
        {
            let _ = overlay;
            w.set_badge_label(text.filter(|t| !t.is_empty())).map_err(err)?;
        }
    }
    Ok(())
}

/// Start-at-login state, for the switch in Settings.
#[tauri::command]
fn idle_seconds() -> u64 {
    system::idle_seconds()
}

#[tauri::command]
fn get_autostart() -> bool {
    system::autostart_enabled()
}

/// Turn start-at-login on or off from Settings; keeps the tray checkbox in step.
#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) -> bool {
    let _ = system::set_autostart(on);
    let now = system::autostart_enabled();
    let _ = app.state::<TrayItems>().startup.set_checked(now);
    now
}

/// Which accounts this app notifies for (answered to the Chrome extension).
#[tauri::command]
fn set_presence(app: AppHandle, reminders: Vec<String>, agent: Vec<String>, reminders_on: bool) {
    presence::set(reminders, agent);
    let _ = app.state::<TrayItems>().reminders.set_checked(reminders_on);
}

/// Google sign-in in the default browser. The web side builds Google's URL
/// with redirect_uri = `redirect` (http://127.0.0.1:47813/google); the
/// loopback server (presence.rs) catches the redirect and hands back the
/// fragment, which we return as the full redirect URL, the same shape
/// chrome.identity.launchWebAuthFlow gives the extension.
#[tauri::command]
async fn google_auth(app: AppHandle, url: String, redirect: String) -> Result<String, String> {
    if !url.starts_with("https://accounts.google.com/") {
        return Err("Bad sign-in URL".into());
    }
    let rx = presence::expect_google()?;
    system::open_url(&url)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(10 * 60)).unwrap_or_else(|_| Err("Sign-in was cancelled.".into()))
    })
    .await
    .map_err(|e| e.to_string())?;
    // Back from the browser: bring the app forward.
    show(&app);
    result.map(|fragment| format!("{redirect}#{fragment}"))
}

#[derive(Serialize)]
struct UpdateMeta {
    version: String,
    notes: String,
    date: Option<String>,
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<UpdateMeta>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateMeta {
        version: u.version.clone(),
        notes: u.body.clone().unwrap_or_default(),
        date: u.date.map(|d| d.date().to_string()),
    }))
}

/// Downloads the signed installer, checks its signature and runs it
/// (quietly; it restarts the app when done).
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Err("Already up to date.".into());
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

/* ── main ────────────────────────────────────────────────────────────────── */

fn main() {
    let hidden = std::env::args().any(|a| a == "--hidden");

    tauri::Builder::default()
        // Second launch (Start menu, shortcut): bring up the running copy instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, e| {
                    if e.state == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            show_window,
            idle_seconds,
            open_url,
            notify,
            copy_text,
            clip::clip_watch,
            clip::clip_take_image,
            clip::clip_write_text,
            clip::clip_write_image,
            set_badge,
            set_presence,
            google_auth,
            check_update,
            install_update,
            get_autostart,
            set_autostart
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            toast::register(&handle);
            system::first_run_autostart(&handle);
            build_window(&handle, !hidden)?;
            build_tray(&handle)?;
            // Taken by another app: carry on without it.
            let _ = handle.global_shortcut().register(SHORTCUT);
            presence::serve();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting Smart Tasks")
        .run(|_app, _event| {
            // macOS: clicking the Dock icon brings the (hidden) window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show(_app);
            }
        });
}
