# Reach-Me & Conversational Channels — Design Spec

**Date:** 2026-06-17
**Status:** Draft for review (design-only; build gated on the AS-§11 delivery runtime)
**Scope:** The multi-channel "reach-me" layer — how a user's grove reaches them on **push / email / SMS / Telegram / WhatsApp** (no iMessage) — *and* the **two-way conversational layer** on top of it: the user can reply to resolve escalations, and can **message their grove any time** (the OpenClaw-style "text my agent" experience), bounded by Nibbin's safety model. Owns: the channel registry + delivery adapters, inbound ingest + identity verification, the Grovekeeper conversation orchestrator, the secret boundary in a chat context, and the per-channel preferences. The **prefs UI** for the email sliver ships now (companion plan `2026-06-17-notification-prefs-email.md`); the rest builds when the delivery runtime lands.

**Companion specs:**
- **Agent Synthesis** (`2026-06-17-agent-synthesis-design.md`) §11 (escalation UX + channels), §9 (resilience/`AgentRequest`/`needs_input`), §10 (credential vault), §12A (memory), C10 (Grovekeeper has no hands), P2 (propose-then-approve), P4 (secret boundary), P8 (cost-aware). This spec **expands §11** from "reach-me escalation" into a full bidirectional channel layer.
- **Trust & Controls** (`2026-06-17-trust-and-controls-design.md`) §7.4 (the notification-prefs UI; T13). The email-only controls there are the first shipped sliver of §8 here.

---

## 1. Goals & non-goals

**Goal:** Make the grove *reachable and conversational on the channels people actually live in.* An agent that's blocked, or has news, or finished a draft, can reach you on your chosen channel; you can reply to unblock it; and you can **start a conversation yourself** — "what's my grove up to?", "draft the invoice follow-ups", "approve that" — and have it answered or acted on, **without ever weakening the approval gate or the secret boundary.**

**Non-goals (this spec):** the agent runtime that *produces* escalations/work (AS-§6/§7); building delivery for every channel on day one (Telegram first, §5); voice/calls; group chats; replacing the in-app surface (the app remains the source of truth and the only place secrets are entered).

---

## 2. Principles (load-bearing)

- **N-P1 — Channels reach you; the app holds the truth.** Notifications and conversation happen anywhere; **the authenticated Nibbin surface is canonical** for anything sensitive. A channel is a convenience layer over the real state, never a separate source of authority.
- **N-P2 — Secrets never traverse a channel (inherits AS-P4).** Passwords, credentials, 2FA codes, OAuth — entered **only** in the authenticated app. When a conversation needs one, the grove **deep-links** you to a one-time secure surface; it never accepts a secret typed into Telegram/SMS.
- **N-P3 — Every inbound is identity-verified (anti-spoof).** A message/reply is acted on only after it's bound to the user's linked, verified channel identity. An unverified or mismatched sender is ignored + flagged. Channel linking itself requires proof from the authenticated app.
- **N-P4 — The Grovekeeper has no hands (inherits C10), and writes stay gated (inherits P2).** Over chat the Keeper can *answer* (read), *collect* decisions/approvals, and *initiate* work — but **work runs through the normal Planner/Composer → validator → approval/School gates.** No chat message executes an unreviewed `write`; sensitive actions deep-link to the app. You can *ask for* power over chat; you can't *take* it.
- **N-P5 — Bounded & cost-aware (inherits P8).** An always-reachable conversational agent is a cost/abuse surface. Per-account rate limits, conversation-turn budgets, digest batching, and quiet hours are first-class — not afterthoughts. Runaway inbound or spend auto-throttles (ties AS-§18.4).
- **N-P6 — Quiet by default, loud only when it matters.** Respect quiet hours and urgency thresholds; batch the non-urgent into digests; escalate only genuinely time-sensitive blockers across quiet hours, and only per the user's threshold.

---

## 3. Architecture overview

