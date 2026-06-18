# Trust & Controls — Design Spec

**Date:** 2026-06-17
**Status:** Draft for review
**Scope:** The user-facing privacy/trust surfaces and the durability/honesty guarantees behind them — exclusion persistence, review-before-upload, the web Data & Privacy panel, the C11 training opt-out + fleet-learning opt-out toggles, the credential-vault management UI, the notification-channel preferences UI, the recording indicator, delete-everything reachability, the routed legal pages (`/privacy`, `/data-ai`, `/subprocessors`), and the copy-accuracy fixes that make every public claim match shipped behavior.

**Companion specs (built in parallel, not here):**
- **Agent Synthesis** (`2026-06-17-agent-synthesis-design.md`) — owns the *runtime* contracts this spec puts controls on: the C9 credential vault behavior (§10 there), the notification-channel routing logic (§11 there), the Tier-2 fleet-learning data flow + hard user-edge boundary (§12B there), and the model-routing subprocessor governance (§4B there). **This spec owns the user-facing controls; that spec owns the runtime behavior.** Cross-referenced throughout as `AS-Rnn` / `AS-§n`.
- **Capture bring-up** (M6 macOS / M8 Windows) — lands the OS-level enforcement that two latent claims (C4 OS-flag suppression, C6 <100ms pause) depend on. This spec's copy-accuracy fixes are written so they are *true today* and tighten automatically when bring-up lands.

---

## 1. Goals & non-goals

**Goal:** Make Nibbin's privacy posture **true, reachable, durable, and honest** — close the gap between what the invariants/marketing promise and what the code actually enforces and exposes. Every privacy claim is backed by enforced behavior; every control the backend supports is reachable by a user from the surface where they'd look for it; privacy-protective state survives restarts; nothing derived leaves the device without a review gate.

