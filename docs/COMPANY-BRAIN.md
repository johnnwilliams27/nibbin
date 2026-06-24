# Nibbin — Company Brain: Positioning, Architecture & Build Spec

**Document type:** Build-from spec + positioning brief. One-shot prompt for Claude Code.
**Status:** Decisions here were made deliberately. Change them in the Decision Log (§16), not silently.
**Scope:** Reframe Nibbin as a *company brain*, generalize ingestion beyond passive capture, harden Grove Memory into a two-layer truth/evidence model, add doc ingestion + conflict resolution, and wire the existing notification center into the Grovekeeper. Covers strategy, copy, design, eng, architecture, and feature work.
**Author's note:** The architectural and data-model decisions below must be placed under real scrutiny during implementation to ensure they scale into the multi-user B2B phase. The tenancy seam (§12) is the load-bearing one — get it right now even though we ship single-user.

---

## 1. Why this document exists

Y Combinator's Summer 2026 Request for Startups includes **Company Brain** (Tom Blomfield) and the closely related **AI Operating System for Companies** (Diana Hu). Both describe the same primitive: pull a business's scattered, tacit knowledge out of people's heads and fragmented tools, structure it, keep it current, and turn it into something AI agents can execute on safely and consistently.

Nibbin already is this — from a different direction. We are repositioning to make that explicit, and closing the specific product gaps that separate "a desktop agent that learns your workflow" from "the brain your business runs on."

This is **not** a rewrite. Most of the foundation exists: Grove Memory (the legible knowledge layer), the Field Study (passive capture), Connections (ingestion from existing accounts), the Grovekeeper (the orchestrator), Agent School (the trust/approval engine), and a notification center. The work is to generalize, harden, and connect what we have — plus build one genuinely new capability (the synthesis/query layer) and one new ingestion path (docs).

---

## 2. Strategic frame: who we are against, and why we win

