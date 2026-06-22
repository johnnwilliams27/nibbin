# AGENTS.md — Nibbin (router)

Nibbin: AI agents that nibble your busywork away, for people who work for themselves.
Owners grant each agent's action level (Observe/Draft/Act); Agent School grades accuracy to inform that grant. The Grovekeeper
orchestrates but has no hands. Two surfaces: Day One web app + desktop Observer.

**Read only what the task needs:**

| Working on | Read first |
|---|---|
| Anything (always) | `docs/STATE.md` (current milestone, open P0/P1) |
| Product/feature scope | `SPEC.md` (source of truth; §8 build order) |
| Hard rules you must not break | `docs/INVARIANTS.md` |
| Process, PR rules, vocabulary | `docs/AGREEMENTS.md` |
| Deploy targets, env facts | `docs/ENVIRONMENT.md` |
| Abuse/compliance/reliability gaps | `docs/RISKS.md` |
| Past mistakes & patterns | `docs/GOTCHAS.md`, `LEARNINGS.md` |
| Creature SVG engine | skill: `.agents/skills/creature-engine` |
| Building a connector | skill: `.agents/skills/connector-builder` |
| Redaction/privacy tests | skill: `.agents/skills/redaction-corpus` |
| User-facing copy | skill: `.agents/skills/brand-voice` |
| UI, CSS, visual output | skill: `.agents/skills/design-system` + `reference/nibbin-style-guide.html` |
| Milestone gate, or any PR touching a sensitive surface | `/gate` (4 `.codex/agents/*` reviewers) → report in `docs/gates/`; see `docs/AGREEMENTS.md` |
| Codebase orientation | run `node tools/grovemap/grovemap.mjs` and open the map |

Brand reference: `reference/nibbin-demo.html`. Engine reference: `reference/nibbin-creature-lab.html`.

**Update protocol:** at every milestone gate update `docs/STATE.md`, append `LEARNINGS.md`,
and add new traps to `docs/GOTCHAS.md`. Keep this file under 50 lines — it is a router,
not a memory dump.
