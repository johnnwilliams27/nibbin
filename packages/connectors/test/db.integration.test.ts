/**
 * M3 migration attack/integration suite — C9 at the database layer.
 *
 * Runs against the same throwaway Postgres as tests/rls (service container in
 * CI, Docker locally): real schema, real policies, real grants. Every claim
 * here is the enforcement behind "tokens in vault only, never app DB;
 * one-click revoke; revocation cascades".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from '../../../tests/rls/harness';

const dbAvailable = await RlsHarness.probe();

it.runIf(process.env.CI)('CI must run the connections suite — database service missing', () => {
  expect(dbAvailable).toBe(true);
});

if (!dbAvailable && !process.env.CI) {
  console.warn('[connectors] no database at RLS_DATABASE_URL / localhost:54329 — skipping DB integration suite');
}

const UID_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const UID_B = 'bbbbbbbb-2222-4222-8222-222222222222';

const TOKEN_PAYLOAD = JSON.stringify({
  accessToken: 'ya29.SECRET-ACCESS',
  refreshToken: '1//SECRET-REFRESH',
  scopes: ['https://www.googleapis.com/auth/gmail.metadata'],
  tokenType: 'Bearer',
});

describe.skipIf(!dbAvailable)('connections + vault (M3 migration, C8/C9)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';
  let connId = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const anon = { kind: 'anon' } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')`, [UID_A, UID_B]);
    for (const [who, uid, name] of [
      [asA, UID_A, 'A Studio'],
      [asB, UID_B, 'B Studio'],
    ] as const) {
      const acct = await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `${name}@example.test`]);
        const r = await c.query(`select public.create_account_with_owner($1) as id`, [name]);
        return (r.rows[0] as { id: string }).id;
      });
      if (uid === UID_A) accountA = acct;
      else accountB = acct;
    }
    // the connection under test, created server-side like the real callback path
    connId = await h.as(service, async (c) => {
      const r = await c.query(
        `insert into public.connections (account_id, provider, method, scopes, status, created_by)
         values ($1, 'gmail', 'H', $2, 'active', $3) returning id`,
        [accountA, ['https://www.googleapis.com/auth/gmail.metadata'], UID_A],
      );
      return (r.rows[0] as { id: string }).id;
    });
  }, 60_000);

  afterAll(async () => {
    await h.close();
  });

  it('creating a connection is audited at the table layer', async () => {
    const r = await h.sql(
      `select count(*)::int as n from public.audit_log where action = 'connection.created' and subject = $1`,
      [connId],
    );
    expect((r.rows[0] as { n: number }).n).toBe(1);
  });

  it('members read their own connections; outsiders and anon read nothing', async () => {
    const mine = await h.as(asA, (c) => c.query(`select id, provider from public.connections`));
    expect(mine.rows).toHaveLength(1);
    const theirs = await h.as(asB, (c) => c.query(`select id from public.connections`));
    expect(theirs.rows).toHaveLength(0);
    await expect(h.as(anon, (c) => c.query(`select id from public.connections`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('clients cannot write connections directly', async () => {
    await expect(
      h.as(asA, (c) =>
        c.query(`insert into public.connections (account_id, provider, method) values ($1, 'gmail', 'H')`, [accountA]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(asA, (c) => c.query(`update public.connections set status = 'active' where id = $1`, [connId])),
    ).rejects.toThrow(/permission denied/);
  });

  it('client roles cannot execute the vault functions at all', async () => {
    for (const fn of [
      `select public.connection_token_store($1, '{"accessToken":"x","scopes":[]}')`,
      `select public.connection_token_read($1)`,
      `select public.connection_revoke($1)`,
    ]) {
      await expect(h.as(asA, (c) => c.query(fn, [connId]))).rejects.toThrow(/permission denied/);
      await expect(h.as(anon, (c) => c.query(fn, [connId]))).rejects.toThrow(/permission denied/);
    }
  });

  it('C9: the token goes to the vault; the app DB row never contains token material', async () => {
    const ref = await h.as(service, async (c) => {
      const r = await c.query(`select public.connection_token_store($1, $2) as ref`, [connId, TOKEN_PAYLOAD]);
      return (r.rows[0] as { ref: string }).ref;
    });
    expect(ref).toMatch(/^[0-9a-f-]{36}$/);

    // vault holds it
    const vaultRow = await h.sql(`select secret from vault.secrets where id = $1`, [ref]);
    expect(vaultRow.rows).toHaveLength(1);

    // the entire connections row (and the whole public schema row image)
    // contains no token material
    const rowImage = await h.sql(`select row_to_json(c)::text as img from public.connections c where id = $1`, [connId]);
    expect((rowImage.rows[0] as { img: string }).img).not.toContain('SECRET-ACCESS');
    expect((rowImage.rows[0] as { img: string }).img).not.toContain('SECRET-REFRESH');

    // and the audit trail records the event without the payload
    const audit = await h.sql(
      `select meta::text as m from public.audit_log where action = 'connection.token_stored' and subject = $1`,
      [connId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const row of audit.rows as Array<{ m: string }>) {
      expect(row.m).not.toContain('SECRET-ACCESS');
    }
  });

  it('service role reads the payload back through the definer fn', async () => {
    const payload = await h.as(service, async (c) => {
      const r = await c.query(`select public.connection_token_read($1) as p`, [connId]);
      return (r.rows[0] as { p: string }).p;
    });
    expect(JSON.parse(payload)).toMatchObject({ accessToken: 'ya29.SECRET-ACCESS' });
  });

  it('refresh rotation replaces the vault secret, never accumulates', async () => {
    const before = await h.sql(`select token_ref from public.connections where id = $1`, [connId]);
    const oldRef = (before.rows[0] as { token_ref: string }).token_ref;
    await h.as(service, (c) =>
      c.query(`select public.connection_token_store($1, $2)`, [connId, TOKEN_PAYLOAD.replace('SECRET-ACCESS', 'ROTATED')]),
    );
    const gone = await h.sql(`select 1 from vault.secrets where id = $1`, [oldRef]);
    expect(gone.rows).toHaveLength(0);
    const count = await h.sql(`select count(*)::int as n from vault.secrets`);
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it('webhook_state physically cannot hold token-shaped keys', async () => {
    await expect(
      h.as(service, (c) =>
        c.query(`update public.connections set webhook_state = '{"access_token":"x"}' where id = $1`, [connId]),
      ),
    ).rejects.toThrow(/check constraint|violates/);
  });

  it('one-click revoke cascades: vault emptied, status flipped, audited, idempotent', async () => {
    await h.as(service, (c) => c.query(`select public.connection_revoke($1, $2)`, [connId, UID_A]));

    const row = await h.sql(`select status, token_ref, revoked_at from public.connections where id = $1`, [connId]);
    expect(row.rows[0]).toMatchObject({ status: 'revoked', token_ref: null });
    expect((row.rows[0] as { revoked_at: Date }).revoked_at).not.toBeNull();

    const vaultCount = await h.sql(`select count(*)::int as n from vault.secrets`);
    expect((vaultCount.rows[0] as { n: number }).n).toBe(0);

    // visible in the account's own audit log, through the member's RLS session
    const audit = await h.as(asA, (c) =>
      c.query(`select 1 from public.audit_log where action = 'connection.revoked' and subject = $1`, [connId]),
    );
    expect(audit.rows).toHaveLength(1);

    // double revoke: no error, no duplicate audit row
    await h.as(service, (c) => c.query(`select public.connection_revoke($1)`, [connId]));
    const again = await h.sql(
      `select count(*)::int as n from public.audit_log where action = 'connection.revoked' and subject = $1`,
      [connId],
    );
    expect((again.rows[0] as { n: number }).n).toBe(1);
  });

  it('revoked connections accept no new tokens and read nothing', async () => {
    await expect(
      h.as(service, (c) => c.query(`select public.connection_token_store($1, $2)`, [connId, TOKEN_PAYLOAD])),
    ).rejects.toThrow(/revoked/);
    await expect(
      h.as(service, (c) => c.query(`select public.connection_token_read($1)`, [connId])),
    ).rejects.toThrow(/no live token/);
  });

  it('webhook_events: unique per (provider, event id); invisible to clients', async () => {
    await h.as(service, (c) =>
      c.query(`insert into public.webhook_events (provider, provider_event_id) values ('stripe', 'evt_1')`),
    );
    await expect(
      h.as(service, (c) =>
        c.query(`insert into public.webhook_events (provider, provider_event_id) values ('stripe', 'evt_1')`),
      ),
    ).rejects.toThrow(/duplicate key/);
    await expect(h.as(asA, (c) => c.query(`select * from public.webhook_events`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('suspended members lose connection visibility (membership status gate)', async () => {
    await h.sql(`update public.memberships set status = 'suspended' where account_id = $1 and user_id = $2`, [
      accountA,
      UID_A,
    ]);
    const rows = await h.as(asA, (c) => c.query(`select id from public.connections`));
    expect(rows.rows).toHaveLength(0);
    await h.sql(`update public.memberships set status = 'active' where account_id = $1 and user_id = $2`, [
      accountA,
      UID_A,
    ]);
  });

  it('account B never gained anything along the way', async () => {
    const rows = await h.as(asB, (c) => c.query(`select id from public.connections`));
    expect(rows.rows).toHaveLength(0);
    expect(accountB).not.toBe(accountA);
  });
});
