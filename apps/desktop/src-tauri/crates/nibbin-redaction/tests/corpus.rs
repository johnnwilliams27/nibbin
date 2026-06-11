//! Rust side of the redaction corpus: drives the SAME sentinel fixtures as
//! tests/redaction-corpus (the CI-blocking vitest suite) through the Rust
//! pipeline, so the TS reference implementation and the production daemon
//! code cannot drift on redaction semantics.

use nibbin_redaction::ner::DownNer;
use nibbin_redaction::{
    snapshot_to_raw_events, AxSnapshot, HeuristicNer, ObserverEvent, PersistSink, ProcessOutcome,
    RedactionPipeline,
};
use std::collections::HashMap;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../../tests/redaction-corpus/fixtures")
}

fn sentinel_values() -> Vec<String> {
    let text = std::fs::read_to_string(fixtures_dir().join("sentinels.json")).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
    parsed["sentinels"]
        .as_object()
        .unwrap()
        .values()
        .map(|s| s["value"].as_str().unwrap().to_string())
        .collect()
}

fn sentinel_map() -> HashMap<String, String> {
    let text = std::fs::read_to_string(fixtures_dir().join("sentinels.json")).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
    parsed["sentinels"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(id, s)| (id.clone(), s["value"].as_str().unwrap().to_string()))
        .collect()
}

/// Load a fixture and seed it: sentinel ids replaced with their VALUES.
fn load_seeded(name: &str) -> AxSnapshot {
    let mut text = std::fs::read_to_string(fixtures_dir().join(name)).unwrap();
    for (id, value) in sentinel_map() {
        text = text.replace(&id, &value);
    }
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("fixture {name} must parse: {e}"))
}

#[derive(Default)]
struct MemorySink {
    events: Vec<ObserverEvent>,
}

impl PersistSink for MemorySink {
    fn append(&mut self, event: &ObserverEvent) -> Result<(), anyhow::Error> {
        self.events.push(event.clone());
        Ok(())
    }
}

fn assert_no_sentinels(text: &str, place: &str) {
    for value in sentinel_values() {
        assert!(!text.contains(&value), "{place} leaks sentinel {value}");
    }
}

#[test]
fn basic_fixture_persists_zero_sentinels() {
    let snapshot = load_seeded("ax-tree-basic.json");
    let mut sink = MemorySink::default();
    let mut pipeline = RedactionPipeline::new(HeuristicNer);

    for raw in snapshot_to_raw_events(&snapshot, "ses_rust", "2026-06-12T14:03:22.114Z") {
        let outcome = pipeline.process(&raw, &mut sink).unwrap();
        assert_eq!(outcome, ProcessOutcome::Persisted);
    }

    assert!(!sink.events.is_empty());
    let serialized = serde_json::to_string(&sink.events).unwrap();
    assert_no_sentinels(&serialized, "persisted store");
    assert_eq!(
        sink.events[0].window.title_redacted,
        "Invoice from {PERSON}"
    );
}

#[test]
fn secure_field_fixture_c4_no_value_no_label_no_frame() {
    let snapshot = load_seeded("secure-field-c4.json");
    let raws = snapshot_to_raw_events(&snapshot, "ses_rust", "2026-06-12T14:03:22.114Z");

    let secure: Vec<_> = raws
        .iter()
        .filter(|r| {
            matches!(
                r.ax,
                Some(nibbin_redaction::AxObservation::SecureSuppressed { .. })
            )
        })
        .collect();
    assert_eq!(secure.len(), 1);
    assert!(secure[0].frame_ref.is_none());
    // the raw debug form itself carries no field content
    let debug = format!("{:?}", secure[0]);
    assert_no_sentinels(&debug, "raw secure observation");
    assert!(!debug.contains("Password"));

    let mut sink = MemorySink::default();
    let mut pipeline = RedactionPipeline::new(HeuristicNer);
    for raw in &raws {
        pipeline.process(raw, &mut sink).unwrap();
    }
    let secure_event = sink
        .events
        .iter()
        .find(|e| {
            e.ax.as_ref()
                .is_some_and(|a| a.label_redacted == "{SECURE}")
        })
        .expect("secure event persisted as constant");
    assert!(secure_event.frame_ref.is_none());
    assert_no_sentinels(
        &serde_json::to_string(&sink.events).unwrap(),
        "persisted store",
    );
}

#[test]
fn secure_parent_suppresses_valued_children_c4() {
    // P1-1: the OS secure flag on a parent must suppress the whole subtree.
    let snapshot = load_seeded("secure-nested-c4.json");
    let raws = snapshot_to_raw_events(&snapshot, "ses_rust", "2026-06-12T14:03:22.114Z");

    let suppressed = raws
        .iter()
        .filter(|r| {
            matches!(
                r.ax,
                Some(nibbin_redaction::AxObservation::SecureSuppressed { .. })
            )
        })
        .count();
    assert!(
        suppressed >= 2,
        "both child fields under the secure group must be suppressed"
    );
    assert_no_sentinels(&format!("{raws:?}"), "nested secure subtree (raw)");

    let mut sink = MemorySink::default();
    let mut pipeline = RedactionPipeline::new(HeuristicNer);
    for raw in &raws {
        pipeline.process(raw, &mut sink).unwrap();
    }
    assert_no_sentinels(
        &serde_json::to_string(&sink.events).unwrap(),
        "nested secure (persisted)",
    );
}

#[test]
fn blocklist_fixture_c5_zero_persisted_events() {
    let snapshot = load_seeded("blocklist-c5.json");
    let mut sink = MemorySink::default();
    let mut pipeline = RedactionPipeline::new(HeuristicNer);

    let raws = snapshot_to_raw_events(&snapshot, "ses_rust", "2026-06-12T14:03:22.114Z");
    assert!(!raws.is_empty());
    for raw in &raws {
        let outcome = pipeline.process(raw, &mut sink).unwrap();
        assert!(matches!(outcome, ProcessOutcome::BlockedCategory(ref c) if c == "banking"));
    }
    assert!(sink.events.is_empty());
}

#[test]
fn fail_closed_when_ner_sidecar_down() {
    let snapshot = load_seeded("ax-tree-basic.json");
    let mut sink = MemorySink::default();
    let mut pipeline = RedactionPipeline::new(DownNer);

    let raws = snapshot_to_raw_events(&snapshot, "ses_rust", "2026-06-12T14:03:22.114Z");
    for raw in &raws {
        let outcome = pipeline.process(raw, &mut sink).unwrap();
        assert_eq!(outcome, ProcessOutcome::HaltedNerUnavailable);
    }
    assert!(pipeline.halted());
    assert!(sink.events.is_empty(), "fail-closed must persist nothing");
}
