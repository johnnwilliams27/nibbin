# CLAUDE.md — Nibbin (router)

Nibbin: AI agents that nibble your busywork away, for people who work for themselves.
Creature agents earn autonomy through verified accuracy (Agent School). The Grovekeeper
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
| Creature SVG engine | skill: `.claude/skills/creature-engine` |
| Building a connector | skill: `.claude/skills/connector-builder` |
| Redaction/privacy tests | skill: `.claude/skills/redaction-corpus` |
| User-facing copy | skill: `.claude/skills/brand-voice` |
| UI, CSS, visual output | skill: `.claude/skills/design-system` + `reference/nibbin-style-guide.html` |
| Milestone gate | `/gate` command + `.claude/agents/*` reviewers |
| Codebase orientation | run `node tools/grovemap/grovemap.mjs` and open the map |

Brand reference: `reference/nibbin-demo.html`. Engine reference: `reference/nibbin-creature-lab.html`.

**Update protocol:** at every milestone gate update `docs/STATE.md`, append `LEARNINGS.md`,
and add new traps to `docs/GOTCHAS.md`. Keep this file under 50 lines — it is a router,
not a memory dump.
