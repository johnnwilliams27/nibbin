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
- **P8 — Cost-aware by construction (COGS is a constraint, not an afterthought).** Route to the **cheapest eval-adequate model** per function (§4B); reserve `frontier`/`computer_use` for where evals prove it's needed. Bounded memory retrieval (top-k/budgeted). Training Mode is sampled + time-boxed (§18.1). Per-agent action + spend budgets with runaway auto-pause (§18.4). No perpetual high-weight runs.

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

**Shared substrate (all modes):** capability surface • validator/safety layer • execution layer • approval/School/credit/connector-scope gates • quarantine + sanitization • resilience/unblocking • escalation.

**Two layers, one contract — keep them separate.** *Creating* an agent and *running* it are distinct subsystems:
- **Synthesis layer** (Composer/B + Planner/C, §6) — authors a **validated spec/plan**. Never executes; never picks runtime models (it may pass a task-profile *hint*).
- **Execution layer** (§7) — takes a validated spec/plan and **runs it**: tool/capability invocation, **model routing** (§4B), content-type handling, gate enforcement, resilience, run recording.

The **validated spec/plan is the only contract** between them. This lets the execution layer evolve (new models, new modalities, better routing) **without touching synthesis**, and vice versa — and each is independently testable.

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

## 4A. Capability *kinds*: deterministic · generative · judgment (creative work)

The `(resource,verb)` model in §4 covers *deterministic* actions. But the highest-value work for creative personas is **non-deterministic** — taste/judgment-laden. Add a **capability KIND** dimension, orthogonal to side-effect class:

- **Deterministic** — fixed transform (CRUD/move/send). Reproducible, validated I/O.
- **Generative** — produce content/media from intent **+ the user's style**: text (posts, replies, captions, copy), image (create/edit/retouch/grade), video (assemble/cut/caption/color), audio/music (edit/master/generate). Model/tool-driven; non-deterministic; quality-judged.
- **Judgment** — classify / prioritize / route / decide with nuance (email triage, lead qualification, urgency).
- **Composites:** most real workflows chain kinds — *"handle email"* = judgment (triage) → generative (draft in voice) → deterministic (send on approval).

**Style/Taste Profile (new artifact).** A per-user, per-domain style memory learned from the field study (editing look/presets, writing voice, brand kit — colors/fonts/logo/reference examples/tone) and **grown by feedback**. Generative capabilities consume it so output feels like *the user's*. It is **derived, not raw capture** — respects the C1–C11 redaction/privacy invariants; versioned; surfaced/editable in Trust & Controls.

**Edits-as-training-signal.** For creative agents the School "measure" is approval + edit-distance; **the user's edits to a draft feed back into the Style Profile** — the agent learns their taste over time. Reuses the existing School/promotion loop.

**Execution tiers (feasibility is honest, not uniform):**
1. **Model-native** — text / image (/audio/video) generation via model APIs → existing model-call infra, `frontier`/`computer_use` weight classes, COGS.
2. **Assisted / headless** — semi-deterministic creative-ops: cull/rate, batch-rename, resize/convert/format, watermark, assemble, caption/transcribe, export — via processing libs (ffmpeg, image libs) + light model assist. The **biggest near-term creative win** (the sync/deliver/organize primitives for photo/video).
3. **App-driven** — pro editing bound to an app (Lightroom/Premiere/Photoshop, no API) → computer-use (C) drives the app.
4. **Prep-and-handoff** — agent does the mechanical 80% (cull, rough-cut, baseline grade, export selects) and **hands the creative-judgment finish to the human** in their own tool.

**Approval & iteration.** Creative is **draft-heavy** (never auto-publish/deliver unseen); **"give me N options / iterate on this feedback" is a first-class generative pattern**; auto-`write` only at high trust + explicit policy.

**Unhappy paths.** Off-brand / low-quality / hallucinated output → mandatory review; iteration budget + ceilings; *"here are options + my confidence"* over one bad answer; graceful *"this needs your eye"* handoff for deep judgment. Generative cost/latency is higher → budget-aware.

