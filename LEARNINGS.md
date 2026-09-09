# Trust Index learnings

## 2026-09-09 — Detail-evidence pre-merge review

Three distinct P1 findings and one P2 were found and resolved by four independent
reviewers; see `docs/gates/2026-09-09-detail-evidence.md`.

- JSON syntax is not proof of a successful detail response. Validate identity
  and interface field shapes before interpreting a null endpoint as evidence.
- Failure logs are historical. Derive current gaps from snapshot state, and do
  not let a stale 429 explain a corrupt cache.
- A shorter retry sleep does not bound a large run. Stop admitting work across
  the shared worker pool when the upstream quota is exhausted.
- Check the emitted HTML as well as pure helpers. Tests now cover all 112
  listed null-endpoint pages in the current snapshot.
- Excluded workspace members need explicit CI commands. The marketplace now
  participates in required typecheck, test and build jobs through npm.

Verification: 991 workspace tests passed (25 explicitly skipped), 16 marketplace
regressions passed, repository lint/typecheck passed, 240 marketplace pages built.
No paid/model calls introduced; no invented per-user COGS projection applies.