```
                 ┌──────────────── Grovekeeper conversation orchestrator ────────────────┐
   agent runtime │  outbound: escalations (AgentRequest §9) + proactive beats/news        │
   (AS §6/§7) ──▶│  inbound:  (a) escalation replies  (b) you-initiated chat              │──▶ Planner/Composer
                 │  enforces: N-P2 secret boundary · N-P3 identity · N-P4 gate · N-P5 cost │     (AS §6) → gates
                 └───────────────────────────────────────────────────────────────────────┘
                                    ▲ outbound                    │ inbound
                          ┌─────────┴──────────┐        ┌─────────┴───────────┐
                          │  delivery adapters  │        │   inbound ingest    │
                          │ push·email·SMS·TG·WA│        │  webhooks per chan  │
                          └─────────┬──────────┘        └─────────┬───────────┘
                              channel registry + per-channel prefs + verification
```

Four subsystems, one contract (a **ChannelMessage** in/out):
1. **Channel registry + prefs** (§5, §8) — which channels a user linked, verified, and how they want to be reached.
2. **Outbound delivery adapters** (§5) — one per channel, behind a uniform `deliver(channelMessage)`; fallback chain on failure.
3. **Inbound ingest** (§6) — per-channel webhooks normalize a reply/message into a verified `InboundMessage`.
4. **Grovekeeper conversation orchestrator** (§7) — the brain: routes outbound, interprets inbound, enforces the principles, hands real work to the Planner/Composer under the existing gates.

---

## 4. The message contract

- **Outbound `ChannelMessage`:** `{ accountId, kind: 'escalation'|'beat'|'news'|'reply', urgency, body (channel-rendered), deepLink?, requestId? (links an AgentRequest §9), expiresAt? }`. Secrets are **never** a field.
- **Inbound `InboundMessage`:** `{ accountId (resolved from verified channel identity), channel, text, inReplyTo? (a requestId), receivedAt }`. Untrusted until identity-verified (N-P3); the raw provider payload is quarantined like any external input.

---

## 5. Channels & delivery adapters

**Channels:** `push` · `email` · `sms` (Twilio) · `telegram` · `whatsapp` (WhatsApp Business). **No iMessage** (no sanctioned API). Each is a **delivery adapter** behind one interface, so adding a channel is a registration, not a rewrite (mirrors the model-routing transport abstraction in AS-§4B).

**Recommendation — Telegram first.** Best developer API (Bot API: rich, free, supports buttons/deep-links/inline keyboards for approvals), no per-message cost, two-way native. Then SMS (Twilio — universal, but metered + 2-way friction + compliance), then WhatsApp Business (rich but template/approval overhead), with push + email always available. (Decision D-N1.)

**Adapter responsibilities:** render the `ChannelMessage` to the channel's format (e.g., Telegram inline buttons for "Approve / Deny / Open app"); send; report delivered/failed; surface inbound via the channel's webhook. Per-provider COGS tracked (SMS especially).

---

## 6. Identity binding & verification (N-P3)

- **Linking** happens from the authenticated app: the user starts "connect Telegram" → the app issues a one-time deep-link/code (e.g. Telegram `/start <nonce>`); the inbound `/start` binds that chat id to the account **only because the nonce came from the authenticated session**. Same shape for SMS (verify a code the app shows ↔ a text), WhatsApp, push (device token).
- **Every inbound** is resolved to a linked, verified `(channel, externalId) → accountId`. No match → ignored + flagged (no information-leaking reply).
- **Anti-spoof:** acting on a reply requires the verified binding; sensitive confirmations additionally deep-link to the app (N-P2). A channel can be **revoked** anytime (Trust & Controls), cascading like a connection.

---

## 7. The two-way conversational layer (the new surface)

Three inbound intents, escalating in power — each safe by construction:

### 7.1 Escalation replies (the §9 loop, over a channel)
An agent hits a blocker → `AgentRequest` (`{blockerClass, whatIsNeeded, why, urgency, expiresAt}`) → rendered to the channel with action affordances:
- **Decision / value** (non-secret, e.g. "which client?", a 2FA *that the user reads elsewhere* — **never a stored secret**) → reply inline → agent resumes.
- **Approval** → channel buttons "Approve / Deny" (Telegram inline keyboard / WhatsApp buttons / SMS reply-keyword), routed through the **existing approval gate** (P2) — the channel is just a remote control for the gate, not a bypass.
- **Secret / credential / OAuth** → a **deep-link to the app** (N-P2); never collected on the channel.
- No reply by `expiresAt` → fallback channel, then in-app; time-sensitive escalates urgency or abandons-with-notice; recurring circuit-breaks + summarizes (AS-§9).

