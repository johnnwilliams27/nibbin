# Security policy

## Reporting a vulnerability

Email **jnwilliams27@gmail.com**. Please do not open a public issue for anything
exploitable.

Include the affected component, a description, reproduction steps, and impact.
We aim to acknowledge within 3 business days and to keep you updated through to a
fix. Please give us a reasonable window to remediate before public disclosure.

## Scope

- The scoring engine (`trust-index/packages/scoring`)
- The probe harness (`trust-index/packages/collectors`) — in particular the
  network guard in `src/net.ts`
- The on-chain indexer (`trust-index/packages/indexer`)
- Persistence and the credential store (`trust-index/packages/db`)
- The marketplace app (`trust-index/apps/bnb-marketplace`)

The v1 product (web app, desktop Observer, installers) was archived on
2026-09-09 and is out of scope here. See `ARCHIVE.md` and the `old-nibbin`
repository.

## What we consider a vulnerability, specifically

This project makes outbound requests to endpoints that **subjects control**, and
stores credentials for some of them. The interesting attack surface is therefore
not the usual web one:

- **SSRF and DNS rebinding.** `src/net.ts` vets a URL, resolves it, refuses
  private and link-local addresses, and PINS the socket to the address it
  vetted, re-vetting on every redirect. A way to reach an internal address
  through a subject-supplied URL, an `endpoint` event, an A2A agent card's `url`,
  or a redirect chain is a vulnerability.
- **Credential exposure.** Secrets are encrypted at rest (AES-256-GCM, key from
  the environment, no default) and decrypted only when a request is about to be
  authenticated. A path that logs, returns, or transmits a stored secret to the
  wrong origin is a vulnerability. Origin-bound headers must not survive a
  cross-origin redirect.
- **Rating integrity.** The engine must not be manipulable by a subject into
  publishing a score it did not earn. Probe values are derived per subject from a
  held seed for exactly this reason. A way to recover those, or to make a gap
  read as evidence, is a vulnerability.

## Handling of subject data

We fetch and store public declarations — registration documents, tool and skill
lists, and responses to probes. We do not collect personal data from the
subjects we rate, and probe responses are stored as evidence for the ratings
derived from them.

Probes are read-only by default: the harness performs a handshake and enumerates
declared capabilities. It does not call tools that mutate state.
