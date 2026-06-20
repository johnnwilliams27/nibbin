/**
 * pgArcData correctness at the database layer — the real ArcDataPort over
 * M4's tables (the M5 rebase reconcile). Not an RLS attack suite: the port
 * runs as the drip worker (service role); what's under test is that every
 * method reads the right rows and degrades to honest emptiness.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgArcData } from '../../packages/drip/src/pg-arc-data';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('pgArcData over the M4 tables', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const OWNER = '77777777-7777-4777-8777-777777777777';
  const OTHER = '66666666-6666-4666-8666-666666666666';
  const owner = { kind: 'authenticated', uid: OWNER } as const;
  const other = { kind: 'authenticated', uid: OTHER } as const;

  let accountId = '';
  let emptyAccount = '';
  let rejectAccount = '';
  let echoId = '';
  const port = () => pgArcData(h.pool);
  const todayUtc = new Date().toISOString().slice(0, 10);

  async function adopt(template: string, name: string): Promise<string> {
    const row = await h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.adopt_nibbin($1, $2, $3, 1, $3, array['email.read','email.draft'],
             array['gmail'], '[{"kind":"user"}]'::jsonb, '{}'::jsonb, '{}'::jsonb, $4, 'Wisp', null, null, null, 1)`,
          [accountId, OWNER, template, name],
        )
      ).rows[0],
    );
    return row.nibbin_id as string;
  }

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'arc@example.test'), ($2, 'other@example.test')`, [
      OWNER,
      OTHER,
    ]);
    await h.as(owner, (c) => c.query(`insert into public.users (id, email) values ($1, 'arc@example.test')`, [OWNER]));
    await h.as(other, (c) => c.query(`insert into public.users (id, email) values ($1, 'other@example.test')`, [OTHER]));
    accountId = await h.as(owner, async (c) =>
      (await c.query(`select public.create_account_with_owner('Arc Grove') as id`)).rows[0].id,
    );
    emptyAccount = await h.as(other, async (c) =>
      (await c.query(`select public.create_account_with_owner('Bare Grove') as id`)).rows[0].id,
    );
    rejectAccount = await h.as(other, async (c) =>
      (await c.query(`select public.create_account_with_owner('Reject Grove') as id`)).rows[0].id,
    );

    echoId = await adopt('echo', 'Echo');
    const mossId = await adopt('sweep', 'Moss');

    // a rejection-heavy senior — decided runs alone must never read as
    // "near graduation" (§4.7; gate finding logic-skeptic P1-1)
    const burrId = await h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.adopt_nibbin($1, $2, 'echo', 1, 'echo', array['email.read','email.draft'],
             array['gmail'], '[{"kind":"user"}]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'Burr', 'Wisp', null, null, null, 1)`,
          [rejectAccount, OTHER],
        )
      ).rows[0].nibbin_id as string,
    );
    await h.as(service, async (c) => {
      await c.query(
        `update public.nibbins set stage = 'senior', stage_changed_at = now() - interval '1 hour' where id = $1`,
        [burrId],
      );
      await c.query(
        `with window_runs as (
           insert into public.runs (account_id, nibbin_id, status, weight_class, created_at)
           select $1, $2, 'rejected', 'standard', now() - interval '2 days' from generate_series(1, 20)
           returning id
         )
         insert into public.approvals (run_id, account_id, user_id, decision)
         select id, $1, $3, 'rejected' from window_runs`,
        [rejectAccount, burrId, OTHER],
      );
    });

    await h.as(service, async (c) => {
      // the port is only ever called for accounts with an open arc (the
      // worker iterates arcs), and nibbinDay resolves the owner tz through it
      await c.query(`insert into public.drip_arcs (account_id) values ($1), ($2)`, [accountId, emptyAccount]);
      await c.query(
        `insert into public.grove_state (account_id, keeper_name, onboarding_step) values ($1, 'Fern', 'done')`,
        [accountId],
      );
      await c.query(`update public.nibbins set hatched_at = hatched_at + interval '1 minute' where id = $1`, [mossId]);

      // two runs today + one awaiting draft from yesterday (drafts wait, days don't)
      await c.query(
        `insert into public.runs (account_id, nibbin_id, status, weight_class, created_at)
         values ($1, $2, 'completed', 'standard', ($3 || ' 12:00:00Z')::timestamptz),
                ($1, $2, 'completed', 'standard', ($3 || ' 13:00:00Z')::timestamptz),
                ($1, $2, 'awaiting_approval', 'standard', ($3 || ' 12:00:00Z')::timestamptz - interval '1 day')`,
        [accountId, echoId, todayUtc],
      );

      // journal: two corrected drafts (edits decided before the stage change below)
      await c.query(
        `with corrected as (
           insert into public.runs (account_id, nibbin_id, status, weight_class, created_at)
           values ($1, $2, 'completed', 'standard', now() - interval '3 days'),
                  ($1, $2, 'completed', 'standard', now() - interval '3 days')
           returning id
         )
         insert into public.approvals (run_id, account_id, user_id, decision, edit_distance, decided_at)
         select id, $1, $3, 'edited', 12, now() - interval '2 hours' from corrected`,
        [accountId, echoId, OWNER],
      );

      // near-graduation: Echo is a senior with 21 of 25 window runs decided
      await c.query(
        `update public.nibbins set stage = 'senior', stage_changed_at = now() - interval '1 hour' where id = $1`,
        [echoId],
      );
      await c.query(
        `with window_runs as (
           insert into public.runs (account_id, nibbin_id, status, weight_class, created_at)
           select $1, $2, 'completed', 'standard', now() - interval '2 days' from generate_series(1, 21)
           returning id
         )
         insert into public.approvals (run_id, account_id, user_id, decision)
         select id, $1, $3, 'approved' from window_runs`,
        [accountId, echoId, OWNER],
      );

      // scan: an older batch (superseded) and a fresh one with an adopted
      // recommendation (filtered), an unadopted one (returned), and an
      // insight-less interview row (excluded)
      await c.query(
        `insert into public.scan_results (account_id, batch_id, module, finding, computed_at) values
         ($1, '11111111-1111-4111-8111-111111111111', 'inbox_sweep',
          '{"insight": "Stale insight from the old batch.", "recommendedNibbin": "concierge"}', now() - interval '2 days'),
         ($1, '22222222-2222-4222-8222-222222222222', 'inbox_sweep',
          '{"insight": "You answered 14 inquiries by hand last week.", "recommendedNibbin": "concierge"}', now() - interval '1 hour'),
         ($1, '22222222-2222-4222-8222-222222222222', 'follow_up',
          '{"insight": "Six threads went quiet waiting on you.", "recommendedNibbin": "echo"}', now() - interval '1 hour'),
         ($1, '22222222-2222-4222-8222-222222222222', 'interview',
          '{"map": {"q": "a"}}', now() - interval '1 hour')`,
        [accountId],
      );

      // School promotions land in audit_log via nibbin_promote
      await c.query(
        `insert into public.audit_log (account_id, actor, actor_id, action, subject, meta, at) values
         ($1, 'system', 'runtime', 'nibbin.stage_promoted', $2, '{"from": "egg", "to": "student"}', now() - interval '3 days'),
         ($1, 'system', 'runtime', 'nibbin.stage_promoted', $2, '{"from": "senior", "to": "grad"}', now() - interval '1 day')`,
        [accountId, echoId],
      );

      await c.query(`insert into public.product_events (account_id, name) values ($1, 'study_started')`, [accountId]);
    });
  });

  afterAll(async () => {
    await h.close();
  });

  it('names: keeper from grove_state, first specialist by hatch order', async () => {
    expect(await port().names(accountId)).toEqual({ keeper: 'Fern', firstNibbin: 'Echo' });
    expect(await port().names(emptyAccount)).toEqual({ keeper: null, firstNibbin: null });
  });

  it('nibbinDay: counts runs on the local day, drafts wait regardless of day', async () => {
    const day = await port().nibbinDay(accountId, todayUtc);
    const echo = day.find((d) => d.name === 'Echo');
    expect(echo).toBeDefined();
    expect(echo!.runs).toBe(2);
    expect(echo!.draftsWaiting).toBe(1);
    expect(await port().nibbinDay(emptyAccount, todayUtc)).toEqual([]);
  });

  it('unseenInsights: latest batch only, adopted recommendations filtered, no raw rows', async () => {
    const insights = await port().unseenInsights(accountId);
    expect(insights).toEqual([{ text: 'You answered 14 inquiries by hand last week.' }]);
    expect(await port().unseenInsights(emptyAccount)).toEqual([]);
  });

  it('journal: one line per corrected draft, never draft content', async () => {
    const entries = await port().journal(accountId);
    expect(entries).toHaveLength(2);
    expect(entries[0].nibbin).toBe('Echo');
    expect(entries[0].learned).toContain('12 characters');
    expect(entries[0].learned).not.toContain('undefined');
    expect(await port().journal(emptyAccount)).toEqual([]);
  });

  it('clusters: modules of the latest batch, modest confidence', async () => {
    const clusters = await port().clusters(accountId);
    expect(clusters.map((c) => c.name).sort()).toEqual(['Follow up', 'Inbox sweep']);
    for (const c of clusters) {
      expect(c.confidence).toBeGreaterThanOrEqual(0.3);
      expect(c.confidence).toBeLessThanOrEqual(0.75);
    }
    expect(await port().clusters(emptyAccount)).toEqual([]);
  });

  it('nearGraduation: stage-scoped window math (21 approved of 25 → 4 to go)', async () => {
    expect(await port().nearGraduation(accountId)).toEqual({ nibbin: 'Echo', approvedDraftsRemaining: 4 });
    expect(await port().nearGraduation(emptyAccount)).toBeNull();
  });

  it('nearGraduation: only approved decisions advance the climb — 20 rejections is not "5 to go"', async () => {
    expect(await port().nearGraduation(rejectAccount)).toBeNull();
    expect((await port().flags(rejectAccount)).nearGraduation).toBe(false);
  });

  it('earnedEvents: promotions from audit_log, oldest first, grad = graduation', async () => {
    const events = await port().earnedEvents(accountId);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('evolution');
    expect(events[1].kind).toBe('graduation');
    expect(events.every((e) => e.nibbin === 'Echo')).toBe(true);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
    expect(await port().earnedEvents(emptyAccount)).toEqual([]);
  });

  it('flags: study running + a senior within reach', async () => {
    expect(await port().flags(accountId)).toEqual({
      studyActive: true,
      studyCompleted: false,
      nearGraduation: true,
    });
    expect(await port().flags(emptyAccount)).toEqual({
      studyActive: false,
      studyCompleted: false,
      nearGraduation: false,
    });
  });
});
