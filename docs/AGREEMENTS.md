# AGREEMENTS — how we work

- Milestones run in SPEC §8 order. M(n+1) does not start until M(n) DoD + the §6.7
  adversarial gate pass and John signs the gate in LEARNINGS.md.
- Every PR reviewed before merge. Human approval required for changes touching SPEC §2
  claims, auth, billing, or the agent runtime. No direct pushes to main.
- CI gates: typecheck, tests, lint, dependency audit, SAST, redaction corpus,
  trigger-graph validation. GitHub Actions pinned by commit SHA.
- Conventional commits. Migrations as in-repo files (Supabase CLI); never dashboard-only.
- Locked vocabulary in all user-facing copy: Nibbin(s), grove, hatch, adopt, Agent
  School (Egg -> Student -> Senior -> Graduate), Grovekeeper, Field Notes, diagnosis,
  Field Study, nibble. Never: bot, assistant, "as an AI".
- When spec and reality conflict, update the Decision Log (SPEC §9) — never drift silently.
- Staging uses synthetic data only. Prod data never leaves prod.
