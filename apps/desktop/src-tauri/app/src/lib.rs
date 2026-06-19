//! Nibbin Observer — Tauri 2 shell. A client of observerd: renders daemon
//! state, hosts the consent/review/Field-Notes/account UI, registers the C6
//! global pause hotkey, and runs the system-browser + nibbin://auth deep-link
//! sign-in (§6.1). No privacy invariant depends on this process being alive.

mod auth;
mod commands;
pub mod daemon_supervisor;
mod update;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// C6 — the global pause hotkey. The handler appends a pause command to the
/// daemon's control channel; the daemon's atomic gate kills forwarding. The
/// gate flip is wait-free, but the end-to-end hotkey→file→daemon-poll→gate path
/// is bounded by the daemon's poll interval (~250ms) — not a sub-100ms number
/// (see nibbin-capture::gate; gate #22).
const PAUSE_SHORTCUT: &str = "CmdOrCtrl+Shift+.";

/// The hosted web origin embedded in the Grove tab. Pinned at build time;
/// override with NIBBIN_WEB_URL for dev/staging. Defaults to production.
fn web_url() -> &'static str {
    option_env!("NIBBIN_WEB_URL").unwrap_or("https://nibbin.com")
}

/// Vertical offset where the Grove child webview starts, leaving the native
/// tab bar (rendered by the main webview) visible above it.
const GROVE_TOP_PX: f64 = 96.0;

fn grove_bounds(window: &tauri::Window) -> (tauri::LogicalPosition<f64>, tauri::LogicalSize<f64>) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let phys = window
        .inner_size()
        .unwrap_or(tauri::PhysicalSize::new(1040, 720));
    let (w, h) = (phys.width as f64 / scale, phys.height as f64 / scale);
    (
        tauri::LogicalPosition::new(0.0, GROVE_TOP_PX),
        tauri::LogicalSize::new(w, (h - GROVE_TOP_PX).max(0.0)),
    )
}

/// The Grove webview's target URL + an optional init script. With
/// NIBBIN_GROVE_HANDOFF set (a build-time flag — flip on only once /desktop-auth
/// is live on the embedded origin), a signed-in user is handed off to
/// /desktop-auth with the session injected OUT-OF-BAND via an init script —
/// NEVER in the URL (security: secrets-in-URLs leak via history / script access).
/// Otherwise (and whenever signed out) it loads /app directly.
fn grove_setup() -> (String, Option<String>) {
    let base = web_url();
    if option_env!("NIBBIN_GROVE_HANDOFF").is_some() {
        if let Some((access, refresh)) = auth::session_tokens() {
            // JSON-encode the values so they embed safely in JS (no injection).
            let a = serde_json::to_string(&access).unwrap_or_else(|_| "\"\"".into());
            let r = serde_json::to_string(&refresh).unwrap_or_else(|_| "\"\"".into());
            let script =
                format!("window.__NIBBIN_HANDOFF__={{access_token:{a},refresh_token:{r}}};");
            return (format!("{base}/desktop-auth"), Some(script));
        }
    }
    (format!("{base}/app"), None)
}

