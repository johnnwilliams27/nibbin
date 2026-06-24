# Adversarial Gate — Desktop shell-auth ACL (PR #252)

**Date:** 2026-06-23
**Branch:** `fix/desktop-store-session-acl`
**Surface:** `apps/desktop/src-tauri/app/capabilities/default.json` + new `apps/desktop/src-tauri/app/permissions/shell-auth.toml`
**Verdict:** **PASS** — Critical 0 · Important 0 · Minor 0

## Change under review
The desktop `main`-window capability (`default.json`) previously granted only `core:event:default`, so Tauri's compile-time ACL rejected every `invoke()` from the native shell — breaking login (`store_session` → "command not allowed by ACL") and 7 sibling commands. This PR adds a `shell-auth.toml` permission set (8 single-command permissions) and references them from `default.json`.

## Red-team / least-privilege
- **Grant target is the trusted local shell only.** All 8 permissions are added to `default.json`, whose `windows` is `["main"]` and which has **no `remote` field** — the `main` webview loads only bundled app content (`asset://`/localhost). It cannot load remote/attacker content, so granting it shell+session commands is not an escalation.
- **Remote webview gets none of these.** `grove-remote.json` (the only capability scoped to the remote `https://nibbin.com` `grove` webview) is unmodified and contains **zero** of these identifiers (verified). The session handoff to Grove is via an init script, not IPC, so the keychain boundary is preserved. The grove webview still cannot call `store_session`/`auth_session`/`sign_out`.
- **Per-command scoping.** Each `[[permission]]` lists exactly one command in `commands.allow` — no wildcard grants. Identifiers follow the existing `bridge-read.toml` `allow-<command-with-dashes>` scheme.
- **Sensitive commands carry their own guards:** `open_external` validates `https` + an origin allowlist `{nibbin.com, www.nibbin.com, github.com}` in Rust before handing the URL to the OS (confused-deputy mitigation); `check_for_update` is read-only; session commands persist to the OS keychain (minimized to the Credential Manager blob limit).

## Claims-audit
- **Build-time validity:** CI "Desktop app crate (cargo check)" **passed** — Tauri's `build.rs` resolves every referenced permission identifier against a real command, so there are no dangling/typo'd grants.
- **All 8 commands exist** as `#[tauri::command]`s in `src-tauri/app/src/` (verified): store_session, auth_session, sign_out, grove_show, grove_hide, grove_reload, check_for_update, open_external — and each is registered in `lib.rs`'s `generate_handler!`.

## Logic / cost
- No new commands, no daemon/privacy-invariant change (C2–C5 enforcement remains in the daemon). Login is the only behavior restored. No cost surface.

## Signing note (Bug B, investigated not changed)
0.2.3's Windows artifact **is** correctly signed via Azure Trusted Signing (release run `27880821688`: `Signing completed with status 'Succeeded'`). The install "Run anyway" prompt is Windows SmartScreen reputation latency on a new publisher cert — not an unsigned artifact and not fixable in code; it abates as install reputation accrues.

## Must-fix
None. Ship.
