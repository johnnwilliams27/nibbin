# PRODUCT-FOUNDATION.md — the platform question, answered

Context: build is mid-flight (M-waves running), observation workflow under test for the next
few weeks. Question: what platform for actual users is missing, what's parallel-safe to build
now, what waits, and what we refuse to build. This document amends SPEC.md and feeds the
decision log. Place in docs/, commit, and paste the SPEC blocks at the bottom.

---

## 1. The reframe

The web app (M2/M4) IS the user platform — Keeper chat, shop, adoption, runtime. What's
under-specced is the **daily-driver surface**, and for Nibbin it has a specific identity no
competitor shares: **the approval queue is the product's heartbeat.** The trust thesis
(Students draft → human approves → accuracy informs the owner's grant) lives or dies on approval speed
and pleasure. If approving feels like email triage, Agent School is a chore. If it feels like
checking on your creatures, it's the retention engine. Promote it to first-class spec.

## 2. Build now, in parallel (study-independent)

### 2.1 The Grove Home (daily surface)
- Approval inbox front and center: draft cards with diff-style "what the agent wants to do,"
  one-tap approve / edit-then-approve / reject-with-reason (reasons feed accuracy scoring).
- Creature presence: each Nibbin at its lifecycle stage, report card one tap away
  (accuracy %, runs, stage progress, next promotion threshold).
- Activity ledger: "what my Nibbins did while I was shooting" — reverse-chron, plain
  language, links to artifacts.
- Ceremony moments: promotions, graduations, first-autonomous-run celebrate here.
- Buildable NOW against fixture data; M4 runtime plugs into it on merge.

### 2.2 Mobile approvals (PWA + push)
- Why urgent: freelancers live on phones (HoneyBook/GlossGenius are mobile-first for a
  reason). Approval latency gates Agent School velocity → TTV and W4-graduation are partly
  hostage to phone reach. Dead time between clients becomes School time.
- v1 = installable PWA + web push: notification → one-tap approve/edit/reject. No app-store
  gauntlet yet; the Tauri desktop and a store app can come post-PMF.
- The single highest-leverage screen in the company is plausibly the push-notification
  approval card.

### 2.3 Grove Memory (the business brain)
- Per-account, user-editable knowledge layer ALL agents share: pricing, policies, FAQ
  answers, voice samples, hard rules ("never discount; offer payment plans").
- Competitive table stakes: Sintra ships "Brain AI"; Lindy runs on knowledge bases. Ours is
  implicit today (scan results + per-agent specs) — make it explicit.
- Effects: draft quality multiplies across every agent at once; switching costs deepen;
  the Keeper's day-one interview (and the scan-empty fallback) finally has a home for its
  output; "what does the grove know about me" gets a trust-architecture answer (inspectable,
  editable, deletable).
- Mechanics: structured sections (facts / voice / rules / FAQ) + freeform notes; versioned;
  injected into agent context by the router with per-section toggles; covered by the same
  retention and export guarantees as everything else (§6.11).

### 2.4 Already queued, still on
- Waitlist + referral mechanics (GTM build), founder-post assets, /photographers vertical
  page at Phase 1.

## 3. Waits for study learnings (deliberately)
Diagnosis presentation, scan heuristics/module tuning, drip beat content and timing,
vertical template-pack contents. These are what the next few weeks of observation testing
reshape — building them now is building twice.

## 4. The anti-feature register (refusals, with reasons)

| Capability (who has it) | Refusal reason |
|---|---|
| Workflow-canvas builder (HoneyBook automations, GoHighLevel, Lindy) | The thesis is users DON'T build workflows — scan + templates + Keeper conversation are the builder. Shipping a canvas concedes the thesis |
| Client portal (HoneyBook, Dubsado core) | Fighting incumbents on fortified ground. Agents work THROUGH the user's existing tools — that's the moat, not the gap |
| Native payments processing (GlossGenius 2.6%, HoneyBook, Bonsai) | Long-term monetization candidate and a founder-wheelhouse edge ("agents that chase invoices" → "agents that collect them"), but a company-defining compliance scope change. Decision-logged, not drifted into. Revisit: post-PMF, ≥1K paying accounts |
| Voice/phone agents (Telegate, AI receptionist cluster) | Latency, trust, brand mismatch at this stage. Future connector-class capability per vertical |
| Template marketplace (user-contributed agent specs) | Real Phase 3 network effect AND a prompt-injection attack surface. Needs post-M8 security maturity + moderation |
| Team seats | ICP is solo. Future exception: read-only "bookkeeper guest" |
| Browser extension | Observer covers capture; portal-action extension is an [H]-class idea for later |

## 5. Pocketed for later (cheap once data flows)
- **Business Pulse** (GlossGenius "AI Analyst" pattern): ask-your-own-business questions +
  revenue-in-flight / response-time trends inside Field Notes. Near-free post-connectors;
  retention surface; post-launch.
- Menu-bar/tray pending-approvals count (desktop glue, polish tier).
- Educator white-label / affiliate dashboards (GTM-adjacent, Phase 2+).

## 6. Sequencing & worktree fit
- Grove Home + Grove Memory: one worktree (feature/m4.5-grove-home), UI against fixtures;
  interfaces with M4's runtime events and the router's context injection.
- PWA + push: extends M5's notification scope (web push is a §6.8/M5 concern); same wave.
- Both run as a Wave 2.5 after current wave gates — review bandwidth stays at two streams.

---

# SPEC paste blocks

## Block A — add as §4.6 (after the Agent School / shop sections)

### 4.8 The Grove Home, approvals everywhere, and Grove Memory

**Grove Home (daily surface).** The web app's home is the approval queue dressed as a
grove, not a dashboard: draft cards (action summary, full preview, one-tap approve /
edit-then-approve / reject-with-reason — reasons feed accuracy scoring), creature presence
with report cards, a plain-language activity ledger, and ceremony moments (promotions,
graduations, first autonomous run). Approval friction is a product metric: median
notification→decision time is tracked per §6.12 (`approval_latency`).

**Approvals everywhere (PWA + push).** The web app is an installable PWA with web push.
The push approval card supports one-tap decisions. Quiet hours and max-1-push-per-day rules
do NOT apply to approval requests (they are work the user asked for), only to drip/celebration
notifications. Approval pushes batch if >3 are pending within 10 minutes.

**Grove Memory (business brain).** A per-account, user-editable knowledge layer shared by
all agents: structured sections (facts, pricing, policies, FAQ, voice samples, hard rules)
plus freeform notes. Versioned; injected into agent context by the router with per-section
toggles; populated initially by the Day-One scan and the Keeper interview (including the
scan-empty fallback), then curated by the user. Hard rules in Grove Memory are enforced as
draft-time constraints, not suggestions. Covered by §6.11 retention/export/deletion
guarantees and rendered inspectable in plain language ("what the grove knows").

## Block B — milestone amendments (§8)

- M4 DoD adds: Grove Home shipped (approval queue, report cards, ledger, ceremonies) wired
  to runtime events; Grove Memory schema + router injection + Keeper-interview population
  live; `approval_latency` instrumented.
- M5 DoD adds: PWA installability + web push approval cards (batching, quiet-hour exemption
  for approvals); push opt-in flow honest and revocable.

## Block C — decision log rows

| The approval queue is the flagship surface, mobile-first | Approval latency gates Agent School velocity; trust ceremony must be a pleasure, not triage | If usage shows desktop-only behavior at scale |
| Grove Memory is explicit, user-editable, and enforced | Implicit knowledge caps draft quality; editable memory is also the trust answer to "what does it know" | Never — extend sections instead |
| Anti-feature register adopted (no canvas builder, client portal, native payments, voice, marketplace, team seats in v1) | Each concedes the thesis, fights incumbents on their ground, or exceeds current security/compliance maturity | Each row carries its own revisit trigger in PRODUCT-FOUNDATION.md §4 |

## Block D — §6.12 event additions

`approval_latency` (push→decision, per channel), `grove_memory_edited`, `push_optin`,
`pwa_installed`, `approval_via_push` vs `approval_via_web`.
