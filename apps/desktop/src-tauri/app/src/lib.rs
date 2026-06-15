//! Nibbin Observer — Tauri 2 shell. A client of observerd: renders daemon
//! state, hosts the consent/review/Field-Notes/account UI, registers the C6
//! global pause hotkey, and runs the system-browser + nibbin://auth deep-link
//! sign-in (§6.1). No privacy invariant depends on this process being alive.

mod auth;
mod commands;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// C6 — the global pause hotkey. The handler appends a pause command to the
/// daemon's control channel; the daemon's atomic gate kills forwarding. The
/// hotkey→file→gate path is timed in the bring-up checklist (<100ms budget;
/// the gate itself is wait-free, see nibbin-capture::gate).
const PAUSE_SHORTCUT: &str = "CmdOrCtrl+Shift+.";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, _event| {
                    if let Err(e) = commands::write_control(app, "{\"cmd\":\"pause\"}") {
                        eprintln!("pause hotkey failed to reach daemon: {e}");
                    }
                    let _ = app.emit("study:paused-by-hotkey", ());
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::study_status,
            commands::send_control,
            commands::review_events,
            commands::review_delete,
            commands::review_keep,
            commands::add_exclusion,
            auth::store_session,
            auth::auth_session,
            auth::sign_out,
        ])
        .setup(|app| {
            if let Err(e) = app.global_shortcut().register(PAUSE_SHORTCUT) {
                eprintln!("pause hotkey unavailable (continuing without it): {e}");
                let _ = app.handle().emit("study:hotkey-unavailable", e.to_string());
            }

            // tray: the study countdown is ALWAYS visible while a study runs
            // (SPEC §5); the value is daemon-derived (daemon.status), the
            // tray only displays it.
            let open = MenuItemBuilder::with_id("open", "Open Nibbin").build(app)?;
            let pause = MenuItemBuilder::with_id("pause", "Pause capture").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open, &pause]).build()?;
            TrayIconBuilder::with_id("observer-tray")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "pause" => {
                        let _ = commands::write_control(app, "{\"cmd\":\"pause\"}");
                    }
                    _ => {}
                })
                .build(app)?;

            // countdown refresher: read daemon.status once a second and push
            // it to the webview + tray tooltip
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                if let Ok(status) = commands::read_status(&handle) {
                    let _ = handle.emit("study:status", &status);
                    if let Some(tray) = handle.tray_by_id("observer-tray") {
                        let remaining_ms = status
                            .get("remaining_ms")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);
                        let days = remaining_ms / 86_400_000;
                        let hours = (remaining_ms % 86_400_000) / 3_600_000;
                        let _ = tray.set_tooltip(Some(format!(
                            "Nibbin — field study: {days}d {hours}h left"
                        )));
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Observer shell");
}
