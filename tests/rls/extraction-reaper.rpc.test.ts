import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping extraction-reaper suite');
}

const UID_R = 'ea000099-0000-4000-8000-000000000001';

describe.skipIf(!dbAvailable)('reap_stale_extractions RPC', () => {
  const h = new RlsHarness();
  let acct = '';
  const asU = { kind: 'authenticated', uid: UID_R } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id,email) values ($1,'reaper@ex.test')`, [UID_R]);
    await h.as(asU, async (c) => {
      await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID_R, `${UID_R}@ex.test`]);
    });
    acct = await h.as(asU, async (c) =>
      (await c.query(`select public.create_account_with_owner('Reaper') as id`)).rows[0].id);
  });
  afterAll(async () => { await h.close(); });

  /**
   * Helper: inserts a source + job row with the given parameters.
   * Returns { srcId }.
   */
  async function insertJobWithSource(params: {
    status: string;
    startedAt: string | null;
    attempts: number;
  }): Promise<{ srcId: string }> {
    const srcId = await h.as(service, async (c) =>
      (await c.query(
        `insert into public.sources (account_id, kind, title) values ($1,'document','test.pdf') returning id`,
        [acct],
      )).rows[0].id);

    await h.as(service, async (c) => {
      await c.query(
        `insert into public.source_extraction_jobs (account_id, source_id, status, started_at, attempts)
         values ($1, $2, $3, $4, $5)`,
        [acct, srcId, params.status, params.startedAt, params.attempts],
      );
    });

    return { srcId };
  }

  it('stale processing job → error + source extraction_state=failed (no re-enqueue)', async () => {
    const startedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 minutes ago
    const { srcId } = await insertJobWithSource({ status: 'processing', startedAt, attempts: 1 });

    // Set source extraction_state = 'extracting'
    await h.as(service, async (c) => {
      await c.query(`update public.sources set extraction_state='extracting' where id=$1`, [srcId]);
    });

    const reaped = await h.as(service, async (c) =>
      (await c.query(`select public.reap_stale_extractions(10) as n`)).rows[0].n);
    expect(reaped).toBeGreaterThanOrEqual(1);

    const job = await h.as(service, async (c) =>
      (await c.query(
        `select status, error_message from public.source_extraction_jobs where source_id=$1`,
        [srcId],
      )).rows[0]);
    // Stale job → terminally error (no re-enqueue in fire-and-forget architecture)
    expect(job.status).toBe('error');
    expect(job.error_message).toMatch(/timed out/i);

    // Source must be marked failed
    const src = await h.as(service, async (c) =>
      (await c.query(`select extraction_state from public.sources where id=$1`, [srcId])).rows[0]);
    expect(src.extraction_state).toBe('failed');
  });

  it('stale processing job with high attempts also → error + source extraction_state=failed', async () => {
    const startedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 minutes ago
    const { srcId } = await insertJobWithSource({ status: 'processing', startedAt, attempts: 5 });

    // Set source extraction_state = 'extracting'
    await h.as(service, async (c) => {
      await c.query(`update public.sources set extraction_state='extracting' where id=$1`, [srcId]);
    });

    const reaped = await h.as(service, async (c) =>
      (await c.query(`select public.reap_stale_extractions(10) as n`)).rows[0].n);
    expect(reaped).toBeGreaterThanOrEqual(1);

    const job = await h.as(service, async (c) =>
      (await c.query(
        `select status, error_message from public.source_extraction_jobs where source_id=$1`,
        [srcId],
      )).rows[0]);
    expect(job.status).toBe('error');
    expect(job.error_message).toMatch(/timed out/i);

    const src = await h.as(service, async (c) =>
      (await c.query(`select extraction_state from public.sources where id=$1`, [srcId])).rows[0]);
    expect(src.extraction_state).toBe('failed');
  });

  it('fresh processing job (started_at = now) is not reaped', async () => {
    const startedAt = new Date().toISOString(); // right now
    const { srcId } = await insertJobWithSource({ status: 'processing', startedAt, attempts: 1 });

    const reaped = await h.as(service, async (c) =>
      (await c.query(`select public.reap_stale_extractions(10) as n`)).rows[0].n);
    // Count may be > 0 from prior rows, but our fresh job must not change
    expect(typeof reaped).toBe('number');

    const job = await h.as(service, async (c) =>
      (await c.query(
        `select status from public.source_extraction_jobs where source_id=$1`,
        [srcId],
      )).rows[0]);
    expect(job.status).toBe('processing');
  });

  it('done job is not reaped', async () => {
    const startedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { srcId } = await insertJobWithSource({ status: 'done', startedAt, attempts: 1 });

    await h.as(service, async (c) => {
      // reap again — done job should be untouched
      await c.query(`select public.reap_stale_extractions(10) as n`);
    });

    const job = await h.as(service, async (c) =>
      (await c.query(
        `select status from public.source_extraction_jobs where source_id=$1`,
        [srcId],
      )).rows[0]);
    expect(job.status).toBe('done');
  });

  it('returns correct count when multiple stale jobs exist', async () => {
    const startedAt = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    // Insert 2 stale processing jobs
    await insertJobWithSource({ status: 'processing', startedAt, attempts: 1 });
    await insertJobWithSource({ status: 'processing', startedAt, attempts: 2 });

    const reaped = await h.as(service, async (c) =>
      (await c.query(`select public.reap_stale_extractions(10) as n`)).rows[0].n);
    expect(reaped).toBeGreaterThanOrEqual(2);
  });

  it('anon cannot execute reap_stale_extractions', async () => {
    await expect(
      h.as({ kind: 'anon' }, (c) =>
        c.query(`select public.reap_stale_extractions(10)`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('authenticated user cannot execute reap_stale_extractions', async () => {
    await expect(
      h.as(asU, (c) =>
        c.query(`select public.reap_stale_extractions(10)`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
