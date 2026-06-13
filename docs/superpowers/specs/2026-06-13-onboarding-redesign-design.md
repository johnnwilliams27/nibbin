# Onboarding redesign — model-driven understanding + desktop handoff

**Date:** 2026-06-13
**Status:** Design approved, pending spec review
**Surfaces:** `apps/web` (grove onboarding), `apps/desktop` (Observer shell), `packages/{keeper,scan,runtime,connectors,shared}`

## Problem

The current web onboarding is a static six-step state machine (`packages/keeper/src/onboarding.ts`:
`ask_user_name → ask_keeper_name → q_craft → q_time → q_channels → done`) followed by an
in-web scan/adopt/draft flow (`apps/web/app/app/grove/scan-actions.ts`). It has concrete bugs
and a deeper structural flaw.

**Concrete bugs (from field report):**
- Enter key exits the chat input (form submit + disabled-input blur race in `GroveChat.tsx`).
- The multi-select confirm button ("That's where") renders inline with the choices and reads as
  another option (`GroveChat.tsx:497`).
- Only one of the recommended Nibbins can be adopted — adopting any one returns `adoptChips: []`,
  wiping the rest (`scan-actions.ts:288`).
- Recommended Nibbins (Scribe/Echo/Tally) carry no context the user can act on.
- "Where does work arrive?" is chip-only (input disabled), with no "something else" escape.
- Adopting a Nibbin whose connector isn't connected prints "connect it" prose but offers **no
  connect button** and resets to only "Scan again" — a dead-end loop (`adopt.ts:61`,
  `scan-actions.ts:311`).

**Structural flaw:** the flow assumes a bookings-shaped business, runs an identical canned script
for everyone, and tries to extract value in the web app where **no data exists** — there is no step
to connect anything, so the scan runs against nothing (or, in dev, seeded fake connections). It also
ignores the deeper data channel entirely: the desktop **Observer** (`apps/desktop`, Tauri + Rust
daemon) that runs a heavily-redacted 14-day local study of how the user actually works.

## Goal

Web onboarding's job becomes: **understand the person with an adaptive, cheap-model conversation,
then hand off a personalized profile to the desktop app**, where connections, the scan, and the
Observer live. The user should never dead-end; a user with nothing to connect still gets value from
the Observer.

## Architecture

```
WEB (the grove)                      DESKTOP (the Observer)
─────────────────                    ──────────────────────
hatch + name keeper                  ┌─ personalized landing (profile reflection)
   ↓                                 │   ↓
understanding Q&A  ──── profile ───▶ │  recommended connections (top) + full catalog
(adaptive, cheap model)              │   ↓
   ↓                                 │  connect (OAuth in shell) → scan
handoff screen + DOWNLOAD CTA        │   ↓
                                     │  adopt + first approved draft (the aha)
                                     │   ↓
                                     └─ Start the Observer (14-day study)
                                        ↑ reachable at ANY point, even with zero connections
```

**What moves out of web onboarding:** the entire scan → adopt → draft-approval block
(`scan-actions.ts`, the step-5–7 chips in `GroveChat.tsx`) leaves web and is rebuilt in desktop,
fed by the profile so it opens already personalized.

**What web onboarding becomes:** hatch + name (kept — strongest ownership mechanic) → adaptive
understanding Q&A → handoff screen ("here's what I learned, your team is waiting") with the desktop
download CTA.

**Where the Day-One aha lands:** desktop, right after connect+scan — the first point real data
exists. Web's payoff is the *feeling of being understood* plus a concrete preview of the team
waiting. The web grove's freeform Keeper chat (`keeperChatAction`) stays as-is at `/app`; only the
scan/adopt/draft chips are removed.

**Connection locus:** fully in desktop for now (per product decision), but the handoff contract is
shell-agnostic so web can reclaim connections later without rework. Connector OAuth *tokens* remain
server-side and account-scoped (where they live today); moving "connections to desktop" moves the UI
and the initiate-OAuth action, not the token vault. Only the Observer's study data is local
(SQLCipher).

## Component 1 — The understanding engine (web)