**We are measured against GBrain.** Garry Tan (YC's president) built and open-sourced GBrain as the reference implementation of the Company Brain shape. Tom Blomfield wrote the RFS. Pitching "company brain" to YC means standing next to the thing the people reading the application built themselves. We must be accurate about this, not naive.

**GBrain's structural ceiling is our opening.** GBrain requires a frontier model, a running agent runtime (OpenClaw/Hermes), command-line comfort, and manual curation. It is explicitly *not* for anyone without persistent agent infrastructure. A wedding photographer or solo operator will never run `bun install` or configure a dream cycle.

**Our wedge:** GBrain's thesis, productized for the people who structurally cannot run GBrain. The mechanism that makes this possible is the one thing GBrain doesn't have — **passive capture**. GBrain ingests artifacts and requires the user to curate. Nibbin observes work happening and proposes. That deletes the two constraints (technical skill + manual curation) that cap GBrain's reach.

**One-sentence positioning:**
> Nibbin is the knowledge layer GBrain pioneered, minus the human curation and the command line — a zero-setup brain that learns how your business works by watching, so your agents can do the work like you would.

**Do not claim:** multi-user, federation, or "company brain for teams" as a present capability. We claim it as a deliberate, sequenced roadmap. See §3.

---

## 3. The narrative: individuals now, businesses next (no dichotomy)

We do **not** position as "company of one." We do not draw a hard line between consumer, prosumer, and B2B. We present a single pathway:

> We work with individuals today to map their workflows and ingest their knowledge so we can build the brain fast and well. We expand to businesses with multi-user permissions once the core thesis is proven and working.

**The strategic reason (not just "it's easier"):** the individual phase is the moat factory. Every individual Nibbin observes produces real, observed-workflow data that no top-down B2B competitor can acquire — because they sell into companies that won't let an agent watch the work. We accumulate the one asset the eventual B2B product is built on, at consumer speed and scale, then convert it to enterprise ACVs. "Start small" is actually "compound a data advantage cheaply, then monetize it up-market."

**Honest engineering note for the pivot to B2B.** It is *not* "just an RBAC step." Multi-user adds three things beyond permissions:
1. **Federated leak-prevention** — every read path must be access-scoped with zero cross-user leakage (GBrain fuzz-tested exactly this).
2. **Authority resolution** — when two people do the same task differently, whose version becomes the skill?
3. **Shared-skill governance** — who approves a skill that acts on company-owned systems?

None block us. They are reasons to bake the **tenant/owner boundary into the schema now** (§12) while shipping single-user, so the pivot is *RBAC + SOC 2 + governance*, not a re-architecture. **SOC 2 is the explicit gate that opens the B2B phase** and is a tracked gap to close — sequenced after the single-user loop is proven.

---

## 4. The memory architecture (keystone)

This is the most important section. Everything in §5–§9 derives from it.

### 4.1 The keystone rule

> **The curated layer is truth. The repository is evidence. Nothing in the repository is authoritative on its own — truth is only what has been distilled and human-approved into Grove Memory.**

Do not try to compute the source of truth *from* a pile of documents. A data lake has no inherent source of truth — that is its defining problem. Instead: the repository is timestamped, sourced evidence that *feeds proposals*; the curated Grove Memory fields are the ratified answer Nibbins treat as gospel. This is also the only safe design once agents start acting — an agent must never act on unratified evidence.

### 4.2 Two layers, surfaced as two tabs on the Memory page

- **Tab 1 — Grove Memory (truth).** Today's Grove Memory: structured, legible, short, human-approved. The fields the Nibbins read as gospel (About your business, Pricing, Policies, Voice & tone, Common questions, Hard rules, etc.). Frame: the source of truth.
- **Tab 2 — Sources / Repository (evidence).** The docs and raw data with provenance and timestamps. Frame the label as **"Sources"** or **"Repository"** — never "data lake," because the word implies the undifferentiated dump whose ambiguity we are explicitly avoiding.

What each needs differs:
- The **repository** needs real search/retrieval once it exceeds a handful of docs — hybrid vector + keyword (the pgvector layer, §11). This is the same retrieval GBrain runs.
- The **curated fields** mostly don't need search — they're already distilled and short.

### 4.3 The thread that connects the two tabs: provenance

Add to every curated field:
- **Per-field provenance** — a small "where did this come from?" affordance pointing back to the doc, observation, or manual entry that produced it.
- **A staleness hint** — when the underlying evidence is old or the field hasn't been touched in a while, surface it (GBrain's "here's what the brain doesn't know yet" idea, applied per-field).

Provenance is what makes the curated layer *trustworthy* instead of mysterious. It is the visible link from truth back to evidence.

### 4.4 How truth gets decided when evidence competes

Three signals, in order:
1. **Recency** — newer supersedes older (timestamps give this for free).
2. **Source authority** — a signed contract outranks a casual email (GBrain calls this a source-tier boost). See §9 for how authority is learned, not just configured.
3. **The human** — ratifies or overrides. Always the final say.

We are not building truth detection. We are building **evidence ranking + human ratification**.

---

## 5. Ingestion: four inputs, one surface, one review loop

Generalize ingestion so it does **not** rely solely on passive capture. Every input feeds the *same* Grove Memory through the *same* review loop:

1. **Manual field entry** → user types into a field → it's in Grove Memory.
2. **Document drop** → user drops a doc → Nibbin extracts → proposes field updates → user approves → Grove Memory. (New, §6.)
3. **Field study (passive capture)** → Nibbin watches work → proposes entries → user approves → Grove Memory.
4. **Connections** → Gmail / calendar / files pull in → same extract-and-propose → Grove Memory.

Four inputs, one legible editable layer, one approval gate. This is GBrain's design in our idiom: the structured fields are the "current understanding," the docs and observations underneath are the source trail. **We already built the top half (Grove Memory). This work builds the bottom half and connects them.**

### 5.1 Connections is already day-one seeding — generalize and harden it

Connecting Gmail already ingests email history immediately, so the brain is *not* empty on day one for anyone who connects an account. This exists; it's thin. "Make it more robust" means three concrete things:

