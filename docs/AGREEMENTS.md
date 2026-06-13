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
  Field Study, nibble. The agents are **Nibbins** (the noun) and may be described warmly
  as **"helpers"** (the descriptor) — "a grove of little helpers," "your first helper."
  Never in user-facing copy: bot, assistant, "as an AI", or **"creature(s)"**. "Creature"
  is retained ONLY as the internal name of the rendering engine and design-system
  primitive (@nibbin/creatures, the style guide's Plate 04, the IP term in terms.html) —
  never customer-facing.
- When spec and reality conflict, update the Decision Log (SPEC §9) — never drift silently.
- Staging uses synthetic data only. Prod data never leaves prod.
