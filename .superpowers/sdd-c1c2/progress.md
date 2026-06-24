# SDD ledger — C1 collate + C2 conflict/source-authority
Base: 631e676a
Task 1: complete (e1515eea, source_authority table+RLS, 8/8). ensure_source_authority seed deferred to Task 2.
Task 2: complete (d4ebb988, flag_field_conflict + ensure_source_authority, 8/8). NOTE: re-notify on updated open flag skipped by insert_system_notification ON CONFLICT DO NOTHING — ACCEPTED (persistent flag is truth, notification is one-time nudge).
Task 3: complete (76268086, resolve_field_flag RPC — write+resolve+audit+learn, 13/13, RLS 29/29, typecheck 0). Mirrors decide_memory_proposal apply.
Task 4: complete (5b188691, conflict-detect pure core, 33/33). substring-suppression v1 heuristic; LLM judging deferred.
Task 5: complete (9169cef8, collateAccount — conflicts/dedup/stale/brief, 16/16, fail-safe). Dedup uses status='superseded' (CHECK is pending/approved/rejected/superseded; 'dismissed' would violate) — good catch.
Task 6: complete (b861e685, cron/collate-pass route + vercel.json daily 0 6 * * *, 7/7, fail-safe per account)
Task 7: complete (c5b87cab, loadPendingItems+conflicts + buildKeeperContext surfacing, 46 tests, typecheck clean 17 pkgs, no-hands preserved)
Task 8: complete (52b96dac, Memory conflict flag + resolve UI, 653 tests, +27). GAP: suggested source uses arbitrary heuristic — Task4 computes suggestedSourceId but it is dropped (flag_field_conflict has no param, field_flags no column). FIX dispatched: thread suggested_source_id through migration+RPC+collate+UI. Minor: banner no optimistic-hide (router.refresh) — fold into fix.
Fix (54801878): threaded suggested_source_id end-to-end (field_flags col + flag_field_conflict 6-arg + collate + page loader + ConflictFlag), 858 tests pass. router.refresh() TODOd (breaks renderToStaticMarkup) with 3 options noted.
MODEL: implementer subagents switched to Opus 4.8 from here per John.
GATE (1829be93): CHANGES-REQUIRED — C1 cross-account bleed (collate.ts reads service-role w/o .eq(account_id)), I1 conflict-detect dead (proposals query never joins sources->kind undefined->all skipped), I2 resolve_field_flag no validation that p_chosen_source_id in competing_source_ids + unguarded field_evidence FK. SQL surface solid. Root cause: filter-blind collate mock. -> ONE Opus fixer + filter-asserting/live-DB test.
