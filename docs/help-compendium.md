# Nibbin Help & Getting-Started — Content Compendium

> This is the authoritative content source for the /app/help build. All claims are grounded in the live `nib-help` worktree; three corrections from the research agent's final pass are applied inline (C11 model-improvement toggle, pause-hotkey phrasing, secure-field phrasing). Accuracy flags marked ⚠️ must be resolved before publishing.

---

> **Source basis:** Synthesized from the live code and docs in the `nib-help` worktree — `docs/STATE.md`, `AGREEMENTS.md`, `INVARIANTS.md`, `RISKS.md`, `PRODUCT-FOUNDATION.md`, `MOAT.md`, the `docs/superpowers/specs/*` design specs, the desktop app (`apps/desktop/src/ui/views/*`), the web app (`apps/web/app/app/*`), and the runtime (`packages/runtime/src/*`). Non-obvious facts cite their source file. ⚠️ marks anything that must be confirmed before publishing.
>
> **Vocabulary law (from AGREEMENTS.md):** Always use Nibbin(s), grove, hatch, adopt, Agent School, Grovekeeper, Field Notes, diagnosis, Field Study. The agents may be called "helpers." **Never** say bot, assistant, "as an AI," or "creature(s)" in customer-facing copy ("creature" is an internal engine term only).
>
> **Product tagline:** "AI agents that nibble your busywork away." Public category label: "AI Agents. Simplified." Human phrasing: "people who work for themselves."

---

## SECTION 1 — GETTING STARTED

### The big picture (read this first)
Nibbin gives you a **grove of little helpers** — Nibbins — that learn how *you* work and then take routine chores off your plate. You decide what each one may do — **Observe**, **Draft**, or **Send** — and Agent School grades how well it is doing so you always know when to extend more trust. The journey has four moves: **(1) sign in and meet your Grovekeeper → (2) install the desktop app and run a Field Study so Nibbin learns your real work → (3) read your diagnosis and adopt your first Nibbin → (4) set its action level and approve its drafts.**

### Step 1 — Create your account and meet your Keeper
1. Go to **nibbin.com** and sign up with your **email and a password** (this single login works on the web app *and* the desktop app — source: `settings/security/page.tsx`).
2. You land in your **grove** (the home screen at `/app`). Your **Grovekeeper** greets you in a docked chat panel. The Keeper is your guide — it has a name and is the one part of Nibbin that *never* touches your tools or sends anything (it holds zero side-effect tools, permanently — INVARIANT C10).
3. The Keeper walks you through a short onboarding: **"Meet your Keeper" → "About you" → "Set up the app" → "You're live"** (source: `grove/OnboardingStepper.tsx`). It asks a few plain questions about what you do and where your time goes. You can **"Skip this one"** on any question.

**What to expect:** Warm, conversational. Anything you tell the Keeper becomes the starting point for your **Grove Memory** (the shared brain your Nibbins draw on). New accounts begin with **0 credits** until you're on a plan or granted a credit refresh.

### Step 2 — Install the desktop app and run a Field Study
The desktop app is where the real work happens — it's the only place your Nibbins connect to your accounts and where the **Field Study** observes your workflow.

1. On Grove Home there's a **"Get the desktop app"** card: **"Download for macOS"** / **"Download for Windows."** Install it on the computer you actually work from.
2. Open the app and **sign in with the same email + password.**
3. The app has two tabs: **Grove** (your web grove, embedded) and **Field Study** (the native observer).
4. Open **Field Study**. You'll choose between:
   - **A 14-day full Field Study** — the deep observation that produces your full diagnosis.
   - **A Quick Scan** — capture and diagnose one task on demand (auto-stops after ~6 hours).
5. Pick a **depth**: **Lite** (selectable now) or **Detailed** (shown but **coming soon / disabled**) — source: `field-study.ts` entry view.
6. Read and accept the **Consent screen** (full detail in Section 4). It spells out exactly what's captured, what's never captured, where data lives, what (if anything) leaves your device, and how to stop everything.
7. The study runs quietly in the background. A countdown shows time remaining; you can **Pause/Resume**, **End the study early**, or hit the global pause hotkey **⌘⇧.** (Ctrl+Shift+. on Windows) at any moment.

**Platform status:** **Windows screen capture is now live in the release.** **macOS capture is coming soon.** ⚠️ Confirm the exact macOS availability wording at ship time against `docs/STATE.md` / `docs/gates/2026-06-18-capture-bringup.md`.

**Permissions you'll grant:** On first run the OS asks for **screen recording** permission (Windows; macOS when it lands). That's all the study needs — there's **no audio and no camera, ever** (INVARIANTS.md).

### Step 3 — Review your captured data, then build your diagnosis
1. During and after the study, open the **Review** tab in Field Study. Everything there is **already redacted** ("Everything below is already redacted") — names, emails, and numbers are replaced. You can delete any single event or clear a whole app's worth.
2. When the study ends, the app builds a **diagnosis packet** *on your device* and shows you a **review-before-upload** screen (the packet review). You see each workflow it found and can **Remove** anything you don't want included.
3. Choose **"Send to Nibbin"** to upload only that redacted packet, or **"Delete instead"** to wipe it locally and send nothing.
4. Only after the upload succeeds (HTTP 200) does the app delete the raw study data — so your raw recordings never leave and are never deleted before you've confirmed the packet (INVARIANT C3; source: `sync-study.ts`).

### Step 4 — Read your diagnosis and adopt your first Nibbin
1. In the web app, open **Your diagnosis** (`/app/diagnosis`) — *"Where your week actually goes."* If it's not ready: *"Run the 14-day Field Study from the desktop app and your map grows in here."*
2. The diagnosis reveals: a **letter from the Grovekeeper**, your **total routine hours/week**, **how much could move to your grove** (~Xh/week automatable), a **workflow map** ("Where the hours go"), where your **desktop time goes**, and the **biggest friction**.
3. Each workflow can carry a recommendation: **"Adopt [Nibbin] to start handling this — it drafts for your approval; you set what it may do when you're ready."** For email workflows you'll also see **"Build a Nibbin for this"** (the Composer path — see Section 3).
4. Or browse the **Agent Shop** (`/app/shop`) and adopt any of the six ready-made Nibbins, or **Hatch Your Own** (`/app/hatch`) for a custom-named helper built around one chore.

