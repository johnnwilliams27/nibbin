# MOAT.md — Nibbin competitive framing v1.0

Canonical reference for positioning, competitive advantage, moat mechanics, and targets.
Future sessions: this document governs how Nibbin describes itself against competitors and
where differentiation investment goes. Changes require a decision-log entry. Sources: two
full competitive research passes + horizontal-gravity analysis (June 2026), gate-validated
architecture. Companion docs: GTM.md (execution), PRODUCT-FOUNDATION.md (build/refuse),
SPEC.md (the mechanics this document claims).

---

## 1. The one-paragraph frame

Nibbin sells **earned trust in a vertical**, not intelligence. Models are rented, frozen,
and swapped behind an eval gate; what accumulates — and what nobody can cold-start — is
per-user state: a graded trust ledger, an observation-based diagnosis, Grove Memory, and
weeks of approve/edit/reject history that both improves drafts and unlocks autonomy.
Frontier models improving makes Nibbin smarter and cheaper; we are a buyer of model
progress, not a casualty of it.

**One-liner:** "Models are the engine; we own the relationship, the vertical rails, and
the earned-trust history — none of which ship in an API."

## 2. The moat, mechanically (the three learning layers)

An agent product can learn at three layers. Naming them precisely is what makes the moat
claim survive diligence:

| Layer | What it means | Who does it | Nibbin |
|---|---|---|---|
| **Weights** | Train/fine-tune the model itself | Enterprise fine-tuning platforms; per-company, never per-individual (cost, privacy, lock-in) | **Never.** Model is rented + eval-gate swappable. Weight-personalization would anchor us to a model version; state-personalization rides every upgrade |
| **Context** | What the model is shown: memory, exemplars, voice, rules | Commodity — ChatGPT/Claude memory, Read "Ada," Sintra Brain, Lindy KBs | Yes: Grove Memory + edit/rejection signals + approved-draft exemplars. Necessary, NOT differentiating — never claim uniqueness here |
| **Permissions** | What the system lets the agent do, as a function of verified performance | **Found nowhere in consumer/prosumer market** (two full passes) | **The moat.** Agent School: per-action-type accuracy graded against the user's own decisions gates autonomy (Student→Senior at 95%/25), visible on report cards, reversible on regression. Deterministic system logic — auditable, no ML |

Vocabulary law: **never say "per-user reinforcement learning."** Say: *"We don't train
models per user; we train agents — their context, exemplars, and earned permissions. Human
feedback shapes behavior the way RLHF does, but at the system layer, not the weights — so
every model upgrade makes every user's agents smarter overnight."*

Uniqueness law: claim **"to our knowledge, no one ships owner-set action levels with graded-accuracy school reports per agent"** —
never "nobody is doing this." Same punch, survives the counterexample an associate finds.

## 3. The trust taxonomy (how everyone else handles it — all static)

| Model | Who | Failure mode |
|---|---|---|
| Scoped sandboxes (folder/connector grants) | Claude Cowork, Claude Code | Trust is spatial + set once; day-200 agent has day-1 standing |
| Per-action confirmation, forever | Operator-class browsers, Claude in Chrome | Confirmation fatigue → rubber-stamping; approvals are discarded, earn nothing |
| Trust by incapability (drafting only) | Sintra, Moxie, Bonsai-class | Nothing acts; nothing works while you sleep |
| Doctrinal copilot (public no-autonomy promise) | HoneyBook | Trust as marketing posture; reversing = brand repositioning |
| Admin governance / guardrails, full autonomy day one | Sierra, Decagon, Notch, Cowork enterprise, front-desk bots | Trust encodes role or hope, not performance; competence improves, standing never does |

**The line: everyone has an approval step; only Nibbin metabolizes it.** A Student's
required approvals aren't friction — they're the training data that retires them. Cowork's
confirmation prompt is a tollbooth; ours is a grade.

## 4. Competitive map (who owns which axis; none own the intersection)

Nibbin's intersection: **trust-staged autonomy × observation diagnosis × creature
legibility × creative-freelancer vertical depth.** Window estimate: 9–12 months (revised
down June 2026).

| Threat class | Players | Their axis | Our exploit |
|---|---|---|---|
| Personality consumer "AI employees" | Sintra ($97–197/mo, TikTok GTM, named helpers) | Brand + consumer reach | Drafting-only; no autonomy, trust system, or verticals. Line: "drafts that send themselves — after they've earned it" |
| Vertical incumbents + assistive AI | HoneyBook (photo), GlossGenius (beauty, 100K+), EngineEars (audio), Bonsai/Moxie (suites — Bonsai has NO AI as of 4/2026) | Distribution | Doctrinally/structurally copilot; connect TO them (ride rails), out-position on autonomy. Agentic, whole-loop automation unclaimed by every incumbent suite |
| Front-desk bots | Studioflo "Athena" ($138–197/mo solo), Inky, AI SmartTalk, Telegate | Inbound-DM slice, vertical | Single-channel, full-autonomy-by-hope, no loop. Line: "Receptionist bots book the job. Nibbins run the business." Their pricing validates our premium tiers |
| Horizontal gravity | Claude Cowork (GA, scheduled tasks, connectors), OpenAI screen control, Read "Ada" | Generic task execution | Enterprise vector (admin, FactSet, DocuSign) — moving AWAY from our ICP. Static scope-grant trust. Blank-canvas problem: their user needs delegation literacy; ours needs to say yes. NOTE: Anthropic is supplier AND gravity — no public comparison fights with the model vendor; FAQ-only handling |
| Enterprise agent trainers | Sierra ($15.8B, 40% of F50, $150M ARR), Decagon ($4.5B), Notch | Account-level agent training, team-supervised | **Category validation, not competition**: they prove trained agents are worth ~$20B combined — at the account level with CX teams supervising. The individual, zero-effort, autonomy-earning version is unbuilt. "Decagon for a Fortune 500's ticket queue; Nibbin for the photographer who IS the company" |
| Observer lane | Screenpipe (productized, $400 lifetime, relicensed MIT→commercial) | Local capture tech | Developer audience; no bounded study, diagnosis, trust staging, or verticals. Validates our architecture; we're pinned pre-relicense |

