# Nibbin

AI agents that nibble your busywork away — for people who work for themselves.

This is the project area: spec, memory architecture, Claude Code setup, review gates, and tooling. The product code grows around it.

## Start here
- `SPEC.md` — the master build specification (single source of truth; §8 is the build order)
- `CLAUDE.md` — thin router that directs every Claude Code session to the right context
- `docs/` — the memory tree (state, invariants, agreements, environment, risks, gotchas)
- `.claude/` — skills (creature-engine, connector-builder, redaction-corpus, brand-voice), adversarial reviewer subagents (red-team, claims-auditor, logic-skeptic, cost-auditor), and the `/gate` command
- `reference/` — `nibbin-demo.html` (brand/copy/pricing) and `nibbin-creature-lab.html` (creature engine)
- `tools/grovemap/` — codebase map; run `node tools/grovemap/grovemap.mjs`, open `grovemap.html`

## First Claude Code prompt
> Read CLAUDE.md, then docs/STATE.md, then SPEC.md §0 and §8. Execute milestone M0. When the DoD is met, run /gate.

## Rhythm
One milestone per working session. No milestone starts until the previous gate is signed in `LEARNINGS.md`.
