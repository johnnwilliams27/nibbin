# Exclusion Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make field-study capture exclusions survive a daemon restart, so a crash/update/reboot mid-study can never silently resume capturing a previously-excluded app or site.

**Architecture:** Exclusions are currently held only in `RedactionPipeline`'s in-memory `UserExclusions`; `Daemon::open()` constructs the pipeline empty and never reloads, and `drain_control` persists a consumed-command offset so the original `add_exclusion` lines are never re-applied. We add a durable `exclusions.json` in the observer store: written atomically every time an exclusion is added, loaded by `Daemon::open()` **before** the capture loop starts, and wiped by the same paths that wipe raw data. A corrupt file fails **closed** (the daemon refuses to start) rather than starting with no exclusions.

**Tech Stack:** Rust (the `observerd` daemon crate + the `nibbin-redaction` crate), `serde`/`serde_json`, `anyhow`, `tempfile` (dev). Cargo workspace at `apps/desktop/src-tauri`.

**Source spec:** `docs/superpowers/specs/2026-06-17-trust-and-controls-design.md` §5.1 (requirements T1, T2; principle TC-P3).

---

## Implementation note: discharges T1 and T2

- **T1** — exclusions persist across daemon restart, reloaded before capture resumes, fail-closed on corruption.
- **T2** — atomic durable writes; the file is the source of truth, the in-memory pipeline is the cache.

## File Structure

- **Modify** `apps/desktop/src-tauri/crates/nibbin-redaction/src/blocklist.rs` — derive `Serialize`/`Deserialize` on `UserExclusions`; dedupe on merge (it lives here today, owned by the redaction crate).
- **Modify** `apps/desktop/src-tauri/crates/nibbin-redaction/src/pipeline.rs` — add a read-only `exclusions()` accessor so the daemon can persist the merged set.
- **Create** `apps/desktop/src-tauri/observerd/src/exclusions.rs` — `save_exclusions` / `load_exclusions` (atomic write; missing → default; corrupt → `Err`).
- **Modify** `apps/desktop/src-tauri/observerd/src/lib.rs` — declare the module; load in `Daemon::open()` (fail-closed); persist in `handle(AddExclusion)`; wipe in `delete_raw_and_verify` + `clear_store`.
- **Create** `apps/desktop/src-tauri/observerd/tests/exclusion_persistence.rs` — headless two-spawn proof that the load→merge→persist cycle holds across a restart.

---

### Task 1: `UserExclusions` is serializable and de-duplicates on merge

