//! T&C spec §5.1 (T1): a capture exclusion must survive a daemon restart.
//! Proof without an accessor: spawn once adding a.com, spawn AGAIN adding only
//! b.com (the persisted control offset skips a.com's line). The file ends with
//! BOTH hosts only if open() reloaded a.com from disk before merging b.com.

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

fn append_line(path: &std::path::Path, line: &str) {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .unwrap();
    writeln!(f, "{line}").unwrap();
}

#[test]
fn an_exclusion_survives_a_daemon_restart() {
    let dir = tempfile::tempdir().unwrap();
    let control = dir.path().join("control.jsonl");
    let now = "2026-06-12T08:00:00Z";

    // Spawn 1: consent + start + exclude a.com.
    append_line(&control, "{\"cmd\":\"consent\"}");
    append_line(&control, "{\"cmd\":\"start\"}");
    append_line(&control, "{\"cmd\":\"add_exclusion\",\"host\":\"a.com\"}");
    let out1 = run_observerd(dir.path(), now);
    assert!(out1.status.success(), "stderr: {}", String::from_utf8_lossy(&out1.stderr));

    let after1: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("exclusions.json")).unwrap())
            .unwrap();
    assert_eq!(after1["hosts"], serde_json::json!(["a.com"]));

    // Spawn 2 (a fresh process = a restart): exclude ONLY b.com. The persisted
    // control.offset means a.com's line is never re-applied.
    append_line(&control, "{\"cmd\":\"add_exclusion\",\"host\":\"b.com\"}");
    let out2 = run_observerd(dir.path(), now);
    assert!(out2.status.success(), "stderr: {}", String::from_utf8_lossy(&out2.stderr));

    let after2: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("exclusions.json")).unwrap())
            .unwrap();
    // Both hosts present ⇒ open() reloaded a.com before merging b.com (T1).
    assert_eq!(after2["hosts"], serde_json::json!(["a.com", "b.com"]));
}

#[test]
fn a_corrupt_exclusions_file_stops_the_daemon() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("exclusions.json"), b"{not json").unwrap();
    // No control commands needed: open() runs before anything and must fail.
    let out = run_observerd(dir.path(), "2026-06-12T08:00:00Z");
    assert!(
        !out.status.success(),
        "a corrupt exclusions file must fail closed (daemon must not start)"
    );
}