### Step 5 — Connect a tool (so your Nibbin has something to work with)
1. Go to **Connections** (`/app/connections`) — *"Accounts your Nibbins work from."*
2. Connect **Gmail** (live). OAuth consent covers read + write scopes at connect, explained plainly (C8). You set what each Nibbin may do — Observe, Draft, or Act. Agent School grades how accurately it's working so you know when to grant it more; the grade never gates what you've granted.
3. **Google Calendar and Stripe are shown as "Coming soon"** in the connect surface today (source: `connections/lib/providers.ts`). When you adopt a Nibbin that needs a tool you haven't connected, you'll see: *"That Nibbin needs [x] and [y] connected to finish adopting."*

> ⚠️ **Tester-allowlist gate:** Gmail (and other Google scopes) are gated behind a tester allowlist while Nibbin's Google OAuth verification is pending (capped at 100 users). If you're not on the allowlist, you'll need to **request access**. Source: `connections/tester-allowlist.ts`, `RISKS.md §1`.

### Step 6 — Approve, and watch it learn
1. Your new Nibbin hatches as an **Egg** in **Agent School** — watching only, drafting nothing yet.
2. In a few days it becomes a **Student** and starts leaving **drafts for your approval** on **Grove Home** under **"Needs you — your only to-do."**
3. For each draft: **"Approve & send"** or **"Edit first."** Your approvals (and edits/rejections) are the training signal.
4. As it earns verified accuracy, it climbs to **Senior** and then **Graduate** — its grade tells you when to grant it more. You set what it may do (Observe / Draft / Act) at any time. (Full mechanics in Section 2 and Section 3.)

---

## SECTION 2 — CORE CONCEPTS (glossary)

**Nibbin (a helper).** A small AI worker that handles one kind of chore for you — drafting replies, chasing invoices, confirming bookings, writing your morning brief. Each is a character with a name, a look, and a stage in Agent School. Plural: Nibbins. Warmly: "helpers."

**Grove.** Your whole collection of Nibbins and your home base. **Grove Home** (`/app`) is your daily surface: what needs your yes, what got done, what's coming up.

**Grovekeeper (the Keeper).** Your guide and narrator. It chats with you, writes your diagnosis letter, and keeps the grove tidy — but it **holds zero tools and can never send or change anything** (INVARIANT C10). Its name is yours to set during onboarding and is then locked.

**Field Study.** A timed, on-device observation of how you actually work, run from the desktop app. The **full study runs 14 days** then hard-stops; everything stays encrypted on your machine and only a redacted summary (the packet) ever leaves — and only if you choose. The deep version of "show Nibbin how I work."

**Quick Scan.** A lighter, on-demand version of a Field Study: capture and diagnose **one task right now**. Auto-stops after ~6 hours. Use it when you want a fast read on a specific workflow without committing to two weeks.

**Lite vs Detailed (capture depth).** **Lite** captures app names, window/shape info, and **redacted text only — no screenshots.** **Detailed** would add periodic screenshots processed on-device. **Detailed is coming soon** (selectable in the UI but disabled today — source: `field-study.ts`, `consent.ts`).

**The Observer / daemon.** The background piece of the desktop app that does the capturing. It's **dormant by default** — it only records during an active study or scan, enforces the day-14 hard stop itself, and is the thing the global pause hotkey stops near-instantly. Internally it's the `observerd` daemon.

**Diagnosis.** The map Nibbin grows from your Field Study: total routine hours/week, a workflow map, where your desktop time goes, biggest friction, how much is automatable, and which Nibbins can help. Only the redacted packet ever left your device to make it.

**Synthesis packet.** The redacted, structured summary your desktop app builds on-device at the end of a study. It contains categorized workflow summaries (and bounded, re-minable structure like repeated action sequences and URL templates) — **never your screen recordings, never the raw event stream.** It *becomes* your diagnosis.

**Agent School (Egg → Student → Senior → Graduate).** How every Nibbin's accuracy is graded. Trust is built through **verified accuracy, never time served.**
- **Egg** — observes only; drafts nothing.
- **Student** — drafts everything for your approval.
- **Senior** — accuracy proven on routine work.
- **Graduate** — accuracy proven across its spec.

Grades are advisory; you grant Observe / Draft / Act.