- **Breadth of sources.** Today seeding is basically Gmail. Add calendar, files/Drive, contacts, and the document path (§6). Each connector makes day-one seeding richer. Architecturally this is the **MCP/connector substrate** (§7) — "expand ingestion beyond passive capture" and "make Connections a generic, extensible source layer" are the same task.
- **The direct file/document path.** Connecting a live account and handing over a static file are different mechanics. Connections covers the former; §6 adds the latter. It slots in as one more ingestion source, not a separate philosophy.
- **Surface the flow.** Connections is currently buried in Settings (ref NIB-3) and Gmail errors render below the fold (ref NIB-5). Promote Connections to a discoverable, early onboarding step and surface connection errors in view. None of the breadth matters if users never reach the surface.

### 5.2 Scope discipline on manual entry

Manual entry and doc ingestion are **subordinate** to passive capture, not co-equal. Do **not** make "type it in yourself" a headline mode — that is literally what GBrain is, and promoting it re-imports the curation constraint that caps GBrain's reach. The correct framing:

> Nibbin learns by watching, and when there's something it can't see or hasn't seen yet, you can just tell it (or hand it a doc).

Manual/doc ingestion exists specifically to solve **cold-start** (the brain is empty and dumb for the first weeks of passive observation) and to **pre-seed B2B onboarding** (a company seeds existing SOPs on day one). That is its strategic home. Headline stays "learns by watching."

---

## 6. Document ingestion (new capability)

### 6.1 The rule: docs are an input, not a storage format

Do **not** let users dump raw files *into* Grove Memory as a pile. That turns the clean, gospel-grade surface into a junk drawer and sends agents back to guessing. Instead:

- A doc is dropped → Nibbin reads it → extracts relevant facts → **proposes** entries into the structured fields → user reviews and approves.
- The original doc is retained underneath in the **Sources** tab (§4.2) as provenance/citation.
- Grove Memory stays the clean synthesized layer; the doc becomes populated, correctable fields plus a retained source.

### 6.2 Why this is the cold-start unlock

Look at the current Memory page: Pricing is empty, Policies is empty, Voice & tone and Common questions are empty placeholders the user must fill by hand. That empty state *is* the cold-start friction. Doc ingestion attacks it directly: instead of typing your policies, drop your client contract and Nibbin fills Policies; instead of typing pricing, drop your rate sheet.

### 6.3 The two distill actions

1. **Extract-on-drop** — one doc lands → Nibbin reads it → proposes field updates for that doc. Synchronous, scoped to the dropped doc.
2. **Periodic collate** — across all docs + observations → dedup, reconcile, refresh, surface contradictions. Runs on a schedule (the consolidation pass; surfaces to the user as a morning brief / review queue, not an interruption). This is GBrain's split: fact extraction at write time + an overnight pass that dedups and consolidates.

**Hard rule for both:** output is **proposed** changes the user reviews. Never a silent write to the curated layer. The distill action is the bridge from evidence → truth; the human is the toll booth on that bridge.

### 6.4 The Reference catch-all

Add a freeform **Reference** area inside the Sources tab for material that doesn't map to any structured field (a long style guide, a full SOP). Still searchable/retrievable by the Nibbins, but kept separate from the curated fields so it never muddies them. (GBrain uses a catch-all `note` type for exactly this.)

---

## 7. Integration substrate: MCP, not per-company builds

**Decision: do not build bespoke per-company integrations.** That is services revenue dressed as product, it doesn't scale, and it is the exact "brutal integration glue" the AI-OS RFS calls out as the problem to eliminate — not reproduce. YC will read bespoke integration work as a consultancy.

**Build a generic, declarative connector layer on MCP.** Let a company point Nibbin at any internal API wrapped as an MCP server, with a thin manifest/recipe describing auth, what it reads (ingestion source), and what it can do (action surface). Nibbin treats any registered system as both an ingestion source *and* an action surface without knowing it in advance. This:

- scales as product, not services;
- matches where the ecosystem is going (the "Software for Agents" RFS: everything becomes MCP/API/CLI for agents);
- keeps us architecturally credible next to the reference implementation (GBrain exposes 30+ tools over MCP and ships custom ingestion sources against a versioned contract);
- is the technical spine of the eventual B2B "link your proprietary systems" promise, so it serves both phases.