### 7.2 You-initiated chat — status & questions (read)
"What's my grove doing?", "did the invoice run go out?", "why did Penny pause?" → the Grovekeeper answers from **run history + memory (§12A) + approvals queue** (the same data §18.5 observability surfaces). Pure read; no gate needed; bounded retrieval (P8). This is the everyday "text my assistant" delight, fully safe.

### 7.3 You-initiated work (the powerful one) — gated end-to-end
"Draft this month's invoice follow-ups", "chase the overdue ones" → the Keeper routes the typed intent to the **Planner (C, AS-§6)** → a **plan-preview** + the normal validator/ceilings → execution where **every `write` is approval-gated (P2)**:
- Non-sensitive confirmations can happen over the channel (buttons).
- Sensitive/destructive or secret-requiring steps **deep-link to the app**.
- Drafts come back to the channel as "here's what I'll send — approve?" (creative/`draft`-class stays draft-heavy, AS-§4A).
- The Keeper itself still has **no hands** (C10): it hands work to agents under the gates; it never executes directly.
This is what makes it feel like OpenClaw's "tell my agent to do things over Telegram" — **without** a god-mode message that bypasses review. **This is the headline experience and ships at launch (D-N2 decided)** — its launch precondition is the §11 cost/abuse controls: every initiated run is metered through the existing credit/weight-class system, budget-capped per user/account, and runaway-protected. The plan-preview + approval gate + secret boundary bound the blast radius of a misread intent (it surfaces as a plan to approve, never an executed action).

### 7.4 Conversation context & memory
A channel thread is a view onto the user's grove, not a separate brain: it reads/writes **per-user memory (§12A, RLS-scoped)** so "chase the overdue ones" resolves "overdue" the way the app would. Threads are summarized/compacted to stay in budget (AS-§7.4). Inbound text is redaction-aware before it enters memory (derived-not-raw, C1–C11).

---

## 8. Preferences (generalizes the drip quiet-hours; T13)

Per-user, per-channel:
- **Linked channels** + connect/disconnect (verified per §6).
- **Priority order** (try Telegram, then SMS, then email…), **per-channel enable**, **urgency thresholds** (only ≥X reaches me on SMS), **quiet hours** (generalizes `drip_arcs.quiet_start/end`), **digest batching** ("non-urgent → one daily digest").
- **Fallback chain** when a channel is undeliverable (§5).
- UI lives in **Trust & Controls → Data & Privacy → Notifications**. **Shipped now (email only):** `email_enabled` + quiet hours over `drip_arcs` (companion plan). The multi-channel rows below light up as the delivery runtime + each adapter land.

---

## 9. Schema (new; additive to AS-§13)

- `notification_channels` — `(account_id, channel, external_id, status: pending|verified|revoked, created_at)`; one row per linked channel. `external_id` (Telegram chat id, phone, device token) is **not a secret** but is PII → RLS member-read, service-role write, revocable.
- `channel_verifications` — one-time nonces binding a channel from the authenticated app (N-P3); short TTL, single-use.
- `channel_prefs` — `(account_id, channel)` enable + priority + urgency threshold; plus account-level quiet hours + digest settings (or fold quiet hours into a single per-account row; the existing `drip_arcs` quiet-hours is the seed).
- `channel_messages` — outbound delivery log (kind, urgency, status delivered|failed|fallback, provider id, COGS) + inbound log (verified, quarantined text). Feeds resilience + observability + cost.
- `conversation_threads` (or reuse memory §12A) — per-(account, channel) thread state for the conversational layer; summarized.
- Reuses the existing `notifications` leaf (in-product) and `drip_arcs` quiet-hours. Apply to **dev/staging/prod**; audit-rule/FK pattern honored.

---