/// Show the Grove tab's embedded web product, creating the child webview on
/// first use (lazily — it only loads when the user opens Grove).
#[tauri::command]
async fn grove_show(window: tauri::Window) -> Result<(), String> {
    let (pos, size) = grove_bounds(&window);
    if let Some(wv) = window.app_handle().get_webview("grove") {
        let _ = wv.set_position(pos);
        let _ = wv.set_size(size);
        return wv.show().map_err(|e| e.to_string());
    }
    let (target, script) = grove_setup();
    let parsed: url::Url = target.parse().map_err(|e| format!("bad grove url: {e}"))?;
    // Lock the Grove webview to the configured web origin's host. The tab only
    // ever loads web_url() and stays there, so same-host navigations (and their
    // subpaths) must keep working — but a redirect to attacker content is
    // rejected (defense-in-depth for the injected handoff token + containment).
    let allowed_host = web_url()
        .parse::<url::Url>()
        .ok()
        .and_then(|u| u.host_str().map(str::to_string));
    let app_handle = window.app_handle().clone();
    let mut builder =
        tauri::webview::WebviewBuilder::new("grove", tauri::WebviewUrl::External(parsed))
            .on_navigation(move |url| {
                // Never cancel the webview's own initial blank document or
                // non-web schemes; returning false for about:blank would abort
                // the load of the real URL. Only gate real http(s) cross-origin
                // navigation (the actual security boundary).
                if !matches!(url.scheme(), "http" | "https") {
                    return true;
                }
                let host_ok =
                    matches!(&allowed_host, Some(h) if url.host_str() == Some(h.as_str()));
                // The embedded web app signing out (or its session expiring)
                // lands the Grove webview on /login. The native shell keeps a
                // separate keychain session, so without this it would still show
                // the signed-in tab bar over a signed-out web page. Propagate:
                // clear the native session and re-boot the main webview to the
                // native login gate. (eval, not an event — the event ACL isn't
                // granted; see bridge.onEvent.)
                if host_ok && url.path() == "/login" {
                    let app = app_handle.clone();
                    let _ = app_handle.run_on_main_thread(move || {
                        let _ = auth::sign_out();
                        if let Some(main) = app.get_webview("main") {
                            let _ = main
                                .eval("window.__nibbinSignedOut__ && window.__nibbinSignedOut__()");
                        }
                    });
                }
                host_ok
            });
    if let Some(s) = script {
        builder = builder.initialization_script(&s);
    }
    // `grove_show` is an ASYNC command, so it runs on a worker thread, not the
    // main/UI thread. `add_child` internally hops to the main thread to create
    // the WebView2 child and blocks until it's done — which works from a worker
    // thread but DEADLOCKS if called on the main thread (a sync command), where
    // the webview was left stranded on about:blank ("Connecting your grove…").
    window
        .add_child(builder, pos, size)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Hide the Grove webview (switching to Field Study, or signing out).
#[tauri::command]
fn grove_hide(window: tauri::Window) -> Result<(), String> {
    if let Some(wv) = window.app_handle().get_webview("grove") {
        wv.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        // D8: single-instance guard — a second launch focuses the existing
        // window instead of creating another app+tray (the main source of
        // duplicate ghost tray icons).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
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
            commands::create_study,
            commands::review_events,
            commands::review_delete,
            commands::review_keep,
            commands::add_exclusion,
            auth::store_session,
            auth::auth_session,
            auth::access_token,
            auth::sign_out,
            update::check_for_update,
            update::open_external,
            grove_show,
            grove_hide,
        ])
        .setup(|app| {
            // Keep the Grove child webview fitted to the window as it resizes.
            if let Some(win) = app.get_window("main") {
                let win_for_resize = win.clone();
                win.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Resized(_)) {
                        if let Some(wv) = win_for_resize.app_handle().get_webview("grove") {
                            let (pos, size) = grove_bounds(&win_for_resize);
                            let _ = wv.set_position(pos);
                            let _ = wv.set_size(size);
                        }
                    }
                });
            }

            if let Err(e) = app.global_shortcut().register(PAUSE_SHORTCUT) {
                eprintln!("pause hotkey unavailable (continuing without it): {e}");
                let _ = app.handle().emit("study:hotkey-unavailable", e.to_string());
            }

            // Phase 1: register + start the independent capture daemon. Failure
            // is surfaced honestly via read_status (daemon_health), never fatal.
            daemon_supervisor::ensure_daemon_running(&app.handle());

            // D7: tray is declared ONLY here (programmatic); the static
            // trayIcon block has been removed from tauri.conf.json so there
            // is exactly one icon. The icon path mirrors what the config block
            // previously referenced. tray: the study countdown is ALWAYS
            // visible while a study runs (SPEC §5); the value is
            // daemon-derived (daemon.status), the tray only displays it.
            let open = MenuItemBuilder::with_id("open", "Open Nibbin").build(app)?;
            let pause = MenuItemBuilder::with_id("pause", "Pause capture").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open, &pause]).build()?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?;
            TrayIconBuilder::with_id("observer-tray")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("Nibbin")
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
                        // Kind-aware copy: a quick scan never says "field study"
                        // and omits the days field (its window is hours-scale).
                        let study_obj = status.get("study");
                        let is_quick_scan = study_obj
                            .and_then(|s| s.get("kind"))
                            .and_then(|k| k.as_str())
                            == Some("quick_scan");
                        let depth_label = match study_obj
                            .and_then(|s| s.get("depth"))
                            .and_then(|d| d.as_str())
                            .unwrap_or("lite")
                        {
                            "detailed" => "Detailed",
                            _ => "Lite",
                        };
                        let tooltip = if is_quick_scan {
                            format!("Nibbin — quick scan ({depth_label}): {hours}h left")
                        } else {
                            format!("Nibbin — field study ({depth_label}): {days}d {hours}h left")
                        };
                        let _ = tray.set_tooltip(Some(tooltip));
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            });

            Ok(())
        })
        // D7: clean up the tray on exit so it doesn't ghost after the process
        // exits. Windows in particular leaves orphan tray icons without this.
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(tray) = app.tray_by_id("observer-tray") {
                    let _ = tray.set_visible(false);
                }
            }
        })
        .expect("error while running the Observer shell");
}
