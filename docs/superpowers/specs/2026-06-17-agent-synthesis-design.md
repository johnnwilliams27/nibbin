# Agent Synthesis — Design Spec

**Date:** 2026-06-17
**Status:** Draft for review
**Scope:** Turning a Nibbin diagnosis (or an ad-hoc ask) into a real, executable agent — the capability library, the two authoring modes (Composer/B + Planner/C), the validator, the runtime interpreter, the resilience/unblocking layer, credentials, and the escalation UX + notification channels.

**Companion specs (built in parallel, not here):**
- **Trust & Controls hardening** — exclusion persistence, review-before-upload, web Data & Privacy panel, C11 opt-out UI, recording indicator, credential-management surface, copy-accuracy fixes. (The credential-vault management UI and notification-channel/escalation preferences UI referenced here live in that spec; this spec owns the runtime behavior, that one owns the user-facing controls.)
- **Capture bring-up** (M6 macOS / M8 Windows) — wires the staged Screenpipe a11y fork into real OS capture. Provides the real diagnosis input; this spec is built/verified against seeded diagnoses until then.
- **Ceremony / reveal** — the emotional "your agent is being born" layer; wraps this once its shape is final.

---

## 1. Goals & non-goals

**Goal:** Replace "adopt one of 6 fixed templates" with **bespoke agents generated from the user's actual work**, safely executable on real connectors, under the existing approval / Agent School / credit / connector-scope model — and make them *resilient* (they escalate and get unblocked rather than silently failing).

**Non-goals (this spec):** the capture engine; the privacy settings surfaces (Trust & Controls owns those UIs); the reveal ceremony; net-new connectors beyond the existing 24 (the library is built on what exists + generic rails).

---

## 2. Principles (load-bearing — referenced by requirements)

- **P1 — One vocabulary couples observe → diagnose → act.** The capability library *is* the lens: the field study can only recognize work it can map to a capability; the diagnosis can only name what it has capabilities to describe; an agent can only do what's in the library. Library breadth = product ceiling. The observation/diagnosis taxonomy and the capability taxonomy are **co-designed**.
- **P2 — Propose-then-approve is the spine.** Every capability is classed `read | draft | write`. `read` auto-runs; `draft` builds an artifact; **every `write` is auto-wrapped in the approval/School gate** (the under-served middle tier incumbents only do piecemeal — our differentiation). No capability bypasses this.
- **P3 — Legitimate unblocking only.** When blocked, prefer the front door (official API → stored auth → ask the human). **No adversarial evasion** (no CAPTCHA-solver services, IP/ban evasion, or ToS-violating scraping). Creative = "find the API" and "ask the human for the one step only they can do."
- **P4 — Secrets never traverse open channels.** Notifications go anywhere; **secret entry (passwords, credentials, 2FA) happens only in the authenticated Nibbin surface** (in-app Grove chat or a deep-linked one-time secure form → vault).
- **P5 — Unhappy paths are first-class.** Every component specifies its failure/blocked/degraded behavior. A blocked agent *waits on the human*; it never silently fails or burns credits looping.
- **P6 — No silent cuts.** Everything in §15 (coverage ledger) is built or explicitly deferred-with-reason. The plan traces back to it.
- **P7 — Build on what exists.** Reuse the connector registry (24), the spec schema (`templateKey:null` custom path), run loop, ceilings, quarantine, sanitization, `nibbin_write_grants`, weight classes. Generalize the one hardcoded piece (`programs.ts`).

---

## 3. Architecture overview

One runtime executes a validated **Agent Spec** over a vetted **Capability Surface**, under existing gates. Two authoring modes produce specs:

| | **Composer (B)** | **Planner (C)** |
|---|---|---|
| Source | Field-study **diagnosis** | **Quick-scan** study *or* **typed intent** (both) |
| Output | Durable bespoke **Nibbin** spec | One-off **plan** |
| Authoring | LLM *composes & parameterizes* from the vetted library | LLM *freely orchestrates* the same vetted capabilities |
| Lifecycle | Persistent, reproducible, auditable, recurring (unattended, drafts-for-approval) | Ephemeral, supervised, plan-previewed; **crystallizable → B** |
| Weight class | `standard` / `frontier` | `computer_use` (free orchestration / browser) |
| Safety | Validated spec; only vetted steps | Validated plan; only vetted tools; plan-preview + tighter ceilings |

**Shared substrate (all modes):** capability surface • validator/safety layer • runtime interpreter • approval/School/credit/connector-scope gates • quarantine + sanitization • resilience/unblocking • escalation.