Reserve forward-deployed custom work for the rare system with no API at all — and even then, productize the result into a reusable connector so we never do it twice.

**Architecture note (existing decision, carry forward):** direct provider API for high-volume passive ingestion (e.g., Gmail API + Pub/Sub for inbox observation); MCP / well-defined tools for agent-facing *actions*. Both ride the same OAuth client. Do not route high-volume ingestion events through an LLM tool-call loop.

---

## 8. The synthesis / query layer (the real build gap)

This is the one capability that is genuinely missing and is **non-negotiable** for the "brain" claim. GBrain's entire differentiator is `think` over `search`: not a list of pages, but a synthesized, cited answer plus a gap analysis telling you what the brain doesn't know yet.

### 8.1 What to build

- **Hybrid retrieval** (vector + keyword on pgvector) over the Sources/Repository — table stakes, adopt directly.
- **A synthesis layer** that runs retrieval, then composes an answer across results with explicit citations back to source pages/observations, **plus an honest gap note** (what's stale, what's uncited, where two sources disagree). This is orchestration, not exotic infra — it's the model following a multi-step prompt over good retrieval.

### 8.2 The product reframe (this is where we beat GBrain on UX)

For our user, the synthesized answer is framed as **workflow guidance**, not a research query:
> "Here's how you usually handle a rescheduled deposit; here's what's still open with the Hendersons."

And the gap analysis becomes Nibbin's **learning interaction**:
> "I haven't seen you invoice this way recently — did your process change?"

We've turned GBrain's most technical feature into Nibbin's friendly onboarding-and-learning loop. Same engine, warmer surface.

---

## 9. Conflict resolution

### 9.1 Surface, don't auto-resolve

