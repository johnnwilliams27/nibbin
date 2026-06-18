# Reach-Me & Conversational Channels — Plan Index

**Date:** 2026-06-18
**Branch / worktree:** `feature/reach-me-channels` @ `C:/nibbin-reach-me` (off `origin/main` 87a9f44)
**Source spec:** `docs/superpowers/specs/2026-06-17-reach-me-conversational-channels-design.md`
**Companion (shipped):** `docs/superpowers/plans/2026-06-17-notification-prefs-email.md` (the email-only T13 sliver — `set_notification_prefs` RPC + Notifications card; already on main).

This spec spans multiple independent subsystems, so per `superpowers:writing-plans` it is decomposed into one plan per subsystem. Each plan produces working, testable software on its own and is built/reviewed in dependency order.

## Scope decision (user, 2026-06-18)
- **Build all adapters incl. SMS/WhatsApp** — Telegram end-to-end, SMS (Twilio) + WhatsApp adapter code too, even though SMS/WhatsApp stay inert until the offline registrations clear.
- **Prep the offline track now** (checklist + in-repo scaffolding) so the multi-day carrier/Meta lead-time clock can start in parallel.

## What already exists (verified in code, not just the spec)
- Agent runtime spine: `packages/runtime` (`runner.ts` `executeRun`, `school.ts` `gateSideEffect`, `velocity.ts` runaway, `awaiting_approval`/`DraftStep` = the escalation loop), `packages/keeper` (`chat.ts` `keeperChat` — pure, no-hands, routes via router), `packages/router` (`route({origin})`, classifier picks cheapest-adequate tier, `model_calls` COGS, `frontier_budget`).
- Connector linking model to mirror: `packages/connectors` OAuth nonce/state flow, `TokenVault`, `connection_revoke` cascade, `quarantine()`; `packages/redaction` `applyBattery()`.
- Delivery model to mirror: `packages/drip` worker + `drip_sends` idempotency ledger; `packages/email` `EmailPort.sendBeat(): Promise<boolean>` + Resend transport; the in-app `notifications` leaf (the delivery floor).
- Prefs UI to extend: `apps/web/app/app/settings/privacy/page.tsx` Notifications card + `actions.ts` + `lib/privacy/notifications.ts`; `apps/web/components/ui` kit (Card/Button/Badge/Select/InlineFeedback).

## Plans (dependency order)

| # | Plan file | Subsystem | Buildable now? | Depends on |
|---|---|---|---|---|
| 01 | `2026-06-18-reach-me-01-schema-foundation.md` | AS-§13 / §9 schema: channel registry, link nonces, prefs, message log, threads + RLS + member RPCs | ✅ fully | — |
| 02 | `2026-06-18-reach-me-02-delivery-adapters.md` | `ChannelPort` abstraction + fallback chain; Telegram adapter (full); SMS (Twilio) + WhatsApp adapters (code, inert); delivery log + COGS | ✅ Telegram; ⚑ SMS/WA inert until offline | 01 |
| 03 | `2026-06-18-reach-me-03-inbound-identity.md` | Link-from-app nonce flow, per-channel inbound webhooks, identity verification (N-P3), redaction-aware + quarantine ingest | ✅ Telegram; ⚑ SMS/WA inert | 01, 02 |
| 04 | `2026-06-18-reach-me-04-prefs-ui.md` | Multi-channel prefs UI (T13): connect/disconnect, per-channel enable/priority/urgency, account quiet-hours + digest, fallback chain | ✅ fully | 01, 03 |
| 05 | `2026-06-18-reach-me-05-conversation-and-cost.md` | Grovekeeper conversation orchestrator (§7.1 escalation replies, §7.2 status Q&A, §7.3 you-initiated gated work) **+ §11 cost/abuse controls** (the launch gate, built together) | ✅ in-app + Telegram path | 01, 02, 03, runtime/router |
| 06 | `2026-06-18-reach-me-06-offline-enablement.md` | Offline-action checklist (10DLC, Meta verification, counsel) + in-repo scaffolding: subprocessor registry entries, STOP/HELP + consent copy, adapter shells wiring | partial (⚑ = user/legal/account action) | 02 |