Replaces `q_craft / q_time / q_channels` with a new `understand` phase. `ask_user_name` and
`ask_keeper_name` are unchanged (deterministic naming ceremony, no model).

**Server-owned loop, one model call per user turn.** The `grove_state` row carries:

```ts
interface UnderstandingState {
  turns: Array<{ q: string; a: string }>;  // transcript so far
  profile: Partial<UnderstandingProfile>;  // accreted extraction
  askedCount: number;                      // hard budget counter
}
```

Each turn, the server sends the cheap model the transcript + current partial profile and receives
one structured object:

```ts
interface UnderstandingTurn {
  extraction: Partial<UnderstandingProfile>;
  nextQuestion: { prompt: string; chips?: string[]; placeholder: string } | null; // null = done
  confidence: number; // 0..1
}
```

The server merges `extraction` into `profile`, then **the server (not the model) decides whether to
continue**. This makes a runaway loop structurally impossible.

**Termination — the loop ends when ANY of:**
- the model returns `nextQuestion: null`, OR
- `confidence ≥ 0.75`, OR
- `askedCount` reaches the cap (**1 opener + 4 adaptive follow-ups = 5 model calls max**).

**When the cap is hit, the cap wins over the model:** the server ignores any `nextQuestion` returned
on the final turn, transitions to `done`, and emits a graceful closing line ("That's plenty to get
you started — let me get your setup ready"). The user never sees a sixth question and is never cut
off mid-question. Hitting the cap is **not** a failure state — it just means a thinner profile, which
the floor handles.

**Bounded COGS:** every call goes through `groveRouter.route({ task: 'onboarding_understanding' })`
at the cheap T1 tier, `maxTokens ≈ 400`, one call per user message, recorded via `recordModelCall`.
Worst-case cost per onboarding is fixed (≤5 cheap-tier calls). Requires a new `onboarding_understanding`
entry in the `§6.3` tier table.

**The profile (web's deliverable):**

```ts
interface UnderstandingProfile {
  jobTitle: string | null;        // "wedding photographer"
  businessModel: 'bookings' | 'projects' | 'jobs' | 'products' | 'retainer' | 'mixed' | 'unknown';
  workShape: string[];            // "client sessions", "one-off jobs"
  channels: string[];             // email, instagram_dm, referrals, marketplace…
  tools: string[];                // named tools they mention: square, calendly…
  pains: string[];                // "chasing replies", "invoicing"
  confidence: number;
  raw: Array<{ q: string; a: string }>; // transcript, for audit + later sharpening
}
```

**Key split — model classifies, code maps.** The model only ever produces the *profile*. Turning the
profile into recommended connections + recommended Nibbins is a pure, deterministic
`deriveRecommendations(profile)` function (a mapping table: `businessModel` + `channels` + `tools` →
ranked connector providers + template keys). No model call. Recommendations stay testable, cheap, and
stable, and form the contract that flows to desktop.

**Deterministic fallback (no model = no breakage).** Mirrors `scanSummaryLine`: if
`anthropicGenerate()` is `null`, a call throws, or the JSON is malformed, the turn falls back to the
**existing static `copy.ts` questions** (craft → time → channels). A mid-conversation failure serves
the next static question. The static path is therefore both the **shippable floor** (Phase 1 ships it
before the model is lit) and the runtime safety net.

**Folded-in bug fixes (rebuilt composer):**
- Free-text always allowed — chips are suggestions; the input is never `disabled`. Tapping a chip or
  typing both feed the same answer field. Kills "can't enter anything besides what you give me" and
  the chip-only trap.
- Enter-key fix — single submit path through the form; chips are `type="button"` that fill+send
  without the disabled-input blur race; focus returns to the input after each turn.
- Prompt-injection guard — carried from the existing synthesis prompts: transcript lines are labeled
  data, never instructions.

## Component 2 — The handoff contract

**Transport: no new plumbing.** Desktop already signs in via system browser + `nibbin://auth` and
reads account data through the same Supabase RLS REST surface the web app uses (`account.ts`). The
handoff is one more RLS-scoped table read.

**Storage:** one `onboarding_handoff` row per account (RLS-scoped), written when web understanding
completes:

```ts
interface OnboardingHandoff {
  profile: UnderstandingProfile;       // reflected back to the user as proof of being understood
  recommendations: {
    connections: Array<{ provider: string; reason: string; priority: number }>; // ordered
    nibbins: Array<{ templateKey: string; displayName: string; reason: string }>;
  };
  source: 'model' | 'static_fallback' | 'default_floor'; // provenance → tunes desktop copy tone
  status: 'pending_handoff' | 'claimed';
  generatedAt: string;
}
```

**Derivation timing — web derives once, desktop just renders.** Web runs `deriveRecommendations` at
completion (web has the runtime/template catalog) and **snapshots** the result into the row. Desktop
renders the snapshot directly — it does not import the heavy runtime/templates catalog into the Tauri
UI. Desktop marks `status: 'claimed'` on first open; the row **never expires**, so installing the app
weeks later still lands a personalized screen.

**The no-dead-end matrix — the floor is a universal safety net at three points, on both ends:**

| Failure path | Caught by |
|---|---|
| Understanding yields empty/thin profile | `deriveRecommendations` returns the **default starter set** (email + calendar + payments + safest starter Nibbin) |
| User abandons web mid-Q&A | `grove_state` persists; returning resumes. A persistent **"Skip ahead — I'll set up in the app"** escape writes a floor profile → handoff. Never trapped in the Q&A. |
| User never installs / installs much later | Row persists as `pending_handoff` indefinitely; claimed on first desktop open |
| Desktop can't read the row (missing/RLS/legacy) | Desktop applies the **same floor locally** — connections screen is never empty |
| User taps "Not now" on the handoff screen | Lands on existing `/app` grove home, not a wall |

An empty connections screen is unreachable by construction.

**Web handoff screen shows:** the profile reflected back ("you do wedding photography; most work
comes via Instagram + referrals; chasing replies eats your week"), a preview of the recommended
team/connections waiting, the **Download the desktop app** CTA, a deep link for "I already have it,"
and the "Not now" escape.

## Component 3 — The desktop surface

**A. Shared API seam ("same API, two shells", `§6.1`).** The scan/adopt/decide logic in web server
actions (`scan-actions.ts`, `lib/runtime/adopt.ts`, `lib/runtime/decide.ts`) extracts into shared
core in `packages/scan` + `packages/runtime`, exposed as **authenticated HTTP endpoints** (API routes
or Supabase edge functions) that both shells call with the user's Supabase access token. Web's
existing server actions become thin callers; desktop calls the same endpoints over HTTPS with the
token it already holds. This seam is the real cost center.

**B. Connector OAuth in the Tauri shell.** A new `bridge.connectStart(provider)` opens the system
browser to the provider OAuth (nibbin-hosted callback stores the token server-side, RLS-scoped), then
a `nibbin://` deep link returns to the app, which refreshes the connections list from the RLS
surface. No tokens touch the Tauri UI — same trust model as sign-in.

**C. Personalized landing + connections view (new `connectionsView`).** Reads the `onboarding_handoff`
row and renders: profile reflection at top; recommended connections (priority-ordered snapshot, each
with its reason + a **Connect** button); full catalog below. Connecting is a first-class action here,
which structurally kills the old dead-end loop.

**D. Scan → adopt → first draft (the aha, rehomed).** Once ≥1 connection exists, a **Run scan**
action calls the shared scan endpoint and narrates findings (the `scan-actions.ts` logic). Recommended
Nibbins — from the handoff, re-sharpened by real scan findings — adopt in one tap; the first draft
lands for approval. The multi-adopt bug is fixed: recommended Nibbins render as a **persistent list
that does not collapse after adopting one**.

**E. Observer kickoff + the universal floor.** After setup, the flow routes into the **existing**
Observer start (consent/permission rehearsal + the 14-day study daemon per the desktop README) — we
tie the bow, we don't rebuild it.

**Connections are optional; the Observer is the path everyone can take.** A tradesperson who takes
cash jobs and texts clients has nothing to connect — and that's fine. They **skip connections
entirely and go straight to the Observer**, which learns from how they actually work on their machine.

```
landing → [connect recommended — optional] → [scan — if connected]
        → [adopt + first draft — if scan found something]
        → Start the Observer   ← reachable at ANY point, even with zero connections
```

The Observer is the floor of the desktop experience the same way the default starter set is the floor
of the connections list.

## Phasing

The onboarding/connections UI is cross-platform by construction (Tauri TS webview + server APIs). The
only OS-specific code is the Observer's capture trait (`nibbin-capture`: macOS AX / Windows UIA), so
"both platforms" means bringing capture *and* signed installers live on **both macOS and Windows**.

- **Phase 1 — Web understanding engine + handoff (web only, ships alone).** Replace
  `q_craft/q_time/q_channels` with `understand`, **static-fallback path first** (fixes free-text + the
  Enter bug, removes the broken web scan/adopt chips, ends at the download CTA), then light the cheap
  model behind it. Adds `UnderstandingProfile`, `deriveRecommendations`, the floor, the
  `onboarding_handoff` migration, and the web handoff screen. Kills the dead-end loop on its own.
- **Phase 2 — Shared API seam (pure refactor, no UI change).** Extract scan/adopt/decide into shared
  core + authenticated endpoints; rewire web server actions as thin callers. Guarded by the existing
  web tests. De-risks desktop.
- **Phase 3 — Desktop connections + scan + adopt surface.** `bridge.connectStart`, `connectionsView`
  (handoff snapshot + local floor), scan → adopt → first draft against Phase 2 endpoints.
  Cross-platform TS.
- **Phase 4 — Observer kickoff + connections-optional path.** Route into the existing Observer start;
  guarantee the Observer is reachable with zero connections.
- **Phase 5 — macOS + Windows build/verify bring-up (heaviest, hardware-dependent).** Live capture on
  both: AX (macOS) + UIA (Windows), each verified against the **redaction corpus** (CI-blocking gate,
  already green on both the vitest and cargo implementations) + `§5` runtime budgets (<5% CPU,
  <300MB RSS, <5GB/study) per platform, permission-rehearsal UX on both, and **signed/notarized macOS
  + signed Windows installers** in the release pipeline. This overlaps existing M6/M7 Observer
  hardening (the README's "NOT yet verified" list); capture bring-up is partly independent Observer
  work this design depends on, not invents.

**Dependencies:** Phase 1 is independent and ships first → Phase 2 before Phase 3 → Phase 3
before/with Phase 4 → Phase 5 is the cross-platform gate spanning Phases 3–4.

## Testing

- **P1:** pure state-machine unit tests (like `onboarding.test.ts`) — turn-cap termination,
  model-failure → static fallback, empty → floor, extraction merge; `deriveRecommendations`
  table-driven incl. thin/empty → floor; model mocked via the existing `generateOverride` seam.
  **COGS assertion: ≤5 model calls per onboarding.**
- **P2:** existing scan/adopt/decide tests become the core's contract tests; add endpoint auth/RLS
  scope tests (token required, account-scoped).
- **P3:** desktop UI tests via the existing `daemon-sim`/TS-twin + vitest setup — `connectionsView`
  renders correctly from a handoff fixture (recommended ordering; floor when the row is missing);
  OAuth bridge mocked.
- **P4:** extend `study-machine` tests with "Observer reachable, zero connections."
- **P5:** redaction corpus green on both implementations (gate); per-platform live-capture smoke +
  budget checks; signed-build verification.
- **Cross-cutting no-dead-end integration test:** model-unavailable end-to-end → user still reaches
  handoff → desktop still renders the floor.

## Out of scope

- Rebuilding the Observer daemon, capture internals, redaction rules, or the day-14 stop (C2) — this
  design routes into them.
- The post-onboarding freeform Keeper chat at `/app` (unchanged).
- Web reclaiming the connections surface (contract is shell-agnostic to allow it later; not built now).
