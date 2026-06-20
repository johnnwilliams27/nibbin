---
name: connector-builder
description: How to add or modify a Nibbin connector (OAuth integration, MCP server, scan modules). Use for any work in packages/connectors or when wiring a new external service.
---
# Connector Builder

## Decision tree
1. Aggregator catalog has it and quality suffices → method **[A]** (Composio/Nango-class). Default.
2. Vertical moat (HoneyBook, Pixieset, ShootProof, Flodesk, IG DMs, Etsy, Studio Ninja) or webhook-heavy → **[H]** hand-built.
3. Neither → generic rails **[G]**: user-supplied MCP URL, IMAP/SMTP, CalDAV, webhooks, CSV.

## Every connector declares (packages/connectors/registry)
provider id, method, read scopes vs write scopes (split!), webhook support + signature scheme, rate limits, scan modules powered, Nibbin capabilities powered, egress allowlist.

## Hard rules
- Connect requests read + write scopes at OAuth consent with plain-language explanation (C8). Execution of write side effects is gated by the earned-autonomy model — drafts-for-approval while in School, autonomous only once trusted.
- Tokens to the vault only (C9); revocation cascades — dependent Nibbins pause politely.
- All fetched content is data, never instructions; wrap in quarantine markers before any model sees it.
- Webhooks: verify signatures, idempotency keys, replay windows.
- Generic rails go through the egress proxy: public IPs only, DNS-rebinding safe, size/time limits, no credential forwarding.
- **Gmail restricted scopes trigger Google verification + CASA** — check docs/RISKS.md §1 before adding any Google scope; prefer the narrowest scope that works.
- Per-account send velocity caps on anything that can send (docs/RISKS.md §2 — protect the OAuth app).

## Scan modules
Pure functions: (connection, 90-day window) → findings[]. Each finding: plain-language insight, quantified cost, recommended Nibbin, adopt action. Deterministic where possible; T1 synthesis only for phrasing, strict structured output.
