/**
 * The real ArcDataPort over M4's cloud tables (runs, approvals, scan_results,
 * nibbins, grove_state, audit_log, product_events) — replaces the M4-stub the
 * arc shipped with (stub.ts stays for tests). Service-role pool, zero
 * string-built SQL, same rules as pg-store.ts.
 *
 * C1/C7 boundary (types.ts): everything read here is CLOUD data the user
 * already owns in-product. Field Study numbers never flow through this port.
 */
import type { Pool } from 'pg';
import type {
  ArcDataPort,
  ArcFlags,
  EarnedEvent,
  JournalEntry,
  NearGraduation,
  NibbinDaySummary,
  ScanInsight,
  WorkflowCluster,
} from './types';

/** §4.7 floor — curriculum may tighten, never loosen (mirrors nibbin_promote). */
const PROMOTION_WINDOW_FLOOR = 25;

function plural(n: number): string {
  return n === 1 ? '' : 's';
}

export function pgArcData(pool: Pool): ArcDataPort {
  const port: ArcDataPort = {
    async flags(accountId): Promise<ArcFlags> {
      // A study is active when the newest study_* event is study_started.
      // M6's Observer emits these; an account that never studied has none.
      const study = await pool.query<{ name: string }>(
        `select name from product_events
          where account_id = $1 and name in ('study_started', 'study_completed', 'study_aborted')
          order by at desc limit 1`,
        [accountId],
      );
      const near = await port.nearGraduation(accountId);
      return {
        studyActive: study.rows[0]?.name === 'study_started',
        nearGraduation: near !== null,
      };
    },

    async nibbinDay(accountId, localDay): Promise<NibbinDaySummary[]> {
      // The local day is computed by the scheduler from the owner's tz; use
      // the same tz to bound the day. Invalid tz already fell back to UTC
      // upstream, but coalesce again — this query must never throw on it.
      const r = await pool.query<{ name: string; runs: string; drafts_waiting: string }>(
        `with owner_tz as (
           select case when u.tz is not null and u.tz in (select name from pg_timezone_names)
                       then u.tz else 'UTC' end as tz
             from drip_arcs a
             join memberships m on m.account_id = a.account_id
                               and m.role = 'owner' and m.status = 'active'
             join users u on u.id = m.user_id
            where a.account_id = $1
            limit 1
         )
         select n.name,
                count(r.id) filter (
                  where r.created_at >= ($2 || ' 00:00:00')::timestamp at time zone (select tz from owner_tz)
                    and r.created_at <  (($2 || ' 00:00:00')::timestamp + interval '1 day') at time zone (select tz from owner_tz)
                )::text as runs,
                count(r.id) filter (where r.status = 'awaiting_approval')::text as drafts_waiting
           from nibbins n
           left join runs r on r.nibbin_id = n.id
          where n.account_id = $1 and n.kind = 'specialist'
          group by n.id, n.name, n.hatched_at
         having count(r.id) > 0
          order by n.hatched_at`,
        [accountId, localDay],
      );
      return r.rows
        .map((row) => ({ name: row.name, runs: Number(row.runs), draftsWaiting: Number(row.drafts_waiting) }))
        .filter((s) => s.runs > 0 || s.draftsWaiting > 0);
    },

    async unseenInsights(accountId): Promise<ScanInsight[]> {
      // M4 keeps no per-insight "seen" marker; the honest cloud proxy is
      // "not yet acted on": insights from the latest scan batch whose
      // recommended Nibbin the account hasn't adopted. Insight strings are
      // module-composed sentences (§4.4) — already user-safe, never raw
      // provider content.
      const r = await pool.query<{ insight: string }>(
        `select s.finding ->> 'insight' as insight
           from scan_results s
          where s.account_id = $1
            and s.batch_id = (
              select s2.batch_id from scan_results s2
               where s2.account_id = $1 order by s2.computed_at desc limit 1
            )
            and s.finding ? 'insight'
            and not exists (
              select 1 from nibbins n
                join agent_specs sp on sp.id = n.spec_id
               where n.account_id = $1
                 and sp.template_key = s.finding ->> 'recommendedNibbin'
            )
          order by s.computed_at desc
          limit 8`,
        [accountId],
      );
      return r.rows.filter((row) => row.insight).map((row) => ({ text: row.insight }));
    },

    async journal(accountId): Promise<JournalEntry[]> {
      // A journal line per corrected draft: approvals carry decision +
      // edit_distance only (never draft content), and an 'edited' decision
      // genuinely holds the Nibbin back — the §4.7 window counts only
      // approved-unedited toward promotion.
      const r = await pool.query<{ nibbin: string; edit_distance: number }>(
        `select n.name as nibbin, a.edit_distance
           from approvals a
           join runs r on r.id = a.run_id
           join nibbins n on n.id = r.nibbin_id
          where a.account_id = $1 and a.decision = 'edited'
          order by a.decided_at desc
          limit 8`,
        [accountId],
      );
      return r.rows.map((row) => ({
        nibbin: row.nibbin,
        learned: `Took your correction on a draft (${row.edit_distance} character${plural(row.edit_distance)} changed) and will be held to it before earning more trust.`,
      }));
    },

    async clusters(accountId): Promise<WorkflowCluster[]> {
      // Day-10 sketch from the latest scan batch: one cluster per module
      // that found something, confidence growing slowly with evidence count.
      // The ceremony copy is built for low confidence — stay modest (≤0.75).
      const r = await pool.query<{ module: string; findings: string }>(
        `select s.module, count(*)::text as findings
           from scan_results s
          where s.account_id = $1
            and s.batch_id = (
              select s2.batch_id from scan_results s2
               where s2.account_id = $1 order by s2.computed_at desc limit 1
            )
            and s.finding ? 'insight'
          group by s.module
          order by count(*) desc, s.module
          limit 5`,
        [accountId],
      );
      return r.rows.map((row) => ({
        name: row.module.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        confidence: Math.min(0.75, 0.3 + 0.15 * (Number(row.findings) - 1)),
      }));
    },

    async nearGraduation(accountId): Promise<NearGraduation | null> {
      // Mirrors nibbin_promote's FULL semantics, not just its window scoping:
      // only the most recent `window` decisions since stage_changed_at count,
      // and only 'approved' ones advance the climb — a rejection-heavy senior
      // is NOT near graduation no matter how many runs it has (§4.7 "earned,
      // never time-served"; gate finding logic-skeptic P1-1). The accuracy
      // guard also keeps the flag from sticking forever at remaining=1.
      const r = await pool.query<{
        name: string;
        window_runs: number;
        min_pct: string;
        decided: string;
        approved: string;
      }>(
        `select n.name, w.window_runs, w.min_pct::text,
                coalesce(d.decided, 0)::text as decided,
                coalesce(d.approved, 0)::text as approved
           from nibbins n
           join agent_specs sp on sp.id = n.spec_id
          cross join lateral (
            select greatest(coalesce((sp.curriculum -> 'promotion' ->> 'windowRuns')::integer, $2), $2) as window_runs,
                   greatest(coalesce((sp.curriculum -> 'promotion' ->> 'minApprovedUneditedPct')::numeric, 0.95), 0.95) as min_pct
          ) w
          cross join lateral (
            select count(*) as decided, count(*) filter (where x.decision = 'approved') as approved
              from (
                select a.decision from approvals a
                 where a.account_id = $1
                   and a.decided_at > n.stage_changed_at
                   and a.run_id in (select r2.id from runs r2 where r2.nibbin_id = n.id)
                 order by a.decided_at desc
                 limit w.window_runs
              ) x
          ) d
          where n.account_id = $1 and n.kind = 'specialist'
            and n.stage = 'senior' and n.status = 'active'
          order by w.window_runs - coalesce(d.approved, 0) asc, n.hatched_at asc
          limit 1`,
        [accountId, PROMOTION_WINDOW_FLOOR],
      );
      const row = r.rows[0];
      if (!row) return null;
      const window = Number(row.window_runs);
      const decided = Number(row.decided);
      const approved = Number(row.approved);
      // promote tolerates at most floor(window × (1 − minPct)) non-approved
      // decisions in the window; beyond that the bad ones must age out first
      // and no honest "N to go" exists.
      const allowedMisses = Math.floor(window * (1 - Number(row.min_pct)));
      if (decided - approved > allowedMisses) return null;
      const remaining = Math.max(1, window - approved);
      if (remaining > 5) return null;
      return { nibbin: row.name, approvedDraftsRemaining: remaining };
    },

    async earnedEvents(accountId): Promise<EarnedEvent[]> {
      // Promotions land in audit_log via nibbin_promote (action
      // 'nibbin.stage_promoted', meta {from,to}). The store dedups on event
      // id (notifications unique on source_id), so re-reading a window is
      // idempotent; 30 days comfortably covers any worker gap.
      const r = await pool.query<{
        id: string; to_stage: string; nibbin: string; nibbin_id: string;
        species: string; stage: string; palette: string | null; accessory: string | null; marking: string | null;
      }>(
        `select l.id, l.meta ->> 'to' as to_stage, n.name as nibbin,
                n.id::text as nibbin_id, n.species, n.stage, n.palette, n.accessory, n.marking
           from audit_log l
           join nibbins n on n.id::text = l.subject
          where l.account_id = $1
            and l.action = 'nibbin.stage_promoted'
            and l.at > now() - interval '30 days'
          order by l.at asc`,
        [accountId],
      );
      return r.rows.map((row) => ({
        id: row.id,
        kind: row.to_stage === 'grad' ? ('graduation' as const) : ('evolution' as const),
        nibbin: row.nibbin,
        detail:
          row.to_stage === 'grad'
            ? 'Graduated on verified accuracy — earned, never time-served.'
            : `Moved up to ${row.to_stage} — earned on your approvals.`,
        nibbinId: row.nibbin_id,
        species: row.species,
        stage: row.stage,
        palette: row.palette,
        accessory: row.accessory,
        marking: row.marking,
      }));
    },

    async names(accountId): Promise<{ keeper: string | null; firstNibbin: string | null }> {
      const r = await pool.query<{ keeper: string | null; first_nibbin: string | null }>(
        `select (select g.keeper_name from grove_state g where g.account_id = $1) as keeper,
                (select n.name from nibbins n
                  where n.account_id = $1 and n.kind = 'specialist'
                  order by n.hatched_at asc limit 1) as first_nibbin`,
        [accountId],
      );
      return { keeper: r.rows[0]?.keeper ?? null, firstNibbin: r.rows[0]?.first_nibbin ?? null };
    },
  };
  return port;
}
