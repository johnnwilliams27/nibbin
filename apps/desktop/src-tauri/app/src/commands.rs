//! Webview commands. The app never bypasses the daemon's gates: study
//! transitions go through control.jsonl; review edits go to the SQLCipher
//! store under the same key custody (OS keystore) the daemon uses.

use nibbin_redaction::event::ReviewState;
use nibbin_redaction::ObserverEvent;
use nibbin_store::{KeyProvider, ObserverStore, OsKeystoreKey};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const ALLOWED_CONTROL: &[&str] = &[
    "consent",
    "start",
    "pause",
    "resume",
    "stop_early",
    "finish_review",
    "synthesis_complete",
    "delete_everything",
];

pub fn store_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, anyhow::Error> {
    let dir = app.path().app_data_dir()?.join("observer-store");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn write_control<R: Runtime>(app: &AppHandle<R>, line: &str) -> Result<(), anyhow::Error> {
    let path = store_root(app)?.join("control.jsonl");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{line}")?;
    Ok(())
}

pub fn read_status<R: Runtime>(app: &AppHandle<R>) -> Result<serde_json::Value, anyhow::Error> {
    let root = store_root(app)?;
    let status: serde_json::Value = match std::fs::read_to_string(root.join("daemon.status")) {
        Ok(text) => serde_json::from_str(&text)?,
        Err(_) => serde_json::json!({ "state": "DAEMON_OFFLINE" }),
    };
    let study: serde_json::Value = match std::fs::read_to_string(root.join("study.json")) {
        Ok(text) => serde_json::from_str(&text)?,
        Err(_) => serde_json::Value::Null,
    };
    Ok(serde_json::json!({
        "state": status.get("state"),
        "remaining_ms": status.get("remaining_ms"),
        "paused": status.get("paused"),
        "pipeline_halted": status.get("pipeline_halted"),
        "study": study,
    }))
}

fn open_store<R: Runtime>(app: &AppHandle<R>) -> Result<ObserverStore, anyhow::Error> {
    let root = store_root(app)?;
    let key = OsKeystoreKey::observer_default();
    // fail loudly if the keystore is unreachable — never fall back to a
    // weaker key source
    key.key_hex()?;
    ObserverStore::open(&root, &key)
}

#[tauri::command]
pub fn study_status(app: AppHandle) -> Result<serde_json::Value, String> {
    read_status(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn send_control(app: AppHandle, cmd: String) -> Result<(), String> {
    if !ALLOWED_CONTROL.contains(&cmd.as_str()) {
        return Err(format!("unknown control command: {cmd}"));
    }
    let line = serde_json::json!({ "cmd": cmd }).to_string();
    write_control(&app, &line).map_err(|e| e.to_string())
}

/// Events for the end-of-day review UI — already redacted; this is the only
/// shape the webview ever sees (raw data never crosses the IPC boundary
/// because raw data does not exist post-pipeline).
#[tauri::command]
pub fn review_events(app: AppHandle) -> Result<Vec<ObserverEvent>, String> {
    let store = open_store(&app).map_err(|e| e.to_string())?;
    store.list_events().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn review_delete(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let mut store = open_store(&app).map_err(|e| e.to_string())?;
    store
        .set_review_state(&ids, ReviewState::UserDeleted)
        .and_then(|()| store.purge_events(&ids))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn review_keep(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let mut store = open_store(&app).map_err(|e| e.to_string())?;
    store
        .set_review_state(&ids, ReviewState::UserKept)
        .map_err(|e| e.to_string())
}

/// Mint a fresh study (full study or ad-hoc quick scan). Forwarded to the
/// daemon, which applies CreateStudy + clears the store so the new study starts
/// empty. The id is caller-supplied (unique); kind ∈ {full_study, quick_scan}.
#[tauri::command]
pub fn create_study(
    app: AppHandle,
    id: String,
    kind: String,
    label: Option<String>,
) -> Result<(), String> {
    if kind != "full_study" && kind != "quick_scan" {
        return Err(format!("bad study kind: {kind}"));
    }
    // Bound the caller-supplied fields so an over-long value can't balloon
    // control.jsonl / study.json (and ride the packet to the server). The id is
    // a crypto.randomUUID() from the UI — well under 64; reject anything longer.
    if id.len() > 64 {
        return Err(format!("study id too long: {} chars (max 64)", id.len()));
    }
    // Truncate (don't reject) the human label — friendlier than erroring; we cap
    // at 256 chars by character boundary so we never split a multi-byte char.
    let label = label.map(|l| {
        if l.chars().count() > 256 {
            l.chars().take(256).collect::<String>()
        } else {
            l
        }
    });
    let line = serde_json::json!({
        "cmd": "create_study",
        "study_id": id,
        "kind": kind,
        "label": label,
    })
    .to_string();
    write_control(&app, &line).map_err(|e| e.to_string())
}

/// Review's "never record this again": forwarded to the daemon, which feeds
/// it into layer 2 for the rest of the study and persists it locally.
#[tauri::command]
pub fn add_exclusion(
    app: AppHandle,
    host: Option<String>,
    bundle_id: Option<String>,
    app_name: Option<String>,
) -> Result<(), String> {
    let line = serde_json::json!({
        "cmd": "add_exclusion",
        "host": host,
        "bundle_id": bundle_id,
        "app_name": app_name,
    })
    .to_string();
    write_control(&app, &line).map_err(|e| e.to_string())
}
