# Nibbin

An independent assessor of AI agents and the interfaces they expose.

We probe a subject's declared interface, measure how it actually behaves when
called, and publish a rating — or decline to, and record why. Subjects are
ERC-8004 on-chain agents and the MCP / A2A endpoints they declare.

The distinguishing property is the refusal: when the evidence is too thin we
withhold the rating and say what was missing, because our inability to measure
must never be recorded as a fact about the subject.

## Layout

| Path | What |
|---|---|
| `trust-index/packages/scoring` | The rating engine. Pure, no I/O. |
| `trust-index/packages/collectors` | Probe harness — MCP, A2A, network guard, judge. |
| `trust-index/packages/indexer` | On-chain enumeration across the ERC-8004 registries. |
| `trust-index/packages/db` | Persistence, daily snapshots, credential store. |
| `trust-index/apps/bnb-marketplace` | Agent marketplace for BNB Chain, ranked by assessment. |

Start with `CLAUDE.md` (router), then `docs/STATE.md`.

## History

The v1 product — a creature-based busywork assistant with a desktop observer —
was archived on 2026-09-09. Nothing was deleted: see `ARCHIVE.md` for how to
recover any part of it, or the `old-nibbin` repository for the full tree.