---

## 4. Capability library (the backbone)

**Structure — `(resource, verb) → side-effect` triples**, not per-app programs, so it scales across the 24 connectors without combinatorial explosion.
- **Verbs:** `get`/`search` (read) · `create`/`update`/**`upsert`**/`delete` (write) · `new`/`changed` (trigger). `upsert` (find-or-create) is first-class.
- **Side-effect class** on every capability: `read` (auto-run) · `draft` (artifact, no external commit) · `write` (approval-gated per P2).
- **Organized by the 5 primitive shapes:** detect-and-nudge · template-fill-and-send · summarize-into-artifact · sync-data-across-tools · deliver/organize-by-convention. (Existing 6 programs = primitives 1–3; the frontier is sync + deliver/organize.)
- **Universal core first (~25–30 ⭐):** email/calendar/chat/CRM/file/row/SQL/task/invoice CRUD + web search/fetch + control-flow primitives (wait / if / loop / try-retry / transform / request-approval). Long tail follows.
- **Generic-web/MCP equalizer:** authenticated HTTP (GET=read, POST/PUT/DELETE=write) + inbound webhook + **the user-supplied MCP rail** + per-connector API passthrough cover any unsupported service. The whole MCP ecosystem is reachable on day one.
- **Computer-use layer (C):** a unified `target` that resolves to **either a selector or coordinates**, with screenshot+OCR as universal fallback; navigate/click/type/extract/scroll/screenshot. Runs in the `computer_use` weight class.
- **Capability descriptor** (each library entry): `id`, primitive, `resource`, `verb`, side-effect class, `requiredConnector(s)` + scope, typed inputs/outputs (JSON schema), credit cost, sanitization rules, trigger compatibility. Capabilities map to **scan modules** (so observation ↔ capability stays coupled per P1).
- **Seed-then-grow flywheel:** the field study surfaces frequent tasks with **no matching capability** → logged as demand signals → the prioritized capability roadmap. Library is seeded (the external-ecosystem survey + persona-task survey from this session's research passes) and grown (observed gaps).

> The full sourced taxonomy (~150 capabilities / 16 domains, from the three research passes) is **not yet committed** — capturing it as a companion reference doc (`2026-06-17-capability-taxonomy.md`) is build-task R4. This spec commits to the **structure** above + **universal-core-first** + existing-connector coverage, with the generic-web/MCP rail for the long tail.

---

## 5. Spec / Plan schema

Extend the existing `AgentSpec` (`packages/runtime/src/types.ts`) — the `templateKey: null` custom path already exists.

- **Shared shape:** `displayName`, `version`, `toolsAllowlist` (capability ids), `requiredConnectors`, `triggers[]`, `curriculum`, `creditProfile` (+ `ceilings`), and **new** `steps[]` (ordered capability invocations with bindings) + `personaPolicy` (voice/tone, drawn from diagnosis).
- **B-spec:** persisted to `agent_specs` (snapshot-on-adopt, immutable per version), `templateKey: null`, recurring triggers.
- **C-plan:** same shape, **ephemeral** (not persisted as a Nibbin), `trigger: user/once`, tighter ceilings, `computer_use` weight unless it only uses vetted connector steps.
- **`needs_input` is a first-class run state** (see §9). A spec/plan step may declare `mayBlockOn` (auth | decision | value) so the planner anticipates escalation.

---

## 6. Synthesis engine

- **Composer (diagnosis → B-spec):** for each significant diagnosed workflow, select primitive + capabilities + connectors + triggers + persona from the diagnosis; the LLM **proposes** a spec; the validator (§8) enforces. Recommends connectors the user must grant (incremental consent, C8). Reproducible: same diagnosis → same spec shape.
- **Planner (intent/quick-scan → C-plan):** input is typed intent **and/or** a quick-scan observation. LLM authors a one-off plan over vetted capabilities; **plan preview** (the ordered steps + side effects) shown to the user before any `write`; runs under `computer_use` ceilings.
- The model **proposes**; nothing executes unvalidated. LLM calls routed via the existing model router; COGS recorded (existing `model_calls`).

---

## 7. Runtime interpreter (generalize `programs.ts`)

Replace the 6 hardcoded switch-cases with a **generic executor** that runs any validated spec/plan step-by-step:
- Resolves each step to a capability → invokes via the connector layer (quarantined results, `safeHeaderValue`/`safeAddress` sanitization preserved).
- Enforces P2: `read` auto-runs; `write` routes through the approval gate + `nibbin_write_grants` + send-velocity caps.
- Reuses the existing run loop, ceilings (`maxSteps`/`maxTokens`/`maxWallClockMs`), idempotency, weight-class credits.
- **The 6 existing programs become seed compositions** expressed as specs — proving the interpreter against known-good behavior (regression anchor).

---

## 8. Validator / safety layer (the wall that makes C safe)

Every spec/plan, before execution, must:
1. **Typecheck** against the capability surface (every step is a known capability; bindings match I/O schemas).
2. **Scope/policy check:** required connectors present + granted; `write` steps have `nibbin_write_grants`; no capability outside `toolsAllowlist`.
3. **Ceiling check:** within weight-class step/token/wall-clock + credit budget.
4. **Side-effect routing:** every `write` wrapped in approval (P2); destructive/irreversible flagged for explicit confirm.
5. **Fail-closed:** anything unvalidated → does not run; Planner re-proposes or escalates (§9). No partial/ambiguous execution.

---

## 9. Resilience & Unblocking

**Blocker taxonomy:** auth-required (OAuth-able · password-only · MFA/2FA · SSO · expired) · bot/CAPTCHA/WAF/rate-limit · paywall · permission-scope gap · missing-input/decision · ambiguity/low-confidence · destructive-needs-confirm · transient (network/5xx/timeout) · structural-drift · ToS/legal.

**Unblock strategy hierarchy (P3, highest-legitimacy first):**
1. Use the official connector/API instead of fighting the web.
2. Use stored auth (vault) / authorize a connector.
3. **Hand the blocked step to the human** (CAPTCHA, MFA, final confirm) → resume.
4. Alternative source/route for the same goal.
5. Back-off + retry (transient/rate-limit).
6. Degrade gracefully → partial result + explicit "couldn't do X."

**`needs_input` run state + `AgentRequest`:** a blocked run pauses (does not fail) and emits a structured request: `{blockerClass, whatIsNeeded, why, resolutionMode, urgency, expiresAt}`. Resolution modes: `secret-entry` (secure surface) · `value-in-chat` (e.g. 2FA) · `do-this-step` (CAPTCHA/manual) · `authorize-connector` · `decision`.

**Loop safety:** **circuit-breaker** — after N consecutive failures/blocks, pause the agent and escalate; never runaway-retry; ceilings always bound a run. A blocked recurring agent waits + summarizes rather than looping.

---

## 10. Credentials & vault (Option A)

- **Prefer connectors/OAuth always.** For **password-only / no-API** sites: **store credentials in the C9 vault** (encrypted, service-role-only RPCs, **revocable**, per-site scoped), captured via explicit consent, referenced by a **handle** the spec never holds in plaintext. Asked once, reused thereafter.
- **2FA / one-time codes:** ephemeral, single-use, **never stored**.
- **Decisions/values:** stored as agent parameters/memory for reuse (non-secret).
- **Management/revocation UI** lives in Trust & Controls (same vault); revocation cascades to dependent agents (existing C9 cascade).

---

## 11. Escalation UX & notification channels (in-scope, built here)

- **Grovekeeper-mediated** (C10-consistent: the Keeper has no hands — it relays + collects; the agent does the work once unblocked).
- **"Reach-me" notification layer** (distinct from work connectors): **push · email · SMS (Twilio) · Telegram · WhatsApp Business.** No iMessage. Per-user channel connection + **preferences** (priority order, quiet hours, urgency thresholds) — UI in Trust & Controls; routing logic here.
- **Resolution by blocker type:** 2FA → value entered in **authenticated** chat; CAPTCHA/manual → Keeper directs user to do the step, then resume; authorize → deep-link OAuth; decision → Keeper asks.
- **Secret boundary (P4):** alerts + non-secret confirmations on any channel; **secrets only in the authenticated in-app surface** (deep-linked from the alert). **Verify the reply came from the linked account** before acting (anti-spoof). Recognizable framing (anti-phishing).
- **Request queue/digest:** batch so a busy day isn't a ping flood; **channel fallback** if undeliverable; **no-response → request expires** (time-sensitive: escalate urgency or abandon-with-notice; recurring: circuit-break + summarize).

---

## 12. Crystallization (C → B)

"Loved that ad-hoc run? Make it a recurring Nibbin." Converts a C-plan into a **reviewed B-spec**: re-express the one-off plan as composed vetted steps, run it through the validator at B's bar, set recurring triggers + curriculum, require explicit user confirm. **Never auto-carry C's free-orchestration latitude into unattended recurrence.**

---

## 13. Migrations / schema changes

- `agent_specs`: add `steps jsonb`, `persona_policy jsonb` (back-compat: templates get derived/empty values).
- New: `agent_requests` (escalations), `notification_channels` + `channel_prefs`, `agent_credentials` (vault handles + metadata; secret in vault, not here).
- `capabilities` registry (the library) — code-defined + a table for grown/observed capabilities and demand signals (flywheel).
- Apply to **dev + prod** (per the two-instance rule); audit-rule/FK pattern honored.

---

## 14. Unhappy paths (consolidated — P5)

Validator rejects spec/plan → re-propose or escalate, never run. • Connector missing/expired → escalate (authorize). • `write` denied at approval → no side effect, recorded. • Blocker unresolved by expiry → abandon-with-notice / circuit-break. • Credential invalid → re-request once, then escalate. • Channel delivery fails → fallback chain → in-app. • Spoofed/unverified reply → ignored + flagged. • Model proposes unsafe/invalid plan → fail-closed. • Crystallization fails validation → stays ad-hoc, told why. • Runaway loop → circuit-breaker + ceilings. • Partial connector outage → degrade + report exactly what was skipped.

---

## 15. Requirements coverage ledger (the completeness guarantee)

| # | Requirement (from our discussion) | Section |
|---|---|---|
| R1 | B for field study (composed from vetted primitives) | §3, §6 |
| R2 | C for ad-hoc (free orchestration), from quick-scan **and** typed intent | §3, §6 |
| R3 | Shared substrate / one runtime, not two systems | §3, §7 |
| R4 | Greatly expanded, externally-sourced capability library | §4 + appendix |
| R5 | Capability library = coupling vocabulary; breadth = ceiling | §2 P1, §4 |
| R6 | Seed-then-grow flywheel (observed gaps → roadmap) | §4 |
| R7 | `(resource,verb)→side-effect` model; upsert first-class | §4 |
| R8 | Universal core first; generic-web + MCP for long tail | §4 |
| R9 | Computer-use `target` unification (selector|coords+OCR) | §4 |
| R10 | Propose-then-approve wrapper over every write (spine) | §2 P2, §7, §8 |
| R11 | Validator/safety layer (fail-closed) | §8 |
| R12 | Generic interpreter replacing 6 hardcoded programs | §7 |
| R13 | Existing 6 programs as seed compositions | §4, §7 |
| R14 | Resilience: blocker taxonomy | §9 |
| R15 | Unblock hierarchy; **no adversarial evasion** | §2 P3, §9 |
| R16 | `needs_input` state + AgentRequest | §9 |
| R17 | Loop safety / circuit-breaker | §9 |
| R18 | Append credentials → vault (Option A); 2FA ephemeral | §10 |
| R19 | Escalation UX **built in this spec** | §11 |
| R20 | Channels: push/email/SMS/Telegram/WhatsApp; **no iMessage** | §11 |
| R21 | Grovekeeper-mediated, C10-consistent | §11 |
| R22 | Secret boundary (P4) + identity verification | §2 P4, §11 |
| R23 | Crystallization C→B (gated) | §12 |
| R24 | Unhappy paths first-class everywhere | §2 P5, §14 |
| R25 | Build on existing connectors/schema/security | §2 P7, §5, §7, §13 |
| R26 | No silent cuts; plan traces to this ledger | §2 P6 |

**Deferred-with-reason (explicit, not dropped):** real capture input (Capture bring-up spec — until then, seeded diagnoses); ceremony/reveal (own spec); net-new connectors beyond 24 (grown via flywheel); `frontier`/`computer_use` ceiling values (TBD in schema — must be set during build, tracked as a build task, not skipped).

---

## 16. Testing strategy

- Validator unit tests (every reject path). • Interpreter parity tests: the 6 seed compositions reproduce current program behavior. • Capability I/O contract tests. • Resilience: each blocker class → correct AgentRequest + resolution + circuit-breaker. • Escalation: channel routing, secret-boundary enforcement (assert secrets never leave the secure surface), spoofed-reply rejection. • Crystallization validation. • C-plan: assert no execution without plan-preview/approval; assert ephemerality. • Adversarial: attempt to compose a spec that bypasses approval/scope → must fail-closed.

---

## 17. Open dependencies

- Real diagnoses require Capture bring-up; built/verified on **seeded diagnoses** until then.
- Credential-management + channel-preferences + review-before-upload UIs are in **Trust & Controls** (parallel spec) — this spec defines the runtime contracts they bind to.
