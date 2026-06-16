//! Process-level proof of the corpus's assertion 7: the day-14 hard stop
//! (C2) fires in a REAL observerd OS process with no UI anywhere — the
//! binary is spawned headless against a store whose study is 15 days old.

use nibbin_study::{new_study, transition, StoppedBy, StudyCommand, StudyKind, StudyState};
use std::process::Command;

fn run_observerd(store: &std::path::Path, fake_now: &str) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_observerd"))
        .args(["--store", store.to_str().unwrap(), "--once"])
        .env("NIBBIN_FAKE_NOW", fake_now)
        .env("NIBBIN_NER", "heuristic")
        .env("NIBBIN_TEST_KEY_HEX", "11".repeat(32))
        .output()
        .expect("observerd must spawn")
}

#[test]
fn day14_stop_fires_in_a_headless_daemon_process() {
    let dir = tempfile::tempdir().unwrap();

    // a study that started 15 days before "now", persisted as ACTIVE
    let t0 = "2026-06-10T08:00:00Z".parse().unwrap();
    let study = transition(
        &transition(
            &new_study("study_proc", StudyKind::FullStudy, None),
            StudyCommand::Consent { at: t0 },
        )
        .unwrap(),
        StudyCommand::Start { at: t0 },
    )
    .unwrap();
    assert_eq!(study.state, StudyState::Active);
    nibbin_study::save(dir.path(), &study).unwrap();

    // spawn the real daemon binary — no UI process exists at all
    let output = run_observerd(dir.path(), "2026-06-25T08:00:00Z");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let after = nibbin_study::load(dir.path()).unwrap().unwrap();
    assert_eq!(after.state, StudyState::Review);
    assert_eq!(after.stopped_by, Some(StoppedBy::Day14Daemon));

    // and the countdown the daemon publishes is zero
    let status = std::fs::read_to_string(dir.path().join("daemon.status")).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&status).unwrap();
    assert_eq!(parsed["remaining_ms"], 0);
    assert_eq!(parsed["state"], "REVIEW");
}

#[test]
fn before_the_deadline_the_daemon_leaves_the_study_running() {
    let dir = tempfile::tempdir().unwrap();
    let t0 = "2026-06-10T08:00:00Z".parse().unwrap();
    let study = transition(
        &transition(
            &new_study("study_proc", StudyKind::FullStudy, None),
            StudyCommand::Consent { at: t0 },
        )
        .unwrap(),
        StudyCommand::Start { at: t0 },
    )
    .unwrap();
    nibbin_study::save(dir.path(), &study).unwrap();

    let output = run_observerd(dir.path(), "2026-06-20T08:00:00Z");
    assert!(output.status.success());
    let after = nibbin_study::load(dir.path()).unwrap().unwrap();
    assert_eq!(after.state, StudyState::Active);
}

#[test]
fn pause_then_resume_records_a_visible_gap() {
    let dir = tempfile::tempdir().unwrap();
    let lines = [
        "{\"cmd\":\"consent\"}",
        "{\"cmd\":\"start\"}",
        "{\"cmd\":\"pause\"}",
        "{\"cmd\":\"resume\"}",
    ]
    .join("\n");
    std::fs::write(dir.path().join("control.jsonl"), lines + "\n").unwrap();

    let output = run_observerd(dir.path(), "2026-06-12T08:00:00Z");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    // C6: the pause must appear as a visible capture_gap event in the store —
    // this is what the consent/Field-Notes copy promises.
    use nibbin_redaction::event::EventKind;
    use nibbin_store::{ObserverStore, StaticTestKey};
    let mut key = [0u8; 32];
    for (i, b) in key.iter_mut().enumerate() {
        *b = u8::from_str_radix(&"11".repeat(32)[i * 2..i * 2 + 2], 16).unwrap();
    }
    let store = ObserverStore::open(dir.path(), &StaticTestKey(key)).unwrap();
    let gaps = store
        .list_events()
        .unwrap()
        .into_iter()
        .filter(|e| e.kind == EventKind::CaptureGap)
        .count();
    assert_eq!(gaps, 1, "resume must emit exactly one visible gap");
}

#[test]
fn delete_everything_via_control_file_destroys_and_verifies() {
    let dir = tempfile::tempdir().unwrap();
    let t0 = "2026-06-10T08:00:00Z".parse().unwrap();
    let study = transition(
        &transition(
            &new_study("study_proc", StudyKind::FullStudy, None),
            StudyCommand::Consent { at: t0 },
        )
        .unwrap(),
        StudyCommand::Start { at: t0 },
    )
    .unwrap();
    nibbin_study::save(dir.path(), &study).unwrap();
    std::fs::write(
        dir.path().join("control.jsonl"),
        "{\"cmd\":\"delete_everything\"}\n",
    )
    .unwrap();

    let output = run_observerd(dir.path(), "2026-06-12T08:00:00Z");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let after = nibbin_study::load(dir.path()).unwrap().unwrap();
    assert_eq!(after.state, StudyState::Deleted);
    let receipt = after.deletion_receipt.expect("receipt recorded");
    assert!(receipt.verified);
    assert!(!dir.path().join("observer.db").exists());
}
