//! Daemon-level REAL capture proof (Windows + screenpipe feature + hardware).
//!
//! Drives the full Observer path with the REAL platform source:
//!   platform_source() (WindowsUiaCapture) → Consent → Start → capture_pass
//!   → snapshot_to_raw_events → heuristic NER → SQLCipher store
//! then reopens the store and asserts real `AxDelta` ObserverEvents landed
//! whose `app` reflects an actual foreground window (not the mock).
//!
//! Gated so default/CI/mock builds never compile or run it. Run with:
//!   cargo test -p observerd --features nibbin-capture/screenpipe \
//!     --test real_ax_capture -- --nocapture

#![cfg(all(windows, feature = "screenpipe"))]

use nibbin_redaction::event::EventKind;
use nibbin_store::{ObserverStore, StaticTestKey};
use observerd::{ControlCommand, Daemon};

fn test_key() -> StaticTestKey {
    let mut key = [0u8; 32];
    for (i, b) in key.iter_mut().enumerate() {
        *b = u8::from_str_radix(&"33".repeat(32)[i * 2..i * 2 + 2], 16).unwrap();
    }
    StaticTestKey(key)
}

#[test]
fn real_foreground_capture_produces_ax_delta_events() {
    // In-process heuristic NER (no sidecar), explicit test key.
    std::env::set_var("NIBBIN_TEST_KEY_HEX", "33".repeat(32));
    std::env::set_var("NIBBIN_NER", "heuristic");

    let dir = tempfile::tempdir().unwrap();

    // The REAL platform source: WindowsUiaCapture under the screenpipe feature.
    let mut daemon = Daemon::open(dir.path(), nibbin_capture::platform_source()).unwrap();

    daemon.handle(ControlCommand::Consent).unwrap();
    daemon.handle(ControlCommand::Start).unwrap();

    // A few ticks against whatever is in the foreground on this machine.
    for _ in 0..5 {
        daemon.capture_pass().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(120));
    }

    let store = ObserverStore::open(dir.path(), &test_key()).unwrap();
    let events = store.list_events().unwrap();

    let ax: Vec<_> = events
        .iter()
        .filter(|e| e.kind == EventKind::AxDelta)
        .collect();

    assert!(
        !ax.is_empty(),
        "expected at least one real AxDelta event; got {} total events (kinds: {:?})",
        events.len(),
        events.iter().map(|e| &e.kind).collect::<Vec<_>>()
    );

    // At least one AxDelta must carry a real (non-empty, non-mock) app name.
    let sample = ax
        .iter()
        .find(|e| !e.app.name.is_empty() && e.app.name != "MockApp")
        .unwrap_or_else(|| {
            panic!(
                "no AxDelta carried a real app name; apps seen: {:?}",
                ax.iter().map(|e| &e.app.name).collect::<Vec<_>>()
            )
        });

    eprintln!(
        "REAL DAEMON CAPTURE OK: {} AxDelta events; sample app={:?} window={:?}",
        ax.len(),
        sample.app.name,
        sample.window.title_redacted
    );
}
