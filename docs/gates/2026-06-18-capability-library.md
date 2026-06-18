# Adversarial gate — Capability Library + Interpreter (Synthesis Core, Slice 1) (2026-06-18)

- **Branch / PR:** `feat/capability-library` → `main`
- **Reviewed diff:** `git diff main..feat/capability-library` at `60481a3` (post-fixes).
- **Scope:** the typed capability registry (`packages/runtime/src/capabilities.ts`) + `interpretSpec()` (`interpreter.ts`) that yields `ProgramStep`s for a declarative `AgentSpec.steps`; `buildProgram` routes steps→interpreter else the 6 unchanged imperative template programs; `agent_specs.steps`/`persona_policy` migration. Spec: `docs/superpowers/specs/2026-06-18-capability-library-design.md`. Foundation for Composer (Slice 2).

## CI step
- typecheck (packages/runtime + apps/web): ✅ exit 0
- tests: ✅ `vitest run packages/runtime/test apps/web/` → 351 passed / 49 files — incl. the unchanged runner/trust-gate suites (no regression), the interpreter-runs-a-steps-spec test, capability conformance, and the new P2/P3 cases.
- **SQL applied + verified on dev / staging / prod:** `agent_specs.steps` + `persona_policy` columns present (additive, back-compat).

## Reviewers
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 2 (fixed) | 1 (fixed) |
| logic-skeptic | PASS | 0 | 0 | 1 (fixed) | 1 (fixed) |
| claims-auditor | PASS | 0 | 0 | 0 | 2 (1 fixed) |

**Load-bearing safety property — verified by all three:** `interpretSpec` only *yields* `ProgramStep`s (grep + tests confirm no `effects`/`reader`/connector call); `runner.ts` is **unchanged in this diff** and gates interpreter-yielded steps identically to template steps — allowlist kill, quarantine (`isQuarantined` on reads; the only `unwrap()` is on runner-quarantined model output with a fail-safe to empty), School `gateSideEffect`, write-grants, idempotency, ceilings. A crafted steps-spec cannot reach a side effect without allowlist + grant + stage. The 6 templates carry empty `steps` → byte-for-byte unchanged imperative path (no behavior change). The two safety-critical replications (compose→draft handoff; quarantine-unwrap vs `@nibbin/scan`'s) are exact.

## Findings + dispositions (all fixed in-branch; reviewers framed the P2s as pre-Composer prerequisites — fixed now so Composer inherits a safe/correct interpreter)
| # | Sev | Reviewer | Finding | Disposition |
|---|---|---|---|---|
| 1 | P2 | red-team | `inputs.path` yielded verbatim → SSRF/path-traversal surface once Composer emits untrusted specs | **FIXED** (`be05941`): `assertSafeReadPath` throws on non-string, missing leading `/`, protocol-relative `//`, absolute `://`, or `..` → run fails cleanly, no read yielded. Generic guard. |
| 2 | P2 | red-team | `effectArgs` passed through unsanitized → header/MIME injection the templates close (`safeAddress`/`safeHeaderValue`) | **FIXED** (`be05941`): `sanitizeEffectArgs` strips CR/LF + caps strings at 998 (RFC 5322 line), recurses one level; applied before yielding the draft. |
| 3 | P2 | logic-skeptic | `patternKey` had no per-step discriminator → distinct composed drafts collapse into one routine identity / R1 bucket | **FIXED** (`be05941`): `CapabilityStep.patternKey?` (verbatim override) else `${prefix}:${templateKey??'custom'}#${idx}` — distinct per step. Tests assert `#0`/`#1` + override. |
| 4 | P3 | all | conformance only checked `toolsAllowlist` (hardcoded list) — a program yielding an unregistered capability wouldn't fail a test | **FIXED** (`60481a3`): `apps/web/.../programs.conformance.test.ts` source-scans `programs.ts` for every `capability: '…'` and asserts each ∈ `CAPABILITY_REGISTRY` (with a non-empty sanity guard). |
| 5 | P3 | claims | `ConnectionMap` widened to `Record<string,string|undefined>` (undocumented, a correctness improvement) | **NOTED** — no action. |

**Note for the record:** spec §3.2's optional defense-in-depth (runner asserting `capability(step).sideEffect` matches the yielded step kind) was not implemented — not required (the interpreter chooses the step kind *from* `cap.sideEffect`, so it's consistent by construction; the allowlist already gates). The §6.2 `inputs.path` per-capability *schema* (vs the generic guard now in place) remains a Composer-era refinement.

## Disposition
- Blocking (P0/P1): **none.** P2 ×3 + the substantive P3: **fixed in-branch.** The interpreter is now safe-by-construction for untrusted specs (path guard + effectArgs neutralizer) — a hard prerequisite for Slice 2 that's satisfied here rather than deferred.
- **Gate verdict: PASS.**
- **Signed:** Claude on 2026-06-18 (on behalf of John).
