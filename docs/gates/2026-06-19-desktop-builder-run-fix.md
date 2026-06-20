# Adversarial Gate — Desktop Builder/App::run structure fix

**Date:** 2026-06-19
**Branch:** `hotfix/desktop-builder-run`
**Sensitive path:** `apps/desktop/src-tauri/app/src/lib.rs` → gate report required by path filter.

## Verdict: PASS (trivial structural fix)

The `desktop-v0.2.2` release build failed with `error[E0308]: mismatched types —
expected Context, found closure` at `lib.rs:282`. Root cause: #195's D7
tray-exit-cleanup replaced `.run(tauri::generate_context!())`
(`Builder::run(Context)`) with `.run(|app, event| …)` — but the run-event
callback belongs on `App::run`, not `Builder::run`. The earlier E0282 (fixed in
#201) was masking this.

**Fix:** restore the canonical Tauri 2 structure —
`Builder…​.build(tauri::generate_context!()).expect(…).run(|app, event| …)`. The
Context is supplied to `build()`; the exit-cleanup closure runs on the resulting
`App`. Verified against the last-good `desktop-v0.2.1`, whose only builder-tail
difference was the single `.run(generate_context!())` line #195 overwrote.

- **Red-team / Logic / Cost / Claims:** no behavior change beyond making the app
  actually build; tray-on-exit cleanup is preserved verbatim. No new IO/auth/data
  surface. Validated by the release build compiling the app crate clean.

Why latent: the "Observer daemon" CI job compiles `observerd`, not the tauri app
crate — the app only compiles at release time.