## 10. Delivery & resilience (ties AS-§9)
Deliver → on failure walk the **fallback chain** (next channel by priority) → terminal: in-app `notifications` leaf always succeeds (the floor). Provider down/rate-limited = an unblock strategy, not a failure. Idempotent sends (dedup anchor like `drip_sends`). Inbound webhook failures are retried/queued; a dropped inbound never silently loses an escalation (the AgentRequest still expires → re-escalates).

## 11. Cost & abuse — the launch gate for you-initiated work (N-P5 / P8)
Leading with you-initiated work (D-N2) means a single text can spawn an agent run, so these controls are **not a follow-up — they are the precondition for shipping §7.3.** Three layers:

**COGS attribution (can't control what you can't see).** Every conversational turn (an LLM call) and every channel-initiated agent run is tagged to its account **and channel origin** in `model_calls` (extends AS-§4B); channel *delivery* cost (SMS/WhatsApp per-message) is logged in `channel_messages`. Channel-initiated work is **not free** — it draws on the existing credit/weight-class metering exactly like in-app work. Chat is a new front door, never a bypass of metering. Channel-origin tagging means we can see (and price) what the conversational surface actually costs.

**Per-user / per-account budgets (hard ceilings).** Conversation-turn budget/day; channel-initiated-run budget/day; an account spend cap; a separate **SMS-spend sub-cap** (the metered channel). Hitting a cap → throttle with a brand-voice "taking a breather — here's why" + an in-app path; never a silent drop or unbounded spend.

**Runaway prevention (ties AS-§18.4).** Anomalous inbound volume, or a conversation spawning runs far above the account's norm, **auto-pauses + Grovekeeper-flags before acting.** Unverified inbound is dropped **pre-LLM** (zero cost — abuse can't run up the bill). Cheapest-eval-adequate model per turn (AS-§4B); long threads summarize/compact to bound context; no perpetual high-weight chat loop. And the plan-preview/approval gate (§7.3) caps blast radius structurally: a misread intent is a *proposed* plan, not an executed one.

## 12. Unhappy paths
Unverified/spoofed inbound → ignored + flagged. • Channel undeliverable → fallback chain → in-app floor. • Secret requested over chat → refused on-channel, deep-linked to app. • You-initiated work that needs a connector/scope you lack → escalates (incremental consent), never silent. • Quiet hours + non-urgent → held to digest. • Rate/cost cap hit → throttle + "taking a breather" note (brand-voice calm-at-the-cap). • Channel revoked mid-flow → pending requests fall back; dependent escalations re-route. • LLM refuses/conversation ambiguous → ask a clarifying question, don't act.

## 13. Requirements coverage ledger
| # | Requirement | Section | Cross-ref |
|---|---|---|---|
| N1 | Multi-channel reach: push/email/SMS/Telegram/WhatsApp, no iMessage | §5 | AS-R20 |
| N2 | Delivery-adapter abstraction (register-not-rewrite) + fallback chain | §5, §10 | AS-R45 |
| N3 | Identity binding + verification of every inbound (anti-spoof) | §6 | AS-R22, N-P3 |
| N4 | Channel linking proven from the authenticated app | §6 | N-P1 |
| N5 | Escalation replies over a channel (decision/approval) route through the existing gate | §7.1 | AS-R16/R19/R21, P2 |
| N6 | You-initiated status/questions (read, bounded) | §7.2 | AS-§18.5 |
| N7 | You-initiated work → Planner → plan-preview → approval-gated execution — **launch headline (D-N2)**, gated on N15/N17 | §7.3, §11 | AS-R2/R10, P2 |
| N8 | Secret boundary in chat: deep-link, never on-channel | §7.1/§7.3, N-P2 | AS-P4/R22 |
| N9 | Grovekeeper no-hands preserved over chat | §7, N-P4 | C10 |
| N10 | Conversation context via per-user memory, redaction-aware, summarized | §7.4 | AS-§12A |
| N11 | Per-channel prefs: priority, enable, urgency, quiet hours, digest, fallback | §8 | T13, AS-§11 |
| N12 | Email sliver shipped now (drip quiet-hours/enable) | §8 | T13 (shipped) |
| N13 | Schema: channels/verifications/prefs/messages/threads | §9 | AS-R… (§13) |
| N14 | Resilience: fallback to in-app floor; idempotent; inbound retry | §10 | AS-§9 |
| N15 | Cost + abuse bounds (rate/turn/spend caps, SMS sub-cap, cheapest-adequate model, anomaly auto-pause) — **launch gate for N7** | §11 | P8, AS-§18.4 |
| N16 | Unhappy paths first-class | §12 | AS-P5 |
| N17 | COGS attribution: every turn + channel-initiated run tagged to account + channel origin in model_calls; delivery cost in channel_messages; metered via existing credits | §11 | P8, AS-§4B |