When evidence disagrees (the deposit is 50% in last year's contract and 30% in the new pricing PDF), Nibbin does **not** silently pick one. It surfaces the disagreement and asks the human. For a solo operator, framed warmly, this reads as "Nibbin caught something," not "database conflict." (GBrain does exactly this — its consolidation pass samples for suspected contradictions and its synthesis layer flags uncertainty rather than guessing.)

### 9.2 Where the conversation happens: the Grovekeeper

The Grovekeeper is the right voice. It is our conductor with **no hands** — it reads, plans, talks, delegates; it holds no side-effect tools. Surfacing a conflict and asking "which is current?" is pure read-plan-talk — no Agent School gate needed. It fits the Grovekeeper's established role as the walkthrough helper that watches out for you.

### 9.3 Separate the messenger from the state

- **The conflict lives as persistent state on the Memory field** — the affected field shows a "needs your review" flag with the competing sources attached. Chat is ephemeral; the flag is not. If the user closes the chat, the conflict must not evaporate.
- **The Grovekeeper is how it gets surfaced and talked through.** Chat raises it; the field holds it until resolved.

### 9.4 Ratification respects "no autonomy laundering"

The Grovekeeper **proposes** the choice; the **user's pick is the approving action** — the user is the hand. The write to Grove Memory follows from the user's click, never from the Grovekeeper silently rewriting gospel. Conductor tees it up; the user commits it.

### 9.5 Tier by stakes so it doesn't nag

- **High-stakes conflicts** (pricing, policies, hard rules — gospel-level) → Grovekeeper raises proactively.
- **Trivial discrepancies** → batch into the periodic collate pass; show as quiet flags or a line in the morning brief, not an interruption.

### 9.6 Metabolize the resolution (Trust Ledger tie-in)

This is what makes the memory architecture *our* moat, not a bolted-on system. A conflict resolution **is an approval step**. When the user picks "the new PDF is right, not last year's contract," Nibbin learns *which source this user trusts* and feeds the **source-authority ranking** (§4.4). This is "everyone has an approval step; only Nibbin metabolizes it" — applied to what the brain *believes*, not just whether to send an email. Every resolved conflict makes evidence-ranking smarter, so fewer conflicts surface over time. The Trust Ledger and the memory architecture are the same idea wearing two hats.

---

## 10. The attention queue + notification wiring

### 10.1 Generalize before building

A conflict is just one kind of "thing that needs you." Siblings already exist: a Nibbin finishing a draft that needs approval (push approvals), an agent graduating Agent School, a connection breaking, the study completing. Do **not** build a notification for memory conflicts in isolation — build the queue once and let everything feed it.

### 10.2 We already have the rail

A notification icon and center already exist. The gap is that (a) the new item types don't emit into it yet, and (b) the Grovekeeper can't see it. So this is mostly **wiring, not building**.

### 10.3 The single rule: one source of truth

> The notification center stays the canonical store. The Grovekeeper **reads from it** — it does not keep its own list.

Otherwise state drifts (chat says two pending, center says five, user trusts neither). One store, multiple lenses over it.

### 10.4 The two wiring jobs

1. **Emit new item types into the existing center.** Memory conflicts and review items become notification *types* alongside whatever fires today (approvals, system events). Additive — a new event type on an existing system. Stakes tiering is a property on the item: high-stakes also pushes; low-stakes sits quietly.
2. **Give the Grovekeeper read access** to unresolved items so it can reference them in-band ("you've got three things waiting — want to start with the pricing conflict?") and **deep-link each one** to where it lives (the Memory field, the draft). On opening chat, lead with what's pending instead of an empty prompt. This is what turns a generic chat window into something that feels like it's keeping track for you.

### 10.5 Surfaces

- **Primary at-a-glance badge → Grove Home** (the daily-driver surface), not buried in chat. "Here's what needs you today" belongs on the surface the user opens every day.
- **The Grovekeeper** is the conversational layer to work *through* the queue.
- **High-stakes items** ride the **same push-notification rail as push approvals** — do not build a second delivery system. (Push approvals is already on the urgent list; you may be building half of this already.)

---

## 11. Build order (engineering sequence)

Each step is gated: don't start the next until the prior is real and reviewed.

1. **Schema + tenancy seam (§12).** Typed pages/fields, append-only history under curated values, auto-linked references, and a tenant/owner boundary baked in even though we ship single-user. Source of record stays clean and inspectable.
2. **Ingestion generalization.** Promote/harden Connections (NIB-3, NIB-5); add calendar/files/contacts connectors via the MCP substrate; add the document-drop path.
3. **Document extract-on-drop.** Read → extract → propose field updates → review/approve → retain source. Reference catch-all in Sources tab.
4. **Hybrid retrieval on pgvector** over the Sources/Repository.
5. **Synthesis + gap-analysis layer (§8).** The query engine, surfaced as workflow guidance + learning interaction.
6. **Periodic collate pass.** Dedup, reconcile, surface contradictions → morning brief / review queue.
7. **Conflict-resolution flow (§9).** Persistent field flags, Grovekeeper surfacing, user-pick-as-approval, metabolize into source-authority.
8. **Notification wiring (§10).** Emit new item types into the existing center; Grove Home badge; Grovekeeper read-and-reference-and-deep-link; high-stakes on the push rail.
9. **MCP connector layer for proprietary systems (§7).** Declarative manifest/recipe; ingestion + action surfaces. (Primarily a B2B enabler — can trail the consumer loop.)

**Parallel / ongoing:** SOC 2 readiness (the B2B gate); security + business-logic review of every new data path (no injection vectors, scoped reads, audit on writes); PR code-review discipline on all merges.

---

## 12. Architecture & data model (scrutinize during build)

- **Tenant/owner boundary in the schema from day one.** Single-user today, but every page/field/source/notification carries an owner scope so the multi-user pivot is RBAC + governance, not a migration. This is the load-bearing decision.
- **Curated value vs. evidence are distinct stores with a typed link.** Curated fields (truth) reference the sources/observations (evidence) that produced them. Provenance is a first-class relationship, not a comment.
- **Append-only history under each curated value.** Current understanding on top (rewritten as it changes); timestamped evidence trail below (only ever appended). The brain gets more accurate over time without losing how it got there.
- **Source-authority ranking is a learned, per-user model** seeded by config (contract > email) and updated by every conflict resolution (§9.6).
- **MCP as the integration substrate** for both ingestion and action; provider APIs for high-volume passive ingestion. One OAuth client.
- **Single source of truth for notifications.** One center; all surfaces (Grove Home badge, Grovekeeper, push) read from it.
- **All distill/collate outputs are proposals.** No code path writes the curated layer without an explicit human approval event, which is itself logged (this log *is* the Trust Ledger substrate).
- **SOC 2 as the explicit B2B gate.** Tracked, sequenced after the single-user loop proves out.

---

## 13. Design principles & surfaces

**Design's job:** make everything GBrain exposes as CLI, markdown, and config into **inspectable visual surfaces a non-technical person can read, trust, and correct.** Correctability-without-a-terminal is simultaneously the design principle and the product moat.

- **Memory page → two tabs:** *Grove Memory* (truth — keep the current clean, structured, editable UX largely as-is) and *Sources* (evidence — docs with provenance, retrieval-backed search, the Reference catch-all).
- **Keep the curated layer clean.** Never let docs land as a pile in the truth layer. Docs populate fields; the field is the surface.
- **Per-field provenance + staleness** on every curated field — a small "where did this come from?" and a staleness hint. The visible thread from truth to evidence.
- **Conflict = a field-level "needs your review" flag** with competing sources, persistent until resolved.
- **The Grovekeeper as conversational layer:** surfaces the queue, walks the user through conflicts and reviews, deep-links to the thing. Presents as the helper who introduces you to your team and watches your back — never as plumbing.
- **Grove Home carries the at-a-glance "what needs you today" badge.**
- **Brand mapping (native, don't force):** Grove = the growing knowledge repository; Agent School = where captured workflows become skills; Hatchling / Grove / Canopy tiers = brain scope & maturity (and foreshadow the multi-user roadmap). The grove that grows as it watches you work.

(When implementing actual UI, follow the frontend-design skill's tokens and styling constraints.)

---

## 14. Copy & positioning language

### 14.1 Locked lines (do not reword without explicit approval)

**Canonical customer-facing tagline** — landing page hero, deck title slide, anywhere we say "what we are":
> **Nibbin is the AI team that learns how you operate — and runs your day so you don't have to.**

**Canonical pitch opener** — the hook that leads a YC/investor pitch, said *before* the tagline:
> **Every other AI makes you explain how you work. Nibbin learns on the job.**

How they hand off: the opener sells *how it's different* (it learns on its own, no setup, no prompts); the tagline sells *what you get* (your day back). In a pitch, lead with the opener to wake the room, then land the tagline as the anchor. Customers mostly see the tagline. The opener's "learns on the job" reinforces the AI-team / good-new-hire metaphor that the tagline carries — keep that consistency.

These are locked. Persist the tagline into the landing-page hero copy and the project memory. Do not substitute synonyms ("works the way you would," "handles your busywork," etc.) — those were considered and rejected.

### 14.2 Headline / category rules

- Lead customer-facing surfaces with the **team/outcome** ("an AI team that learns how you operate"), not the machinery.
- "Learns by watching" stays an internal/explanatory phrase — **avoid "watching" in customer-facing taglines** (surveillance connotation works against the privacy-first story). Prefer "learns how you operate," "learns on the job," "picks it up as you work."
- Umbrella ambition (investor altitude): the brain every business runs on — starting with the people who run them solo.
- Do **not** say "company of one." Do **not** claim multi-user before it ships. Do **not** use "agentic brain" or other insider jargon in customer copy.

### 14.3 About / origin section (founder-credibility copy)

This is the "why we exist" narrative — for the About page, the deck's problem slide, and investor conversations. It does three jobs: establishes founder-earned insight, names the real pain (finding and keeping knowledge), and sets up the simple-to-enterprise spectrum.

Direction (founder voice, credible, plain — not jargon):

> Every business runs on knowledge that lives in the wrong places — in someone's head, in old threads, in tools nobody can navigate. We saw it at its most extreme inside companies like PayPal, Block, and Google, where finding out how the work already got done could take months. It's the same problem whether you're one person or ten thousand: the way your business actually works is everywhere except somewhere you can use it.
>
> The tools meant to fix this ask too much in return. They need constant setup and management, and even then you can't easily see what your agents know or why they did what they did. Powerful, but heavy — so most of that power goes unused.
>
> Nibbin is the opposite of that. It learns how the work gets done by doing it alongside you, and it keeps what it knows somewhere you can actually see, trust, and correct — no command line, no configuration, no manual. Simple enough for one person who has never touched an AI tool. Extensible enough to handle a whole organization's knowledge base when you want it to. **The same brain, whether it's just you or an entire company.**

**The spectrum line to reuse** (works in both rooms): *"Simple enough for a layman, extensible to a full enterprise — the same brain either way."* This is the reconciliation of the consumer wedge and the company-brain ambition, stated as a feature of the architecture rather than a roadmap promise.

Notes for whoever writes the final copy:
- **Never let the origin or the villain pick an end of the spectrum.** The *constant* is the problem (knowledge is scattered; tools are heavy to run); the *variable* is the size of the business. Both a solo operator and an enterprise buyer must see themselves in every line. Do not frame the origin as "born in the enterprise" (ringfences us to B2B) and do not say tools were "built for engineers" (ringfences *and* fails enterprise vetting — it reads as "not serious infrastructure").
- The large company is the *most extreme illustration* of a universal problem, not the home base. Lead with the universal truth; use PayPal/Block/Google as the sharpest example of it.
- The villain is the *burden* of the tools, not their audience. "Asked too much in return / powerful but heavy" threads both profiles: the individual hears "I don't have time for that"; the enterprise hears "low adoption, poor observability" — a sophisticated critique that survives a vetting process.
- The large-company knowledge pain is the *same problem* the company-brain thesis solves — so the origin story and the product vision are one continuous argument, not two. Keep them connected.
- The existing-tools pain has two halves: (1) hard to set up/use, and (2) hard to *manage and track* — you can't tell what your agents or memory are doing. Nibbin answers both with legibility (the inspectable, correctable Grove Memory) and zero-setup. Name both halves.
- Don't oversell the enterprise end in customer copy; "extensible to a full enterprise if you want it to be" is the right register — present as latent capability, not current product.

### 14.4 Against the GBrain ceiling (pitch/investor only — never customer-facing)

- GBrain needs a frontier model, a running agent runtime, and command-line comfort — it's "not your next step" for anyone without persistent agent infra. Nibbin is the brain for everyone who can't run that.

### 14.5 Memory page copy direction
- Keep the existing warm, plain-spoken voice ("Everything here is shared with your Nibbins so their drafts sound like you — not a generic assistant. Edit or clear any of it, anytime; it's yours.").
- Sources tab framing: "Everything Nibbin has read or watched to build your memory. The originals live here; your memory up top is the clean version."
- Empty-state nudge toward doc drop: "Don't want to type it all out? Drop in a doc — a contract, your rate sheet, an old email — and Nibbin will fill this in for you to check."

**Grovekeeper conflict prompt direction (warm, not technical):**
- "Quick one — your deposit terms don't match across two things I've read. Which is current?" → present both with their sources → user picks → "Got it, I'll treat that as the rule from now on."

**Privacy-first as a through-line:** local/on-device where applicable is both a consumer trust asset and the eventual B2B data-residency story. Keep it in the narrative.

---

## 15. Anti-features & scope guardrails

Hold the line on these — each is a way the product gets fuzzier or slower:

- **No manual entry as a co-headline mode.** It's the cold-start/fill-gaps tool, subordinate to "learns by watching." (§5.2)
- **No raw docs dumped into the curated layer.** Docs are an input that populates fields; they live in Sources. (§6.1)
- **No bespoke per-company integrations.** Generic MCP connector layer only; productize any exception. (§7)
- **No auto-resolution of conflicts.** Surface to the human; the human ratifies. (§9.1)
- **No second notification system.** One center; the Grovekeeper reads from it. (§10.3)
- **No Grovekeeper side-effect writes.** It proposes; the user's click commits. (§9.4)
- **No claiming multi-user / federation before it ships.** Roadmap, not present tense. (§3)
- **No silent writes to the curated layer, ever.** Every truth-layer write is a logged human approval. (§12)

---

## 16. Decision Log

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Reposition as "company brain," measured against GBrain | YC RFS + GBrain is the reference; our wedge is passive capture for non-technical operators GBrain can't serve |
| D2 | Narrative: individuals now, businesses next; no consumer/B2B dichotomy | Bottoms-up motion; individual phase is the moat factory (unacquirable observed-workflow data) |
| D3 | Curated layer = truth; repository = evidence; only human-approved knowledge is authoritative | A data lake has no inherent source of truth; ratification is the only safe basis once agents act |
| D4 | Memory page gets two tabs: Grove Memory + Sources | Keep truth clean and short; give evidence real retrieval; provenance threads them |
| D5 | Four ingestion inputs, one review loop into Grove Memory | Manual, docs, field study, connections all converge; one legible layer |
| D6 | Docs are an input, not a storage format | Prevents the junk-drawer failure; docs populate fields, originals retained in Sources |
| D7 | Manual/doc ingestion is subordinate to passive capture | Avoids re-importing GBrain's curation ceiling; solves cold-start + B2B seeding |
| D8 | MCP as the generic integration substrate; no per-company builds | Scales as product not services; matches ecosystem direction; B2B spine |
| D9 | Build the synthesis/query layer (`think`, not just `search`) | The non-negotiable "brain" capability; reframed as workflow guidance + learning loop |
| D10 | Conflicts surfaced, never auto-resolved; resolved via Grovekeeper; user pick = approval | Trust; preserves "no hands" / "no autonomy laundering" |
| D11 | Resolutions metabolize into source-authority ranking | Trust Ledger applied to knowledge; the moat, not a bolt-on |
| D12 | One attention queue / notification center; Grovekeeper reads from it | Single source of truth; wiring not building; shared push rail with approvals |
| D13 | Tenant/owner boundary in schema from day one | Makes B2B pivot RBAC+SOC2+governance, not a re-architecture |
| D14 | SOC 2 is the explicit B2B gate | Required for multi-user; tracked; sequenced after single-user proof |
| D15 | Locked tagline + pitch opener (§14.1) | Chosen after extensive iteration; do not reword without explicit approval; persist tagline to landing page + memory |
| D16 | "Simple for a layman, extensible to a full enterprise — the same brain either way" | Reconciles the consumer wedge with the company-brain ambition as an architecture property, not just a roadmap; origin story (large-company knowledge pain + hard-to-use tools) and product vision are one continuous argument |

---

## 17. Acceptance criteria (definition of done for this milestone)

- [ ] Memory page has two tabs: **Grove Memory** (truth) and **Sources** (evidence), with the curated UX preserved and a Reference catch-all in Sources.
- [ ] Every curated field shows **provenance** and a **staleness** indicator.
- [ ] A user can **drop a document**; Nibbin extracts and **proposes** field updates; the user reviews/approves; the original is retained in Sources. No silent writes.
- [ ] **Hybrid retrieval** works over Sources; the **synthesis layer** returns a cited answer + gap note, surfaced as workflow guidance.
- [ ] A **periodic collate** pass dedups/reconciles and produces a review queue / morning brief.
- [ ] **Conflicts** appear as persistent field-level flags, are surfaced by the Grovekeeper (high-stakes proactively; trivial batched), and resolve via user pick; resolution updates source-authority.
- [ ] **Connections** is promoted to a discoverable onboarding step; calendar/files/contacts added; connection errors render in view (NIB-3, NIB-5 closed).
- [ ] The **notification center** receives new item types (conflicts, reviews); **Grove Home** shows the count badge; the **Grovekeeper** reads from the center, references pending items, and deep-links; high-stakes items use the push rail.
- [ ] **Schema carries a tenant/owner boundary** throughout, single-user today.
- [ ] No path writes the curated layer without a **logged human approval**.
- [ ] Security + business-logic review passed on every new data path; all merges code-reviewed.

---

*End of spec. Implement in build order (§11). Where a decision in §16 needs to change, change it there with rationale — not silently in code.*
