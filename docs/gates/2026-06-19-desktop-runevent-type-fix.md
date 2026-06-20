# Adversarial Gate — Desktop RunEvent closure type fix

**Date:** 2026-06-19
**Branch:** `hotfix/desktop-runevent-type`
**Sensitive path touched:** `apps/desktop/src-tauri/app/src/lib.rs` → gate report required by path filter.

## Verdict: PASS (trivial)

Single-line change: added explicit types to the `.run(|app, event| …)` closure
parameters (`app: &tauri::AppHandle`, `event: tauri::RunEvent`). This resolves a
latent `error[E0282]: type annotations needed` that broke the `desktop-v0.2.2`
release build — the `RunEvent<T>` generic could not be inferred from the closure
body. The defaults (`AppHandle<Wry>`, `RunEvent<EventLoopMessage>`) are the
standard Tauri 2 run-callback types; behavior is unchanged.

Why it wasn't caught earlier: the CI "Observer daemon" job compiles `observerd`,
not the full tauri app crate; the app is only compiled at release time, so this
error from #195's D7 tray-exit-cleanup sat latent until the first 0.2.2 build.

- **Red-team:** no surface — type annotation only, no new IO/auth/data path.
- **Logic:** identical runtime behavior (Exit → hide tray); only the param types are now explicit.
- **Cost:** none.
- **Claims:** the fix is the compiler's exact E0282 recommendation; validated by the release build compiling past this point.