## Requirements ledger → plan mapping (spec §13)
- N1 multi-channel reach → 02 · N2 adapter abstraction + fallback → 02 · N3 identity verification → 03 · N4 link proven from app → 03 · N5 escalation replies through gate → 05 · N6 status/questions → 05 · N7 you-initiated gated work → 05 · N8 secret boundary in chat → 05 · N9 keeper no-hands → 05 · N10 conversation memory redaction-aware → 03/05 · N11 per-channel prefs → 04 · N12 email sliver (shipped) → companion · N13 schema → 01 · N14 resilience/fallback-to-floor → 02 · N15 cost+abuse bounds → 05 · N16 unhappy paths → each plan's self-review · N17 COGS attribution → 05.

## Cross-cutting conventions (apply to every plan)
- **DB:** migration files `YYYYMMDDHHMM00_<name>.sql`; pick the next free timestamp **at apply/rebase time** (parallel branches `feat/agent-memory-v1`, `feature/capture-bringup` may add migrations — collisions have happened before; renumber on rebase). RLS = member-read + `revoke` writes from `authenticated`; mutations via security-definer RPCs (`auth.uid()` → `private.is_account_member` → mutate → `audit_log` insert → `revoke`/`grant`). Tamper-evidence via **`BEFORE` triggers + `private.raise_append_only()`, never rewrite rules** (rewrite rules are incompatible with `ON DELETE CASCADE`). Migrations are FILES only — the orchestrator applies to **dev/staging/prod** via MCP after review, then hash-verifies all three.
- **Channels carry no OAuth token / no vault:** `external_id` (Telegram chat id, phone, device token) is PII-but-not-secret (N9) → lives under RLS, not the vault. The Telegram bot token is **app-level env** (`TELEGRAM_BOT_TOKEN`), not per-account.
- **Secret boundary (N-P2):** no secret is ever a channel field; secret-requiring steps deep-link to the app.
- **Brand voice:** error copy = what happened → what's safe → what to do, sentence case (`.claude/skills/brand-voice`). No fake/undeliverable channel controls in the UI.
- **Don't touch `reference/*.html`.**

## Status
- [x] Worktree + baseline install · codebase mapping (5 agents) · all 6 plans drafted
- [x] **Plan 01 — schema foundation** — BUILT + opus-reviewed (ready to merge). Live-DB RLS gate caught 2 real bugs.
- [x] **Plan 02 — delivery adapters** — BUILT + opus-reviewed (ready to merge). Floor + Telegram (live) + SMS/WhatsApp (inert), dispatcher, fallback.
- [x] **Plan 03 — inbound + identity** — BUILT + opus-reviewed (fixed a silent message-loss path the final review caught).
- [x] **Plan 04 — multi-channel prefs UI** — BUILT + opus-reviewed (ready to merge).
- [x] **Plan 05 — conversation + §11 cost/abuse + on-channel approval bridge** — BUILT; **4-reviewer adversarial gate PASS after fixes** (2 P1s: empty-secret fail-open, inert gate p_account; + 2 P2 hardenings). Gate record: `docs/gates/2026-06-18-reach-me-conversation-approval.md`.
- [x] **Plan 06 — offline enablement** — BUILT + opus-reviewed (ready to merge). Offline checklist + consent/STOP-HELP/START copy + audited `sms_opt_out` RPC + subprocessor registry. (reference/subprocessors.html publish = content-owner follow-up; START re-subscribe handler = pre-go-live follow-up, both in the checklist.)
- [ ] PR + migrations to dev/staging/prod (timestamps may need renumbering on rebase) + human gate sign-off.

### Migrations added (apply dev/staging/prod at PR time, in order)
`20260618030000` channels schema · `20260618040000` channel RPCs · `20260618050000` notifications 'reach' kind · `20260618060000` model_calls origin/channel · `20260618070000` channel budgets · `20260618080000` approval bridge (linked_by + decide_run_service) · `20260618090000` sms_opt_out RPC.

### Cross-cutting follow-ups (from reviews/gate)
- Spend cap is rolling-soft; turn-count is the hard backstop (decide hard-vs-soft; align spend/turn windows).
- Drip worker should read `notification_settings` quiet-hours, then retire the `drip_arcs` mirror.
- Anomaly v1 fixed-threshold → AS-§18.4 adaptive baseline.
- `next build` not yet run E2E (transpilePackages/extensionAlias wired; verify at deploy).
