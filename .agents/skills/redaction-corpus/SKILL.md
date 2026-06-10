---
name: redaction-corpus
description: Maintaining the privacy redaction test corpus and writing redaction/deletion/capture tests for the Observer. Use for any work touching capture, redaction layers, the local store, study lifecycle, or synthesis packets.
---
# Redaction Corpus

The corpus is CI-blocking and P0. It is the executable form of the privacy claims.

## Structure
Fixtures = synthetic AX trees + window metadata + (where relevant) frames, seeded with KNOWN sentinel values: names, emails, phones, SSN/EIN, card numbers, addresses, API keys, passwords-in-plain-fields. Sentinels are unique magic strings (e.g. SENTINEL_SSN_7f3a) so a leak is grep-provable.

## Assertions
1. Zero sentinels in the persisted store after the full 4-layer pipeline.
2. Zero sentinels in any synthesis packet.
3. Secure-field fixtures (C4) produce no value, no label, no frame — at capture, not at scrub.
4. Category-blocklist fixtures (C5) produce zero persisted events.
5. Fail-closed: with the NER sidecar killed, persistence of unredacted strings is blocked (regex layer still runs; pipeline halts rather than degrades).
6. Deletion: after RAW_DELETING, the verifier proves store emptiness; test walks paths independently.
7. Day-14 stop: daemon-level kill fires with the UI process killed.

## Protocol
Every real-world leak found (especially during user-zero, M7) becomes a permanent regression fixture the same day. Never delete a fixture.