**Files:**
- Modify: `apps/desktop/src-tauri/crates/nibbin-redaction/src/blocklist.rs:34-50`
- Test: same file (inline `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing tests**

Add at the end of `blocklist.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::UserExclusions;

    #[test]
    fn exclusions_serde_round_trips() {
        let ex = UserExclusions {
            hosts: vec!["evil.com".into()],
            bundle_ids: vec!["com.evil.app".into()],
            app_names: vec!["Evil".into()],
        };
        let json = serde_json::to_string(&ex).unwrap();
        let back: UserExclusions = serde_json::from_str(&json).unwrap();
        assert_eq!(back.hosts, ex.hosts);
        assert_eq!(back.bundle_ids, ex.bundle_ids);
        assert_eq!(back.app_names, ex.app_names);
    }

    #[test]
    fn merge_dedupes_repeated_entries() {
        let mut ex = UserExclusions {
            hosts: vec!["a.com".into()],
            ..Default::default()
        };
        ex.merge(UserExclusions {
            hosts: vec!["a.com".into(), "b.com".into()],
            ..Default::default()
        });
        assert_eq!(ex.hosts, vec!["a.com".to_string(), "b.com".to_string()]);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop/src-tauri && cargo test -p nibbin-redaction exclusions_serde merge_dedupes`
Expected: FAIL — `UserExclusions` does not implement `Serialize`/`Deserialize`, and there is no `merge` method.

- [ ] **Step 3: Derive serde + add a de-duplicating `merge`**

In `blocklist.rs`, change the `UserExclusions` definition (currently lines 34-40) and add a `merge` method:

```rust
/// User-added exclusions (layer 4 feeds layer 2). Stored locally only.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct UserExclusions {
    #[serde(default)]
    pub hosts: Vec<String>,
    #[serde(default)]
    pub bundle_ids: Vec<String>,
    #[serde(default)]
    pub app_names: Vec<String>,
}

impl UserExclusions {
    /// Merge another set in, preserving insertion order and dropping
    /// duplicates so the persisted file never grows unbounded on re-adds.
    pub fn merge(&mut self, more: UserExclusions) {
        for (dst, src) in [
            (&mut self.hosts, more.hosts),
            (&mut self.bundle_ids, more.bundle_ids),
            (&mut self.app_names, more.app_names),
        ] {
            for v in src {
                if !dst.contains(&v) {
                    dst.push(v);
                }
            }
        }
    }
}
```

`#[serde(default)]` on each field means a future file missing a field still loads (forward-compatible).

- [ ] **Step 4: Point `add_exclusions` at `merge`**

In `pipeline.rs`, replace the body of `add_exclusions` (currently lines 46-50) so the dedupe is used everywhere:

```rust
    /// Layer-4 exclusions feed back into layer 2 for the rest of the study.
    pub fn add_exclusions(&mut self, more: UserExclusions) {
        self.exclusions.merge(more);
    }
```

The `use crate::blocklist::{blocked_category_for, UserExclusions};` import at the top of `pipeline.rs` already brings `UserExclusions` into scope — no import change needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test -p nibbin-redaction exclusions_serde merge_dedupes`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/crates/nibbin-redaction/src/blocklist.rs apps/desktop/src-tauri/crates/nibbin-redaction/src/pipeline.rs
git commit -m "feat(redaction): serializable, de-duplicating UserExclusions"
```

---

### Task 2: A read-only accessor for the merged exclusions

**Files:**
- Modify: `apps/desktop/src-tauri/crates/nibbin-redaction/src/pipeline.rs`
- Test: same file (inline `#[cfg(test)] mod tests`)

The daemon needs to read the pipeline's *current, merged* exclusions to persist them after an add. Add a getter.

- [ ] **Step 1: Write the failing test**

Add at the end of `pipeline.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::RedactionPipeline;
    use crate::blocklist::UserExclusions;
    use crate::ner::HeuristicNer;

    #[test]
    fn exclusions_accessor_reflects_adds() {
        let mut p = RedactionPipeline::new(HeuristicNer);
        assert!(p.exclusions().hosts.is_empty());
        p.add_exclusions(UserExclusions { hosts: vec!["a.com".into()], ..Default::default() });
        assert_eq!(p.exclusions().hosts, vec!["a.com".to_string()]);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop/src-tauri && cargo test -p nibbin-redaction exclusions_accessor`
Expected: FAIL — no method `exclusions` on `RedactionPipeline`.

- [ ] **Step 3: Add the accessor**

In `pipeline.rs`, inside `impl<N: NerClient> RedactionPipeline<N>`, add (next to `halted`):

```rust
    /// The current merged exclusions — the daemon persists these after an add.
    pub fn exclusions(&self) -> &UserExclusions {
        &self.exclusions
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/desktop/src-tauri && cargo test -p nibbin-redaction exclusions_accessor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/crates/nibbin-redaction/src/pipeline.rs
git commit -m "feat(redaction): expose merged exclusions accessor"
```

---

### Task 3: Durable `exclusions.json` — atomic save, fail-closed load

**Files:**
- Create: `apps/desktop/src-tauri/observerd/src/exclusions.rs`
- Modify: `apps/desktop/src-tauri/observerd/src/lib.rs` (add `mod exclusions;`)
- Test: `exclusions.rs` (inline `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src-tauri/observerd/src/exclusions.rs`:

```rust
//! Durable storage for user capture exclusions (T&C spec §5.1, T1/T2).
//! The file is the source of truth; the in-memory pipeline is a cache loaded
//! on `Daemon::open()`. A corrupt file fails CLOSED (load returns Err so the
//! daemon refuses to start) rather than starting with no exclusions (TC-P3).

use anyhow::Context;
use nibbin_redaction::UserExclusions;
use std::path::Path;

const FILE: &str = "exclusions.json";

/// Persist exclusions atomically: write a temp file then rename, so a crash
/// mid-write can never leave a half-written file as the source of truth.
pub fn save_exclusions(root: &Path, ex: &UserExclusions) -> anyhow::Result<()> {
    let tmp = root.join("exclusions.json.tmp");
    std::fs::write(&tmp, serde_json::to_string(ex)?)?;
    std::fs::rename(&tmp, root.join(FILE))?;
    Ok(())
}

/// Load exclusions. Missing file → empty (default, first run). Unreadable or
/// unparseable file → Err (fail-closed; the caller must not start capture).
pub fn load_exclusions(root: &Path) -> anyhow::Result<UserExclusions> {
    let path = root.join(FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .with_context(|| format!("{} is corrupt", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(UserExclusions::default()),
        Err(e) => Err(e).with_context(|| format!("reading {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let ex = UserExclusions { hosts: vec!["evil.com".into()], ..Default::default() };
        save_exclusions(dir.path(), &ex).unwrap();
        let back = load_exclusions(dir.path()).unwrap();
        assert_eq!(back.hosts, vec!["evil.com".to_string()]);
    }

    #[test]
    fn missing_file_loads_empty() {
        let dir = tempfile::tempdir().unwrap();
        let back = load_exclusions(dir.path()).unwrap();
        assert!(back.hosts.is_empty() && back.bundle_ids.is_empty() && back.app_names.is_empty());
    }

    #[test]
    fn corrupt_file_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("exclusions.json"), b"{not json").unwrap();
        assert!(load_exclusions(dir.path()).is_err(), "corrupt file must fail closed");
    }
}
```

- [ ] **Step 2: Declare the module**

In `lib.rs`, add near the top of the file (after the `use` block, before `pub fn daemon_now`):

```rust
mod exclusions;
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test -p observerd exclusions`
Expected: PASS (3 tests: `round_trips_through_disk`, `missing_file_loads_empty`, `corrupt_file_fails_closed`).

`nibbin_redaction::UserExclusions` resolves because `observerd` already depends on `nibbin-redaction` (see the existing `use nibbin_redaction::...` lines in `lib.rs`); `tempfile` is already a dev-dependency (used by `tests/day14_headless.rs`).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/observerd/src/exclusions.rs apps/desktop/src-tauri/observerd/src/lib.rs
git commit -m "feat(observerd): durable exclusions store (atomic save, fail-closed load)"
```

---

### Task 4: Wire persistence into the daemon lifecycle

**Files:**
- Modify: `apps/desktop/src-tauri/observerd/src/lib.rs` — `Daemon::open()` (load), `handle(AddExclusion)` (persist), `delete_raw_and_verify` + `clear_store` (wipe)

- [ ] **Step 1: Load exclusions on open (before capture can run)**

In `Daemon::open()`, replace the `Ok(Self { ... })` block (currently lines 150-159) so the pipeline is built with the loaded exclusions. The load happens here, before any `capture_pass`, so capture never runs an exclusion-free window after a restart. A load error propagates out of `open()` (fail-closed: the daemon does not start):

```rust
        let mut pipeline = RedactionPipeline::new(ner_from_env());
        pipeline.add_exclusions(exclusions::load_exclusions(store_root)?);
        Ok(Self {
            store_root: store_root.to_path_buf(),
            study,
            pipeline,
            store: None,
            gate: CaptureGate::new(),
            source,
            control_offset,
            paused_at: None,
        })
```

- [ ] **Step 2: Persist on every add**

In `handle`, replace the `ControlCommand::AddExclusion { .. } => { ... }` arm (currently lines 322-333) so the merged set is written to disk after the in-memory merge:

```rust
            ControlCommand::AddExclusion {
                host,
                bundle_id,
                app_name,
            } => {
                self.pipeline
                    .add_exclusions(nibbin_redaction::UserExclusions {
                        hosts: host.into_iter().collect(),
                        bundle_ids: bundle_id.into_iter().collect(),
                        app_names: app_name.into_iter().collect(),
                    });
                // The file is the source of truth (T2): persist the merged set
                // so the exclusion survives a daemon restart (T1).
                exclusions::save_exclusions(&self.store_root, self.pipeline.exclusions())?;
            }
```

- [ ] **Step 3: Wipe the file when raw data is wiped**

In `delete_raw_and_verify`, add `"exclusions.json"` to the residual-file cleanup list (currently line 419) so a C3 deletion / delete-everything leaves nothing behind and the verifier's "nothing but study.json" bar still holds:

```rust
        for extra in ["control.jsonl", "control.offset", "daemon.status", "exclusions.json"] {
```

In `clear_store` (fresh-study reset), remove the file too so a new study starts with no inherited exclusions. Add this just before `Ok(())` at the end of `clear_store`:

```rust
        let ex = self.store_root.join("exclusions.json");
        if ex.exists() {
            std::fs::remove_file(ex)?;
        }
```

- [ ] **Step 4: Typecheck the daemon compiles**

Run: `cd apps/desktop/src-tauri && cargo build -p observerd`
Expected: builds with no errors.

- [ ] **Step 5: Run the existing daemon tests (no regressions)**

Run: `cd apps/desktop/src-tauri && cargo test -p observerd`
Expected: PASS — the existing `day14_headless` integration tests (`day14_stop_fires...`, `before_the_deadline...`, `pause_then_resume...`, `delete_everything_via_control_file...`) and the new unit tests all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/observerd/src/lib.rs
git commit -m "feat(observerd): load exclusions on open, persist on add, wipe on delete"
```

---

### Task 5: Headless proof that exclusions survive a restart

**Files:**
- Create: `apps/desktop/src-tauri/observerd/tests/exclusion_persistence.rs`

This mirrors `tests/day14_headless.rs`: spawn the real `observerd --once` binary against a temp store. The proof is restart-safe by construction — the second spawn adds *only* `b.com` (the persisted `control.offset` skips the already-consumed `a.com` line), so the file can contain both hosts **only if** `Daemon::open()` reloaded `a.com` from disk before merging `b.com`.

- [ ] **Step 1: Write the integration test**

Create `apps/desktop/src-tauri/observerd/tests/exclusion_persistence.rs`:

```rust
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
```

- [ ] **Step 2: Run the integration test to verify it passes**

Run: `cd apps/desktop/src-tauri && cargo test -p observerd --test exclusion_persistence`
Expected: PASS (2 tests). If `an_exclusion_survives_a_daemon_restart` fails with `hosts == ["b.com"]`, the load path in Task 4 Step 1 is not wired — `open()` is not reloading before merge.

- [ ] **Step 3: Run the whole daemon + redaction suite once more**

Run: `cd apps/desktop/src-tauri && cargo test -p observerd -p nibbin-redaction`
Expected: PASS — all unit + integration tests across both crates.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/observerd/tests/exclusion_persistence.rs
git commit -m "test(observerd): prove exclusions survive a daemon restart"
```

---

## Self-review notes (verified against the spec)

- **T1 covered** — Task 4 Step 1 (load before capture), Task 5 (restart proof + corrupt-fails-closed).
- **T2 covered** — Task 3 (atomic temp-then-rename `save_exclusions`), Task 4 Step 2 (persist on add).
- **TC-P3 covered** — corrupt file → `Err` → `open()` returns `Err` → daemon does not start (Task 3 + Task 5 Step 1's second test).
- **Wipe paths honored** — Task 4 Step 3 wipes `exclusions.json` in both `delete_raw_and_verify` (C3) and `clear_store` (fresh study), matching the existing residual-file discipline.
- **Recovery from corruption** — documented behavior: a corrupt `exclusions.json` halts the daemon; removing the file (or running delete-everything once the daemon is up) clears it. This is the intended fail-closed posture, not a regression.
- **No new runtime deps** — `serde`/`serde_json`/`anyhow` already used by both crates; `tempfile` already a dev-dependency.
- **Type consistency** — `merge`, `exclusions()`, `save_exclusions`, `load_exclusions` names are used identically across tasks.
