# Security policy

## Reporting a vulnerability

Email SECURITY-CONTACT-PLACEHOLDER (the author must replace this with a
monitored address before the repo goes public; a `security@` alias on the
project domain is the expected shape).

Include what you found, where, and steps to reproduce. Do not open a public
issue for a vulnerability, and do not test against production data beyond
what is needed to demonstrate the finding.

## Disclosure policy

- We acknowledge reports within 72 hours.
- We aim to ship a fix within 90 days of a valid report. If we fix it sooner,
  you may publish sooner; coordinate the date with us.
- After 90 days you may publish regardless of fix status. This is the
  standard 90-day clock and we accept it applying to us.
- Credit is given in release notes unless you ask otherwise. There is no
  bounty program at this time; we say so here to set expectations, not to
  discourage reports.

## Scope

In scope: the indexer, the scoring engine, the API and web app, the published
dumps, the anchoring and oracle contracts, and this repository's CI.

Out of scope: the ERC-8004 registries themselves (report upstream),
third-party RPC providers, and volumetric denial of service.

## Threat model summary

The full table is SPEC section 16; supplements are SPEC section 24. The short
version: this is a read-only public data service, so the surface is narrow
but not zero.

- All agent metadata is attacker-controlled input. Size caps, timeouts,
  schema validation, no raw HTML rendering, escape everything.
- RPC and database credentials are server-side only, rotated on any suspected
  exposure, with provider-side allowlists.
- Queries are parameterized; no user-supplied ORDER BY, LIMIT, or filter
  expressions. Pagination is capped and rate-limited.
- Flag language describes observable conditions with numbers, never intent.
  A documented correction request process backs it.
- The future anchoring signer key exists only in the jobs runner, with spend
  caps and a contract allowlist. It is never present in the web app.
- Secret scanning (gitleaks) runs in CI on every pull request. The lockfile
  is committed; Dependabot reviews land weekly.

## Deployment assumptions (adversarial review, 2026-08-28)

Two mitigations are correct in code but rest on how the service is deployed.
State them in the production runbook.

- The rate-limit bucket key comes from a platform-trusted client-IP header
  (x-real-ip / x-vercel-forwarded-for) and ignores x-forwarded-for. This holds
  only while the app is always reached through an edge that overwrites those
  headers. If the origin is ever exposed directly, or fronted by a proxy that
  passes client-supplied x-real-ip through, a client can rotate it per request
  and defeat the limit. Keep the origin private behind the edge.
- The metadata fetcher must resolve the host, pin the resolved address, and
  re-run the host block-list on any redirect Location. The resolver blocks
  literal private, loopback, link-local, and embedded-IPv4 hosts before the
  request, but it cannot resolve DNS, so a public hostname that resolves to or
  302-redirects into an internal address is only stopped by the fetcher. The
  Fetcher doc comment in packages/indexer/src/metadata.ts states this contract.

Known latent limitation: the inputs_hash sorts validations by
(request_hash, validator_address) and transfers by (block, tx_hash, from, to).
These are total orders for well-formed chain data (a token transfers once per
tx; a validator answers a request once). If the Validation Registry later
admits two responses to one request in a single snapshot, extend the
comparator to every serialized field so two honest reproducers cannot compute
different roots.

## Repository hygiene checklist

Per SPEC 24, to be completed by the author at repo-public time:

- [ ] Replace the security contact placeholder above.
- [ ] Branch protection on the default branch; no direct pushes.
- [ ] All trust-index CI jobs marked as required status checks.
- [ ] Dependabot enabled.
- [ ] Signed commits if practical.