**Deferred-with-reason:** all delivery (needs the AS-§11 runtime — until then this is design-only); voice/calls; group chats; per-channel rich-template approval flows beyond buttons (provider-specific, later).

## 14. Decisions (resolved 2026-06-17)
- **D-N1 — DECIDED: Telegram first, SMS + WhatsApp fast-follow.** Build Telegram to prove the loop (free, rich, inline-button approvals); start the offline enablement for SMS + WhatsApp **now, in parallel** (§16) so they fast-follow rather than start cold.
- **D-N2 — DECIDED: LEAD with you-initiated work (§7.3) at launch — the headline.** Non-negotiable trade: the §11 cost/abuse controls (COGS attribution N17 + per-user/account budgets + runaway auto-pause N15) ship **as part of** §7.3, not after. The plan-preview/approval gate + secret boundary stay intact. "Bold feature, hard guardrails."
- **D-N3 — DECIDED: run-log retention clock** (90d default, user-shortenable/wipeable), derived-not-raw, **with explicit disclosure** that channel providers (Telegram/Meta/Twilio) retain message history beyond Nibbin's reach.
- **D-N4 — DECIDED: SMS + WhatsApp compliance is a gate, started now.** No SMS before 10DLC brand+campaign registration + opt-in consent + STOP/HELP + TCPA quiet-hours; no WhatsApp before Business verification + template approval. Tracked in §16; confirm specifics with Twilio + counsel.

## 16. Parallel enablement (offline lead-time — start while Telegram builds)
These have real-world lead time and gate the fast-follow channels, so they begin in parallel with the Telegram build. **⚑ = needs the user / legal / an account action** (cannot be done from the codebase):
- **Telegram:** register the Bot (BotFather), set the webhook, implement the `/start <nonce>` deep-link binding (§6). Mostly buildable in-repo.
- ⚑ **SMS / Twilio:** 10DLC **brand + campaign registration** (multi-day carrier lead time — the long pole), Twilio account + number, STOP/HELP + quiet-hours config, TCPA + opt-in language reviewed with counsel.
- ⚑ **WhatsApp Business:** Meta Business verification + WhatsApp Business API access + proactive-escalation **message-template pre-approval**.
- ⚑ **Subprocessor registry + published page (T&C §6.3):** add Twilio / Telegram / Meta with regions, data categories, retention — published **before** any user data flows to them.
- ⚑ **Privacy/legal:** the channel + provider-retention disclosure (D-N3) folded into the #46 attorney review; SMS consent record-keeping.

> COGS modeling note (D-N2): before SMS/WhatsApp go live, fold their **per-message delivery cost** + the **conversational-turn LLM cost** into the unit-economics model alongside the existing weight-class credits — channel-initiated runs are normal metered runs, but the *delivery* leg (esp. metered SMS) is a new COGS line that the per-account spend cap + SMS sub-cap (§11) must be tuned against.

## 15. Relationship to what's shipped
The companion-email controls (`drip_arcs` email + quiet hours, plan `2026-06-17-notification-prefs-email.md`) are **§8's first sliver** — real today because the drip email delivery exists. Everything else here builds when the AS-§11 delivery runtime lands; this spec is the blueprint it builds against. New providers (Twilio/Telegram/WhatsApp) register in the **subprocessor registry** (T&C §6.3) before any user data flows (D-N4 for SMS specifically).
