# Security Pass — `feature/nibbin-desktop-unified-app`

**Date:** 2026-06-15
**Scope:** the full branch diff `origin/main..HEAD` (72 commits): Phase 2 cloud sync, packet enrichment, finer re-mining, Phase 3 quick scan, the richer-diagnosis + Group A reveal, the Maya surfaces (roster, hatch, Today feed), the Opus quality refinements, and the desktop unified-app changes.
**Method:** five focused analyses — (1) web server-actions/API authz & IDOR, (2) LLM prompt-injection & output handling, (3) Tauri/desktop client trust boundary, (4) installer/distribution threat model (`2026-06-15-installer-desktop-threat-model.md`), (5) migrations/RLS — plus verification of the headline desktop finding against the Tauri 2 framework source. Semgrep/SAST was unavailable on the build host (not installed); the analyses were manual.

## Headline correction (a false positive worth recording)

The desktop review flagged HIGH×2 "the Grove webview can call `access_token` and steal the JWT." **This is not exploitable.** Confirmed from Tauri 2 source (`crates/tauri/src/webview/mod.rs`): custom commands reject any request from a **remote origin** unless an explicit `remote` capability is configured. The Grove tab is a remote `WebviewUrl::External` and there is **no `remote` capability**, so it cannot reach any custom command. The trust boundary for the IPC surface is intact by Tauri's default. We therefore did NOT add a capabilities/ACL manifest (it would risk breaking the working local UI for no security gain) and instead added defense-in-depth (navigation lock, CSP pin).

## Verdict by area

- **Web server-actions + API routes — STRONG.** Every service-role write/delete/read is account-scoped (`.eq('account_id', accountId)` with `accountId` derived server-side from a verified session); no IDOR; the desktop PKCE code-exchange routes were *removed* this branch (replaced by keychain + init-script handoff). The Bearer packet route validates the JWT cryptographically and upserts on an account-scoped key.
- **LLM prompt-injection — BOUNDED.** "Data not instructions" + JSON-shape validation + length clamps + an allow-list on refined keys. All model output renders as React **text** (no XSS); `dangerouslySetInnerHTML` is used only for the typed creature engine, never model/user content. Blast radius is self-targeted (a user's crafted packet only affects their own reveal).
- **Migrations/RLS — APPROVED.** The new columns/indexes preserve account isolation: `authenticated` has zero write surface on `diagnoses`/`nibbins` (M4/M7 `REVOKE`s cover added columns), reads are member-scoped, the `(account_id, study_id)` partial unique index can't collide or leak cross-account.
- **Desktop client — INTACT (after de-escalation) + hardened.** No remote-IPC exploit. Remaining items were hygiene/defense-in-depth.
- **Installer/distribution — see the threat model.** Biggest gaps are operational: unsigned Windows build, the `/download` redirector trusting the latest release without pinning, and unpinned CI actions that run with (currently absent) signing secrets.

## Fixed in this pass

| Fix | Severity | Commit |
|---|---|---|
| `refreshLearnedNote` 6h cooldown — caps Opus cost to ~1/nibbin/6h regardless of action-loop attempts (the scaled-cost concern) | med | `8e57dab` |
| Strip URLs + HTML from stored LLM prose (`letter`/`label`/`description`/note) — neutralizes injected phishing links/markup before storage | med | `8e57dab` |
| Desktop-auth handoff: capture+delete `__NIBBIN_HANDOFF__` synchronously at module load; strip the URL fragment before token handling | med | `8e57dab` |
| Desktop CSP: pin `*.supabase.co` → the prod project origin; add explicit `script-src 'self'` | med | `7a802b7` |
| `create_study` input bounds (id ≤64, label ≤256) + UI `maxlength` | med | `7a802b7` |
| Grove webview navigation lock (`on_navigation`, fail-closed to the web origin) | def-in-depth | `7a802b7` |
| Drop the orphaned `desktop_auth_codes` table (held plaintext sessions; backed only the deleted routes) | hygiene | migration `20260615150000` (dev-applied) |

## Cost / scaled-download abuse — answered definitively

**Mass downloads cannot charge per cert.** Signing happens once per release at **CI build time**; the signed artifact is published once to GitHub Releases and served **free/unmetered** by GitHub. `/download` only 302-redirects — no signing op or Nibbin infra is on the download path. A million downloads ≈ $0. The only cost levers are CI build frequency + the Azure signing quota, and release triggers are maintainer-gated (`workflow_dispatch` + `desktop-v*` tag; **no `pull_request` trigger**), so forks/PRs can't drive signed builds. Recommended guardrails (in the threat model): GitHub Environment reviewers on the publish job, a protected `desktop-v*` tag ruleset, and an Azure signing-quota alert.

## Accepted for beta / pre-GA follow-ups (NOT fixed now, with rationale)

**Before enabling Windows code-signing:**
- **Pin CI actions by SHA** — `tauri-apps/tauri-action@v0` (runs with signing secrets) + `rust-toolchain@stable`, `cache@v4`, `upload/download-artifact@v4`, `attest-build-provenance@v2`, and `cargo install trusted-signing-cli --version`. Not done now because (a) signing is dormant (no Azure secrets present), so the secret-exposure risk is latent, and (b) pinning to a guessed SHA could break CI. Do this as the gate to turning signing on.
- Keep the Windows build **beta-gated** until Azure Trusted Signing validates (workflow auto-enables on secret presence — no code change needed).

**Distribution hardening:**
- `/download` trusts the newest GitHub release with no version/checksum pinning — a single poisoned release reaches all users. Add release-tag pinning or checksum verification; surface SHA256SUMS + verify instructions in the download UI (currently invisible).
- No auto-updater exists — updates are manual (no hijackable channel, but also no remote kill-switch). Decide intentionally for GA.

**Desktop hygiene (all gated by "only the trusted local webview can call commands"):**
- `auth_session` returns the refresh token to the (local) webview — minimize to is-signed-in + non-secret metadata.
- `store_session` writes token values without JWT-shape validation.
- `delete_everything` is bypassable at the IPC layer (UI two-click guard is the safeguard) — consider an OS confirm dialog.
- `control.jsonl` default perms on macOS (same-user local attacker could inject control lines) — set 0600 + owner check.

**Web minor:**
- Bearer route trusts the `Content-Length` header for its 512KB guard (a client can omit it; Next's 4MB default is the real bound) — add a streaming byte cap if strict bounding is wanted.
- `deleteDiagnosis` swallows DB errors silently (log them); `decideRunAction` lacks a UUID-format pre-check (downstream ownership check still gates it).
- Publishable key hardcoded in two desktop files — single-source via build injection.

**Schema trip-wire:** if any future migration grants `authenticated` a column-selective UPDATE on `nibbins`/`diagnoses`, a matching `FOR UPDATE` RLS policy becomes mandatory.

None of the deferred items are live-exploitable on the current (sequential, signing-dormant, handoff-gated) configuration.