**Scope honesty (no misspeaking):**
- **Strong v1:** generative **text** (in-voice) · basic image gen/edit · the **mechanical creative-ops** (tier 2) · **email handling** (judgment+generative+send) · **prep-and-handoff** for deep editing.
- **Aspirational / deferred-with-reason:** fully autonomous pro **video / music / photo** editing (tool-bound, compute-heavy, taste-critical) — pursued via app-driven / prep-and-handoff, **not** promised as full automation.

## 4B. Model routing — buy the transport, own the thin reinforcement

Verified June 2026 (re-verify model IDs/defaults — the field churns weekly). Routing splits into two layers with **opposite buy-vs-build answers** — mirroring §3's synthesis/execution split. The execution layer (§7) invokes every model through this; synthesis never picks a model.

**Layer A — gateway/transport (unified API + fallback + provider governance): BUY, fully off-the-shelf.** Gives one API across providers, **ordered fallback chains**, provider prefs (price/latency/throughput), and data-governance controls. We do **not** build this.
- Candidates: **OpenRouter** (broadest model + modality coverage incl. image/video-gen/embeddings; governance via `data_collection:"deny"` + `zdr:true` — **default permissive, we must opt in + enforce in config**; an Auto-router exists for quality-aware picks). **Vercel AI Gateway** (the only one that **fail-closed enforces** `disallowPromptTraining` + ZDR — strongest for our no-train posture — but hosted-only and **BYOK bypasses it**). **LiteLLM / Portkey** (MIT OSS, self-hostable, prescribe + fallback, but **no provider no-train enforcement** — we'd negotiate provider contracts ourselves).
- **Recommendation:** start on **OpenRouter** (breadth + Auto-router) with `data_collection:"deny"` + `zdr` set account-wide and verified; revisit **Vercel** for fail-closed enforcement or **self-host LiteLLM** to own the transport. (Decision to confirm — §17/below.)

**Layer B — "best model for THIS action, reinforced by OUR performance": BUILD (thin) — the moat.** **No gateway routes on quality / your eval data** — "smart routing" everywhere = cost/latency/load, never measured quality. *Prescribing* a model per action is trivial in any gateway; the *reinforce-on-our-data* half is the thin owned layer: we own the **action/function taxonomy, outcome capture, scoring (approval / edit-distance / style-fidelity / latency / cost / refusal), the reinforcement policy, and fallback rules.** **Not Diamond** is the one off-the-shelf component that trains an *updatable* quality router on *our* eval scores (client-side, ZDR/VPC) — usable as the **engine inside** this layer. Extends the existing `groveRouter` + `model_calls` COGS + `evals`. *This is "be great at this."*

**Three transport types the execution layer abstracts over (so adding one is a registration):**
- **Gateway** (Layer A) — text, image-gen, increasingly video-gen, embeddings.
- **Direct provider** — required where gateways don't reach: **music/audio gen** (ElevenLabs Music, Google Lyria/Vertex, Stability) and **computer-use** (Anthropic / OpenAI / Google). (Suno/Udio have no sanctioned API.)
- **Media aggregator** — **fal.ai + Replicate** together reach ~all image/video/music models via one API (Replicate has Suno/Udio/MusicGen) — a partial "media gateway."

**The eval → routing loop** sets prescribed per-function/modality defaults (incl. style-fidelity), then production signals reinforce; bad models demote, good ones reinforce. **Handles model churn automatically** (the mid-2026 deprecation cluster) — the policy is data-driven, not hardcoded IDs. Respects weight-class budgets (`standard`/`frontier`/`computer_use`); per-model COGS in `model_calls`.

**Governance (load-bearing, accurate — no misspeaking).** No-train is *achievable* but **requires explicit config** (OpenRouter opt-in or Vercel's enforced flag) + a **provider/subprocessor registry** + published **`nibbin.com/subprocessors`** (currently 404) before any provider sees user data. **BYOK and unknown-stance providers are treated as training-until-proven.** Ties to C11 + the Anthropic no-training agreement.

**Resilience tie-in:** model down / rate-limited / refuses → the **fallback chain** is an unblock strategy (§9), not a failure.

## 4C. Agent Shop catalog: curated, connector-tagged seed agents

The Agent Shop is **not** 6 templates — it's a **curated, growing catalog of pre-built agents**, each a validated B-spec composed over the capability library, **tagged by connector/tool** (+ domain, primitive, persona). Users browse/filter "agents for Gmail / Notion / Stripe / Slack / Calendar…" and **adopt directly — no field study required for this path** (e.g. *"I just connected Gmail → here are Gmail agents"*).

**Two paths, one spec type.** Shop (curated/seeded, browse-and-adopt) and Composer (bespoke, generated from the diagnosis) **both produce B-specs.** The diagnosis can *recommend* a shop agent (generalize the existing scan-module→template mapping) **or** compose a bespoke one; the shop also stands alone for users who skip/await the study.

**Sourcing methodology (the seed catalog).** Source purpose-built agents for each of our 24 connectors from the ecosystem — **MCP servers** (largely connector-specific — a goldmine), agent marketplaces, vendor agent offerings, automation-platform app templates — and **adapt/curate** them into Nibbin shop agents: **re-expressed as validated B-specs over our capability library + connectors, under our approval/School/governance model** (we don't wrap-and-run an untrusted third-party agent). Tracked as a build deliverable (the shop-seed sourcing pass — see below).

**Tagging/metadata (each shop agent):** connector tag(s), domain, primitive, persona fit, required connectors + scopes, side-effect summary, credit/weight class, "what it does" copy, creature/species (existing shop-card model). Powers browse/filter **by tool/connector**.

**Governance.** Sourced agents are curated + validated exactly like our own — no unvetted third-party execution. MCP-server-backed agents route through the existing **deny-by-default MCP egress proxy** (quarantined results, public-IP-only). New connectors/providers introduced this way go through the subprocessor governance in §4B.

**Grows via the flywheel.** Popular bespoke (Composer) agents and observed-gap capabilities get **promoted into the shop catalog** — so the shop is seeded (sourced) *and* grown (from real usage).

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

## 7. Execution layer (runtime interpreter + tool use + model invocation)

A separate subsystem from synthesis (§3). It takes a **validated** spec/plan and runs it; it owns tool use *and* model invocation. Replace the 6 hardcoded `programs.ts` switch-cases with a **generic executor**:
- Resolves each step to a capability → invokes the tool via the connector layer (quarantined results; `safeHeaderValue`/`safeAddress` sanitization preserved).
- For generative/judgment/reasoning steps, invokes a model **via the Model Router (§4B)** — the execution layer never hardcodes a model.
- Enforces P2: `read` auto-runs; `write` routes through the approval gate + `nibbin_write_grants` + send-velocity caps.
- Reuses the existing run loop, ceilings (`maxSteps`/`maxTokens`/`maxWallClockMs`), idempotency, weight-class credits.
- **The 6 existing programs become seed compositions** expressed as specs — proving the interpreter against known-good behavior (regression anchor).

**Extensible to all content types.** Capabilities declare **content-typed I/O** (`text` · `image` · `video` · `audio` · `structured` · `file`). The execution layer and router handle any modality through one uniform interface, so **adding a content type or a model/provider for it is a registration, not a rewrite.** A future modality (or a new best-in-class video model) plugs in without changing the layer or any synthesized spec.

**Performance-optimized + a thin reinforcement layer.** Per step, the router picks the model that optimizes **known performance** (per-function/modality evals) within the weight-class budget, then a **thin reinforcement layer** nudges the choice from production signals — approval rate, edit-distance, style-fidelity, latency, cost, refusal/error. "Thin" = a lightweight weighting/policy on top of known performance **and the off-the-shelf gateway** (§4B), **not** a heavy ML system we build. Bad models demote automatically; good ones for a given function get reinforced.

### 7.1 Harnesses — two profiles, shared infrastructure

The execution layer runs each agent through a **harness**, and the right harness follows the B/C split (**B = compile-then-run; C = interpret-at-runtime**):
- **B — deterministic step interpreter.** A B-spec is a validated, ordered sequence; the harness replays it, invoking a model **only at generative/judgment steps**. The agentic *reasoning was front-loaded into synthesis* (the Composer decided the workflow once) → execution is predictable, cheap, auditable, re-runnable. **No free tool-selection loop** — which is exactly why B is safe to run unattended/recurring.
- **C — bounded agentic loop.** A C-plan needs a ReAct-style loop: the model picks the next tool, observes, iterates, until done/blocked — but **only over the validated, pre-provisioned tool surface**, with plan-preview, ceilings (§5), the circuit-breaker (§9), and escalation. Reasoning happens at runtime → which is why C is one-shot/supervised, not durable.

Both share: tool dispatch, the Model Router (§4B), context assembly, gates (P2), resilience (§9), run recording.

### 7.2 Tools loaded — connector capabilities + a standard utility set

Every agent gets a **standard utility toolset** (distinct from connector capabilities): memory/scratchpad (+ Style Profile read), web search/fetch, **ask-human / escalate** (the AgentRequest tool, §9), delegate/sub-task, done/return-artifact, working-file/artifact I/O. The spec's scoped **`toolsAllowlist`** (connector capabilities) is layered on top. (These utilities are the cross-cutting control-flow/memory/HITL primitives from the capability survey.)

### 7.3 Provisioning is pre-set, not LLM-self-granted (the safety boundary)

**Will the LLM figure out which tools it has?** No — and deliberately so. The harness exposes exactly **the spec's validated `toolsAllowlist` + the standard utilities, nothing more.** The LLM **selects among** loaded tools (in C's loop, or at B's generative steps); it **cannot grant itself new tools, connectors, or scopes.**
- **What tools are *needed*** is reasoned at **synthesis** (Composer/Planner → `toolsAllowlist` → validator), not discovered unboundedly at runtime.
- If a running agent determines it needs a capability/connector it lacks → that's a **blocker → escalate** (`needs_input`; the human grants via incremental consent C8; logged as a flywheel demand signal) — **never silent self-expansion.** This keeps P2/P3/fail-closed intact: an agent can *ask for* more power, it can't *take* it.

### 7.4 Context assembly

System prompt + spec/plan + tool definitions + relevant memory/Style Profile + prior-step results, within the weight-class token budget; long C runs **summarize/compact** to stay in budget.

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

## 12A. Agent memory

Memory is fragmented today (Style Profile §4A, the memory utility tool §7.2, the existing learned-notes). Make it one coherent subsystem with **tiers**:
- **Working / episodic (per run)** — scratchpad + intermediate results; short-lived; lives in run context.
- **Agent memory (per agent, persistent)** — what *this* agent learned: corrections, recurring entities (this client's PO format), preferences, past-outcome summaries. Grows with runs/feedback.
- **User memory (per user, cross-agent)** — shared by all of the user's agents: the Style/Taste Profile + user facts/conventions/clients/voice/brand. One agent learning a client's preference makes it available to the user's other agents.
- **Account/team memory (optional, multi-seat)** — shared team knowledge.

**Storage:** structured rows (facts/preferences/entities) + a **vector store** for semantic retrieval (existing capability — Supabase/pgvector/Qdrant) + the versioned Style Profile. Encrypted; **RLS-scoped per user**; **derived-not-raw** (built from already-redacted data — respects C1–C11, redaction-corpus-checked).

**Lifecycle:** **write** (from runs, feedback/corrections, explicit user input) → **retrieve** (relevant memory injected into context §7.4 via semantic + recency) → **correct/update** (user edits) → **forget/retention** (TTL + user deletion → Trust & Controls; honors C3).

**Provenance + confidence:** every entry tagged source (`observed` / `user-stated` / `inferred`) + confidence; agents don't treat low-confidence inferences as fact; user-visible + editable.

**Privacy boundary:** memory is **per-user-scoped, never crosses users** (RLS). Cross-user value flows *only* via §12B's aggregate layer — never raw memory.

## 12B. Learning & the two-tier flywheel (individual + fleet)

Agents improve on **two tiers, with a hard privacy boundary at the user edge:**

**Tier 1 — Individual (the user's data improves the user's agents).** Content-aware, privacy-safe (their own data): **edits → Style Profile** (§4A); **Agent School** approval→autonomy (existing); **per-agent + user memory** (§12A); **routing reinforcement** (§4B) tuned on their outcomes.

**Tier 2 — Fleet (improve SHARED assets for everyone) — aggregate, anonymized, opt-in, STRUCTURAL only.** The network effect, made privacy-safe:
- **What flows up:** capability/composition performance ("detect-and-nudge invoicing → 92% approval"), model-per-function performance (routing policy), capability **demand signals** (gaps → roadmap), shop-agent adoption/promotion/abandon, blocker patterns per connector, failure/quality rates per capability/model. **Statistics about the SYSTEM — capabilities, models, compositions — not about users.**
- **What improves:** the shared **capability-library defaults, routing policy (§4B), shop catalog (§4C), Composer heuristics, unblock strategies (§9)** — benefiting everyone. **Never per-user models.**
- **The hard boundary (load-bearing):** **no raw content, no per-user data, no memory/Style Profile crosses the user edge; no model trained on user content (C11); no selling/sharing (C11).** Potentially-identifying signals pass **aggregation thresholds / k-anonymity / differential privacy**; a user's data improves *others'* agents **only** as anonymized structural statistics — never their content or model weights.
- **Decision — contribution is OPT-OUT (default-on, one switch off).** Safe *because* Tier-2 is anonymized aggregate structural signals only (never content) — this matches the existing C11 claims-page stance ("on unless you turn it off"). The toggle is built in **Trust & Controls** (fixing the C11 no-UI gap), audited, and the privacy copy must state **exactly** what's contributed (system statistics, not your data) so we don't misspeak.

This is a **privacy-respecting network effect**: Nibbin gets smarter for everyone as it's used, without betraying "your data is yours / never sold / opt-out training." (It *is* the seed-then-grow flywheel §4 + the eval/reinforcement loop §4B, with the user-edge boundary now explicit.)

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
| R27 | Capability **kinds**: deterministic · generative · judgment | §4A |
| R28 | Style/Taste profile (field-study-learned) + edits-as-training | §4A |
| R29 | Creative execution tiers incl. prep-and-handoff | §4A |
| R30 | Creative draft-heavy + iteration/options first-class | §4A |
| R31 | Honest creative scope boundary (strong v1 vs aspirational) | §4A |
| R32 | Model router: per-function/modality model assignment + fallback | §4B |
| R33 | Eval-driven routing policy (the moat) + production observability | §4B |
| R34 | Routing governance: vetted no-training providers + subprocessor page | §4B |
| R35 | Transport abstraction: prescribe + OpenRouter hybrid | §4B |
| R36 | Agent Shop = curated, **connector-tagged** catalog of pre-built B-specs | §4C |
| R37 | Source/curate connector-specific agents (MCP/marketplaces/vendor) as seed shop agents | §4C |
| R38 | Shop browse/filter by tool/connector + metadata tagging | §4C |
| R39 | Synthesis ↔ Execution are separate layers; validated spec/plan = the only contract | §3, §6, §7 |
| R40 | Execution extensible to all content types (content-typed capability I/O; register-not-rewrite) | §7 |
| R41 | Thin reinforcement layer on known performance (prod signals → routing), not a heavy ML build | §4B, §7 |
| R42 | Two harness profiles: deterministic interpreter (B) vs bounded agentic loop (C) | §7.1 |
| R43 | Standard utility toolset (memory/web/ask-human/delegate/done/artifact) + scoped connector caps | §7.2 |
| R44 | Tool provisioning pre-set from validated spec; no LLM self-granting; needs-more → escalate (C8) + flywheel | §7.3 |
| R45 | Three transport types (gateway / direct-provider / media-aggregator); music + computer-use are direct | §4B |
| R46 | Agent memory subsystem (working/agent/user/account tiers; vector+structured; provenance; per-user RLS; derived-not-raw) | §12A |
| R47 | Tier-1 individual learning (the user's data → the user's agents) | §12B |
| R48 | Tier-2 fleet learning: aggregate/anonymized **structural** signals → shared assets; **hard user-edge boundary** (no content, no per-user data, no cross-user training, k-anon/DP) | §12B |
| R49 | Tier-2 contribution is **opt-out** (default-on, structural-only); toggle in Trust & Controls; accurate copy (fixes C11) | §12B |
| R50 | **P8 cost-aware by construction** — cheapest-adequate routing, bounded memory, time-boxed training, budgets | §2 |
| R51 | **Training Mode** (read-only earn-write phase = safety + learning + explainability; School student phase; COGS-bounded) | §18.1 |
| R52 | Agent lifecycle: versioned edit + migrate, pause/retire, re-diagnosis (diff+approve) | §18.2 |
| R53 | Multi-agent coordination + conflict-flagging (Grovekeeper orchestrator) | §18.3 |
| R54 | Runaway-action + spend prevention (budgets + anomaly auto-pause) — COGS + trust guardrail | §18.4 |
| R55 | Observability/explainability surface (run history, why-did-it, approvals) | §18.5 |

**Deferred-with-reason (explicit, not dropped):** real capture input (Capture bring-up spec — until then, seeded diagnoses); ceremony/reveal (own spec); net-new connectors beyond 24 (grown via flywheel); `frontier`/`computer_use` ceiling values (TBD in schema — must be set during build, tracked as a build task, not skipped); **fully autonomous pro video/music/photo editing** (taste-critical + tool-bound — addressed via app-driven/prep-and-handoff in §4A, not promised as full automation).

**Build deliverables to produce (companion docs/data, tracked — not skipped):** (a) the full ~150-capability taxonomy doc (R4); (b) the **shop-seed sourcing pass** — purpose-built connector-specific agents surveyed + curated into tagged shop B-specs (R37); (c) the **model-per-function eval results → routing policy** table (R33); (d) the **provider/subprocessor registry + published `nibbin.com/subprocessors`** (R34).

---

## 16. Testing strategy

- Validator unit tests (every reject path). • Interpreter parity tests: the 6 seed compositions reproduce current program behavior. • Capability I/O contract tests. • Resilience: each blocker class → correct AgentRequest + resolution + circuit-breaker. • Escalation: channel routing, secret-boundary enforcement (assert secrets never leave the secure surface), spoofed-reply rejection. • Crystallization validation. • C-plan: assert no execution without plan-preview/approval; assert ephemerality. • Adversarial: attempt to compose a spec that bypasses approval/scope → must fail-closed. • Creative: generative steps are `draft`-classed and cannot auto-`write` without explicit policy; iteration/options budget enforced; edits update the Style Profile; Style Profile is derived (no raw-capture leakage — redaction-corpus check).

---

## 17. Open dependencies

- Real diagnoses require Capture bring-up; built/verified on **seeded diagnoses** until then.
- Credential-management + channel-preferences + review-before-upload UIs are in **Trust & Controls** (parallel spec) — this spec defines the runtime contracts they bind to.

## 18. Additional committed components (decided 2026-06-17)

**18.1 Training Mode** (the renamed dry-run/shadow). Before an agent earns `write` it runs in **Training Mode**: read-only, producing the drafts/actions it *would* take, surfaced for approve/correct. One mechanism, three jobs — (a) **safety** dry-run, (b) **learning** period (corrections feed Style Profile + memory, §4A/§12A, edits-as-training-signal), (c) **explainability** (you see what it would do). It *is* Agent School's **student** phase; graduating (the existing approval/promotion bar) flips on `write`. **COGS:** cheapest eval-adequate model (§4B), **sampled/batched** (not every event), **time-boxed by graduation** — not a perpetual cost.

**18.2 Agent lifecycle.** Edit/tune → **new spec version** (snapshots stay immutable) + migrate the running Nibbin; pause/retire/delete; **re-diagnosis** — a fresh field study proposes updates to existing agents as a **diff to approve**, never silently mutating them.

**18.3 Multi-agent coordination (Grovekeeper-orchestrated).** The **Grovekeeper** (C10, no hands) sequences/dedupes a user's fleet and **flags conflicts** (two agents acting on the same inbox/resource). Agents declare the resources they touch; the orchestrator prevents double-acting and arbitrates ordering.

**18.4 Runaway-action prevention + budgets (COGS + trust guardrail).** Per-agent **action budgets** (max sends/run, max/day) **and spend/credit budgets**, plus **anomaly detection** — an agent about to act far above its normal volume (50× sends, or burn its monthly credits in one run) is **auto-paused and Grovekeeper-flagged before acting**. Hard ceilings always bound it. Stops an agent from "eating someone's actions" and prevents COGS blowouts. Extends the circuit-breaker (§9) from blockers to **volume/spend**.

**18.5 Observability / explainability ("peek into the black box").** One coherent surface: **run history**, **"why did it do this?"** (step trace + which memory/Style inputs + which model), and the **approvals queue**. Reuses existing runs / `model_calls` / approvals data. Necessary for trust in an autonomous product.

**18.6 Cold-start — sufficient as-is.** New user, no study: the **shop catalog (§4C) + quick-scan + typed intent** cover it. No additional work.