## 5. Why each moat layer compounds (defensibility tests)

1. **Trust ledger** — weeks of graded per-action history per user. Cold-start-proof: a
   competitor can copy the approval UI in a sprint; they cannot copy six weeks of a user's
   graded decisions, and the autonomy is MADE of that history. Even we couldn't migrate it
   competitively.
2. **Diagnosis** — the 14-day local-first study answers "what should I even delegate?"
   Solves the blank-canvas problem every horizontal agent has; doubles as the share-card
   growth loop.
3. **Grove Memory + exemplars** — switching costs that grow with use; quality multiplier
   across all agents at once.
4. **Vertical rails** — connector packs (HoneyBook, Pixieset, IG DMs, QuickBooks, Square,
   Frame.io next) + the Observer for portal-grinders that have no APIs. Horizontal players
   will never prioritize these; incumbents won't grant autonomy over them.
5. **The referral graph** — wedding-vendor cross-referrals make existing users the
   distribution into adjacent verticals (photo → video → planning → beauty → music).
6. **Legibility brand** — creatures + report cards make trust visible to non-technical
   owners; beige competitors structurally can't follow without becoming us.
7. **Model-agnostic by construction** — eval-gated swaps mean the moat survives model
   churn; every frontier improvement accrues to us at lower COGS.

## 6. Targets

**Category line:** "AI Agents. Simplified." (SEO/meta/PH/eyebrow) — deliberately
audience-agnostic; the public label names *what* we do, not *who* it's for. Human copy:
"people who work for themselves." (Founder decision 2026-06-15: widened the public label
from "AI agents for freelancers" so the copy no longer prescribes the target audience —
entrepreneurs and solo owners beyond freelancers self-ID. The wedge sequence below still
governs *who we serve first*; only the public label changed, not the targeting.)

**ICP filter (every vertical must pass):** solo or ≤2 people; client-services revenue loop
(inquiry→quote→deposit→schedule→deliver→revise→invoice→review); ≥5 hrs/week admin; lives in
email/IG/portals; dense communities with educator trust graphs; no regulated data.

**Wedge sequence (GTM.md §1.5 governs):** A1 photographers → A2 videographers/RE media →
A3 tattoo artists (inbound slice contested; whole-loop open) → A4 designers/illustrators →
B-tier (colorists, producers/engineers [Observer-fit], VO, bridal beauty) → C via referral
graph. Avoid: regulated-data verticals, retainer copywriters.

**Customer:** $0/$19/$49; consumer motion; mobile-first approvals; TTFAD <10 min as the
contractual promise and measured SLO.

## 7. What we refuse to build (PRODUCT-FOUNDATION.md §4 governs)

No workflow-canvas builder (concedes the thesis — the Keeper conversation IS the builder).
No client portal (incumbents' fortified ground; working through the user's tools is the
moat). No native payments yet (decision-logged founder-wheelhouse expansion; revisit
post-PMF ≥1K paying accounts). No voice yet. No template marketplace pre-M8 security
maturity. No team seats beyond a future read-only bookkeeper guest.

## 8. Soundbites (use verbatim)

- **Moat (30s):** "Anthropic sells intelligence; we sell trust in a vertical. Their vector
  is enterprise knowledge work; ours is a photographer's revenue loop through connectors a
  horizontal player will never prioritize. The core mechanic isn't a copyable feature: our
  agents build an accuracy grade over weeks of a user's real decisions, and the owner sets
  what each may do. That trust ledger plus the diagnosis compounds per user and can't be cold-started by anyone —
  including us, twice. Better models make our staff smarter and our margins better."
- **One-liner:** "Models are the engine; we own the relationship, the vertical rails, and
  the earned-trust history — none of which ship in an API."
- **Trust:** "Everyone has an approval step; only we metabolize it."
- **vs Cowork:** "Cowork is a brilliant assistant you direct each day; Nibbins are staff
  who've earned the right to run the shop while you shoot."
- **vs enterprise trainers:** "Decagon trains an agent on a company's ticket history with a
  CX team supervising. We train a grove on one freelancer's decisions with nobody
  supervising but them — and the output isn't just better drafts, it's earned permission."
- **Training precision:** "We don't train models per user; we train agents."

## 9. Standing rules

- Never market in "generic AI agent" territory — that contests Cowork/ChatGPT ground.
- Never pick public fights with the model supplier; FAQ-grade handling only.
- Memory/context personalization is table stakes — claim the permission layer, carefully.
- Re-run the competitive scan at each phase gate; this doc's map carries a June 2026 date.
