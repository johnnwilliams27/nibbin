/**
 * Agent Versioning Slice 1 (SPEC §18.2 / R52) at the DB layer: a re-tune mints a
 * NEW immutable agent_specs version and migrates the live Nibbin to it, with
 * lineage via previous_spec_id; the old spec row is never mutated. retune_nibbin
 * is service_role-only (app-side validation gates it), exactly like adopt_nibbin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('Agent versioning: retune_nibbin at the DB layer', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const OWNER = '77777777-7777-4777-8777-777777777777';
  const OUTSIDER = '66666666-6666-4666-8666-666666666666';
  const owner = { kind: 'authenticated', uid: OWNER } as const;
  const outsider = { kind: 'authenticated', uid: OUTSIDER } as const;
  const anon = { kind: 'anon' } as const;

  let accountId = '';
  let outsiderAccount = '';
  let nibbinId = '';
  let originalSpecId = '';

  async function adopt(name: string): Promise<{ nibbin_id: string; spec_id: string }> {
    return h.as(service, async (c) =>
      (
        await c.query(
          `select * from public.adopt_nibbin($1, $2, 'echo', 1, 'Echo', array['email.read','email.draft'],
             array['gmail'], '[{"kind":"user"}]'::jsonb, '{}'::jsonb, '{}'::jsonb, $3, 'Wisp', null, null, null, 1,
             '[{"id":"s1","capability":"email.draft"}]'::jsonb, '{"tone":"warm"}'::jsonb)`,
          [accountId, OWNER, name],
        )
      ).rows[0],
    );
  }

  beforeAll(async () => {
    await h.reset();
    for (const [uid, email] of [
      [OWNER, 'verowner@example.test'],
      [OUTSIDER, 'veroutsider@example.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1, $2)`, [uid, email]);
      await h.as({ kind: 'authenticated', uid }, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, email]);
      });
    }
    accountId = await h.as(owner, async (c) =>
      (await c.query(`select public.create_account_with_owner('VerGrove') as id`)).rows[0].id,
    );
    outsiderAccount = await h.as(outsider, async (c) =>
      (await c.query(`select public.create_account_with_owner('VerOther') as id`)).rows[0].id,
    );
    const adopted = await adopt('Echo');
    nibbinId = adopted.nibbin_id;
    originalSpecId = adopted.spec_id;
  });

  afterAll(async () => {
    await h.close();
  });

  it('service_role retune mints a new immutable version, migrates the Nibbin, preserves lineage', async () => {
    const newSpecId = await h.as(service, async (c) =>
      (
        await c.query(
          `select public.retune_nibbin($1, $2, $3, 'Echo v2', '[{"id":"s1","capability":"email.draft"},{"id":"s2","capability":"email.send"}]'::jsonb, '{"tone":"crisp"}'::jsonb) as id`,
          [accountId, OWNER, nibbinId],
        )
      ).rows[0].id,
    );
    expect(newSpecId).toBeTruthy();
    expect(newSpecId).not.toBe(originalSpecId);

    // New spec: version+1, lineage set, name applied, NULL provenance, validated.
    const fresh = await h.as(service, async (c) =>
      (
        await c.query(
          `select version, previous_spec_id, display_name, source_plan_run_id, validated_at from public.agent_specs where id = $1`,
          [newSpecId],
        )
      ).rows[0],
    );
    expect(fresh.version).toBe(2);
    expect(fresh.previous_spec_id).toBe(originalSpecId);
    expect(fresh.display_name).toBe('Echo v2');
    expect(fresh.source_plan_run_id).toBeNull();
    expect(fresh.validated_at).not.toBeNull();

    // The Nibbin is migrated to the new spec.
    const migrated = await h.as(service, async (c) =>
      (await c.query(`select spec_id from public.nibbins where id = $1`, [nibbinId])).rows[0],
    );
    expect(migrated.spec_id).toBe(newSpecId);

    // The OLD spec row is still present and unchanged (immutable snapshot).
    const old = await h.as(service, async (c) =>
      (await c.query(`select id, version, display_name from public.agent_specs where id = $1`, [originalSpecId])).rows[0],
    );
    expect(old.id).toBe(originalSpecId);
    expect(old.version).toBe(1);
    expect(old.display_name).toBe('Echo');

    // An audit row records the re-tune.
    const audit = await h.as(service, async (c) =>
      (
        await c.query(
          `select meta from public.audit_log where action = 'nibbin.retuned' and subject = $1 order by at desc limit 1`,
          [nibbinId],
        )
      ).rows[0],
    );
    expect(audit.meta.previous_spec_id).toBe(originalSpecId);
    expect(audit.meta.version).toBe(2);
  });

  it('authenticated and anon cannot call retune_nibbin (service_role only)', async () => {
    await expect(
      h.as(owner, (c) =>
        c.query(`select public.retune_nibbin($1, $2, $3, 'hack', '[]'::jsonb, '{}'::jsonb)`, [accountId, OWNER, nibbinId]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(anon, (c) =>
        c.query(`select public.retune_nibbin($1, $2, $3, 'hack', '[]'::jsonb, '{}'::jsonb)`, [accountId, OWNER, nibbinId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('rejects a nibbin/account mismatch (defense in depth)', async () => {
    await expect(
      h.as(service, (c) =>
        c.query(`select public.retune_nibbin($1, $2, $3, 'x', null, null)`, [outsiderAccount, OUTSIDER, nibbinId]),
      ),
    ).rejects.toThrow(/not found/);
  });

  it('clients still cannot write agent_specs directly (snapshots stay immutable)', async () => {
    await expect(
      h.as(owner, (c) =>
        c.query(`update public.agent_specs set display_name = 'tamper' where id = $1`, [originalSpecId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
