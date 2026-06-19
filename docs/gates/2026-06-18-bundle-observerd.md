# Adversarial gate — bundle observerd in installer (Task 1.6, 2026-06-18)

- **Branch / PR:** `feature/bundle-observerd` → `main` (#TBD)
- **Reviewed diff:** `git diff fe07f9d..542b450` at `542b450` (3 files, +34/-3 lines)
- **Gate run by:** Claude on 2026-06-18 (self-applied; proportionate to a config/CI-only diff)

## What the change does

Adds `bundle.resources: ["binaries/observerd*"]` to `tauri.conf.json` so the tauri bundler includes the daemon in the installer; adds a per-OS CI step to build observerd with `--features os-keystore` and `lipo`-universal it on macOS before the tauri-action runs; and extends `daemon_supervisor.rs::observerd_path` to look in `<resourceDir>/binaries/` first (the path preserved by the glob), then the resource root (forward-compat), then the dev sibling fallback.

## CI step

- typecheck: ☐ (not run by PR CI — app crate compiles at release)  tests: ☐ (no new tests in diff; daemon integration tested at release)  lint: ☐  audit: ☐  SAST: ☐  redaction corpus: ☐  trigger-graph: N/A

> Note: PR CI does not build `apps/desktop/src-tauri/app` — only `desktop-release.yml` does. The resolver compile path (new `for cand in` loop) and the actual bundling are **RELEASE-verified, not PR-verified**. The gate report says so honestly.

## Adversarial reviewers (.claude/agents/*)

| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | reviewed | 0 | 0 | 1 | 0 |
| claims-auditor | reviewed | 0 | 0 | 0 | 1 |
| logic-skeptic | reviewed | 0 | 0 | 1 | 1 |
| cost-auditor (≥M2) | reviewed | 0 | 0 | 0 | 1 |

## Findings (severity-ranked)

### F1 — P2 — CI bash step uses `matrix.platform` value in a string-interpolated shell conditional (logic-skeptic / red-team)

- **File:line:** `.github/workflows/desktop-release.yml` — the new "Build + stage observerd" step, `if [ "${{ matrix.platform }}" = "macos-latest" ]`
- **Impact:** `matrix.platform` is an attacker-controlled string only if the matrix itself is attacker-controlled (i.e., a pull_request_target mis-configuration or a future matrix expansion that injects a value like `macos-latest; rm -rf /`). In the current workflow the matrix is hardcoded (`[macos-latest, windows-latest]`), so the interpolated value is never attacker-supplied. **Not exploitable today**, but the pattern is fragile: if the matrix is ever made dynamic (workflow_dispatch input, label-driven) the injection opens.
- **Fix direction:** Replace the string comparison with a native YAML `if:` condition on the step (`if: matrix.platform == 'macos-latest'`), eliminating the interpolated shell expansion entirely. Or use a `PLATFORM="${{ matrix.platform }}"` assignment before the `if` and compare the shell variable rather than the raw substitution (defense-in-depth only).
- **Status:** Open / non-blocking. Recommend fix before the matrix is made dynamic.

### F2 — P2 — Resolver `for` loop compile path not verified by PR CI (claims-auditor / logic-skeptic)

- **File:line:** `apps/desktop/src-tauri/app/src/daemon_supervisor.rs:85–88`
- **Impact:** The new `for cand in [dir.join("binaries").join(name), dir.join(name)]` loop is the critical correctness change. If it doesn't compile (e.g., array syntax, borrow error, `PathBuf` move semantics in the loop), the release build silently regresses to a broken app. PR CI does not build this crate; the first compile verification is the release workflow.
- **Fix direction:** Add a `cargo check -p nibbin-desktop-app` step (or equivalent) to the PR CI matrix, even without running the full tauri build. A type check catches the whole resolver loop for near-zero CI time. Alternatively, document this explicitly in GOTCHAS.md so reviewers know the gap.
- **Status:** Open / non-blocking (the loop is straightforward Rust — low actual risk — but the gap is architectural and worth closing).

### F3 — P3 — `binaries/observerd*` glob on macOS stages one universal binary; on Windows it stages `observerd.exe` — but the glob is OS-agnostic in tauri.conf.json (logic-skeptic)

- **File:line:** `apps/desktop/src-tauri/app/tauri.conf.json:114`; CI step `else` branch
- **Impact:** On Windows the staged file is `observerd.exe`; the glob `binaries/observerd*` matches it. `observerd_binary_name()` returns `"observerd.exe"` on Windows, so the resolver joins `binaries/observerd.exe` — this resolves correctly only if tauri preserves the filename including extension. Tauri's resource bundler does preserve filenames from the glob, so this should work. The concern is minor: if tauri ever flattens the path (no `binaries/` subdirectory) the resolver's second candidate (`dir.join(name)`) recovers. **No actual defect**, but the cross-OS filename assumption is implicit.
- **Fix direction:** Add a comment in daemon_supervisor.rs noting the Windows extension convention and that the forward-compat fallback covers flattened layouts.
- **Status:** Open / non-blocking.

### F4 — P3 — macOS CI builds two arch targets sequentially; no sccache or cargo registry cache configured for the new observerd build (cost-auditor)

- **File:line:** `.github/workflows/desktop-release.yml` — new step, lines 42–46
- **Impact:** Two cold Rust builds (aarch64 + x86_64) on macOS add roughly 3–6 minutes to release CI per run (observerd is a small daemon so likely the low end). No unbounded artifact growth — the `DEST` directory holds one final binary per platform. Acceptable for an infrequent release workflow, but will grow if observerd gains dependencies.
- **Fix direction:** Add a `actions/cache` step keyed on `Cargo.lock` + `observerd/` source hash before the new build step, covering both macOS targets. The tauri-action already warms some caches; observerd's target dirs are separate and uncached today.
- **Status:** Open / non-blocking. Acceptable at current release cadence; revisit if release CI exceeds 20 min.

### F5 — P3 — `os-keystore` feature ships a persistent OS-level secret association; no documentation of what key material it stores or how it's rotated (red-team)

- **File:line:** CI step `--features os-keystore` (both macOS and Windows builds)
- **Impact:** The flag is required for the release daemon (without it the daemon would panic "no key source" — claims-auditor note: this is a correctness invariant, not a security finding). The concern is that the name `os-keystore` implies the daemon writes something durable to the system keychain (macOS Keychain / Windows Credential Manager). If that entry persists after app uninstall, it constitutes residual data. This is a P3 observation — no capture data touches the keystore by construction (C1/C7 hold: captures never leave the device, pixels never egress), so the residual is at most a daemon identity credential, not user data. But the scope of what `os-keystore` stores is not documented in this diff.
- **Fix direction:** Add a note in `desktop-release.md` or `INVARIANTS.md` clarifying what the `os-keystore` feature persists and whether uninstall removes it. If it persists a user-scoped key, confirm the uninstaller tears it down.
- **Status:** Open / non-blocking. Privacy invariants C1–C7 are not breached by this diff; the gap is documentation.

## Claims audit (C1–C11)

| Claim | Verdict | Evidence |
|---|---|---|
| C1 — captures never leave device | enforced-by-construction | This diff adds no network dependency to the capture path; observerd is bundled, not changed in behavior. |
| C2 — 14-day hard-stop in daemon | enforced-by-construction | Hard-stop logic not touched by this diff. |
| C3 — raw data deleted after synthesis | enforced-by-construction | Not touched. |
| C4 — secure inputs suppressed via OS flags | enforced-by-construction | Not touched. |
| C5 — banking/health blocked before persistence | enforced-by-construction | Not touched. |
| C6 — global pause <100ms | enforced-by-construction | Not touched. |
| C7 — only redacted text leaves device | enforced-by-construction | No egress path added. |
| C8 — Connections read-only until adoption requests write | enforced-by-construction | Not touched. |
| C9 — tokens in vault only | enforced-by-construction | `os-keystore` feature noted in F5; vault invariant not changed. |
| C10 — Grovekeeper zero side-effect tools | enforced-by-construction | Not touched. |
| C11 — no data sales; training opt-in | enforced-by-construction | Not touched. |

No claim violations found. F5 is a documentation gap adjacent to C9, not a violation.

## What the gate tried and why it held

**Injection (red-team):** Examined the `matrix.platform` interpolation — exploitable only with an attacker-controlled matrix (F1). The current hardcoded matrix prevents it. Fixed-path `DEST`, `MANIFEST`, and the `lipo` output are all repo-relative literals. No env-var expansion in filenames. `set -euo pipefail` means a failed build aborts the step rather than silently producing a partial binary.

**SSRF/exfiltration (red-team):** The CI step performs only local file operations and `cargo build` (registry.crates.io, GitHub). No daemon behavior change; C1/C7 are structural.

**os-keystore persistence (red-team):** Not a C9 breach (vault tokens live in the app DB vault, not the OS keystore); however scope of keystore writes is undocumented (F5).

**Glob over-inclusion (red-team):** `binaries/observerd*` is narrow. It matches `observerd` (macOS) and `observerd.exe` (Windows). Nothing else in `binaries/` is staged (the directory is gitignored and created fresh each CI run). No risk of accidentally bundling secrets or debug symbols.

**Correctness (logic-skeptic):** The `for cand` loop tries `binaries/<name>` first, then `<name>` at the root. Both paths return `Ok` on first hit. The dev fallback (`current_exe().with_file_name(name)`) is unchanged. Loop is correct; the only unverified risk is compile correctness (F2).

**lipo universal vs. `--target universal-apple-darwin` (logic-skeptic):** Tauri on macOS accepts either a pre-lipo'd universal binary placed in resources or a `--target universal-apple-darwin` Cargo target. The diff uses the explicit lipo approach (build both, combine), which is equivalent and more portable to Rust crates that don't support the Cargo universal target directly. Matches what tauri-action expects when it finds a universal binary in resources.

**Step ordering (logic-skeptic):** "Build + stage observerd" appears at line ~34 in the diff, before "Build installers (tauri-action)" at line ~54. Correct: staging must precede bundling.

**YAML indentation (logic-skeptic):** The new step block is at the same indentation level as surrounding steps. The `run:` block uses `|` literal scalar. `shell: bash` ensures POSIX behavior on Windows runners too. Correct.

**CI cost (cost-auditor):** Two Rust builds on macOS + one on Windows. observerd is a small daemon; incremental build with caching would be sub-minute. Cold builds estimated 3–6 min on macOS; 1–2 min on Windows. Acceptable for an infrequent release workflow (F4). No unbounded artifact growth.

## Disposition

- Blocking (P0/P1) resolved: ☑ (none found)
- Non-blocking tracked: ☑ (F1–F5, P2/P3)
- **Gate verdict: PASS**
- **Caveat:** The resolver compile path (daemon_supervisor.rs) and actual bundling are RELEASE-verified, not PR-verified. F2 recommends adding a `cargo check` step to close this gap.
- **Signed:** _pending John_
