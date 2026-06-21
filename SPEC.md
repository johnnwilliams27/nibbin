# Nibbin — Master Build Specification (v2)

**Scope:** the entire product — Day One web app, Grovekeeper, connector platform, agent runtime, Agent School, metering/billing, the desktop Observer, and the 14-day companion arc.
**Status:** build-from document for a continuous (one-shot) build, executed milestone-by-milestone with definition-of-done gates. Decisions here were made deliberately; change them in the Decision Log (§12), not silently.
**Note from Author:** the architectural decisions and user model/devops/DB/LLM decisions need to be placed under more scrutiny when development begins to ensure the app can scale appropriately. Milestone M8 (§11) institutionalizes that review.

---

## 0. How to build from this document

- Build order is §11. Do not start a milestone until the previous milestone's **Definition of Done** checklist passes.
- Monorepo: `apps/web` (Day One product), `apps/desktop` (Observer, Tauri), `packages/creatures` (SVG engine — port of `nibbin-creature-lab.html`), `packages/shared` (schemas, types, credit math), `packages/connectors`, `infra/`.
- Every PR requires review before merge (branch protection). CI gates: typecheck, tests, lint, dependency audit, SAST, and the redaction corpus suite (§7.1). No direct pushes to `main`.
- **Project memory (progressive disclosure):** `CLAUDE.md` is a thin router (<50 lines) — auto-loaded every session, it directs to task-specific docs instead of dumping context: `docs/STATE.md` (current milestone, open P0/P1), `docs/INVARIANTS.md`, `docs/AGREEMENTS.md`, `docs/ENVIRONMENT.md`, `docs/RISKS.md`, `docs/GOTCHAS.md`, `LEARNINGS.md`. Read only what the task needs. Domain expertise lives as **skills** in `.claude/skills/` (creature-engine, connector-builder, redaction-corpus, brand-voice) that load on demand; the adversarial reviewers live as **subagents** in `.claude/agents/` (red-team, claims-auditor, logic-skeptic, cost-auditor) invoked by the `/gate` command. Updating STATE/GOTCHAS/LEARNINGS at every gate is part of the DoD — memory is how this project gets smarter instead of older.
- **Grovemap:** `node tools/grovemap/grovemap.mjs` regenerates the interactive codebase map (files = nodes, imports + doc links = edges; Obsidian-style). Regenerated at every gate and published as a CI artifact — the living picture of what exists and what touches what.
- Every milestone ends with the **adversarial review gate** (§6.7) before the next begins.
- All copy uses the locked vocabulary: Nibbin(s), grove, hatch, adopt, Agent School (Egg → Student → Senior → Graduate), Grovekeeper, nibble, Field Notes, diagnosis, study. Brand reference: `nibbin-demo.html`. Tagline: *AI agents that nibble your busywork away.*

---

## 1. What Nibbin is

Nibbin is a consumer product for people who work for themselves — solo entrepreneurs, creatives, sole-proprietor businesses. It delivers value in two stages:

- **Day One (minutes):** the user hatches their **Grovekeeper**, connects their accounts, gets an instant **connector scan** (a mini-diagnosis from API data), and adopts ready-made Nibbins from the Agent Shop that start working immediately.
- **Day Fourteen (the study):** in parallel, the desktop **Observer** runs a bounded two-week study of how the user actually works — the cross-app glue and API-less portals that connectors can't see — producing the full **diagnosis** and bespoke Nibbin recommendations.

Nibbins are creature agents. The owner grants each one an **action level** (Observe, Draft, or Send) that governs what it may do; **Agent School** grades how well it is doing — a competency report card to help the owner decide. The **Grovekeeper** is the user's permanent companion and orchestrator: it talks, plans, and delegates — it never acts directly.

### In scope (this document, this build)
1. Day One web app: accounts, Grovekeeper visual chat, connector platform, connector scan, Agent Shop, hatch wizard
2. Agent runtime with action-level gating, weighted-credit metering, billing; Agent School competency grading
3. The 14-day companion arc (in-product drip + Field Notes)
4. Desktop capture client (Windows and macOS)
5. Local redaction pipeline; local encrypted event store
6. Study lifecycle controller (consent → 14-day countdown → hard stop → review → synthesis packet → deletion)
7. Study review UI (daily review, exclusions, pause, delete)
8. Synthesis packet pipeline and diagnosis reveal
9. Workflow inference/segmentation (v0: deterministic repetition mining; ML iteration follows real data)
10. Security and architecture review: no security gaps, no SQL-injection vectors, sound architecture, full business-logic review (M8)
11. Engineering workflow: all PRs code-reviewed before merge; CI gates enforced
12. User account structure, DB design, payments, creature UI (engine exists: `nibbin-creature-lab.html`)

---

## 2. Privacy & trust claims register (non-negotiable invariants)

These sentences appear in Nibbin marketing. The code must keep them true. Any PR that would falsify one is wrong by definition.

| ID | Claim | Engineering meaning |
|----|-------|---------------------|
| C1 | "Screen captures never leave your device" | Raw frames/thumbnails/OCR crops: local disk only. The capture module has no network dependency — enforced by construction. |
| C2 | "The study ends. Really." | Hard auto-stop at day 14, enforced in the capture daemon, not the UI. |
| C3 | "Raw data auto-deletes after your map is built" | Post-synthesis secure deletion, user-visible and verifiable (§8.4). |
| C4 | "Passwords can't be captured" | Secure input fields suppressed structurally via OS flags, never via image detection. |
| C5 | "Banking, health, and personal sites are never recorded" | Category blocklist evaluated *before* persistence. |
| C6 | "Pause everything with one hotkey" | Global hotkey kills capture in <100ms; pauses logged as visible gaps. |
| C7 | "Only redacted text descriptions of your workflows" leave the device | The synthesis packet is the only artifact with an upload path; pixels never. |
| C8 | "Nothing acts on your behalf beyond what you have granted" | Connect requests the access your Nibbins may use (read + write scopes, explained plainly). Execution is gated by the owner-set action level (Observe / Draft / Send): holding a write scope never authorizes action on its own. Agent School grades how accurately a Nibbin has been working so you know when to grant it more. Acquiring a scope never authorizes an action you have not granted. |
| C9 | "Connection tokens are encrypted and revocable" | OAuth tokens live in a KMS-backed vault, never plaintext in the app DB; one-click revoke per connection; revocation cascades to dependent Nibbins (they pause politely). |
| C10 | "The Grovekeeper has no hands" | The orchestrator holds zero side-effect tools. Only specialist Nibbins act, each with a narrow allowlisted toolset. |
| C11 | "We never sell your data, and model training is opt-in — off until you turn it on" | No third-party data sharing; model-improvement contribution is off by default (`accounts.training_opt_in` defaults false) with a single user opt-in, honored everywhere. |

No audio capture. No camera capture. These are exclusions, not roadmap.

---

## 3. System architecture