**Non-goals (this spec):** the capture engine itself; the OS-flag/latency enforcement work (Capture bring-up owns C4/C6 *enforcement* — this spec owns only the *honesty of the copy* until then); the runtime credential-vault / notification-routing / fleet-learning *mechanisms* (Agent Synthesis owns those); net-new legal posture (we route + reconcile existing reference copy, we don't invent new promises).

---

## 2. Originating requirements — the three privacy audits

This spec exists to discharge three audits raised in the originating conversation. They are the requirement source; §11's ledger traces every item back here.

- **Audit 1 — Capture-side durability & egress.** Do the protective controls actually hold? Two P0 findings: (a) **exclusions do not persist across a daemon restart** — fail-open to capture; (b) **no review-before-upload** of the synthesis packet — the only artifact that leaves the device (C7) leaves unseen.
- **Audit 2 — Web Data & Privacy controls.** The web app has **zero field-study privacy controls** and **no Data & Privacy panel**; the legal pages (`/privacy`, `/data-ai`, `/subprocessors`) **404**; the backend opt-out flag and credential-revocation RPC exist with **no UI**.
- **Audit 3 — Copy accuracy ("no misspeaking").** Public claims that outrun shipped behavior: the **C11 opt-out** (copy says "opt out anytime in settings"; no toggle exists; the DB default contradicts the invariant), **C6 <100ms pause** (~250ms measured, #22), **C4 OS-flag suppression** (type-level only, OS mapping is #23), **"personal sites are never captured"** (category-blocklist, not literal "personal"), and the **404 subprocessor list** that the privacy policy points to.

---

## 3. Principles (load-bearing — referenced by requirements)

- **TC-P1 — Promise equals behavior ("no misspeaking").** No public claim ships before the code enforces it. Where a claim is aspirational (C4 OS-flag, C6 latency), the copy is rewritten to state only what is true *today* and tightens when enforcement lands. The invariants (C1–C11), the marketing pages, and the database must describe the **same** behavior.
- **TC-P2 — Controls are reachable, not buried.** Every privacy control is reachable from the surface where a user would look for it. Destructive-but-protective actions (delete-everything) are reachable from **every** screen; opt-outs live in a single discoverable **Data & Privacy** home on both web and desktop.
- **TC-P3 — Protective state is durable and fails safe.** Privacy-protective state (exclusions, pause, blocklist) persists across restart/crash/update and is reloaded **before capture resumes**. The failure mode of any ambiguity is *don't capture*, never *capture anyway* (fail-closed, never fail-open).
- **TC-P4 — Review before egress.** Nothing *derived* leaves the device without a user-visible review gate. The synthesis packet (the only egress artifact, per C7) is shown — with the actual structured text that will be sent — and the user can redact/cancel before upload.
- **TC-P5 — Secrets only in the authenticated surface (inherits AS-P4).** Notifications reach the user anywhere; secret entry (passwords, credentials, 2FA) happens **only** in the authenticated Nibbin surface. The notification-preferences and credential-management UIs in this spec enforce that boundary.
- **TC-P6 — Schema-ready is not shipped.** A backend flag, RPC, or column with no UI is an *unkept promise*. This spec closes the UI gap for every privacy control the backend already supports (training opt-out RPC, connection revoke, drip quiet-hours), and pairs every new backend control (fleet opt-out, notification channels, credential vault) with its UI in the same deliverable.
- **TC-P7 — Two-tier opt-out honesty.** "Training on your content" and "anonymized fleet/structural contribution" are **different things** and get **different controls and copy**. Training on user *content* (raw captures, memory, Style Profile) is **never done — a hard invariant, not a toggle**. The **fleet/structural contribution** (AS-§12B, anonymized aggregate system statistics, never content) is the thing that has an opt-out. Each toggle's copy states *exactly* what it does and does not cover.

---

## 4. Architecture overview

Trust & Controls spans three layers; this spec touches all three but its center of gravity is the **control surfaces**.

| Layer | What lives here | This spec's job |
|---|---|---|
| **Enforcement** (daemon / redaction crate / RLS) | exclusions, category blocklist, pause, vault RLS, deletion | Fix the **durability** gap (exclusion persistence); rely on existing enforcement for the rest |
| **Egress** (sync-study → `/api/study/packet`) | the one artifact that leaves the device | Insert the **review-before-upload** gate |
| **Control surfaces** (web settings, desktop preferences, marketing/legal pages) | toggles, panels, indicators, routed pages | Build the **Data & Privacy** home, the opt-out/credential/notification UIs, route the legal pages, fix the copy |

The **Data & Privacy panel** (web + desktop) is the spine: a single home that surfaces every control and links to the rest. It is the missing artifact Audit 2 names.

---

## 5. Capture-side durability (Audit 1, P0)

### 5.1 Exclusion persistence (the fail-open bug)

**Current behavior (confirmed):** exclusions are added via `bridge.addExclusion()` → written as a command to `observer-store/control.jsonl` (`app/src/commands.rs:148`) → drained by the daemon (`observerd/src/lib.rs:234`) → applied to the in-memory `RedactionPipeline.exclusions` (`crates/nibbin-redaction/src/pipeline.rs:26`). On startup `Daemon::open()` constructs the pipeline with `UserExclusions::default()` (empty) (`observerd/src/lib.rs:153`, `pipeline.rs:33`) and **never reloads exclusions**. Because `control.jsonl` is consumed by a persisted offset, an exclusion command past the offset is **never re-applied**. A crash/update/reboot mid-study silently resumes capturing previously-excluded apps/sites — a fail-open violation of TC-P3.

**Required behavior:**
- Exclusions persist to a durable, daemon-owned store (`observer-store/exclusions.json`, or an `exclusions` table in the local SQLCipher store — chosen during build for atomic-write safety).
- `Daemon::open()` **loads exclusions before the capture loop starts** (`UserExclusions` is hydrated from the store, not `::default()`), so capture never runs an exclusion-free window after restart.
- Every add/remove updates the durable store atomically (write-temp-then-rename) *before* acknowledging to the UI; the in-memory pipeline is the cache, the store is the source of truth.
- The store is wiped by `delete_everything` (§8) and by C3 post-synthesis deletion.

**Unhappy paths:** store unreadable/corrupt on startup → **fail closed: pause capture and surface an error**, never start with empty exclusions. Write failure on add → the UI reports the exclusion did *not* take, and capture of that target stays paused until confirmed.

### 5.2 Review-before-upload of the synthesis packet

**Current behavior (confirmed):** on entering `SYNTHESIZING`, `syncStudy()` builds the packet via `segmentStudy()` and immediately `POST`s it to `${WEB_ORIGIN}/api/study/packet` (`apps/desktop/src/ui/sync-study.ts:30-49`) with no review step. The packet is the **only** artifact that leaves the device (C7).

**Required behavior (TC-P4):**
- A **Review-before-upload** screen between `segmentStudy()` and the `POST`. It renders the actual packet contents that will be sent — the redacted structured text, the per-segment summaries, the categories/apps included — grouped legibly (not raw JSON).
- Per-item **redact / remove** controls; removed items are stripped from the packet before upload (and the removal is local-only).
- Explicit **"Send to Nibbin"** confirm; **"Delete instead"** routes to `delete_everything` (§8). No upload occurs without confirm.
- Reinforces the C7 framing in copy: "Only this redacted text leaves your device. Your screen recordings never do."

**Unhappy paths:** user closes without choosing → packet stays local, study parks in `SYNTHESIZING` with a persistent "review pending" prompt (no silent upload, no silent delete). Upload fails after confirm → ret/abort with the packet retained locally for retry; never partial upload.

---

## 6. Web & legal surfaces (Audit 2)

### 6.1 The Data & Privacy panel (web)

**Current:** web settings has exactly four tabs — Profile / Security / Account / Plan & credits (`apps/web/app/app/settings/SettingsNav.tsx`). **No Data & Privacy section exists.**

**Required:** a new **Data & Privacy** settings section (web) that is the single home for:
- **Training & contribution** (§7) — the C11 training-on-content statement (read-only, "never") + the fleet/structural contribution opt-out toggle.
- **Field study data** — retention clocks (14-day study cap C2, run-log retention), what is/isn't captured (C4/C5 framing), the C3 deletion-receipt view, and a link to delete-everything (§8).
- **Connections & credentials** (§7.3) — stored-credential list with one-click revoke (wraps the existing `connection_revoke` RPC).
- **Notifications** (§7.4) — channel connections + preferences (quiet hours, priority, per-channel enable).
- **Your data** — export + the deletion clock state (mirrors Account tab) + delete-everything.

Desktop **Preferences** gets a parallel **Data & Privacy** group that mirrors the local controls and **deep-links to the web panel** for account-level ones (consistent with the existing "account settings live at nibbin.com" pattern in `preferences.ts`).

### 6.2 Routed legal pages

**Current:** `reference/data-ai.html`, `reference/privacy.html`, `reference/terms.html` exist as content but are **not routed**; `/privacy`, `/data-ai`, `/subprocessors` all 404; the landing footer links to pages that don't resolve (`apps/web/app/page.tsx`).

**Required:**
- Route `/privacy` and `/data-ai` (and `/terms`) as live web pages sourced from the reconciled reference content (after §9 copy fixes + the open #46 attorney-review record).
- Build `/subprocessors` (§6.3).
- The landing footer links resolve.

### 6.3 Subprocessor registry + published page

**Current:** `reference/privacy.html` points users to `nibbin.com/subprocessors`, which **404s**; `docs/STATE.md:15` gates routing the data-ai/privacy pages on publishing it (with the Anthropic no-training agreement confirmed).

**Required (ties AS-R34 / AS-§4B governance):**
- A **subprocessor registry** (code-defined list + table for the published view): name, role, data category, region, no-training status. Seed: **Anthropic** (model inference — T1/T2/Opus, no-training agreement), **Supabase** (Postgres + Vault), **Vercel** (hosting), **Resend** (email), **Stripe** (payments). Model-routing providers introduced by AS-§4B (gateway/direct/aggregator) register here **before** seeing user data — the registry is the single source for that gate.
- Published `/subprocessors` page rendering the registry, "updated before adding anyone new" honored by making the page the gate, not an afterthought.
- **No provider sees user data until it's in the registry with a confirmed no-training stance** (AS-§4B: BYOK + unknown-stance = training-until-proven).

---

## 7. Control UIs — closing the schema-ready-but-no-UI gaps (TC-P6)

### 7.1 Training opt-out (C11) — and resolving the default contradiction

**Current (the contradiction — Audit 3):**
- `INVARIANTS.md:15` (C11): *"model training on user data is opt-out (on by default, one user switch turns it off, honored everywhere)."* → **opt-out / default-on.**
- Migration `20260612120000_m65_budget_cogs.sql:155`: `add column training_opt_in boolean not null default false` + `set_training_opt_in()` RPC → **opt-in / default-off**, and named `training_opt_in` (opt-*in* framing).
- Landing copy (`page.tsx:56`): *"you can opt out anytime in settings"* → opt-out framing — **and the toggle does not exist.**

So the invariant, the schema, and the marketing copy describe three inconsistent behaviors, and there is no UI either way. This violates TC-P1 and TC-P7.

**Resolution (recommended — see §12 Open Decisions; needs sign-off because it governs a live, outward-facing training default):** split the concept per TC-P7 and align to the **already-locked AS-R49** decision:
- **Training on user content = never** (hard invariant; not a toggle). State this as fact in the panel and on `/data-ai`.
- **Fleet/structural contribution** (the thing AS-R49 / AS-§12B defines: anonymized aggregate *system* statistics, never content) = **opt-out, default-on, one switch.** This is what the C11 "opt-out / on by default" language actually refers to.
- Repurpose/rename the existing flag to represent the **fleet contribution** opt-out and **flip its default to on** (opt-out semantics) so schema = invariant = copy. (Build task: migration to flip default + backfill/rename; reconcile `set_training_opt_in` → a clearly-named contribution RPC.)
- Build the **toggle UI** in the Data & Privacy panel, wired to the RPC, audited.

**Copy (TC-P7):** the toggle says exactly what flows up — "anonymized statistics about how capabilities and models perform — never your content, never your data, never sold" (mirrors AS-§12B) — and is paired with the read-only "we never train models on your content" statement so the two are not conflated.

### 7.2 Fleet-learning opt-out toggle

Covered by §7.1's resolution — the C11 toggle **is** the fleet/structural contribution opt-out (there is no separate "train on content" toggle because that's never done). If the build keeps two distinct backend signals, the panel still presents **one** user-meaningful switch ("Help improve Nibbin for everyone — anonymized, never your content") to avoid a confusing two-toggle privacy surface.

### 7.3 Credential-vault management UI (C9)

**Current:** the vault is real — `connections.token_ref` → Supabase Vault, `connection_token_store/read`, `connection_revoke()` with cascading Nibbin pause + audit (`20260611000000_m3_connections_vault_webhooks.sql`). The only management UI is under `/app/connections` (a redirect stub sits in settings). The Agent Synthesis spec adds `agent_credentials` (AS-§10, password-only site vault handles).

**Required:**
- A **stored-credentials view** in the Data & Privacy panel: every stored connection/credential (OAuth connections + AS-§10 site credentials), what it's scoped to, which agents depend on it, last used.
- **One-click revoke** wired to `connection_revoke()` (and the AS-§10 credential revoke), with the cascade ("N agents will pause") shown before confirm.
- Plaintext/token material is **never** rendered (read-only metadata only — service-role RPCs keep secrets in the vault). 2FA/one-time codes are never listed (ephemeral, never stored, per AS-§10).

### 7.4 Notification-channel preferences UI

**Current:** `drip_arcs` has `email_enabled` + `quiet_start`/`quiet_end` (`20260612000000_m5_drip_email.sql`) with **no UI**. The Agent Synthesis spec defines the full channel set + routing (AS-§11, AS-R20): push / email / SMS (Twilio) / Telegram / WhatsApp, **no iMessage**, plus `notification_channels` + `channel_prefs` schema (AS-§13).

**Required (this spec owns the UI; AS owns routing):**
- A **Notifications** group in the Data & Privacy panel: connect/disconnect each channel (push/email/SMS/Telegram/WhatsApp), set **priority order**, **quiet hours** (wire the existing `quiet_start/end`), **urgency thresholds**, and **email enable** (wire `email_enabled`).
- Channel connection that involves a secret (e.g. verifying a phone) happens in the authenticated surface (TC-P5).
- Reflects AS-§11's request-queue/digest + channel-fallback behavior as user-visible settings (e.g. "batch non-urgent into a daily digest").

---

## 8. Recording indicator & delete-everything (mostly shipped — polish to spec)

### 8.1 Recording indicator (EXISTS — verify + harden)

**Current (confirmed):** a system-tray icon (`observer-tray`) with a tooltip updated every second — *"Nibbin — field study: {days}d {hours}h left"* / *"Nibbin — quick scan: {hours}h left"* — plus tray menu **Open / Pause** (`apps/desktop/src-tauri/app/src/lib.rs:192-243`). Satisfies "countdown always visible in tray" (SPEC §5).

**Required (polish, not net-new):** ensure the indicator unambiguously communicates **active recording** (not just a countdown) — a recording-state glyph/color when capture is live vs paused — and verify **macOS menu-bar** parity during Capture bring-up. No new subsystem; this is an indicator-state + asset task.

### 8.2 Delete-everything reachability (desktop EXISTS — extend to web)

**Current (confirmed):** `deleteEverythingCard()` (two-confirm, local SQLCipher wipe + empty-store verification, *"never uploads anything first"*) is reachable from **Study, Preferences, Review, and terminal states** (`apps/desktop/src/ui/views/study.ts:67`, `preferences.ts:59`, `field-study.ts:125`). Web account deletion (30-day clock, type-to-confirm, `request_account_deletion()`) exists but **only** in the Account tab (`apps/web/app/app/settings/account/page.tsx`).

**Required (TC-P2):**
- **Desktop:** already meets "reachable from every state" — keep parity as screens are added.
- **Web:** surface delete-everything / deletion-clock state in the **Data & Privacy** panel (not only the Account tab), and show the **C3 deletion receipt** (user-visible verification that raw study data was deleted post-synthesis) and the **Stage-2 purge completion** state (currently backend-only, M7-pending).

---

## 9. Copy-accuracy fixes (Audit 3 — TC-P1)

Each fix makes the public claim true *today* and tightens automatically when enforcement lands.

| Claim (current) | Reality | Fix |
|---|---|---|
| C6: "Global pause hotkey kills capture **<100ms**" (`INVARIANTS.md:10`, `SPEC.md:57`) | ~250ms measured (`STATE.md:207`, #22) | Drop the number until #22 lands: "**stops capture near-instantly**, enforced in the daemon." Restore a measured figure only once verified on-hardware. |
| C4: "Secure fields suppressed **via OS flags**, never via image detection" (`SPEC.md:55`) | Type-level structural only; OS-flag mapping is #23 | Keep the true half ("**never via image detection**; suppressed by construction"); defer the "via OS flags" *mechanism* claim until #23. |
| "banking, health, and **personal sites** are never captured" (`page.tsx:31`, `consent.ts:33`) | Category blocklist (`packages/redaction/rules/category-blocklist.json`); "personal" is not a literal category | Reframe: "banking, health, and other **sensitive categories** are never captured — and you can mark **anything** 'never record'." Ties the claim to the real category blocklist + the user-exclusion control (§5.1). |
| "opt out anytime **in settings**" (`page.tsx:56`) | No toggle exists; default contradicts invariant | Ships true once §7.1 lands (toggle exists + default reconciled). Until then, copy must not promise a settings toggle that isn't there. |
| Privacy policy → "list at **nibbin.com/subprocessors**" (`reference/privacy.html:87`) | 404 | True once §6.3 publishes the page. Gate routing `/privacy` + `/data-ai` on it (already a STATE.md gate). |
| "on by default" vs DB `default false` (C11) | Three-way inconsistent | Resolved by §7.1 (schema = invariant = copy). |

**Process guard:** the open **#46 claims-wording + attorney review** must be recorded before `/privacy` and `/data-ai` route (per `STATE.md`). This spec's copy fixes are the input to that review.

---

## 10. Migrations / schema changes

- **Local (desktop) store:** durable exclusions store (`observer-store/exclusions.json` or `exclusions` table) loaded on `Daemon::open()` (§5.1).
- **C11 / fleet contribution:** migration to **flip the training/contribution default to on** (opt-out semantics) + reconcile the `training_opt_in` column/RPC naming to "contribution" semantics (§7.1). Apply to **dev + prod** (two-instance rule); honor the audit-rule/FK pattern.
- **Notifications:** consume AS-§13's `notification_channels` + `channel_prefs` (owned by Agent Synthesis); this spec adds no new notification tables, only the UI binding (and wires the existing `drip_arcs` quiet-hours/email columns).
- **Subprocessors:** registry table for the published list (§6.3).
- **Credentials:** none new here — the UI binds existing `connections` vault RPCs + AS-§10 `agent_credentials`.

---

## 11. Requirements coverage ledger (the completeness guarantee)

| # | Requirement | Audit | Section | Cross-ref |
|---|---|---|---|---|
| T1 | Exclusions persist across daemon restart; reloaded before capture resumes; fail-closed | A1 | §5.1 | TC-P3 |
| T2 | Atomic durable exclusion writes; store is source of truth | A1 | §5.1 | TC-P3 |
| T3 | Review-before-upload of the synthesis packet (shows real contents, redact/cancel) | A1 | §5.2 | TC-P4, C7 |
| T4 | No upload without explicit confirm; "delete instead" path | A1 | §5.2 | TC-P4 |
| T5 | Web **Data & Privacy** panel (the single controls home) | A2 | §6.1 | TC-P2, TC-P6 |
| T6 | Desktop Data & Privacy group mirroring local controls + deep-link | A2 | §6.1 | TC-P2 |
| T7 | Route `/privacy`, `/data-ai`, `/terms` from reconciled reference content | A2/A3 | §6.2 | TC-P1 |
| T8 | Subprocessor registry + published `/subprocessors`; gate providers on it | A2/A3 | §6.3 | AS-R34, AS-§4B |
| T9 | C11 training-on-content = stated-as-never (hard invariant) | A3 | §7.1 | TC-P7, AS-R48 |
| T10 | Fleet/structural contribution **opt-out** toggle UI, wired + audited | A2/A3 | §7.1, §7.2 | AS-R49, AS-§12B |
| T11 | Resolve C11 default contradiction (schema = invariant = copy) — **D1-A: opt-out/default-on** | A3 | §7.1, §9, §12 | TC-P1, AS-R49 |
| T12 | Credential-vault management UI (view + one-click revoke + cascade) | A2 | §7.3 | C9, AS-§10 |
| T13 | Notification-channel preferences UI (channels + quiet hours + priority) | A2 | §7.4 | AS-R20, AS-§11 |
| T14 | Recording indicator shows active-recording state (not just countdown); macOS parity | A1 | §8.1 | (exists — polish) |
| T15 | Delete-everything reachable from web Data & Privacy + C3 receipt + Stage-2 purge state | A2 | §8.2 | TC-P2, C3 |
| T16 | C6 copy: drop "<100ms" until #22 verified | A3 | §9 | TC-P1 |
| T17 | C4 copy: keep "never image detection", defer OS-flag mechanism until #23 | A3 | §9 | TC-P1 |
| T18 | "personal sites" copy reframed to sensitive categories + user-exclusion | A3 | §9 | TC-P1 |
| T19 | "opt out in settings" copy true only once toggle ships | A3 | §9, §7.1 | TC-P1 |
| T20 | #46 attorney-review recorded before routing legal pages | A3 | §9 | process gate |
| T21 | Secrets only in authenticated surface (channel verify, credential entry) | A2 | §7.3, §7.4 | TC-P5, AS-P4 |

**Deferred-with-reason (explicit, not dropped):** C4 OS-flag *enforcement* (#23) and C6 *latency* (#22) — owned by **Capture bring-up**; this spec only makes the **copy** honest until then. Stage-2 purge **completion UI** — M7-pending backend; this spec adds the user-visible state once the backend lands. macOS menu-bar indicator parity — verified during Capture bring-up.

---

## 12. Decisions

- **D1 — C11 default reconciliation — DECIDED 2026-06-17: D1-A (opt-out, default-on, content-never).** Training-on-content = *never* (hard invariant, not a toggle); fleet/structural contribution = *opt-out, default-on* (anonymized system statistics only, never content). Build flips the `training_opt_in` column default to **on**, reconciles naming + copy so schema = invariant = marketing, and ships the single contribution toggle (§7.1). Honors the locked **AS-R49** stance, `INVARIANTS.md:15` C11, and the live landing copy — no marketing edit needed beyond §9's accuracy fixes.

---

## 13. Testing strategy

- **Exclusion persistence:** add exclusion → kill daemon → restart → assert excluded target is *still* excluded *before* the first capture tick; corrupt store → assert capture **pauses** (fails closed), never starts empty.
- **Review-before-upload:** assert no `POST /api/study/packet` fires before confirm; redacted items are absent from the uploaded body; "delete instead" wipes locally and uploads nothing.
- **Panel reachability:** every backend privacy control (training/contribution RPC, `connection_revoke`, quiet-hours) is reachable from the Data & Privacy panel; delete-everything reachable from every desktop state and from the web panel.
- **Copy = behavior:** snapshot tests assert the routed `/privacy` + `/data-ai` copy matches the reconciled reference (no "<100ms", no bare "OS flags", reframed "sensitive categories"); `/subprocessors` lists every registered provider; assert no provider lacking a registry entry can be selected by the router (binds AS-§4B).
- **Secret boundary:** assert channel/credential flows that involve a secret only occur in the authenticated surface; assert credential UI never renders token material.
- **Default reconciliation:** assert the contribution flag default, the invariant text, and the rendered copy agree (one source-of-truth test).

---

## 14. Open dependencies

- **Capture bring-up** (M6/M8) lands C4/C6 *enforcement*; this spec's copy is written to be true before and tighten after.
- **Agent Synthesis** owns the credential-vault runtime (AS-§10), notification routing (AS-§11), fleet-learning data flow + user-edge boundary (AS-§12B), and subprocessor governance (AS-§4B); this spec binds UIs to those contracts.
- **#46** attorney review must be recorded before `/privacy` + `/data-ai` route.
