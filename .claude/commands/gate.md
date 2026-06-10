Run the milestone gate for the current milestone (see docs/STATE.md):

1. Run full CI locally (typecheck, tests, lint, audit, redaction corpus, trigger-graph suite). Stop and report on any failure.
2. Launch the four adversarial reviewers as subagents against the milestone diff: red-team, claims-auditor, logic-skeptic, cost-auditor (cost-auditor only after M2). Collect findings.
3. Triage findings by severity. Any P0/P1 → gate FAILS: file issues, stop, report.
4. If clean: update docs/STATE.md (milestone, gate date), append the gate entry to LEARNINGS.md (breakages, patterns, perf/cost numbers, adversarial finding counts), add new traps to docs/GOTCHAS.md, regenerate the Grovemap (node tools/grovemap/grovemap.mjs).
5. Output a gate report for John to sign, including the DoD checklist from SPEC §8 with per-item evidence.