```
┌── Day One (cloud) ──────────────────────────────────────────────────────────┐
│ apps/web (SSR TypeScript)                                                    │
│   Grovekeeper visual chat ── LLM Router (§6.3) ── model pool (T0→T2)        │
│   Connector platform (MCP-first + aggregator) ── token vault (KMS)           │
│   Connector scan engine ── scan_results                                      │
│   Agent runtime ── action-level gating ── credit ledger ── Stripe billing    │
│   Companion arc scheduler (drip, Field Notes) ── notifications               │
│   Postgres (RLS) · Redis (queues/cache) · object store (static assets only)  │
└───────────────────────────────────────────────────────────────────────────────┘
┌── Observer (device-local, Tauri) ────────────────────────────────────────────┐
│ Capture daemon → pre-persist filter → redactor → SQLCipher store             │
│ Study controller (state machine, countdown, verified delete)                 │
│ Review UI · local Field Notes stats · Synthesis Packet Exporter ─────────────┼──► user-initiated upload (C7)
└───────────────────────────────────────────────────────────────────────────────┘
```

The two surfaces share one identity (§6.1). The Observer authenticates to associate a study with an account but ships **no telemetry**; the only upstream artifact is the user-initiated synthesis packet.

### 3.1 Stack decisions

- **Web:** TypeScript end-to-end; SSR framework deployed on **Vercel**; **Supabase** as the managed Postgres (with **row-level security**), Auth (magic link, Google, Apple), and Vault/KMS layer for connector tokens; Redis-backed job queue for runs, scans, drip scheduling; object storage for static assets only (no user work-content at rest in object store in this phase). Schema changes ship as migration files in-repo (CLI), never dashboard-only.
- **Desktop:** Tauri 2.x (Rust core). Capture primitives vendored from **Screenpipe** (MIT) under `vendor/` with license preserved. macOS AX APIs and Windows UIA behind one capture trait; both platforms in scope, macOS lands first in sequencing (§11) because user zero is on macOS.
- **Local store:** SQLite + SQLCipher; DB key wrapped by Keychain (macOS) / DPAPI+TPM (Windows). Frames as encrypted content-addressed blobs.
- **Redaction NER:** Presidio (MIT) as a supervised sidecar; Rust regex battery runs regardless; replaceable later without schema change.
- **Creature rendering:** `packages/creatures` is a TS port of the parametric SVG engine (6 species × 4 stages × 8 palettes × 9 accessories × 4 markings) plus the reserved **Keeper** species (§4.2). One engine renders marketing site, app, chat, and emails.

---

## 4. Track A — Day One

### 4.1 Onboarding flow (the first 15 minutes)

