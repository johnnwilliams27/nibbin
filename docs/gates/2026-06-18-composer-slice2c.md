# Adversarial Gate Report — Composer Slice 2c (digest/summarize shape)

**Date:** 2026-06-18
**Branch:** `feat/composer-slice2c`
**Surface:** sensitive (`packages/runtime` + composer path). Populates the synthesis mechanism with 2 PRESENTATION (read-only) primitives — the lowest-stakes slice yet. **No migration.**
**Spec:** `docs/superpowers/specs/2026-06-18-composer-slice2c-design.md` · **Plan:** `docs/superpowers/plans/2026-06-18-composer-slice2c.md`
**Reviewers (4 lenses):** red-team · logic-skeptic · claims-auditor · cost-auditor
**Verdict: PASS** — no P0/P1 from any reviewer (the cleanest slice of the arc). The P2/P3 test-hardening + one structural invariant were fixed in-branch.

## What 2c adds (and completes)
The second structural shape — **summarize/digest** (read → present, no side effect) — parity-extracted from the two remaining templates:
- `digest.inbox-cleanup` (from `sweep`) — gmail mailbox sweep → top-N "keep or clear" digest, param `topSenders` (default 5). effectiveTools `['email.read']`.
- `digest.morning` (from `brief`) — **3-connector** (gcal + stripe + gmail) → one 3-part morning digest, empty inputSchema. effectiveTools `['calendar.read','payments.read','email.read']`.

Both yield a `draft` step with capability `email.read` + `presentation:true`; the runner gates a presentation step as `{action:'draft'}` ALWAYS, never executes (`runner.ts:249`) — so digests are read-only by construction. **With 2c, all 6 shipping templates have composable primitive equivalents — the synthesis loop fully mirrors the template library.**

## Security thesis (re-verified, no new mechanism)
LLM picks only a primitive id + scalar params (`topSenders` 1..20, bounded at adopt- and run-time); trusted code builds all read paths; the 3-connector requirement is derived server-side from `effectiveTools` (2b machinery) and the menu hides `digest.morning` unless all 3 are granted; `validateComposedSpec` fail-closed re-checks `requiredConnectors ⊆ accountConnections`; polite-pause checks all connectors inside the generator. Defense-in-depth: the effects executor has no case for read capabilities, so even a hypothetical executing read step throws rather than acting.

## Findings & dispositions
| # | Lens | Sev | Finding | Fix |
|---|------|-----|---------|-----|
| 1 | claims-auditor | P2 | **Senior-stage "never executes" test passed vacuously** — it seeded 0 routine approvals, so the School gate drafted via novelty regardless; it would pass even if `presentation` were ignored. | Test now seeds `routineApprovals = routineMinApprovals` (5) for the patternKey + grants `email.read` on a grad/senior nibbin, so the gate would otherwise return `execute` — the draft now PASSES ONLY because of `presentation:true`. Confirmed it bites (flipping `presentation→false` fails it). |
| 2 | claims-auditor | P2 | **Sweep parity fixture (2 senders) couldn't catch a `topSenders` default drift** (`slice(0,5)`≡`slice(0,3)`). | Expanded the parity fixture to 7 distinct unsubscribe senders. Confirmed it bites (delegating `topSenders:3` fails the sweep parity case). |
| 3 | red-team + claims-auditor | P3 | **read↔presentation coupling was conventional, not structural** — nothing forced a `sideEffect:'read'` primitive's impl to actually yield `presentation:true`. | Interpreter's primitive branch now throws `read-capability primitive '<id>' yielded a non-presentation side effect` if a read-primitive yields a non-presentation draft → run fails cleanly. No-op for the shipped digests; unit-tested (mock read-primitive rejected; presentation one allowed). |

### Verified clean (not findings)
- **Cost-auditor: PASS** — read-only, ≤83 steps under the 120 ceiling (digest.morning = 3 reads, no per-item fetch), ZERO model COGS at runtime (digests are pure template text — no compose prompt), single presentation draft (no fan-out), no new entry point, inherited ceilings/triggers.
- **Logic-skeptic: PASS** — parity hand-verified line-by-line for both digests (path builders reproduce brief's queries byte-for-byte; read order gcal→stripe→gmail matches; empty/list digest bodies identical); both conformance-test refinements still catch wrong descriptors / orphan capabilities with anti-vacuous guards intact.
- **Red-team: could not break it** — presentation can't be flipped by the LLM (impl hardcodes it; interpreter forwards untouched); 3-connector derivation server-side; wrong-connection reads impossible; params bounded; empty inputSchema rejects extra keys.

### Conformance-test refinements (audited, sound)
Because `programs.ts` now delegates (yields nothing inline): (1) the "read descriptors have no `patternKeyPrefix`" invariant was relaxed to exempt `kind:'primitive'` reads (the digests legitimately yield a presentation draft with a routine patternKey) — atomic reads still strictly checked; (2) the orphan-capability scan now covers the primitive files (where the yields moved) — still fails on an orphan, anti-vacuous guard intact. Both verified by the claims-auditor (mutation-probed).

## Verification (post-fix)
- `npx tsc --noEmit -p packages/runtime` → exit 0
- `npx tsc --noEmit -p apps/web` → exit 0
- `npx vitest run packages/runtime/test apps/web/` → **435 passed (56 files)**
- `npx eslint packages/runtime/src apps/web/lib/composer apps/web/lib/runtime apps/web/app/app/diagnosis` → clean
- `npm run build -w @nibbin/web` → Compiled successfully; static pages 20/20

## Migration
None.

## Deferred (per spec) — arc state after 2c
All 6 templates now have primitive equivalents; the synthesis loop generalizes fully. Next frontier is **multi-primitive composition** + the **Planner (Slice 3)** (bounded ReAct, `computer_use` weight, previewable) → Crystallization (Slice 4). Slice 3 is a larger/different design — to be scoped before building.
