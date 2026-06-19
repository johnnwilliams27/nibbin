//! Daemon-level proof: a `CaptureItem::Input` queued in the mock source is
//! persisted as an `InputBurst` event with the correct counts and no AX tree.

use nibbin_capture::{InputCounts, MockCapture};
use nibbin_redaction::event::EventKind;
use nibbin_store::{ObserverStore, StaticTestKey};
use observerd::{ControlCommand, Daemon};
use std::sync::Once;

static SET_ENV: Once = Once::new();

fn test_key() -> StaticTestKey {
    let mut key = [0u8; 32];
    for (i, b) in key.iter_mut().enumerate() {
        *b = u8::from_str_radix(&"22".repeat(32)[i * 2..i * 2 + 2], 16).unwrap();
    }
    StaticTestKey(key)
}

fn setup_env() {
    SET_ENV.call_once(|| {
        std::env::set_var("NIBBIN_TEST_KEY_HEX", "22".repeat(32));
        std::env::set_var("NIBBIN_NER", "down");
        std::env::set_var("NIBBIN_FAKE_NOW", "2026-06-18T10:00:00Z");
    });
}

#[test]
fn input_counts_are_persisted_as_input_burst() {
    setup_env();
    let dir = tempfile::tempdir().unwrap();

    // Build a MockCapture and queue one InputCounts item.
    let mut mock = MockCapture::default();
    mock.queue_input(InputCounts {
        keys: 7,
        clicks: 3,
        duration_ms: 900,
    });

    let mut daemon = Daemon::open(dir.path(), Box::new(mock)).unwrap();

    // Drive Consent → Start → capture_pass.
    daemon.handle(ControlCommand::Consent).unwrap();
    daemon.handle(ControlCommand::Start).unwrap();
    daemon.capture_pass().unwrap();

    // Open the store with the same key and assert exactly one InputBurst event.
    let store = ObserverStore::open(dir.path(), &test_key()).unwrap();
    let events = store.list_events().unwrap();

    let bursts: Vec<_> = events
        .iter()
        .filter(|e| e.kind == EventKind::InputBurst)
        .collect();

    assert_eq!(
        bursts.len(),
        1,
        "expected exactly one InputBurst, found {} total events (kinds: {:?})",
        events.len(),
        events.iter().map(|e| &e.kind).collect::<Vec<_>>()
    );

    let burst = bursts[0];

    // Must carry counts and no AX tree.
    let input = burst
        .input
        .as_ref()
        .expect("InputBurst must have input counts");
    assert_eq!(input.keys, 7, "key count must match");
    assert_eq!(input.clicks, 3, "click count must match");
    assert_eq!(input.duration_ms, 900, "duration_ms must match");
    assert!(burst.ax.is_none(), "InputBurst must not carry an AX tree");
}