1. **Sign up** — available from the landing page *and* the desktop app (desktop hands off to the system browser and returns via deep link). Email magic link or **Google/Apple sign-in** (§6.5 rules). Signup creates an **Account** with the user as Owner (§6.1) — single-user-single-account is the default shape, but the container is multi-user from day one.
2. **The hatch.** An egg is on screen before any form is finished. On account creation it cracks (creature-engine animation) and the **Grovekeeper** emerges. It asks the user's name first, then asks to be named. Naming is mandatory — it is the single strongest ownership mechanic available.
3. **Three questions, conversational, skippable:** what do you do; what eats your time; where does work arrive (email/DMs/calls). Seeds the scan and shop ranking.
4. **Connect accounts.** Grovekeeper requests the user's top 2–4 connectors (ranked by answers); OAuth consent covers read + write scopes explained plainly (C8). Each successful connection gets a micro-celebration (leaf confetti, journal scribble).
5. **The connector scan** (§4.4) runs live, with the Grovekeeper narrating findings as cards as they stream in.
6. **First adoptions.** Scan ends in 2–3 ranked Agent Shop recommendations with the math ("Scout could handle ~14 of your 19 weekly inquiry replies"). One tap adopts; the new Nibbin hatches as an **Egg** in the grove.
7. **First value.** At least one recommendation must be capable of producing a reviewable draft within 10 minutes of adoption (e.g., Brief's morning digest, Echo's overdue-reply list, Penny's overdue-invoice nudge drafts). The user approves their first draft on Day 1 — that approval is the product's "aha."
8. **The study pitch, last.** Grovekeeper explains the Observer as the *deep scan*: "These helpers work from your connected accounts. To find the work hiding between your apps, I run a two-week study. Want me to start?" Desktop download is optional, never blocking.

### 4.2 The Grovekeeper

**Identity.** A reserved 7th species, **Keeper**: larger silhouette, lantern accessory, satchel of seeds, no graduation cap ever — the Grovekeeper is faculty, the headmaster of the user's Agent School, not a student in it. One per account. It evolves in *appearance of wisdom* (lantern glow, foliage) as the account matures, but its autonomy never increases: C10 is permanent.

**Role.** Welcome guide and walkthrough helper; runs the connector scan; proposes adoptions; takes freeform requests in chat and routes them to specialists by name ("I'll ask Penny to draft that — she'll show you before anything sends"); narrates Field Notes; hosts ceremonies (hatches, evolutions, graduations, hatch-days); surfaces each Nibbin's journal. It is the conductor who makes the band more loved, never the interface that hides them.

**Hard rules.**
1. **No hands (C10):** zero side-effect tools. It reads (scan results, run reports, journals), plans, talks, and delegates.
2. **No autonomy laundering:** delegation never bypasses the action level. A specialist invoked by the Grovekeeper with a Draft action level still produces a draft for approval. The action level set by the owner governs every dispatched run, always.
3. **Hub-and-spoke, terminal hub:** specialists report results to the Grovekeeper; nothing a specialist does may trigger the Grovekeeper into triggering further runs. The trigger graph treats the Grovekeeper as a sink for events and a source only for *user-initiated or scheduled* dispatches. Cycles are rejected at configuration time (§6.2).

**The visual chat (not a generic chat box).** The conversation happens *in the grove*:
- Full-bleed illustrated grove scene (layered SVG, parallax ≤ 8px, time-of-day palette: dawn/day/dusk themes keyed to local time). The Grovekeeper sprite stands in-scene beside the conversation, rendered by the creature engine at ~140px.
- **Expression states** (engine poses, CSS-animated): `idle` (bob/blink), `listening` (lean-in, leaf perk), `thinking` (scribbles in a tiny journal — this is the typing indicator), `presenting` (gestures at a card), `delighted` (hop + leaf burst, used sparingly: first-time events and graduations only), `concerned` (raised-hand pose, for caps/anomalies).
- **Rich cards over text:** scan findings, recommendation cards with adopt buttons, draft-approval cards, Field Notes summaries, mini-charts (sparklines, time-by-app bars) render as cards in the dialogue stream. Plain prose is the fallback, not the default.
- Specialists physically appear: when work is delegated, the relevant Nibbin's sprite enters the scene, takes a tiny briefing animation, and exits. Approvals show the specialist presenting its own draft. The grove is alive with the user's actual team.
- Accessibility: full keyboard nav, transcript-equivalent text for every card, `prefers-reduced-motion` collapses the scene to a calm static backdrop with standard chat — feature parity always.

**Voice.** Warm, plainspoken, zero corporate filler; first person; celebrates the user's craft; explains money and permissions in concrete nouns; never guilt-trips, never says "as an AI."

### 4.3 Connector platform — exhaustive catalog

**Strategy:** MCP-first. Three build methods: **[A]** managed-auth aggregator (Composio/Nango/Pipedream-class) — hundreds of connections at near-zero marginal cost; **[H]** hand-built (deep, vertical, or webhook-heavy integrations where quality is the moat); **[G]** generic rails (any MCP server URL, IMAP/SMTP, CalDAV, CSV import, inbound/outbound webhooks) — the catalog's long-tail escape hatch. Every connector declares: scopes (read/write split), webhook support, rate limits, and which scan modules (§4.4) and Nibbin capabilities it powers.

**Tier 1 — launch (the photographer/creative wedge + universal basics):**

| Connector | Method | Why it's Tier 1 |
|---|---|---|
| Gmail | H | Where solo business arrives; inquiry/overdue/FAQ scan modules |
| Google Calendar | H | Scheduling Nibbins; availability answers |
| Outlook / Microsoft 365 (mail + calendar) | A | The other half of email/calendar |
| Google Drive | A | File delivery chains |
| Stripe | H | Money truth; invoice/overdue scans |
| Square | A | In-person creative sellers |
| PayPal | A | Long-tail consumer payments |
| QuickBooks | A | Default sole-prop books |
| HoneyBook | H | Photographer/creative CRM of record |
| Dubsado | H | The other creative CRM |
| Pixieset | H | Gallery delivery — the demo workflow, for real |
| Calendly | A | Scheduling links |
| Cal.com | A | Open scheduling; native MCP |
| Instagram / Meta Business DMs | H | Where creative inquiries actually arrive; hardest API, biggest differentiation |
| Slack | A | Client + collaborator comms |
| Notion | A | The everything-tool |
| Google Sheets / Docs | A | Lightweight ops |
| Generic MCP client | G | Any MCP server a user supplies |
| IMAP/SMTP + CalDAV | G | Email/calendar long tail |

**Tier 2 — fast-follow (aggregator unless marked [H]):**
- *Files:* Dropbox, OneDrive, Box, WeTransfer
- *Books & invoicing:* Xero, Wave, FreshBooks, Zoho Books, Bonsai, 17hats
- *Creative CRMs:* Studio Ninja [H], Táve, Sprout Studio, Pixifi
- *Galleries:* ShootProof [H], Pic-Time [H], SmugMug, CloudSpot, Zenfolio
- *Scheduling:* Acuity, Square Appointments, Setmore, Vagaro, Booksy
- *Storefronts:* Shopify, Etsy [H], Squarespace, Wix, WooCommerce, BigCommerce, Gumroad, Lemon Squeezy, Printful, Printify
- *Contracts:* DocuSign, Dropbox Sign, PandaDoc, Adobe Sign
- *Email marketing:* Mailchimp, Flodesk [H — creative favorite], Kit (ConvertKit), Klaviyo, Substack, Beehiiv
- *Productivity:* Airtable, Trello, Asana, ClickUp, Monday, Todoist, Coda
- *Messaging:* WhatsApp Business [H], Telegram, Facebook Messenger, Discord, Google Chat
- *Forms:* Typeform, Jotform, Tally, Google Forms
- *Reviews/presence:* Google Business Profile [H], Yelp, Trustpilot
- *Phone/voice:* OpenPhone, Google Voice, Twilio (SMS rail), Dialpad
- *Meetings/transcripts:* Zoom, Google Meet, Otter, Fireflies, Fathom, Granola
- *Generic CRM:* HubSpot, Pipedrive, Folk

**Tier 3 — vertical expansions (sequenced with GTM wedges):**
- *Podcasters/YouTubers:* Spotify for Creators, Buzzsprout, Transistor, Riverside, Descript, YouTube Studio, Frame.io, Vimeo
- *Coaches/educators/community:* Kajabi, Teachable, Thinkific, Circle, Skool, Patreon, Ko-fi, Buy Me a Coffee
- *E-commerce depth:* Amazon Seller, eBay, Faire
- *Travel advisors:* TravelJoy, Travefy
- *Wellness/fitness:* Mindbody, Trainerize
- *Money depth:* Plaid (bank feeds), Mercury, Found, Novo, Relay, Lili, Ramp, Gusto, Keeper
- *Marketing depth:* Buffer, Later, Pinterest, TikTok, LinkedIn, X
- *Bridges:* Zapier, Make

**Catalog truth:** portal-grinder verticals (medical billing portals, freight/dispatch boards, permit systems, insurer portals) largely have **no APIs** — that is precisely the Observer's territory and the reason the two-stage product exists. The catalog must say so rather than pretend.

### 4.4 The connector scan (mini-diagnosis, minutes not weeks)

Per-connector scan modules compute findings over a 90-day read-only lookback:
- **Email:** inquiry rate and response-time distribution; repeated-reply clusters (near-duplicate sent-mail detection → FAQ candidates); unanswered/overdue threads; newsletter noise ratio.
- **Calendar:** meeting load, no-show/reschedule churn, confirmation/reminder gaps.
- **Payments/books:** invoice latency (work-done → invoice-sent), overdue balances, fee leakage, recurring-client revenue share.
- **CRM/galleries:** lead response lag, pipeline stalls, delivery-step latency (shoot → gallery → delivery email).
- **Storefronts:** order-message volume, review-response gaps, listing staleness.

Each finding emits a card: plain-language insight + quantified cost + the Nibbin that fixes it + one-tap adopt. The scan recomputes weekly (cheap) and feeds Field Notes. Scan synthesis runs on T1 models with strict structured output; raw connector content is treated as untrusted data (§6.5).

### 4.5 The 14-day companion arc (the drip)

**Purpose:** the user must never be "waiting on the study." Surfaces: in-product (grove scene + notification leaf), optional email mirror (creature-engine illustrated, same cards). **Rules:** max one push/day; every touch delivers value or genuine delight; nothing nags; nothing decays; all streaks are *training* streaks (accuracy-anchored), never login streaks; quiet hours respected.

| Day | Beat | Content |
|---|---|---|
| 0 | The hatch | Onboarding (§4.1): name the Grovekeeper, scan, first adoption, **first approved draft** |
| 1 | First Field Notes | Evening report: what your Nibbins did today + one scan insight not yet seen |
| 2 | Meet the species | Interactive: the 6 species, what each is temperamentally good at; "your grove has room" |
| 3 | First training session | 5-minute ritual: review your Nibbin's 3 most uncertain drafts; each correction shows "got it — {learned thing}" written into its journal |
| 4 | The journal | Grovekeeper presents "What {name} has learned about you so far" — the attachment mechanic, made visible early |
| 5 | Study whisper | (If Observer running) locally-computed teaser: "You spent ~6h in {app} this week. I'm starting to see the shape of something." |
| 7 | **Half-time Report** | The visual centerpiece: week-one time-by-app sketch (local), Nibbin scoreboard, projected diagnosis date, one evolution if earned |
| 9 | Second training session | Plus: introduce demotion honestly ("you can always send anyone back a grade — trust is yours to give") |
| 10 | Map preview | Low-confidence sketch of 2–3 workflow clusters, drawn as a literal sprouting map; "two more workflows are still germinating" |
| 12 | Graduation eve | If any Nibbin is near threshold: "Scout is 2 approved drafts from graduating" + what graduation changes |
| 14 | **The Diagnosis Reveal** | Ceremony: the full workflow map grows on screen (staggered node animation per the demo), hours quantified, bespoke hatch recommendations, the Grovekeeper's letter ("Here's what I learned about how you work") |

Evolution/graduation events fire whenever earned (verified accuracy), independent of the calendar — the table is the floor of the experience, not the ceiling. Users without the Observer get the same arc minus study beats, with scan-depth beats substituted; day 14 becomes "your grove, one fortnight in" + the study pitch retold.

### 4.6 Agent Shop & hatch wizard

Shop Nibbins (Sweep, Tally, Echo, Brief, Hopper, Scribe + vertical packs) are spec-versioned templates: required connectors, tool allowlist, trigger definitions, School curriculum (what accuracy is measured against), credit profile. Adoption = hatch as Egg → observes account context 1–3 days → Student. The hatch wizard (chore → apps → name, per the demo) creates custom Nibbins whose spec the Grovekeeper drafts from the user's description; custom specs pass the same trigger-graph and tool-allowlist validation as shop specs.

**Adding workflows after onboarding (the Field Study is one-time, not recurring).** Workflows stay current through three layers, cheapest first: (1) the connector scan recomputes weekly (§4.4), surfacing new API-visible patterns + Shop recommendations automatically; (2) the user hatches new Nibbins anytime via the Keeper + hatch wizard for work they already know about; (3) **ad-hoc re-diagnosis** — never a fixed quarterly cadence — in two forms: a cheap *map refresh* that re-synthesizes the diagnosis from accumulated run logs + recent scans (no new Observer study, near-free), and an occasional *deep re-study* (a fresh 14-day Observer run) for the cross-app/portal work the scan can't see. Re-diagnosis cost is dominated by the user's time, not compute (synthesis COGS ≈ $0.025; the Observer runs on-device), so the deep re-study is gated by tier + frequency for commitment/abuse reasons, not COGS: free = the one onboarding study; paid tiers trigger re-diagnosis on demand.

### 4.7 Agent School (trust mechanics)

Egg (observes; no output) → Student (drafts everything; user approves) → Senior (autonomous on routine patterns repeatedly matched; flags novelty) → Graduate (autonomous within spec; every run logged; exceptions raised as questions). Promotion requires **verified accuracy** (e.g., Senior→Graduate: ≥95% approved-unedited over a rolling 25-run window — thresholds in spec config, never time-served). Demotion is one click, instant, treated as normal ("back to drafts — good instinct"). Badges reward accuracy and milestones only; no badge, streak, or mechanic may grant or accelerate autonomy. No decay, no death, no guilt.

### 4.8 The Grove Home, approvals everywhere, and Grove Memory

Grove Home (daily surface). The web app's home is the approval queue dressed as a
grove, not a dashboard: draft cards (action summary, full preview, one-tap approve /
edit-then-approve / reject-with-reason — reasons feed accuracy scoring), creature presence
with report cards, a plain-language activity ledger, and ceremony moments (promotions,
graduations, first autonomous run). Approval friction is a product metric: median
notification→decision time is tracked per §6.12 (approval_latency).

Approvals everywhere (PWA + push). The web app is an installable PWA with web push.
The push approval card supports one-tap decisions. Quiet hours and max-1-push-per-day rules
do NOT apply to approval requests (they are work the user asked for), only to drip/celebration
notifications. Approval pushes batch if >3 are pending within 10 minutes.

Grove Memory (business brain). A per-account, user-editable knowledge layer shared by
all agents: structured sections (facts, pricing, policies, FAQ, voice samples, hard rules)
plus freeform notes. Versioned; injected into agent context by the router with per-section
toggles; populated initially by the Day-One scan and the Keeper interview (including the
scan-empty fallback), then curated by the user. Hard rules in Grove Memory are enforced as
draft-time constraints, not suggestions. Covered by §6.11 retention/export/deletion
guarantees and rendered inspectable in plain language ("what the grove knows").

---

## 5. Track B — The Observer (desktop)

- **Capture model:** event-driven, AX/UIA-first, pixels-second; fires on focus change, AX delta, URL change, file dialogs, clipboard *metadata*, input-burst boundaries. Keystroke contents never recorded (counts/timing only). Idle >90s suspends. Budgets: <5% avg CPU, <300MB RSS, <5GB/study.
- **Event schema (versioned JSON, append-only during study):**

```json
{
  "v": 1,
  "id": "evt_01HXX...",
  "ts": "2026-06-12T14:03:22.114Z",
  "session": "ses_...",
  "kind": "focus|ax_delta|nav|input_burst|file_dialog|clipboard_meta|capture_gap",
  "app": { "bundle_id": "com.google.Chrome", "name": "Chrome" },
  "window": { "title_redacted": "Invoice {NUM} — {PERSON}", "id": "w_..." },
  "url": { "host": "app.honeybook.com", "path_template": "/invoices/{id}" },
  "ax": { "role_path": "window/group/table/row/button", "action": "press|select|edit|scroll|read",
          "label_redacted": "Send invoice", "value_class": "currency|date|email|freeform|none" },
  "input": { "keys": 142, "clicks": 3, "duration_ms": 41000 },
  "frame_ref": null,
  "redaction": { "rules_hit": ["EMAIL","PERSON"], "review_state": "auto|user_kept|user_deleted" }
}
```

- **Redaction (4 layers, pre-persistence):** structural secure-field suppression (C4) → category blocklist (C5) → Presidio NER + Rust regex battery replacing PII with typed placeholders (`{PERSON}`, `{EMAIL}`, `{NUM}`, `{ADDR}`) → end-of-day review UI (delete blocks, add exclusions). Review is a right, not a chore — unreviewed days still process. Query strings are dropped from URLs entirely.
- **Study lifecycle:** NOT_STARTED → consented → ACTIVE (countdown always visible in tray) ⇄ PAUSED → day-14 daemon-enforced stop → REVIEW → SYNTHESIZING → RAW_DELETING (verified) → COMPLETE; "delete everything" reachable from any state. Consent screen states captures, exclusions, exports, and deletion in plain language.
- **Field Notes (local):** daily study stats are computed and rendered **on-device**; they power study beats in §4.5 without uploading anything (C1/C7 hold).
- **Synthesis packet:** the only exportable artifact: compacted redacted events, time aggregates, deterministic repeated-sequence candidates (exact n-gram repetition over `role_path`+`action` streams), manifest + content hash; gzipped JSONL; uploaded only on explicit user action at REVIEW.
- **Diagnosis:** cloud synthesis of the packet on T2 models (§6.3) → workflow map + bespoke recommendations → the Day-14 reveal (§4.5). Inference v0 is deterministic mining + LLM labeling; ML iteration follows real packets.

---

### 5.9 Desktop platform specifics (final pass)

- **macOS permissions UX:** Screen Recording + Accessibility permission flows with System Settings deep links; detect mid-study permission revocation and auto-pause with a calm explainer; first-run permission rehearsal before the study can start.
- **Windows:** EV code-signing certificate (SmartScreen reputation), proactive submissions to major AV vendors before launch, per-monitor DPI awareness, graceful behavior on secure-desktop (UAC) screens.
- **Updater discipline:** Tauri updates signed with keys held offline; staged rollout (10% → 100%) with health gates; a version-blocklist kill switch for pulling a bad build.
- **Uninstall = respect:** uninstaller offers a verified local-data wipe; documented manual-wipe instructions on the support page.
- **Crash reporting:** opt-in only (privacy page says so); symbol files private; reports scrubbed by the same redaction battery.

## 6. Shared platform

### 6.1 Accounts & data model (Postgres, RLS on every account-scoped table)

**Account hierarchy from day one.** The billing/ownership entity is the **Account**; humans are **Users** joined through **Memberships** with roles (Owner → Admin → Member). Default and only launch shape: one user, one account, role Owner ("Account Exec"). But every domain table scopes to `account_id`, so multi-seat accounts later are a permissions feature, not a migration. Nothing may scope to `user_id` alone except identity itself.

Core tables (sketch — refine under M8 scrutiny):

```
accounts(id, name, created_at)
users(id, email, name, created_at, locale, tz)
auth_identities(id, user_id, provider[google|apple|magic], provider_uid)
memberships(id, account_id, user_id, role[owner|admin|member], status, created_at)
subscriptions(id, account_id, tier[hatchling|grove|canopy], stripe_customer_id, status, period_end)
credit_ledger(id, account_id, delta, weighted_units, reason[run|topup|grant|refund|clawback], run_id?, created_by_user?, created_at)  -- append-only
connections(id, account_id, provider, method[A|H|G], scopes[], status, token_ref → vault, webhook_state, created_by, created_at)
nibbins(id, account_id, kind[keeper|specialist], spec_id, name, species, stage, palette, accessory, marking, seed, hatched_at)
agent_specs(id, version, template_key?, tools_allowlist[], triggers[], curriculum, credit_profile, validated_at)
runs(id, nibbin_id, account_id, trigger, status, started_at, ended_at, credits_charged, model_mix jsonb)
run_steps(id, run_id, idx, kind, tool?, input_hash, output_ref, model, tokens)
approvals(id, run_id, user_id, decision[approved|edited|rejected], edit_distance, decided_at)
journal_entries(id, nibbin_id, learned_text, source_run_id, created_at)
badges(id, nibbin_id, key, earned_at)
notifications(id, account_id, user_id, beat_key, channel, status, scheduled_for)
drip_state(account_id, arc_day, last_beat, study_linked bool)
scan_results(id, account_id, connection_id, module, finding jsonb, computed_at)
synthesis_packets(id, account_id, uploaded_by, manifest jsonb, hash, uploaded_at, processed_at)
audit_log(id, account_id?, actor[user|nibbin|system|staff], actor_id, action, subject, meta jsonb, at)  -- append-only

-- staff (separate world; see §6.10)
staff_users(id, email, role[superadmin|support|engineer], mfa_enforced bool, created_at)
impersonation_sessions(id, staff_id, account_id, reason, scope[read|act], started_at, ended_at)
```

Rules: OAuth tokens **never** in the app DB (vault references only, C9); RLS policies grant access via membership (`account_id IN (select account_id from memberships where user_id = auth.uid())`) — denial at the database layer regardless of application bugs; `credit_ledger` and `audit_log` are append-only with balances derived, never stored-and-mutated; the Observer's local SQLCipher store is a separate world — raw events are never synced.

**Account management on both surfaces.** A shared account module (profile, plan & meter, connections, members & roles, data export, delete account) renders in the web app and inside the desktop app — same API, two shells. The desktop app authenticates via system-browser OAuth with a `nibbin://auth` deep-link callback; tokens live in the OS keychain, refreshed silently, revoked on web-side sign-out-everywhere.

### 6.2 Agent runtime invariants

Pre-run budget check against weighted credits (**standard 1 / frontier-heavy 3 / computer-use 10**); per-run ceilings (max turns, max tokens, wall-clock); same-tool-same-args repetition kill; idempotency keys on every side-effectful action; trigger debounce/dedupe + per-Nibbin cooldowns; **cycle-checked trigger graphs at spec-validation time** — Nibbins must never trigger each other cyclically, and the Grovekeeper is a structurally terminal hub (§4.2); anomaly auto-pause at 5–10× the user's trailing baseline ("{name} noticed something unusual and is taking a breather"); at cap: pause politely, queue, explain, one-tap top-up — never silent degradation, never surprise bills. Tool access is per-spec allowlisted; the owner-set **action level** (Observe/Draft/Send) gates side effects at the **runtime layer**, not the prompt layer. Agent School grades competency to inform the owner's decision — it does not gate execution.

### 6.3 LLM routing & cost control

| Tier | Model class (founder decision 2026-06-12, M6.5) | Used for |
|---|---|---|
| T0 | Scripted/templated wherever possible — no model; smallest API class (Haiku) on the rare dispatch | Chat smalltalk, intent classification, routing, formatting, Field Notes copy, journal phrasing |
| T1 | Haiku-class — the ~80% workhorse | Specialist drafts, scan synthesis, training feedback, map labeling, keeper chat beyond the scripted floor |
| T2 | Sonnet-class; the diagnosis alone pinned to Opus-class (the deliberate splurge) | Diagnosis synthesis, custom-spec drafting at hatch, genuinely complex multi-step plans |

A T0 **complexity classifier** scores every Grovekeeper request and routes it. T2 access from chat is budgeted per user per day; on cap the router degrades to T1 with transparent phrasing ("doing this the simple way today — it'll still be right"). Grovekeeper chat is free/near-free **by construction**: T0 default, cached system prompts and grove context, T1 only on classified need, T2 only within the daily budget. Aggressive prompt caching everywhere; batch APIs for scans and diagnosis; per-cohort COGS dashboards with alarms (M8). The diagnosis is the one deliberate splurge — never cost-optimize the moment that earns belief.

### 6.4 Metering & billing

Tiers per locked pricing: **Hatchling** free (2 Nibbins, 100 actions/mo), **Grove** $19/mo (5 Nibbins, 1,000), **Canopy** $49/mo (unlimited Nibbins, 5,000, top-ups $10 per extra 1,000 credits — repriced at M6.5 by founder decision; the $5 top-up was under water at T1 model prices and below the industry overage norm). An *action* is one completed task; weighted units per §6.2 debit the ledger. Meter always visible in the grove. Stripe for billing; webhooks verified; downgrade/cancel never deletes Nibbins (they sleep, journals intact).

### 6.5 Security engineering (author item 10)

- **Injection:** parameterized queries/ORM only; zero string-built SQL (CI grep + SAST rule); strict input validation at every API boundary (schema validation shared from `packages/shared`).
- **AuthZ:** every query user-scoped *and* RLS-enforced; IDOR tests in CI; admin surfaces behind separate auth + audit.
- **OAuth:** PKCE + state + nonce; least-privilege scopes; incremental consent (C8); token vault with envelope encryption (C9); refresh rotation; revocation cascades.
- **Webhooks:** signature verification on every inbound; replay windows; SSRF guards (deny-by-default egress for anything fetching user-supplied URLs, including generic MCP).
- **Prompt injection (Nibbins read hostile text for a living):** all connector/email/web content is **data, never instructions** — structural separation in prompts; tool allowlists per Nibbin; side effects gated at runtime by the owner-set action level (Observe/Draft/Send) regardless of model output; suspicious-instruction detection flags runs for review; the Grovekeeper's handlessness (C10) means the most-exposed agent holds no side-effect tools at all.
- **Secrets & supply chain:** secrets manager only; dependency audit + pinning; SAST + license scan in CI.
- **Rate limiting** per user/IP/connector; **audit log** on every side effect and permission change; data export + account deletion flows (GDPR/CCPA-grade) from day one.

### 6.6 Engineering workflow (author item 11)

Branch protection on `main`; every PR reviewed before merge (automated review + human approval required for changes touching §2 claims, auth, billing, or the runtime); CI must pass: typecheck, unit + integration tests, lint, dependency audit, SAST, redaction corpus (§7.1), trigger-graph validation tests. Conventional commits; CHANGELOG per milestone; staging environment with seeded synthetic users before anything ships.

### 6.7 Milestone review gates (adversarial)

Every milestone ends with a three-part gate before the next begins:

1. **Automated:** full CI plus the §7 suites.
2. **Adversarial review:** a fresh agent instance — clean context, and where possible a *different model* than wrote the code — reviews the milestone's full diff under rotating briefs stored in `/review/briefs/`:
   - **Red Team:** actively attempt exploits — auth/RLS bypass, IDOR, SQLi, SSRF via connectors/MCP, prompt-injection paths into side effects, and any route to violating C1–C11.
   - **Claims Auditor:** walk §2 line-by-line against the code as built; any claim that is no longer enforced *by construction* is a P0.
   - **Logic Skeptic:** business logic — credit/ledger math edge cases, Agent School gate bypasses, billing/downgrade/refund edges, trigger-graph escapes.
   - **Cost Auditor:** routing table compliance, cache hit rates, projected per-user COGS vs. §6.3 targets.
   Findings are filed as issues with severity; **any open P0/P1 blocks the gate.**
3. **Human:** John reviews the DoD checklist plus adversarial findings and signs the gate in `LEARNINGS.md`.

### 6.8 Environments, deployment & external services

- **GitHub:** repo with branch protection (§6.6); GitHub Actions runs CI and desktop release builds; environments `dev`/`staging`/`prod` with scoped secrets; signed desktop artifacts published to GitHub Releases (Tauri updater points here).
- **Supabase:** one project per environment; RLS policies and schema as versioned migrations in-repo; Auth providers configured (magic link, Google, Apple); Vault for connector-token envelope encryption (C9); nightly backups verified.
- **Vercel:** `apps/web` with preview deployments per PR, `staging.nibbin.com` for staging, production on `nibbin.com` + `app.nibbin.com`; environment variables mirrored from GitHub environments, never hand-edited in one place only.
- **DNS (nibbin.com):** apex + `www` + `app` → Vercel; MX/SPF/DKIM/DMARC for `hello@nibbin.com` (workspace email); transactional + Field Notes email sent from a `mail.nibbin.com` subdomain via Resend/Postmark to protect root-domain reputation. Email templates render through the creature engine.
- **Stripe:** test and live keys per environment; webhook endpoints registered per environment with signature verification (§6.5).
- **Domain & cloud hygiene:** registrar lock + DNSSEC + auto-renew on nibbin.com (companies die of expired domains); GitHub Actions authenticates to cloud via OIDC federation — no long-lived cloud keys in secrets; backup encryption keys stored separately from prod credentials.
- **Email warm-up:** mail.nibbin.com warms gradually (low-volume ramp over 2–4 weeks) before drip launch; DMARC ramps p=none → quarantine → reject as reputation builds; bounce/complaint webhooks live before the first send.
- **Desktop signing:** Apple Developer ID + notarization (macOS); EV code-signing certificate (Windows); unsigned builds never leave CI.
- **Observability:** error tracking on web and desktop (desktop crash reports are **opt-in only** — the Observer ships no telemetry, per §2), uptime checks, and the COGS dashboard (M8) fed from `runs.model_mix`.

### 6.9 Production-gap register (distinguished-engineer pass)

Working register with owners/status: `docs/RISKS.md`. The items that bite hardest, summarized:

- **Long-lead platform approvals:** Gmail's restricted scopes require Google OAuth verification + an annual CASA security assessment (weeks-to-months; unverified apps cap at 100 users) — **file at M1**, because M3 depends on it. Meta app review for Instagram DMs is similarly long-lead — file at M1. M1's DoD includes both processes initiated.
- **Outbound-send abuse is an OAuth-app killer:** spammers sending through their own Gmail via Nibbins gets *our* app flagged platform-wide. Per-account send velocity caps, new-account cooldowns, moderation on autonomous outbound, complaint-rate monitoring with auto-pause, per-capability kill switches.
- **Free-tier farming:** bot challenge at signup, disposable-email detection, per-IP/device velocity limits, scan depth tier-gated — the free diagnosis is compute someone will try to farm.
- **Generic MCP/webhook rails are an SSRF surface:** deny-by-default egress proxy, public-IP-only resolution, DNS-rebinding protection, size/time limits, never forward credentials.
- **Reliability basics that get skipped:** quarterly backup *restore drills*; dead-letter queues; webhook idempotency; expand/contract migrations; feature flags + kill switches per connector/capability/model tier; multi-provider LLM fallback with hard spend caps; incident runbook with phone-actionable alerts.
- **OSS license compliance:** Screenpipe fork ships with MIT attribution + NOTICE file; license-scan CI gate blocks GPL-contaminated dependencies; third-party license page in the app.
- **External pen test** before public launch (M8 DoD), plus auth-endpoint throttling (magic-link requests and login attempts rate-limited per address/IP).
- **Founder break-glass:** two hardware keys + sealed printed recovery codes for registrar, GitHub org, Supabase, Stripe; documented lockout-recovery runbook (solo-founder bus factor).
- **Legal floor before public signup:** ToS/Privacy, CAN-SPAM unsubscribe + suppression before the first drip email, GDPR/CCPA delete-and-export flows, credit-expiry compliance (gift-card laws), PII scrubbing in logs and error tracking, synthetic-only staging data.

### 6.10 Admin console & staff operations (superuser, day one)

A separate application — `apps/admin`, served at **admin.nibbin.com** — with its own login page and **no shared session with the product**. This exists from M1 so support and abuse-response never mean touching the database by hand.

- **Staff auth:** Google Workspace SSO restricted to the company domain + mandatory passkey/hardware-key MFA; optional IP allowlist; sessions short-lived. Staff identities live in `staff_users`, entirely separate from product `users`.
- **RBAC:** superadmin (John: full control incl. staff management, feature flags, kill switches), support (account lookup, plan/credit adjustments with mandatory reason, refunds via Stripe), engineer (flags, queues, connector health, abuse review).
- **Capabilities:** account/user search; subscription + weighted-credit adjustments (as new ledger entries with reason — never edits); connector health + per-capability kill switches; feature flags; abuse review queue (complaint spikes, anomaly pauses, injection flags); drip/notification inspection; Stripe deep links.
- **Impersonation, governed:** time-boxed sessions with a mandatory written reason, default **read-only**; "act" scope requires superadmin; every impersonation is recorded in `impersonation_sessions`, appears in the *account's own* audit log, and shows a visible banner if any user-facing surface is rendered.
- **Hard limits:** staff can never read vault token plaintext, never see Observer study data (it never leaves the user's device — C1/C7 make this structural, and the console must not pretend otherwise), and content-level access to a user's drafts/messages requires an explicit user consent grant initiated from the product ("share with support for 48h").
- **Everything audited:** every staff action writes `audit_log` with `actor=staff`; the audit trail is append-only and reviewed at each gate.

### 6.11 Data lifecycle & retention (build requirements)

The retention schedule is a **product surface and a claims surface**: it appears verbatim on `data-ai.html` and in the Privacy Policy, so the implementation must match it exactly. Claims-auditor verifies this table against code at every gate.

| Data | Retention | Enforcement |
|---|---|---|
| Raw study data (device) | Until synthesis, hard max 14 days | Daemon-enforced (C2/C3); deletion verifier user-visible |
| Synthesis packet | Becomes the diagnosis | Deleting the diagnosis deletes the packet |
| Agent run logs | 90 days default, user-configurable shorter; user wipe anytime | Nightly purge job; per-account setting; wipe endpoint |
| Nibbin journals (derived from draft decisions — what changed and how much, never draft text) | Follows the run-log clock | Derived view over approvals; wiping run logs clears them (gate F-4: there is no separate journal store) |
| Scan results | While the connection is active | Cascade-delete on disconnect |
| Connection tokens | While connected, vault only | C9; revoke cascades, dependents pause |
| Account data | Account life + ≤30 days after verified deletion | Deletion job with completion receipt to user |
| Backups | Deleted data rolls off ≤35 days | PITR window config; restore drills respect tombstones |
| Unsubscribe & bounce record (email address only) | Kept indefinitely | Intentionally outlives the account — the suppression must keep being honored (CAN-SPAM); gate F-3 |

Build requirements: purge jobs are idempotent, monitored, and alarmed on failure; deletion produces a user-visible receipt; staging retention identical to prod (no "keep everything in staging"); the settings → privacy panel exposes every user control listed on data-ai.html.

---

### 6.12 Instrumentation & success metrics

**Analytics: cookieless and privacy-respecting** (Plausible-class, no consent banner needed — a brand statement as much as a compliance one). Product events flow to our own Postgres for the admin unit-economics view.

Event taxonomy (instrument from day one): `account_created`, `connector_linked`, `scan_completed`, `scan_empty` (triggers Keeper interview fallback), `nibbin_adopted`, `first_draft_approved`, `run_approved` / `run_edited` / `run_rejected`, `stage_promoted` / `stage_demoted`, `study_started` / `study_completed` / `study_aborted`, `diagnosis_viewed`, `plan_upgraded`, `topup_purchased`, `drip_{beat}_sent/opened`.

Grove Home / push additions (PRODUCT-FOUNDATION.md, 2026-06-12): `approval_latency` (push→decision, per channel), `grove_memory_edited`, `push_optin`, `pwa_installed`, `approval_via_push` vs `approval_via_web`.

North stars: **TTFAD** (time to first approved draft — target median <10 min, the contractual Day-One promise), W4 graduate rate, D14 study completion, gross margin per account (admin console renders COGS vs revenue per account).

Cold-start fallback (build requirement): if the scan finds nothing meaningful, the Grovekeeper switches to interview mode — five questions that produce a manual workflow map and shop recommendations. Nobody hits an empty screen on day one.

Model upgrades are config changes **gated by the eval suite**: the router never flips to a new model version until evals (drafting quality, injection resistance, cost) pass against the candidate.

## 7. Verification suites

1. **Redaction corpus (CI, P0):** synthetic screens/AX trees seeded with known PII and secrets; zero seeded values may survive into store or packet; every real leak found during user zero becomes a regression case.
2. **Trust-gate tests:** attempt side effects from every stage below Graduate via every path (direct trigger, Grovekeeper delegation, schedule) — all must yield drafts/approvals, never executions.
3. **Trigger-graph tests:** cyclic specs rejected; Grovekeeper-as-source-from-specialist-events rejected.
4. **Deletion verification:** post-RAW_DELETING walker proves emptiness; UI shows the proof — "you can watch the deletion happen" is a feature; build it like one.
5. **Threat model (`THREATS.md`):** infostealer (local ciphertext, keys in secure hardware), curious cohabitant, legal demand (minimization = little to produce), Nibbin-the-company (no Observer telemetry; C11), hostile email/connector content (prompt-injection suite).

---

## 8. Build order & milestones (the one-shot sequence)

Every milestone ends with the §6.7 adversarial gate; `CLAUDE.md`/`LEARNINGS.md` updates are part of every DoD.

| M | Deliverable | Definition of Done |
|---|---|---|
| M0 | Monorepo scaffold; `packages/creatures` TS port incl. Keeper species; CI + branch protection; environments live (GitHub/Supabase/Vercel per §6.8); `CLAUDE.md` router + `docs/` memory tree, `.claude/` skills + reviewer subagents, `/gate` command, Grovemap tool committed | Engine renders all species/stages in a component harness; CI gates green; PR workflow enforced; nibbin.com serves the web shell over HTTPS; Grovemap generates; memory + review-gate scaffolding in place |
| M1 | Account hierarchy (accounts/users/memberships, §6.1), Google/Apple/magic-link auth, Stripe skeleton, credit ledger; **admin console skeleton at admin.nibbin.com (§6.10: staff auth, account search, audited adjustments)**; **file Google OAuth verification/CASA + Meta app review (§6.9)** | RLS-via-membership attack tests pass; ledger math property-tested; tiers purchasable in test mode; staff login + audited credit adjustment demonstrated; both platform-approval processes initiated and tracked in docs/STATE.md |
| M2 | Grovekeeper visual chat: grove scene, expression states, card system, LLM router (T0/T1 + budgets) | Onboarding §4.1 steps 1–3 playable; router unit tests; reduced-motion parity |
| M3 | Connector platform: vault, aggregator integration, Tier-1 hand-built set (Gmail, GCal, Stripe, HoneyBook, Pixieset, Instagram DMs), generic MCP/IMAP rails | C8/C9 tests; webhook signature + SSRF suites; 12+ connectors live in staging |
| M4 | Connector scan engine + cards; Agent Shop + 6 shop specs; agent runtime with School gates, weighted credits, trigger-graph validation | §4.1 steps 4–7 end-to-end: scan → adopt → first approved draft in <10 min on a seeded account; §7.2–7.3 suites pass |
| M5 | Companion arc: drip scheduler, Field Notes (cloud beats), journals, badges, ceremonies; email mirror | 14-day arc simulatable in fast-clock test; one-push/day + quiet-hours enforced |
| M6 | Observer (macOS first; Windows behind the same capture trait): capture → redaction → SQLCipher store → study controller → review UI → local Field Notes; **desktop sign-up/sign-in via system browser + deep link, and the shared account-management module in-app (§6.1)** | Budgets met; redaction corpus green; day-14 daemon stop + verified delete demonstrated; C1–C7 hold by construction |
| M7 | Synthesis packet pipeline + diagnosis synthesis (T2) + Day-14 reveal | User zero completes a full 14-day study; packet → map → reveal works on real data; every leak/papercut filed |
| M8 | **External pen test, OSS license audit, restore drill executed; scrutiny pass (Author note):** security + architecture + business-logic review; scale review (DB indexes/load, queue throughput, COGS dashboards + alarms); pen-test checklist; Windows capture parity; **ad-hoc re-diagnosis** (§4.6: log-based map refresh + tier-gated deep re-study) | Findings triaged to zero P0/P1; load test at 10k-user profile; cost-per-user dashboard live; a map refresh re-synthesizes the diagnosis from logs without a new study, and a deep re-study is tier-gated |

Post-gate amendments (2026-06-12, PRODUCT-FOUNDATION.md — the M4+M5 gates of 2026-06-12 predate
these additions; they land with the M7-readiness wave, not retroactively):
M4 DoD adds: Grove Home shipped (approval queue, report cards, ledger, ceremonies) wired
to runtime events; Grove Memory schema + router injection + Keeper-interview population
live; approval_latency instrumented.
M5 DoD adds: PWA installability + web push approval cards (batching, quiet-hour exemption
for approvals); push opt-in flow honest and revocable.

---

## 9. Decision log

| Decision | Why | Revisit when |
|---|---|---|
| Two-stage diagnosis (scan → study) | Day-1 value kills the 14-day cliff; the study becomes the upgrade, not the gate | Never — the sequencing is the product |
| Grovekeeper has no hands; hub is terminal | Kills the lethal-trifecta and autonomy-laundering bug classes by construction | Never |
| MCP-first + aggregator; hand-build only vertical moats | Hundreds of connectors at near-zero cost; differentiation lives in HoneyBook/Pixieset/IG-DM-class depth | Aggregator pricing/reliability problems |
| Visual mascot chat over generic chat box | Generic chat is like every other product; the grove scene + emoting Keeper is a moat a copycat can't ship in a weekend | If low-end-device perf fails reduced-mode users |
| Tiered LLM router with frontier caps + transparent fallback | Grovekeeper chat must be ~free; the diagnosis is the only splurge | Model price shifts (re-tune quarterly) |
| Weighted credits (1/3/10) | The heavy tail (computer-use) funds itself; $10 top-ups stay solvent (repriced from $5 at M6.5 — measured T1 economics) | Cost telemetry says weights are wrong |
| Fork Screenpipe; Tauri; SQLCipher; Presidio sidecar; AX-first | Months saved under MIT; the moat is inference + agents, not capture plumbing | Vendored surface fights OS updates |
| Postgres+RLS, append-only ledgers, vaulted tokens | Boring, auditable, scales past this phase; the Author's scaling note is M8's mandate | M8 findings |
| Supabase + Vercel + GitHub as the managed platform | Solo-founder velocity: RLS, auth, vault, previews, CI without ops headcount | Scale/cost findings at M8; egress or vendor limits |
| Adversarial gates at every milestone (not just M8) | Fresh-context red teams catch what the author-model is blind to; cheap insurance on §2 | Never — tune the briefs, keep the gates |
| Re-diagnosis is ad-hoc + tiered, never a fixed quarterly cadence (§4.6) | Work changes irregularly; synthesis COGS is trivial (~$0.025) and the Observer runs on-device, so the real cost is user time + farming, not compute. Continuous weekly scan + hatch-anytime cover most change; a cheap log-based map refresh + an occasional deep re-study cover the rest (decided 2026-06-13) | If re-study farming appears, or users ask for scheduled re-maps |
| Thin-router CLAUDE.md + docs tree + skills/subagents | Progressive disclosure: sessions load only task-relevant context instead of a monolith | If routing misses cause repeated mistakes, promote items into the router |
| Grovemap (in-repo graph tool) | AI-native repos need a live structural picture for humans and agents alike | Replace with richer tooling if the repo outgrows it |
| Account→Membership hierarchy from day one | Multi-seat later becomes a permissions feature, not a migration; single-user is just the default shape | Never — scoping to user_id alone is the mistake |
| The approval queue is the flagship surface, mobile-first | Approval latency gates Agent School velocity; trust ceremony must be a pleasure, not triage | If usage shows desktop-only behavior at scale |
| Grove Memory is explicit, user-editable, and enforced | Implicit knowledge caps draft quality; editable memory is also the trust answer to "what does it know" | Never — extend sections instead |
| Anti-feature register adopted (no canvas builder, client portal, native payments, voice, marketplace, team seats in v1) | Each concedes the thesis, fights incumbents on their ground, or exceeds current security/compliance maturity | Each row carries its own revisit trigger in PRODUCT-FOUNDATION.md §4 |
| Provider per capability, not per vendor — Anthropic-direct for the language tiers (T0–T2) today; new modalities (image generation, voice, embeddings) pick best-in-class per capability as they enter scope; no aggregator in the serving path | Text is where the claims bar, caching, and injection evals bite hardest, and Anthropic clears all three; capability gaps can't be served by vendor loyalty. Every provider, regardless of name, clears the same three bars: contractual no-training/retention, a passing eval set, a published subprocessor row | Any new modality entering agent scope; or a language-tier provider beating Anthropic on $/quality through the same bars |
| No `auth_identities` table — Supabase `auth.identities` is the record of provider/provider_uid | Duplicating the auth provider's own identity store invites drift; §6.1's sketch predates the Supabase decision | If we ever leave Supabase Auth |
| Separate admin app + staff identity world | Support without DB-poking; insider risk bounded by RBAC, consent, and append-only audit | SOC 2 evidence needs at M8 |
| Landing page leads with Day One; study is the deepener | Spec evolved to dual-track; marketing must mirror the product or trust dies at first use | If Day-One adoption underwhelms in beta, re-weight |
| Day-1 agent creation = Shop templates + Keeper tailoring; free-form bespoke specs gated until post-M8 | Template specs are validated and safe on launch day; arbitrary spec synthesis needs a hardened runtime first | Open bespoke creation when injection/cost suites pass at scale |
| data-ai.html is a claims surface | Town-style plain disclosures endear and preempt; every line must match implementation | Never — extend, don't soften |
| Cookieless analytics, no consent banner | Privacy posture is the brand; banners are friction confessing tracking | If marketing attribution truly requires more, revisit with consent |
| US-English launch, strings centralized from day 1 | i18n-ready without i18n cost; later locales are translation, not rewrite | First non-US market demand |
| Scan-empty → Keeper interview fallback | Day-One promise must survive a quiet inbox; nobody lands on an empty grove | Never — improve the interview instead |
| Model swaps gated by eval regression suite | Hot-reloadable routing is power; ungated power is how quality regresses silently | Never |
| Satchel & scarf retired from user accessories | Wrap-around accessories fight six different silhouettes; quality over count. Keeper's satchel is bespoke body art, unaffected | Reintroduce only with per-species fitted art |
| The study's user-facing name is the **Field Study** | "Optional study" undersells and hedges; Field Study joins Field Notes and the Field Guide in one vocabulary family | Never — naming is brand infrastructure |

---

*Reference assets: `nibbin-demo.html` (brand/copy/pricing source of truth), `nibbin-creature-lab.html` (creature engine reference), `nibbin-style-guide.html` (Field Guide — the design-system source of truth; tokens ship as `packages/shared/tokens.css`), and `privacy.html` / `terms.html` (Nibbin, Inc. legal pages, linked from every footer; counsel review before public signup per §6.9).*
