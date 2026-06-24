# ADR: Connector strategy — in-house builds vs. an aggregator (Nango / Composio)

> **SUPERSEDED — 2026-06-22 (D17, Company Brain program)**
>
> Decision D17 (recorded in `docs/superpowers/specs/2026-06-22-company-brain-program-decomposition.md` §4) adopts Nango **now** for the out-of-box connector lane. Specifically: wire the existing Google (Gmail + Calendar) and Stripe connectors into Nango this batch (a contained migration, not a replatform). The inflection-point trigger in the original decision below has been reached early — the Company Brain program requires connector breadth that DIY linear build cannot supply at the needed pace.
>
> **What is retained from this ADR:** The generic MCP/API rail (`packages/connectors/src/rails/mcp.ts`) is kept for proprietary/company systems that are not out-of-the-box. The primitive + action-level safety model is unchanged — Nango operates as a transport layer *underneath* the primitive boundary (Scenario A in the diagram below), not as a Composio-style raw-tool router (Scenario B remains rejected). Composio remains rejected outright for the reasons in §Rationale.
>
> **Build scope of D17:** P4 worktree — migrate Gmail/Calendar/Stripe to Nango proxy mode; retain generic MCP/API rail; then seed calendar/files/contacts into memory.

**Date:** 2026-06-22
**Status:** ~~Accepted~~ **Superseded by D17** (see note above)
**Deciders:** John (owner)
**Context window:** follows the Action Levels permission-model rewrite (PR #231) and Connector Lever 1 (PR #217).

## Context

Nibbin needs to grow from one fully-acting connector (Gmail) to many. The question: build each connector in-house, or adopt an integration aggregator (Nango or Composio) to add connectors "en masse"?

Two facts frame the decision:

1. **Nibbin already shipped the agent-action layer.** The Composer/Planner synthesises a bespoke spec from field study; that spec may only compose **vetted primitives** (not raw writes — `validateComposedSpec` rejects any composed step whose capability is not `kind:'primitive'` or a pure read); and the owner-set **action level (Observe/Draft/Act)** is the sole execution gate. This primitive + action-level boundary is the product's safety model (see [[project-nibbin-action-levels]]).
2. **The privacy moat is the on-device screen capture (C7), not connector data.** Connector data is "cloud-but-disciplined": tokens-not-warehouses, derived-not-raw. The owner has explicitly ruled that connector data flowing through a third-party processor is acceptable; only the screen capture is the moat.

## Decision

**Build connectors in-house for the near and medium term. Do not adopt an aggregator yet. Reject Composio outright. Revisit Nango — self-hosted, proxy-mode, *underneath* the primitive boundary — only at a defined inflection point.**

### Inflection point to revisit Nango

Adopt Nango (self-hosted, proxy/live mode — never sync/warehouse, to preserve derived-not-raw) when **either** of:
- We commit to the long tail: roughly **≥ 10–15 connectors**, especially providers with non-OAuth2 auth (OAuth1, API-key+HMAC, bespoke token dances) that our generic OAuth2 core does not cover; **or**
- **Connector maintenance** (providers changing APIs/auth) becomes a recurring time sink.

Until then, in-house is cheaper all-in and keeps token custody.

## Options considered

| Dimension | In-house | Nango (self-hosted, proxy) | Composio |
|---|---|---|---|
| Core identity | We build everything | Open-ish auth+transport infra we run | Managed OAuth broker + ~1,000-app tool catalog + MCP |
| What it removes for us | Nothing new (generic OAuth core already built) | OAuth + refresh + transport for 800+ APIs | Same auth + pre-built actions |
| What it does NOT remove | — | The **primitive** (our "what should it do") | The primitive too — unless the LLM calls raw actions |
| Token custody | Our Supabase Vault | Our infra (self-host) | Composio cloud vault → migration = re-auth every user |
| Self-host / sovereignty | Total | Full parity, free ≤1k connections (ELv2) | Auth self-host **not GA**; SDK MIT, vault cloud-only |
| Fit with primitive + action-level safety model | Native | Slots underneath cleanly | Conflicts — **no native HITL/action-level enforcement** |
| derived-not-raw | Yes | Yes in proxy mode (avoid syncs) | Pass-through, but transits/logs their cloud |
| Breadth | Low | High (800+) | Highest (~1,000 apps) |
| Effort per connector | OAuth (built) → client + primitive | (auth free) → primitive + endpoints | (auth free) → primitive, or skip primitive & rebuild guardrails |
| Pricing | Eng time | Usage (~$500/mo→100 conn); self-host free tier | Per tool-call ($29→200k, $229→2M; 20k free) |
| Compliance | Ours | SOC2 Type II, AES-256-GCM, GDPR, HIPAA BAA | SOC2/ISO vendor-stated, no public report; no HIPAA |
| Lock-in | None | Low (we hold tokens + code) | High (tokens in their vault) |

*Research caveats (2026-06): Composio "20k tools" and SOC2/ISO are vendor-stated/unverified; Composio is deprecating managed auth (~mid-2026) so production needs our own OAuth app regardless; Nango HIPAA/SOC2 worth confirming at trust.nango.dev.*

## How primitives & actions flow — the two scenarios

**Scenario A — primitive boundary preserved (in-house, or Nango as transport underneath):**

```
   on-device SCREEN CAPTURE ── field study ──┐   (C7 moat — never leaves device)
                                             ▼
                           PLANNER / COMPOSER (LLM)
                                             │  composes ONLY from vetted verbs
                                             ▼
        ┌─────────────────────────────────────────────────┐
        │ PRIMITIVE VOCABULARY (trusted code we own)        │
        │ nudge.* · reply.* · digest.* · schedule.* …       │ ← we add verbs here
        │ each builds SAFE effectArgs for one capability    │
        └─────────────────────────────────────────────────┘
                                             │  emits steps[] (cap + safe args)
                                             ▼
              ACTION-LEVEL GATE   Observe │ Draft │ Send      ← owner-set, SOLE gate
              (+ idempotency · velocity · resource-claims · quarantine)
                                             ▼
                        EXECUTOR (thin per-capability branch)
                                             ▼
                   ─────────── transport / auth ───────────
                   │ IN-HOUSE: our client + Vault token    │
                   │ NANGO proxy(): inject managed token,  │   ← we keep custody
                   │               we keep token custody    │
                   ──────────────────────────────────────────
                                             ▼
                      REAL API (Gmail · Calendar · Stripe · …)

   LLM sits ABOVE a trusted vocabulary; never picks a raw write, never sees a token.
```

**Scenario B — aggregator-native (Composio tool-router style): REJECTED**

```
   field study ▼
   PLANNER (LLM) ── picks & fills RAW actions as tools ──┐
        ▼                                                │ 1,000+ pre-built actions
   ┌──────────────────────────────────────────┐         │ GMAIL_SEND_EMAIL,
   │ COMPOSIO TOOL ROUTER                       │         │ GOOGLECALENDAR_CREATE_EVENT…
   └──────────────────────────────────────────┘         │
        │  LLM emits raw write + args ⚠️ injection surface reopens
        ▼
   ❓ NEW GUARDRAIL WE'D HAVE TO BUILD: action-level gate + generic arg
      validation + always-draftable + prompt-injection defense
        ▼
   COMPOSIO CLOUD (token vault + server-side execution)  ← we don't own tokens
        ▼  REAL API

   LLM sits ABOVE raw API actions. The vetted-primitive boundary is GONE; we'd
   rebuild guardrails we already have, around an external vault we don't control.
```

The diagrams are the argument: in A the LLM is constrained to a vocabulary we vetted; in B it chooses raw writes and we re-derive our safety layer around someone else's tool-router and vault.

## Rationale

1. **Composio competes with our core; Nango sits under it.** Composio's differentiator (agent-native tool-calling) bypasses the primitive + action-level boundary we just shipped and red-team verified. Its managed auth is being deprecated anyway, and tokens-in-their-vault is the lock-in we least want under a privacy-moat product.
2. **Provider accounts + OAuth apps + verification are required either way.** Aggregators are bring-your-own-credentials; none registers developer apps for us. The slowest, least-parallelizable part of each connector — provider review/verification (Google CASA, Meta review, …) — is identical in all options. **Nango saves *code*, not *paperwork*.** If breadth is gated by verification (it is), an aggregator does not move that bottleneck.
3. **We already paid for the expensive generic core.** `callback-core` (generic `[provider]` callback), `getOAuthConfigFor`, the Supabase Vault token store, and refresh-on-401 already exist and are provider-agnostic. So the auth/refresh/transport an aggregator removes is largely already built for the OAuth2 family — Nango's marginal saving per OAuth2 connector is small.
4. **The candidate connectors are 60–90% built in-house.** Stripe/HoneyBook/Pixieset/Instagram-DM already have client classes, registry entries, scan modules, and OAuth provider configs; Stripe even has a write primitive. Finishing them is ~1–3 days of code each (dominated by verification waits), and adopting Nango here would *add* work (stand up + operate its infra; discard existing clients) without touching the bottleneck.
5. **Maintenance is the real future lever, not initial build.** At dozens of connectors, owning every provider's breaking changes is a recurring cost; that — plus non-OAuth2 auth breadth — is what eventually justifies Nango. Hence the inflection trigger rather than "never."

## Consequences

- **Positive:** full token custody; zero new infra/dependency near-term; the safety model stays intact; near-term connector work reuses already-built scaffolding.
- **Negative / accepted:** in-house connector count scales roughly linearly with eng effort; we own provider-change maintenance until the inflection point; long-tail breadth (the 185-catalog) stays out of reach until a deliberate Nango adoption.
- **Reversible:** waiting costs nothing — Nango can be introduced later as a transport layer beneath the unchanged primitive boundary without rework.

## Follow-on

Execution scoped in `docs/superpowers/plans/2026-06-22-connector-batch-plan.md` (finish the 5 + a calendar-write primitive).
