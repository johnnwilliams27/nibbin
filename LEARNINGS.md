# Trust Index learnings

## Marketplace UX correction — 2026-09-09

- The marketplace is the product; Trust Index is its evidence feature. Lead with
  finding an agent and make the demonstration a secondary path.
- Four category links in the header plus cards plus filters repeat navigation.
  Keep global destinations distinct from local category filters.
- Keep financial warnings at the decision; move methodology and technical detail
  behind purposeful disclosures. Removing repeated prose must not remove consent.
- A shared CSS padding shorthand overrode route spacing. Inline-only padding and
  browser geometry checks fixed the apparent header/footer overlap.
- CSS-only ambient motion can add depth without moving controls. Provide reduced
  motion handling; cap result transitions and paginate actual records. Decorative
  pause controls were removed at the user's explicit request.

## 2026-09-09 — Marketplace and public hiring

- Read the actual challenge: all four DeFi categories are required; registration
  count is not the task. Selection is a union of capped discovery streams and
  a text classifier, not a population-wide trust ranking.
- Count endpoint observations separately from registrations. Replaying 111
  saved URL observations restored 7,993 associations without creating new tests.
- An MCP initialize response needs its required structure and matching ID.
  HTTP success, authentication walls and static agent cards are different states.
- A working localhost seller is not a public hire path. Test the deployed
  buyer-to-seller boundary and retrieve the actual delivery, not just a quote.
- SDK funding-event lookup scanned historical blocks and exceeded the public
  RPC log limit. Passing the confirmed funding transaction receipt provides a
  bounded proof tied to the exact job, buyer, provider and signed time window.
- Testnet sponsorship in the SDK can fall back to self-payment. Enforce zero
  gas price at the dedicated testnet signer's boundary when claiming sponsorship.
- A serverless result must survive instance loss. Versioned deterministic
  reconstruction plus the on-chain manifest digest avoids ephemeral file storage.
- Full signed task inputs become public on-chain. Warn before the user creates
  a job, and verify the downloaded manifest before offering settlement.
- Mainnet gas controls and serverless traffic controls solve different problems.
  A nonce/gas ceiling does not bound request-time compute; both need explicit limits.


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
