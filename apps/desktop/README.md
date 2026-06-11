# apps/desktop — the Observer

Tauri 2.x desktop client (macOS first; Windows behind the same capture trait). Built at M6.

## Process model (who enforces what)

```
observerd (Rust daemon — LaunchAgent/service, NO UI, no network listener)
  capture trait (nibbin-capture: macOS AX / Windows UIA / mock)
    → layer 1 C4: secure fields suppressed structurally at capture
    → layer 2 C5: category blocklist BEFORE persistence
    → layer 3: regex battery (always) + Presidio sidecar (FAIL-CLOSED)
    → SQLCipher store (nibbin-store; key in OS keystore)
  study state machine (nibbin-study) — day-14 hard stop lives HERE (C2)
  verified deletion + receipt (C3)

app (Tauri shell — a CLIENT of the daemon)
  tray countdown (displays daemon-derived state) · C6 pause hotkey
  consent / review UI / local Field Notes / account module (webview, TS)
  sign-in: system browser + nibbin://auth deep link, tokens in keychain (§6.1)
  IPC: writes control.jsonl, reads study.json + daemon.status
```

- `src-tauri/` — Rust workspace. `default-members` (privacy-core crates +
  observerd) build and test on Linux CI; the `app` shell crate builds in the
  platform release pipeline.
- `src/core/` — pure TS twins of the daemon logic (study machine, Field
  Notes) used by the UI and pinned to the Rust side via the shared corpus.
- `src/daemon-sim/` — the TS daemon simulator the CI-blocking redaction
  corpus drives end to end (real files, real deletion verification).
- Redaction RULES are owned by `packages/redaction/rules/*.json` and embedded
  into the Rust crates via `include_str!` — edit there, never fork.
- Capture plumbing fork: `vendor/screenpipe` (MIT commit `892199f742`; see
  VENDOR.md — upstream relicensed after that commit, never pull HEAD).

## Verification status (M6)

- Redaction corpus: green on BOTH implementations (vitest `tests/redaction-corpus`,
  cargo `crates/nibbin-redaction/tests/corpus.rs` + `observerd/tests/day14_headless.rs`).
- Day-14 stop: proven at process level (headless observerd, no UI). C6 gate
  latency proven wait-free in `nibbin-capture::gate` tests.
- NOT yet verified (needs macOS hardware bring-up): live AX capture, §5
  runtime budgets (<5% CPU, <300MB RSS, <5GB/study), permission rehearsal UX,
  end-to-end hotkey latency, signed/notarized builds. `MacAxCapture::start()`
  fails loudly until then — the daemon never pretends to record.

Hard rules: see `docs/INVARIANTS.md` (C1–C7) and `.claude/skills/redaction-corpus`.