**Promotion & demotion.** A Nibbin promotes when it hits **≥95% approved-without-edits over a rolling 25-run window** (stage-scoped). Senior→Graduate also requires **coverage of ≥4 distinct routine patterns** (so it can't graduate on one easy case). High-stakes actions are weighted more heavily (read=1 / normal=3 / delete-or-archive=10). **Demotion is human-only and one click** — the system may *nudge* ("its last few got edited — want to put it back to drafts?") but never demotes automatically. **Paused never means penalized:** earned progress is frozen, never eroded by silence (source: `promotion-rubric-design.md`, `school.ts`).

**Keeper.** See Grovekeeper. (Always locked from editing tools by design.)

**Agents & capabilities.** Each Nibbin is built from **capabilities** — typed, atomic skills like `email.read`, `email.draft`, `calendar.read`, `payments.read`, `invoice.nudge`, plus higher-level **primitives** (e.g. "nudge overdue email," "morning digest"). A Nibbin can only ever use the capabilities it was given, and only at the action level you've granted.

**Composer.** The system that **builds a custom Nibbin for you** from a diagnosis or a description — it assembles validated primitives into a working helper. You review it before it's created (see Section 3).

**Crystallization ("Make this recurring").** After you supervise a successful one-off task run (via the Planner), Nibbin can offer "Make this recurring" — it distills exactly the chore you just approved into a permanent, scheduled Nibbin. You pick the cadence (it suggests one; it never auto-schedules), and the new Nibbin **hatches as an Egg and is graded from scratch** — your earlier approvals don't transfer into standing accuracy. You set its action level whenever you're ready. Source: `crystallization-slice4-design.md`. ⚠️ Gated/early-access; confirm availability in `docs/STATE.md`.

**Connections.** The accounts your Nibbins work from (Gmail today; Calendar/Stripe coming). Write scopes are requested at connect with a plain-language explanation; you set what each Nibbin may do (Observe / Draft / Act). One-click revoke.

**Memory (Grove Memory + agent memory).** Two layers. **Grove Memory** is the business brain you edit by hand — facts, pricing, policies, FAQs, your voice, and **hard rules** your Nibbins can never break. **Agent memory** is short derived notes Nibbins learn from your approved work (never raw content). Both make drafts sound like *you*.

**Training mode.** A time-boxed, budget-bounded switch (Students/Seniors) that surfaces *more* drafts for your review so a Nibbin gathers approval signal faster — **without granting any autonomy or changing any gate.** Every draft still needs your yes (source: `TrainingToggle.tsx`).

---

## SECTION 3 — FEATURES (every feature, with behavior, limits, and status)

### Field Study (desktop) — **LIVE on Windows; macOS coming soon**
- **What it is:** A 14-day on-device observation of your work that produces your diagnosis.
- **Modes:** **Full Field Study** (14-day hard stop) and **Quick Scan** (one task, ~6-hour backstop).
- **Depth:** **Lite — live** (app/window/shape + redacted text, **no screenshots**). **Detailed — coming soon** (adds periodic on-device-processed screenshots).
- **Captured:** active app names, window titles/shapes, redacted text from accessibility info, repeated action sequences, URL templates, daily minutes per app.
- **Never captured:** passwords/secure fields, banking/health/sensitive-category content, audio, camera (see Section 4).
- **Controls:** Pause/Resume, End early, global pause hotkey (⌘⇧. / Ctrl+Shift+.), per-event/per-app delete, exclusions, "Delete everything."

### Desktop app tabs
- **Grove** — your web grove embedded in the app (where Nibbins connect and work). Shows a sprout loader while it connects.
- **Field Study** — the native capture experience, with sub-tabs: **Home**, **Review**, **Field Notes**, **Preferences**.
- **Field Notes** — on-device-only stats computed from your already-redacted events: event count, active time, pause count, days so far, and a "Where the day went" app breakdown. *"Counted on this machine, shown on this machine. Nothing here is uploaded."*
- **Preferences** — device-level settings: add exclusions (an app or a website), pointer to the Review screen, and an always-reachable "Delete everything." Account/plan/password live on the web at nibbin.com.

### Daily Review + exclusions
- **Review** lists every captured event (already redacted), grouped by app. Delete individually or by app.
- **Exclusions** let you name an app or a website that should **never** be recorded; they persist across sessions (source: `exclusion-persistence.md`). Add them from Review or Preferences.

### The six Shop Nibbins (verbatim from `packages/runtime/src/templates.ts`)
All start at the Draft action level — you set each one's action level (Observe/Draft/Act); Agent School grades how well it's doing. Each lists its required connections.

| Nibbin | Tagline | What it does | Needs |
|---|---|---|---|
| **Sweep** (Puff, broom) | "Keeps your inbox floor clean" | Reads your inbox like a tidy morning — gathers newsletter noise, stale threads, things you already answered — and hands you one short **keep-or-clear** list. *(Presentation only; nothing deleted without you.)* | Gmail |
| **Echo** (Wisp) | "Never lets a thread go quiet" | Watches for conversations waiting on you — overdue replies, stalled follow-ups, deliveries with no note — and **drafts the nudge** so you just read it and say go. | Gmail |
| **Brief** (Glim, glasses) | "Your morning, on one card" | Reads yesterday/today across calendar, inbox, and money, and writes the short version: what's booked, what's waiting, what needs a decision. Five lines, every morning. *(Presentation only.)* | Gmail + Google Calendar + Stripe |
| **Tally** (Capling, coin) | "Minds the money you already earned" | Watches invoices — late, overdue, where fees nibble — and **drafts the polite payment nudge** you keep meaning to send. | Stripe |
| **Hopper** (Longear, pencil) | "Keeps your calendar honest" | Checks tomorrow before you do: unconfirmed sessions, missing reminders, the reschedule that never rebooked — and **drafts the confirmation** so nobody no-shows. | Google Calendar + Gmail |
| **Scribe** (Sprout, quill) | "Answers the question you answer every week" | Learns how you reply to repeat inquiries (pricing, availability, what's included) and **drafts the answer in your voice**, ready for your yes. | Gmail |

> ⚠️ Brief and Tally require **Stripe**, and Brief/Hopper require **Google Calendar** — both of which currently show **"Coming soon"** in Connections. Until those connectors are live for your account, those Nibbins can be adopted but won't have a working connection; you'll get the *"needs [x] connected"* prompt.

### Adopt → Egg → approve → promote (the lifecycle)
- **Adopt** from the Shop, a diagnosis recommendation, or Hatch Your Own. There's a brief hatch ceremony.
- The Nibbin starts as an **Egg** (observe-only), becomes a **Student** in a few days (drafts for approval), then earns **Senior** and **Graduate** through verified accuracy (95%/25-run + coverage ≥4 + severity weighting).
- Watch progress on **Your Nibbins** (`/app/nibbins`): the Agent School ladder, streaks, badges (**First Solo**, **Zero-Miss Month**, **100 Runs**), and "What [name] has learned about you" — all read from real run history, never fabricated.

### Composer (build / edit custom agents) — **early access (gated)**
- From an **email** workflow in your diagnosis, **"Build a Nibbin for this"** runs the **Composer**: it proposes a custom Nibbin made of validated **primitives** (e.g. "watch your inbox for overdue threads → draft a warm follow-up for your approval").
- You get a **review-before-adopt** card showing the workflow, the plain-language steps, the persona, the trigger, and the connectors it needs. **Nothing exists until you confirm.**
- Today's primitives cover the **detect-and-nudge** family (overdue email, overdue invoices, unconfirmed events, new-inquiry replies) and the **digest** family (inbox cleanup, morning brief). Source: `composer-slice2a/2b/2c-design.md`.
- The custom Nibbin hatches as an **Egg** and is graded by Agent School exactly like a shop Nibbin — you set its action level (Observe / Draft / Act) whenever you're ready.
- **Hatch Your Own** (`/app/hatch`) is the simplest builder: pick a chore, pick the apps, name your egg. *"Build a Nibbin for one chore."* Three steps: "What's the chore?" → "Where does it happen?" → "Your egg is ready" (name it, optionally customize its look).

### Planner — multi-step orchestration — **early access (coming soon)**
A bounded orchestrator that takes a goal, breaks it into steps across capable Nibbins, and tracks progress. Bounded ReAct loop: ≤30 iterations, capped tokens, ≤4 web calls, ≤3 memory writes; **every side effect is approval-gated** (runs at synthetic "student" stage so nothing auto-executes) (source: `runtime/planner.ts`, `planner-slice3a-design.md`). ⚠️ Treat as coming soon / early access unless confirmed live in `docs/STATE.md`.

### Crystallization ("Make this recurring") — **early access (gated)**
After you supervise a successful one-off Planner run, Nibbin can offer **"Make this recurring"** — it distills exactly the chore you just approved into a permanent, scheduled Nibbin. You pick the cadence (Nibbin suggests one; it never auto-schedules). The new Nibbin **hatches as an Egg and is graded from scratch** — your earlier approvals don't transfer into standing accuracy. You set its action level whenever you're ready. Source: `crystallization-slice4-design.md`. ⚠️ Gated/early-access; confirm in `docs/STATE.md`.

### Training mode — **early access (gated)**
- On a Student or Senior's card, **"Train faster"** opens a time-boxed window (1 hour–14 days, ≤100 extra runs) that surfaces more drafts for your review.
- It **grants no autonomy and changes no gate** — graduation still takes the same earned approvals. End it any time with "End training." Source: `TrainingToggle.tsx`, `training-mode.md`. ⚠️ Built and migrated, but the scheduler seam may not be wired yet — confirm production readiness.

### Memory — **live (Grove Memory); agent memory live, semantic retrieval gated**
- **Grove Memory** (`/app/memory`) — *"What your grove knows."* Edit five sections — **facts, pricing, policies, FAQ, voice** — plus **hard rules** (one per line, never broken in a draft) and free notes. Shared with all your Nibbins so drafts sound like you. Saved memory is used from the next draft.
- **Learn from my Gmail history (one-time sweep)** — optional, **off by default**, **opt-in only**. Reads ~12 months of sent + inbox mail once to learn your voice and common questions. **Sent messages are processed by the model; your inbox is reduced to subjects and previews; only short derived notes are kept** (the raw mail isn't retained). Toggle it on the Gmail connect screen or in Data & Privacy. Source: `sweep-consent-gating-design.md`.
- **Agent memory** — short derived facts/preferences a Nibbin learns from your approved work (never raw content; runs through redaction before storage). Semantic retrieval uses an embedding subprocessor (Voyage) on derived text only. ⚠️ Semantic recall depends on a server key (`VOYAGE_API_KEY`); without it, memory falls back to text/recency matching (source: `agent-memory-rag-design.md`).

### Connections — **Gmail live (tester-gated); Calendar + Stripe coming soon**
- **Connections** (`/app/connections`) — *"Accounts your Nibbins work from."*
- **Action-level gated.** Connect requests read + write scopes at OAuth consent, with plain-language explanation (INVARIANT C8). Holding a write scope doesn't authorize action — execution is gated by the owner-set action level (Observe / Draft / Act). You decide what each Nibbin may do, and you can change or revoke it anytime. Agent School grades how accurately it's working so you know when to grant more. Access shows as **"Read-only access"** (no write grant) or **"Includes actions you approve · revoke anytime"** (write grant held, action level set by you). |
- **Live in code:** **Gmail** (`gmail.readonly` + `gmail.compose` + `gmail.send` requested at connect). **Coming soon:** **Google Calendar** (`calendar.readonly` + `calendar.events` at connect), **Stripe.**
- ⚠️ **HoneyBook, Instagram, Pixieset, QuickBooks, Outlook, Notion, Drive/Dropbox** appear in the **Hatch Your Own** app-picker and in product/strategy docs, but are **not** in the connectable provider list today. They are **roadmap, not connectable now.** Confirm against `connections/lib/providers.ts` before publishing any "supported tools" list.
- **Write grants** are per-capability and revocable one-click; revoking a connection suspends all its grants and destroys the stored token (INVARIANT C9).

### Diagnosis reveal — **live**
- *"Where your week actually goes."* Animated reveal: Keeper letter → total routine hours → automatable hours → study window/stats chipline → workflow map → desktop-time breakdown → "Where the hours go" → adoptable recommendations.
- History of all studies and scans (newest first) with **"14-day study"** / **"Quick scan"** badges; per-diagnosis detail page with a delete (with confirm).
- Older diagnoses are browsable and individually deletable (source: `diagnosis/`).
- Adopt recommended Nibbins directly, or "synthesize" a custom one from a recommended workflow without adopting yet.

### Notifications + channels — **leaves live; channels: Telegram gated, SMS/WhatsApp coming soon**
- **From the grove** (`/app/notifications`) — *"Your leaves."* Field Notes, training sessions, near-graduations, drift nudges, ceremonies land here. Mark read individually.
- **Where your grove reaches you** (in Data & Privacy): connect **Telegram / SMS / WhatsApp**. Each shows **Connect** or **"Coming soon"** based on server flags. **The app is always the one place anything sensitive happens.**
- **Quiet hours & digests:** set quiet-hour start/end and how non-urgent notifications batch. Only genuinely urgent things cross quiet hours. **Approval requests are work you asked for — they aren't suppressed by quiet hours** (PRODUCT-FOUNDATION §4.8).
- **Companion emails:** gentle field-study email nudges (Field Notes, milestones, your map); toggle off anytime.
- **Channel-initiated work:** Telegram supports agents initiating conversations (gated end-to-end via plan-preview + approval). SMS/WhatsApp pending 10DLC/Meta compliance.

### Data & Privacy panel — **live** (full detail in Section 4)
Surfaces what the Field Study sees, retention windows, connections summary, the Gmail-sweep opt-in, notifications/channels/quiet-hours, the model-improvement opt-out, and a link to account deletion.

### Account & billing
- **Profile** (`/app/settings/profile`): display name, timezone, locale. Email is your sign-in (change it from Security).
- **Security** (`/app/settings/security`): change password (≥8 chars; works web + Observer), **sign out everywhere.**
- **Account** (`/app/settings/account`): **delete account** — a **30-day countdown**, tools disconnected **immediately**, **cancelable any time within 30 days**, then permanent. Type your account name to confirm.
- **Billing/plans:** plan tiers exist (Hatchling free / Grove / Canopy; pricing handled in-app). Capped adoptions prompt *"Move up a plan."* ⚠️ Confirm current plan names/prices against the live billing page; STATE.md lists Stripe test-mode products **Grove $19/mo, Canopy $49/mo, top-up repriced to $10/1,000**.

---

## SECTION 4 — PRIVACY & DATA (plain language)

Nibbin's whole design is built so that **your screen never leaves your computer** — by architecture, not just policy. These are the guarantees (the C-claims are hard invariants from `INVARIANTS.md`; "break these and the build is wrong by definition").

- **Your screen recordings never leave your device (C1, C7).** The capture module has no way to send anything to the network. Only a **redacted, structured summary** (the synthesis packet) can leave — and only when *you* choose to build your diagnosis. *"Your screen recordings never do — by architecture, not policy"* (source: `settings/privacy/page.tsx`).
- **You review everything before it's uploaded (C7).** At study end you see the packet, can remove any workflow, and choose **Send** or **Delete instead.** Choosing delete uploads nothing.
- **Data is encrypted on your device.** Raw study data lives in an encrypted local store; the key is wrapped by your OS keystore.
- **Passwords and secure fields can't be captured — by construction, never by reading the picture (C4).** Suppression is structural. A password box can't be recorded even in Detailed mode.
- **Banking, health, and sensitive categories are auto-excluded (C5)** before anything is ever written to disk. You can also mark any app or site "never record" yourself.
- **No audio. No camera. Ever.** These are exclusions, not roadmap items (INVARIANTS.md).
- **One hotkey stops capture near-instantly (C6).** ⌘⇧. (macOS) / Ctrl+Shift+. (Windows) pauses capture. Reach for it any time.
- **The Observer is dormant by default.** It records only during an active study or quick scan, and the **14-day hard stop is enforced by the daemon itself** (C2), not the UI — with anti-rollback so the clock can't be cheated.
- **Raw data is verifiably deleted after synthesis (C3).** After your packet is safely uploaded, the raw data is deleted and an **independent verifier confirms it's gone.** Deletion is user-visible, and account deletion produces a receipt.
- **No telemetry; no data sales (C1, C11).** Nibbin doesn't quietly phone home, and it never sells your data.
- **Nibbin never trains its models on your content — ever. That's a hard guarantee, not a setting** (there is no toggle because it never happens). Separately, a **Model improvement** toggle controls whether Nibbin learns from anonymized, aggregate signals about how its capabilities and models perform — never your data, never your content, never sold. **That toggle is ON by default (opt-out)**; turn it off anytime in Data & Privacy. (Source: `settings/privacy/page.tsx`, Trust & Controls D1-A.)
- **Nothing acts on your behalf without your permission (C8).** Connect requests the access your Nibbins may use (read + write scopes, explained plainly); execution is gated by the owner-set action level (Observe / Draft / Act) — holding a write scope doesn't authorize action, you grant each Nibbin what it may do. Agent School grades how accurately it's working so you know when to grant more. Tokens live in an **encrypted vault, never the app database**, with **one-click revoke that cascades** (C9).
- **The Grovekeeper can never act (C10).** It holds zero side-effect tools, permanently.

### What's kept, and for how long (from the Data & Privacy panel)
| Data | Where & how long |
|---|---|
| Raw Field Study data | On your device, until your diagnosis is built — **14 days max** |
| Agent run logs | **90 days** by default; shorten or wipe anytime |
| Connection tokens | Encrypted vault while connected; **one-click revoke** |
| Account data | Life of the account, plus **30 days** after verified deletion |

### Deleting everything
- **On the desktop:** "Delete everything" wipes the captured study data on that machine and **verifies it's gone** — reachable from any state, and it never uploads first.
- **On the web:** delete your whole account (grove, Nibbins, diagnosis, connections) from **Settings → Account** — 30-day cancelable countdown, tools disconnected immediately.

> Subprocessors: Nibbin uses Anthropic (models) and Voyage (embeddings on already-redacted derived text only). ⚠️ Confirm the live subprocessor page is published (`reference/subprocessors.html`) before pointing users to it — STATE.md notes it was still pending.

---

## SECTION 5 — BEST PRACTICES & IDEAS (for solopreneurs, freelancers & creative service businesses)

### Get the best possible diagnosis
- **Run the full 14-day Field Study during a normal work stretch** — ordinary weeks, real inboxes and clients. The diagnosis is only as good as the work it watches.
- **Work the way you always do.** Don't perform for it. The repeated, boring sequences are exactly what becomes automatable.
- **Use Quick Scan for a single sticky task** you want a fast read on (e.g. "watch me answer inquiries this afternoon").
- **Add exclusions up front** for anything personal so you never think twice about what's captured.
- Don't over-prune the packet — removing too much hides the recurring patterns Nibbin is looking for. Remove only what's genuinely private.

### Fill in Grove Memory early
- Spend ten minutes on **Grove Memory**: your **pricing, policies, FAQ answers, and voice.** Paste a reply you're proud of into the voice box. This instantly lifts every Nibbin's draft quality at once.
- Write **hard rules** for the lines you never cross — e.g. *"Never promise a delivery date without checking with me," "Always address clients by first name."* Nibbins treat these as non-negotiable.

### What to automate first (highest payoff)
1. **Scribe** — repeat inquiries (pricing/availability/what's included). Highest-frequency, lowest-risk drafting; great first win.
2. **Echo** — chase the replies and follow-ups that go quiet.
3. **Tally** — the polite invoice nudge you keep meaning to send (needs Stripe — coming soon).
4. **Hopper** — confirmations so clients don't no-show (needs Calendar — coming soon).
5. **Brief** — a five-line morning card once Calendar + Stripe land.
6. **Sweep** — a daily keep-or-clear pass on inbox noise.

### Build trust before autonomy
- **Approve generously but edit honestly.** An edit teaches voice; a rejection teaches a boundary. Both are training, not failure.
- **Use Training mode** when you want a Nibbin to graduate faster — it surfaces more drafts during a focused window without ever acting on its own.
- **Let Seniors prove routine work** before you lean on autonomy. Coverage of several distinct patterns is what earns Graduate.
- **A nudge isn't a punishment.** If a Nibbin's recent drafts start getting edited, you'll get a calm "want to put it back to drafts?" — demotion is always your call, and paused progress is never lost.
- **Promote on accuracy, not time** — let it hit its clean-run streak. Don't grant send-scope until you'd happily sign its drafts unread.
- **Watch the drift nudge:** if approvals dip, review a few drafts before it slips further.

### Example use-cases by trade
- **Photographer / videographer:** Scribe answers "are you available for [date]?" inquiries in your voice; Hopper confirms shoots; Tally chases the second invoice.
- **Designer / illustrator:** Echo nudges stalled approval threads; Brief shows what's due today.
- **Any solo service business:** Sweep keeps the inbox sane; Brief is your one-card morning standup.

**Example agent use-cases in detail:**
- **Invoice chasing:** Tally drafts a warm "just a nudge on invoice #X" when one goes overdue.
- **Email triage / nudges:** Sweep clears inbox noise into a keep-or-clear list; Echo surfaces the three threads waiting on you.
- **Inquiry replies:** Scribe drafts a priced, on-brand reply to a new booking inquiry.
- **Morning brief:** Brief gives you "booked / waiting / needs a decision" before coffee.
- **Event confirmations:** Hopper drafts tomorrow's confirmations so clients don't no-show.

---

## SECTION 6 — TROUBLESHOOTING

**"The background watcher isn't reporting / Field Study shows nothing."**
The Observer may be offline or cold-starting. Field Study polls a few times before deciding (≈3 tries). If it still shows offline, use **Retry** on the daemon health note. Make sure the desktop app is running and you're signed in. If a study isn't capturing, check it isn't **Paused** (look for the Paused chip) and that you didn't hit the pause hotkey. (source: `views/field-study.ts` pollUntilOnline / daemonHealthNote; `field-study-state.ts` DAEMON_OFFLINE → entry.)

**"Capture is blocked / a banner says it can't record."**
You'll see a honey-tinted **capture-blocked banner** above the normal content. This usually means the current app/site is on an auto-exclusion (banking/health) or you've excluded it. Switch to the work you want observed, or check your exclusions. (source: `field-study.ts` captureBlockedBanner.)

**"Permission denied / nothing is being captured."**
Grant the OS **screen recording** permission for the Nibbin app (Windows now; macOS when capture ships). On macOS, if you previously revoked it, the app auto-pauses — re-grant in System Settings and resume. Remember: there's no audio/camera permission to grant. (⚠️ macOS *capture* is still coming soon — full native capture may not be available even with permissions granted; confirm in the capture-bringup handoff.)

**"My study is paused and won't capture."**
Open the **Field Study → Home/Study** screen and hit **Resume.** If you pressed the global hotkey (⌘⇧. / Ctrl+Shift+.), press it again or resume from the UI. Also confirm you're inside the 14-day window — a full study **hard-stops at day 14** by design. (source: `study.ts`; `main.ts` study:paused-by-hotkey.)

**"Where's my diagnosis?"**
The diagnosis only exists after you finish a Field Study **and** choose **"Send to Nibbin"** on the packet-review screen. If you chose "Delete instead," nothing was uploaded — run another study. The web page says: *"Run the 14-day Field Study from the desktop app."* Uploads must return success before raw data is cleared, so a failed upload means no diagnosis yet — retry from the app.

**"I can't sign in / forgot my password."**
Your **email + password** is the same everywhere (web and Observer). Reset it from the web sign-in flow; update it in **Settings → Security** (≥8 characters). After changing it, sign in again on the desktop app. If sessions feel stale, use **"Sign out everywhere"** then sign back in. (source: `login.ts`; `settings/security`.)

**"Windows warns about an unsigned installer."**
Builds are signed (Windows: Azure Trusted Signing; macOS: signed .dmg). If Windows SmartScreen still warns, choose **More info → Run anyway**; on macOS, right-click the app → **Open** the first time. ⚠️ Confirm current signing status before publishing this answer (STATE.md notes signing has been intermittently in flux).

**"How do I uninstall or remove the daemon?"**
Use **"Delete everything"** in the desktop app first (Preferences or any state) to wipe captured data and verify deletion, then uninstall the app normally for your OS (Windows: Add/Remove Programs; macOS: drag to Trash). The Observer runs inside the app, so removing the app removes the watcher. (source: `study.ts`/`preferences.ts` deleteEverythingCard.) ⚠️ Confirm whether uninstall auto-removes a background service.

**"The connector I want isn't available" / "request access."**
Only **Gmail** is connectable today; **Google Calendar and Stripe** show **"Coming soon"** and can't be connected yet. Other tools shown in the Hatch picker aren't connectable now. Also, Google connections are **tester-allowlist-gated** while verification is pending — if you're not on the allowlist you'll need to **request access**. (source: `tester-allowlist.ts`; `connections/providers.ts`.)

**"That Nibbin needs X and Y connected to finish adopting."**
Connect the named tools in **Connections**, then adoption resumes. If the tool shows "Coming soon," wait for that connector to go live.

**"My Nibbin isn't acting on its own."**
Check its action level — if it is set to Draft, every output comes to you for approval. Eggs always observe regardless of action level (it hasn't hatched yet). Check its Agent School grade on **Your Nibbins** to see how accurately it has been working; use **Training mode** to accumulate more graded runs faster. You can raise the action level any time.

---

## SECTION 7 — FAQ

**What is Nibbin, in one line?** A grove of little AI helpers that learn how you work and take routine chores off your plate — you grant what each one may do, and Agent School grades how well it is doing.

**Who is it for?** People who work for themselves — solopreneurs, freelancers, and small creative service businesses (photographers, videographers, designers, and the like).

**Do I have to install anything?** Yes — the desktop app. It's where the Field Study happens and where your Nibbins connect to your tools. The web grove handles approvals, your diagnosis, memory, and settings.

**What does Nibbin actually do?** It privately learns how you work, tells you where your time goes, and grows little agents ("Nibbins") that take routine work off your plate — built from *your* patterns, not generic templates.

**Is it on Mac and Windows?** Both. **Windows screen capture is live now; macOS capture is coming soon.** ⚠️ Confirm macOS timing at launch.

**Does Nibbin record my screen and send it somewhere?** No. Screen capture **never leaves your device.** Only a **redacted summary** can leave, and only when you choose to build your diagnosis — after you've reviewed it.

**Can it capture my passwords or my banking?** No. Passwords and secure fields can't be captured — by construction, never by reading the picture (C4). Banking, health, and other sensitive categories are blocked before anything is saved (C5).

**Does it record audio or use my camera?** Never. Those are permanent exclusions.

**How do I stop capture instantly?** The global pause hotkey — **⌘⇧.** (Mac) / **Ctrl+Shift+.** (Windows) — stops capture near-instantly.

**Lite vs Detailed?** **Lite** (live) captures app/window info and redacted text, **no screenshots.** **Detailed** (coming soon) adds periodic on-device screenshots.

**Field Study vs Quick Scan?** Field Study = a deep **14-day** study for your full diagnosis. Quick Scan = capture/diagnose **one task on demand** (auto-stops ~6 hours).

**How long does the study last?** A full Field Study runs **14 days** and then hard-stops automatically — enforced by the daemon, not the UI.

**What is never captured?** Passwords/secure fields (C4), banking & health sites (C5), audio, and camera.

**What happens to my raw data?** It stays encrypted on your device and is **verifiably deleted after your diagnosis is built** (within 14 days max). An independent verifier confirms it's gone.

**Does Nibbin train its AI on my content?** Never. Nibbin never trains its models on your content — that's a hard guarantee, not a setting. Separately, a **Model improvement** toggle (on by default, opt-out) controls whether Nibbin learns from anonymized, aggregate signals about how its capabilities perform — never your data, never your content, never sold. Turn it off anytime in Data & Privacy.

**What's the Grovekeeper?** Your guide. It chats, writes your diagnosis letter, and keeps things tidy — but it **can never send or change anything.**

**What are the Agent School grades?** **Egg** (observes) → **Student** (drafts for approval) → **Senior** (proven-routine grade) → **Graduate** (in-spec grade). These are accuracy grades, not autonomy unlocks — you set what each Nibbin may do via its action level (Observe/Draft/Act).

**How does a Nibbin's Agent School grade improve?** A Nibbin advances when **≥95% of its drafts are approved without edits over a rolling 25-run window.** Reaching Graduate also needs proven accuracy across **≥4 distinct routine patterns**, with high-stakes actions weighted more. Better grades tell you when it's safe to grant a higher action level — but the grade alone does not unlock execution.

**Can it demote a Nibbin automatically?** No. It may **nudge** you if recent drafts start getting edited, but **demotion is one click and always your call.** Pausing never costs earned progress.

**What are the six Shop Nibbins?** Sweep (inbox tidy list), Echo (follow-up nudges), Brief (morning card), Tally (invoice nudges), Hopper (booking confirmations), Scribe (inquiry replies).

**Can I build my own Nibbin?** Yes — **Hatch Your Own** (pick a chore + apps + name) and, from email workflows in your diagnosis, the **Composer** ("Build a Nibbin for this"). You review every custom Nibbin before it's created, and it still starts as an Egg.

**What's Crystallization?** After supervising a successful one-off Planner run, "Make this recurring" turns it into a permanent scheduled Nibbin — hatching as an Egg and earning autonomy from scratch. (Early access.)

**What's Training mode?** A time-boxed switch that surfaces more drafts for your review so a Nibbin graduates faster — **it grants no autonomy and changes no gate.**

**What tools can I connect?** **Gmail** today. **Google Calendar and Stripe are coming soon.** Other tools shown in the Hatch picker are on the roadmap, not connectable yet. ⚠️ Some connections are tester-allowlist-gated — request access if you're not on the list.

**Are my connections read-only?** Connect requests read + write scopes at consent, with a plain-language explanation. Holding a write scope doesn't authorize action — you set each Nibbin's action level (Observe / Draft / Act) and nothing acts beyond what you've granted. Agent School grades how accurately it's been working so you know when to grant more. Revoke in one click anytime.

**What is Grove Memory?** Your editable business brain — facts, pricing, policies, FAQs, voice, and **hard rules** — shared with all your Nibbins so their drafts sound like you. Edit or clear any of it anytime.

**What's the Gmail "learn my style" sweep?** An optional, **opt-in, off-by-default** one-time read of ~12 months of mail to learn your voice. Sent messages are processed by the model; your inbox is reduced to subjects/previews; only short derived notes are kept.

**Where do notifications go?** "From the grove" (your leaves) in the web app, plus optional channels (Telegram now; SMS/WhatsApp coming soon) and companion emails. You set quiet hours and digest batching — but approval requests always reach you because they're work you asked for.

**What do credits do?** They power runs. If you're out, tasks queue and run when the meter refills; upgrade to raise your Nibbin cap.

**How do I delete my account?** Settings → Account → type your account name → 30-day cancelable countdown; tools disconnect immediately; then permanent.

**What does it cost?** There's a free tier plus paid plans (handled in-app). ⚠️ Confirm current plan names/prices on the live billing page before quoting figures.

**Which tools can I connect, really?** Today: **Gmail** (read + write scopes at connect; voice-learning read optional). **Calendar** and **Stripe** are **coming soon**. Connections are allowlist-gated — request access if you're not a tester. ⚠️ HoneyBook/Instagram/Pixieset/QuickBooks/Outlook/Notion/Drive appear in the Hatch picker and strategy docs but are **NOT connectable** — roadmap only. Confirm against `apps/web/lib/connections/providers.ts`.

**How do write/send permissions work?** Connect requests write scopes at consent with a plain-language explanation. Holding a write scope does not authorize action — you set each Nibbin's action level (Observe / Draft / Act). While a Nibbin is at the Draft level, every side effect is drafted for your approval; at Act, it acts immediately within its spec. Agent School grades how accurately it has been working so you know when to grant more. Revoke anytime in one click.

**What's in Memory?** Facts (what you do, pricing, policies, FAQ), Voice (how you sound), and Hard rules (non-negotiables never broken in a draft). Edit or clear anytime.

**What's the Planner?** A bounded orchestrator (early access) that chains steps across Nibbins to hit a goal — every action still approval-gated.

**How do notifications reach me?** In-app "leaves," study email nudges, and channels — **Telegram (live)**, SMS/WhatsApp (coming soon). Quiet hours and an urgency threshold keep it calm.

**macOS support?** The app runs on Mac (sign-in + Grove), but **native Field Study capture is coming soon** on macOS — Windows capture is live today.

**Why a grove of helpers?** Nibbin's design is that each little agent earns your trust one approved draft at a time, and their stages and report cards make that trust *visible*. (We never call them "creatures" or "bots" in the product — that's internal engine language.)

---

## ADDENDUM — Brand Voice & Crystallization (from brand-voice docs and final research pass)

### Brand voice rules for all help copy (from `brand-voice/SKILL.md`)
- Warm, plainspoken, first person, concrete nouns; celebrate the user's craft.
- **Sentence case everywhere.** Status chips/badges capitalize only the first word ("Waiting on you," "Needs your eyes"). No Title Case in status copy.
- Trust language is always **"earned," "verified," "you approved"** — never "unlocked" or "leveled up."
- Errors say **what happened → what's safe → what to do**, no blame.
- Always call it **"Field Study"** (the optional framing belongs in body copy, never the name).
- **Never:** bot, assistant, automation, "as an AI," creature(s), or corporate filler.
- Confirmation copy for demotion: *"back to drafts — good instinct."* The system never punishes or shames.

### Vocabulary lock (from AGREEMENTS.md)
Must always use: Nibbin(s), grove, hatch, adopt, Agent School, Grovekeeper, Field Notes, diagnosis, Field Study. The agents may be called "helpers." The six Shop Nibbins are: Sweep, Echo, Brief, Tally, Hopper, Scribe.

### Confirmed exact numbers (from source code and specs)
- Full Field Study: **14-day hard stop** (daemon-enforced, INVARIANT C2).
- Quick Scan: **~6-hour backstop**, normally user-stopped.
- Promotion: **95% approved-unedited over a rolling 25-run window**, + **coverage ≥4 patterns** for Senior→Graduate, with stakes weighting (read=1 / normal=3 / delete-or-archive=10).
- Senior→Graduate badges: **First Solo**, **Zero-Miss Month**, **100 Runs**.

### Three corrections applied throughout this document
*(These supersede any earlier draft wording.)*

1. **Privacy / model training (two-part, exact):** "Nibbin never trains its models on your content — ever. That's a hard guarantee, not a setting (there is no toggle because it never happens). Separately, a **Model improvement** toggle controls whether Nibbin learns from anonymized, aggregate signals about how its capabilities and models perform — never your data, never your content, never sold. That toggle is **ON by default (opt-out)**; turn it off anytime in Data & Privacy." Any "off by default" phrasing for the Model improvement toggle has been removed throughout.

2. **Pause hotkey:** Write "stops capture near-instantly" — never publish the literal figure "<100ms" (the measured value was ~250ms; the literal was deliberately removed from user copy).

3. **Secure fields:** "passwords and secure fields can't be captured — by construction, never by reading the picture" (do not claim an OS-flag mechanism; the structural suppression claim is correct, the OS-flags mechanism wording overstates what's confirmed).

---

## Accuracy flags for the editor (resolve before publishing)

1. **Connector list** — Code (`connections/lib/providers.ts`) wires only **Gmail**; Calendar + Stripe = "coming soon." **HoneyBook, Instagram, Pixieset, QuickBooks, Outlook, Notion, Drive/Dropbox** are in strategy docs and the Hatch picker but **not** in the connectable list. Decide how to present them.
2. **Detailed mode & macOS capture** — Both "coming soon" per `field-study.ts` and gate CA-01; confirm wording at ship. (`apps/desktop/src/ui/views/field-study.ts`, `docs/gates/2026-06-18-capture-*.md`)
3. **Growth-stage labels** — Egg/Student/Senior/Graduate used here; confirm exact display labels. (creatures package / promotion code / `runtime/types.ts`)
4. **Training Mode / Reach Me / Composer / Planner / Crystallization status** — All built but gated; labeled Early access / Coming soon. Confirm current go-live flags before calling any "Live." (`docs/STATE.md`, `docs/gates/2026-06-19-*.md`)
5. **Deletion receipt email** — Confirm enabled in this release. (account deletion runner notes)
6. **Retention numbers** — Agent-log retention stated 90 days per `settings/privacy/page.tsx`; confirm still accurate.
7. **Billing/plans** — Hatchling free / Grove $19 / Canopy $49 / $10-per-1,000 top-up from STATE.md test-mode Stripe — verify against live billing page before publishing figures.
8. **Shop Nibbin one-liners** — Verify final marketing copy against `packages/runtime/src/templates.ts` (the descriptions above are verbatim from the file at time of research; confirm no changes at ship).
9. **Windows installer signing** and **subprocessor page** — Both were in flux in STATE.md; verify before publishing the related troubleshooting/privacy answers.
10. **Semantic memory (`VOYAGE_API_KEY`)** — Without this server key, agent memory falls back to text/recency matching. Confirm key is set in production or flag the fallback behavior accurately.

---

### Key source files
- Process docs: `C:/nib-help/docs/STATE.md`, `AGREEMENTS.md`, `INVARIANTS.md`, `RISKS.md`, `SPEC.md`, `PRODUCT-FOUNDATION.md`, `MOAT.md`, `docs/security/2026-06-17-data-privacy.md`
- Brand voice: `C:/nib-help/docs/brand-voice/SKILL.md`
- Shop Nibbins: `C:/nib-help/packages/runtime/src/templates.ts`
- Trust/stages/promotion: `C:/nib-help/packages/runtime/src/school.ts`, `runtime/types.ts`, `apps/web/lib/runtime/drift.ts`, `docs/superpowers/specs/2026-06-18-promotion-rubric-design.md`
- Desktop Field Study: `C:/nib-help/apps/desktop/src/ui/views/{consent,field-study,study,review,notes,packet-review,preferences,login}.ts`, `core/study-machine.ts`, `daemon-sim/daemon.ts`
- Web pages: `C:/nib-help/apps/web/app/app/{page,diagnosis,hatch,memory,shop,connections,notifications,nibbins}/...`, `settings/{profile,security,account,privacy}/page.tsx`
- Connections: `C:/nib-help/apps/web/lib/connections/{providers,grants,begin,complete,tester-allowlist}.ts`
- Capabilities/Composer/Planner/Crystallization: `C:/nib-help/packages/runtime/src/{capabilities,validate,interpreter,planner,training}.ts`, `docs/superpowers/specs/{composer-slice2a,2b,2c,planner-slice3a,crystallization-slice4}-design.md`
- Memory: `C:/nib-help/apps/web/lib/memory/extract.ts`, `write.ts`, `apps/web/app/app/memory/page.tsx`
- Channels/Reach-Me: `docs/superpowers/specs/*reach-me*.md`, `docs/superpowers/specs/*trust-and-controls*.md`
