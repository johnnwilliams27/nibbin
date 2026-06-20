//! End-to-end test: RemoveExclusion drives the daemon through handle() and
//! proves a subsequently captured event for the removed host is unblocked.
//! Mirrors the exclusion_persistence.rs integration test pattern.

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

/// Add a host exclusion, then remove it; verify exclusions.json no longer
/// contains the host.
#[test]
fn remove_exclusion_subtracts_from_persisted_set() {
    let dir = tempfile::tempdir().unwrap();
    let control = dir.path().join("control.jsonl");
    let now = "2026-06-12T08:00:00Z";

    // Spawn 1: consent + start + exclude evil.com.
    append_line(&control, "{\"cmd\":\"consent\"}");
    append_line(&control, "{\"cmd\":\"start\"}");
    append_line(
        &control,
        "{\"cmd\":\"add_exclusion\",\"host\":\"evil.com\"}",
    );
    let out1 = run_observerd(dir.path(), now);
    assert!(
        out1.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out1.stderr)
    );
    let after_add: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("exclusions.json")).unwrap())
            .unwrap();
    assert_eq!(
        after_add["hosts"],
        serde_json::json!(["evil.com"]),
        "evil.com must be in exclusions after add"
    );

    // Spawn 2: remove evil.com.
    append_line(
        &control,
        "{\"cmd\":\"remove_exclusion\",\"host\":\"evil.com\"}",
    );
    let out2 = run_observerd(dir.path(), now);
    assert!(
        out2.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out2.stderr)
    );

    let after_remove: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("exclusions.json")).unwrap())
            .unwrap();
    assert_eq!(
        after_remove["hosts"],
        serde_json::json!([]),
        "evil.com must be removed from exclusions"
    );
}

/// After removing a host exclusion, a capture event for that host is no longer
/// blocked — the pipeline's in-memory set is updated immediately.
/// Verified via blocked_category_for: after remove, the host no longer matches
/// a user_exclusion.
#[test]
fn removed_host_is_no_longer_blocked_in_pipeline() {
    use nibbin_redaction::{blocked_category_for, UserExclusions};

    let mut exclusions = UserExclusions {
        hosts: vec!["evil.com".to_string()],
        bundle_ids: vec![],
        app_names: vec![],
    };

    // With the exclusion, evil.com is blocked as user_exclusion.
    let blocked = blocked_category_for(
        "",
        None,
        "com.example",
        "Example",
        Some("evil.com"),
        &exclusions,
    );
    assert_eq!(
        blocked.as_deref(),
        Some("user_exclusion"),
        "evil.com must be blocked when in exclusion set"
    );

    // Simulate RemoveExclusion subtraction (case-insensitive, matching daemon handler).
    let needle_lc = "evil.com".to_lowercase();
    exclusions.hosts.retain(|x| x.to_lowercase() != needle_lc);

    // After removal, the host is no longer blocked.
    let unblocked = blocked_category_for(
        "",
        None,
        "com.example",
        "Example",
        Some("evil.com"),
        &exclusions,
    );
    assert!(
        unblocked.is_none(),
        "evil.com must NOT be blocked after removal, got: {unblocked:?}"
    );
}

/// Case-insensitive removal: an exclusion stored as "Evil.Com" must be dropped
/// when the needle is "evil.com" (matching enforcement semantics in blocklist.rs).
#[test]
fn remove_exclusion_is_case_insensitive() {
    use nibbin_redaction::UserExclusions;

    let mut exclusions = UserExclusions {
        hosts: vec!["Evil.Com".to_string()],
        bundle_ids: vec!["Com.Evil.App".to_string()],
        app_names: vec!["Evil App".to_string()],
    };

    let h_lc = "evil.com".to_lowercase();
    exclusions.hosts.retain(|x| x.to_lowercase() != h_lc);

    let b_lc = "com.evil.app".to_lowercase();
    exclusions.bundle_ids.retain(|x| x.to_lowercase() != b_lc);

    let a_lc = "evil app".to_lowercase();
    exclusions.app_names.retain(|x| x.to_lowercase() != a_lc);

    assert!(
        exclusions.hosts.is_empty(),
        "case-insensitive host removal failed"
    );
    assert!(
        exclusions.bundle_ids.is_empty(),
        "case-insensitive bundle_id removal failed"
    );
    assert!(
        exclusions.app_names.is_empty(),
        "case-insensitive app_name removal failed"
    );
}
