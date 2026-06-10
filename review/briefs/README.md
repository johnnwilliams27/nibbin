Adversarial review briefs live as Claude Code subagents in `.claude/agents/`:
red-team, claims-auditor, logic-skeptic, cost-auditor.

Run them via the `/gate` command at every milestone, or individually on risky PRs.
This directory holds milestone-specific addendum briefs when a gate needs extra focus
(e.g. M6 gets a capture-daemon-specific red-team addendum).
