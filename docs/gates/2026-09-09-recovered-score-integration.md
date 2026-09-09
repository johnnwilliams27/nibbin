# Recovered score integration

Original evidence commit: 0a0f4cca80174d666f84b57444d65e05b065b5c7.
Imported without modifying its 273 transcripts or rescoring. Independent claims
review confirms all 42 published endpoint/protocol pairs map to original
transcripts and batteries. Five A2A services rejected discovery GetTask but
answered later message/send tests; discovery failure does not erase the battery.

The scoring parameter is 2026-09-09T02:00:00Z, earlier than the actual readings.
It is retained as a historical engine parameter, not a claim of evidence then.

Recovery: 42 scores; direct-chain publication: 268 registrations, 37 measured
service URLs. Remaining original subjects are not automatically invented as
registrations. Explicit card/service links are retained; no host-only joins.

Checks: pipeline27, builder22, marketplace105; workspace typecheck passed.
Collector497 suite initially had one stale population assertion; the fixed-scope
fixture's two tests passed afterward. Database tests skipped without local Docker.
Security reviewer reported no P0/P1, with a P2 review read-rate-limit ordering risk.
Final logic reviewer was interrupted by an account usage limit; its partial review
identified no false score transfer. Build/CI results must be checked before merge.
