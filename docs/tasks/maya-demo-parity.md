# Maya-demo parity — feature backlog

The landing page's interactive **"Maya's grove" demo** (`apps/web/app/(marketing)/MayaDemo.tsx`)
portrays an aspirational 5-tab product dashboard. Several of its elements are **not yet built**
in the real authenticated app (`apps/web/app/app`). This doc inventories real-vs-aspirational and
groups the gaps so they can be tracked against milestones rather than living only in the demo.

Captured 2026-06-15 (after the desktop unified-app work).

> **STATUS UPDATE 2026-06-15 — most of this is now BUILT** (on `feature/nibbin-desktop-unified-app`,
> unmerged). **Group A** (time-saved metric, visual workflow map, automatable %, friction, chipline) —
> shipped via the richer-diagnosis backend + the Group-A reveal (`DiagnosisReveal` + `WorkflowMap.tsx`).
> **Group B** (Your Nibbins roster, Agent School ladder, streaks/badges) — shipped at `/app/nibbins`
> over real `runs`/`approvals` data (streaks/badges derived, not fabricated; the "what it learned about
> you" narrative is omitted — no data source). **Group C** (Hatch Your Own builder) — shipped at
> `/app/hatch` (custom-named egg via the real adoption path). **Group D** (rich Today feed) — shipped at
> `/app` (time-saved chipline [estimated, marked `~`], draft cards, "Done while you were working",
> "Coming up"). Remaining demo flourishes not yet built are noted inline below where they lack a data
> source (esp. the per-agent "learned about you" narrative, which needs an Opus pass).

## Built (demo ≈ reality)
- **Agent Shop** — `/app/shop`, adoptable ready-made Nibbins. ✅
- **Diagnosis** — `/app/diagnosis`: lists workflows with `~Xh/week` + a total + the Grovekeeper
  letter. ✅ but **basic** (see Group A for what's missing vs. the demo's "Your Map").
- **Today / Grove Home** — `/app`: "waiting on you," recent activity, credits/active counts. ✅ bare.
- **Agent School staging** (egg → student → senior → graduate) exists in the data model.

## Gaps — grouped

### Group A — Diagnosis synthesis ("Your Map" tab) — overlaps M7
M7 is already framed in STATE.md as "synthesis packet pipeline + diagnosis synthesis + Day-14
reveal," which is exactly this story. Real Diagnosis is a flat list today; the demo shows:
- **Time saved** metrics — "1h 12m today · 6.4 hrs this week." **Zero implementation** (`time saved`
  = 0 files). Likely the single most motivating number; doesn't exist.
- **Visual workflow map** — interactive SVG node graph: bubbles sized by hours/week, connected,
  color-coded by automatability, with a friction hotspot. Real app has no map (just a list).
- **Automatable %** per workflow + the auto-bar (`automatable` = 0 files).
- **Friction analysis** per workflow ("what the study found") + **"biggest friction"** hotspot.
- The map chipline: study window, **desktop work observed** (hrs/wk), **automatable hrs/wk**.

### Group B — "Your Nibbins" roster (agents tab) — its own feature
No dedicated agents-roster view exists. The demo shows, per agent:
- **Agent School ladder** progress visual (egg/student/senior/graduate rungs).
- **"What it learned about you"** (`what…learned about you` = 0 files).
- **Streaks** (`streak` = 0 files) and **badges** (First Solo, Zero-Miss Month, 100 Runs…).
- **Draft-only-until-graduation** access state; per-agent **run log / match-% metrics**.

### Group C — "Hatch Your Own" builder — its own feature
No build-your-own-agent flow exists. The demo's 3-step wizard:
- Step 1: pick the chore (plain-language cards). Step 2: pick the apps involved. Step 3: name it +
  enroll as an egg in Agent School (watch-only → drafts in a few days).

### Group D — Rich "Today" approval feed
Grove Home's "waiting on you" is much thinner than the demo's Today tab:
- Draft cards with the agent **creature + "Approve & send / Edit first"** inline actions.
- **"Done while you were working"** activity feed (with per-item time saved).
- **"Coming up"** (what each agent will do next).

## Suggested sequencing (proposal, not committed)
- **A** lands with **M7** (it IS the diagnosis-synthesis reveal). Highest narrative payoff.
- **B** and **D** make the day-to-day feel alive; **D** is the smallest and a good early win.
- **C** (builder) is the most net-new surface; sequence after the roster (B) so "hatched" agents
  have somewhere to live.
