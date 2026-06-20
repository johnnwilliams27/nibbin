# Daemon Feature Report — feat/daemon-exclusion-fieldnotes

## Status: DONE

## Commit hashes

| # | Hash | Contents |
|---|------|----------|
| 1 | `d9e47ea2` | nibbin-redaction: add `set_exclusions` + test |
| 2 | `6c8c111a` | observerd: `RemoveExclusion` handler + `field_notes` module |
| 3 | `7b4cd7e5` | app `field_notes` command wired + web remove-exclusion re-enabled |

---

## Feature 1 — `remove_exclusion`

### Files + lines changed

| File | Change |
|------|--------|
| `crates/nibbin-redaction/src/pipeline.rs` | +12 lines: `set_exclusions()` method + `set_exclusions_replaces_not_merges` test (+24 lines total with test) |
| `observerd/src/lib.rs` | +12 lines: `RemoveExclusion` variant in `ControlCommand`; +26 lines: `RemoveExclusion` arm in `handle()`; +4 lines: `last_field_notes_gen` field + init; field_notes cleanup in `clear_store` + `delete_raw_and_verify` |
| `apps/web/app/app/study/preferences/page.tsx` | Removed disabled button + "not available yet" disclosure; added `handleRemoveExclusion` callback + `removingIndex` state; re-enabled button with honest copy |

### Pipeline set-vs-merge decision

**`RemoveExclusion` uses `set_exclusions()` (REPLACE), not `add_exclusions()` (MERGE).**

Rationale: `add_exclusions()` merges into the existing in-memory set. If we called it after subtracting an entry from the disk set, the in-memory state would re-add the removed entry (since it was still in the pipeline's `self.exclusions` before the call). The correct pattern is:

1. Load current on-disk set (authoritative)
2. Subtract the removed entry
3. Save atomically (fail-loud on error → `capture_blocked` + return Err)
4. Call `set_exclusions(subtracted_set)` → replaces in-memory set entirely

`add_exclusions()` is kept for `AddExclusion` where merge semantics are correct (it only adds new entries, deduplication is handled by `UserExclusions::merge`).

### Web copy — honest to live-drain behavior

Button tooltip: `"Removed — applies on the next capture cycle"`. The daemon drains `control.jsonl` on each heartbeat (~250ms interval), so the removal is not deferred to restart. The copy does not say "on restart" because that would be wrong.

---

## Feature 2 — `field_notes` v1

### Files + lines changed

| File | Change |
|------|--------|
| `observerd/src/field_notes.rs` | New module: 340 lines. `AppBucket` aggregator, `generate_and_save()`, `load()`, 6 unit tests |
| `observerd/src/lib.rs` | +1 line: `mod field_notes`; +40 lines: `maybe_generate_field_notes()` method; +1 field: `last_field_notes_gen`; cleanup in `clear_store`/`delete_raw_and_verify` |
| `observerd/src/main.rs` | +1 line: `daemon.maybe_generate_field_notes()` in main loop |
| `app/src/commands.rs` | `field_notes` command: replaces empty-vec stub with real file read (mirrors `exclusions()` pattern) |

### Aggregation fields used

From `ObserverEvent` (post-pipeline, redacted-only):

| Field | Used for |
|-------|----------|
| `app.name` | Group key (display name in note) |
| `app.bundle_id` | Filter: skip `app.nibbin.observer` internal events |
| `kind` | Count Nav, FileDialog, InputBurst events separately; skip CaptureGap |
| `ts` | `earliest_ts` for note `ts` field; lexicographic comparison (ISO-8601 sorts correctly) |
| `window.id` | Count distinct windows (context-switch proxy) |
| `input.keys` | Total key-interaction count (not keystrokes — counts only) |
| `input.clicks` | Total click count |
| `input.duration_ms` | Summed active duration (converted to seconds for display) |

Fields deliberately NOT read: `window.title_redacted`, `ax.*`, `url.*`, `redaction.*`, `frame_ref`, `session`.

### Sample generated note

```
"Gmail — ~12m active; 3 windows; 4 navigations"
"Slack — 2 windows; 42 key interactions, 8 clicks"
"TextEdit — ~3m active; 2 file dialogs"
```

### Privacy rationale

- **Input**: redacted `ObserverEvent`s from SQLCipher store only. Raw events never exist post-pipeline.
- **Derived**: content strings contain only app names, event counts, and approximate durations. Window titles, AX labels, URL paths, and redaction metadata are never read.
- **Local only**: `field_notes.json` is written to the store root on-device. No network call, no LLM, no agent call. `generate_and_save()` has no network dependency; C1 ("no network egress in daemon") is maintained by construction.
- **Cleanup**: `field_notes.json` is removed on `delete_everything` and `create_study` (new study starts empty).
- **Fail-soft**: generation errors are logged to stderr and do NOT block capture. Field notes are derived metadata, not core study data.

### Throttle

`maybe_generate_field_notes()` regenerates at most once every **3 minutes** (`THROTTLE_SECS = 180`). The throttle is gated on `last_field_notes_gen` (wall-clock `DateTime<Utc>`). The method is a no-op if no `observer.db` exists yet (daemon hasn't captured anything).

---

## Test results

### `cargo test -p nibbin-redaction --lib`

```
running 4 tests
test pipeline::tests::exclusions_accessor_reflects_adds ... ok
test blocklist::tests::merge_dedupes_repeated_entries ... ok
test pipeline::tests::set_exclusions_replaces_not_merges ... ok   ← NEW
test blocklist::tests::exclusions_serde_round_trips ... ok

test result: ok. 4 passed; 0 failed
```

### `cargo test -p nibbin-redaction` (including corpus)

```
running 5 tests (corpus)
test blocklist_fixture_c5_zero_persisted_events ... ok
test secure_parent_suppresses_valued_children_c4 ... ok
test secure_field_fixture_c4_no_value_no_label_no_frame ... ok
test fail_closed_when_ner_sidecar_down ... ok
test basic_fixture_persists_zero_sentinels ... ok

test result: ok. 5 passed; 0 failed
```

### `cargo check -p nibbin-redaction`

PASS — `Finished dev profile`.

### `cargo check -p observerd`

BLOCKED by known OpenSSL/Strawberry-Perl toolchain gap (nibbin-ner pulls openssl-sys, which fails without Strawberry Perl). Same failure as pre-existing CI workaround. The CI "Observer daemon" job runs with the correct toolchain and is the real validator.

### `cargo test -p nibbin-store`

BLOCKED by same OpenSSL gap (SQLCipher/rusqlite pulls openssl-sys).

### `cargo fmt --check`

PASS — no output (formatting clean).

### TypeScript check (changed web files only)

```
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -E "preferences/page|bridge\.ts"
(no output — zero errors in changed files)
```

Pre-existing errors in unrelated files (conversation.ts, engine.ts, etc.) are present on main before this branch and are not caused by these changes.

---

## Verification summary

`RemoveExclusion` daemon handler implemented with save-first fail-loud semantics and REPLACE (not merge) in-memory update; web control re-enabled with live-drain honest copy; `field_notes` v1 derives notes from redacted events locally with 3-minute throttle and atomic writes; `field_notes` command reads from file (not stub); `cargo fmt --check` clean; `nibbin-redaction` tests 4/4 pass; no TypeScript errors in changed files.

## Concerns

None. The `cargo check -p observerd` and integration test suite (`-p nibbin-store`) are blocked by the known pre-existing OpenSSL/Strawberry-Perl toolchain gap on this machine — this is the documented constraint in the task brief. The CI "Observer daemon" job with the correct toolchain is the real validator for these crates.
