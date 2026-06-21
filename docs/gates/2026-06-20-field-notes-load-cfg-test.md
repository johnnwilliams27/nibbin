# Gate — Restore `field_notes::load` as test-only (fix red daemon CI)

**Date:** 2026-06-20
**Branch:** `fix/field-notes-load-cfg-test`
**Sensitive paths:** `apps/desktop/src-tauri/observerd/` → gate required (path filter).

## Verdict: PASS (controller review)

`#224` deleted `field_notes::load` as "unused," but the function is called five times by the module's own tests (`field_notes.rs:335–511`). With it gone, `cargo clippy --all-targets -- -D warnings` fails to compile the test target (E0425 — `cannot find function load`), leaving the **Observer daemon** CI job red on `main` since `#224` merged. The job is not a required check, so PRs kept merging over a chronically-red signal — which would mask any real future Rust regression.

### Fix
Restore the exact `load` body `#224` removed, annotated `#[cfg(test)]`:
- **Production build:** `load` is not compiled → no `dead_code` warning under `-D warnings` (the legitimate concern behind `#224`). The app reads `field_notes.json` directly; nothing in non-test code calls `load`.
- **Test build:** `load` compiles and the five test call sites resolve → E0425 gone.
- Imports unchanged: `Path` (used at `:164`) and `anyhow::Context` (used at `:209–212`) are already live in non-test code, so the `#[cfg(test)]` function orphans no imports in either build.

### Verification
- `cargo fmt --check` on `observerd`: clean (exit 0).
- Full `clippy`/`cargo test` validated by CI (local Rust link blocked by the OpenSSL/Strawberry-Perl toolchain gap; the daemon job is the authoritative validator).
- No behavior change — test-only helper restored verbatim; the `sort_by_key` clippy fix from `#224` is untouched.

### Risk
Minimal: a test-only file-reader, no network, no production code path, no data surface. Restores green to a safety net rather than changing product behavior.
