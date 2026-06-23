/**
 * Migration test — Task 3 (P4 Nango connector lane):
 * Verifies that the nango_connection_id + nango_provider_config_key columns
 * are present on the connections table after migration, and that:
 *  - Both columns are nullable (no constraint breaks existing [H]/[G]/[A] rows)
 *  - Existing connections rows accept null in both new columns
 *  - [N] method is now accepted by the method check constraint
 *  - RLS on connections is unchanged: only the owning account can read its rows
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();
if (!dbAvailable && !process.env.CI) {
  console.warn('[rls] no database — skipping nango-connection-cols suite');
}

const UID_A = 'aaa00001-0001-4001-8001-000100010001';
const UID_B = 'bbb00002-0002-4002-8002-000200020002';

describe.skipIf(!dbAvailable)('nango_connection_id + nango_provider_config_key migration (Task 3)', () => {
  const h = new RlsHarness();
  let accountA = '';
  let accountB = '';

  const asA = { kind: 'authenticated', uid: UID_A } as const;
  const asB = { kind: 'authenticated', uid: UID_B } as const;
  const service = { kind: 'service_role' } as const;

  beforeAll(async () => {
    await h.reset();
    await h.sql(
      `insert into auth.users (id, email) values ($1, 'na@example.test'), ($2, 'nb@example.test')`,
      [UID_A, UID_B],
    );
    for (const [who, uid] of [
      [asA, UID_A],
      [asB, UID_B],
    ] as const) {
      await h.as(who, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `${uid}@example.test`]);
      });
    }
    accountA = await h.as(asA, async (c) =>
      (await c.query(`select public.create_account_with_owner('Nango Studio A') as id`)).rows[0].id,
    );
    accountB = await h.as(asB, async (c) =>
      (await c.query(`select public.create_account_with_owner('Nango Studio B') as id`)).rows[0].id,
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it('nango_connection_id column exists and is nullable', async () => {
    const { rows } = await h.sql(
      `select column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'connections'
         and column_name = 'nango_connection_id'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('text');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('nango_provider_config_key column exists and is nullable', async () => {
    const { rows } = await h.sql(
      `select column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'connections'
         and column_name = 'nango_provider_config_key'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('text');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('existing [H] connection row can be inserted with null nango columns (no behavior change)', async () => {
    await h.as(service, async (c) => {
      await c.query(
        `insert into public.connections (account_id, provider, method, scopes, status)
         values ($1, 'gmail', 'H', '{}', 'pending')`,
        [accountA],
      );
    });
    const { rows } = await h.sql(
      `select nango_connection_id, nango_provider_config_key
       from public.connections
       where account_id = $1 and provider = 'gmail'`,
      [accountA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nango_connection_id).toBeNull();
    expect(rows[0].nango_provider_config_key).toBeNull();
  });

  it('[N] method is now accepted by the method check constraint', async () => {
    await expect(
      h.as(service, async (c) =>
        c.query(
          `insert into public.connections (account_id, provider, method, scopes, status, nango_connection_id, nango_provider_config_key)
           values ($1, 'gmail', 'N', '{}', 'pending', 'nibbin-acc-test-gmail', 'google-mail')`,
          [accountB],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('[N] connection row stores nango identifiers and they are readable by the owning account', async () => {
    const { rows } = await h.as(asB, async (c) =>
      c.query(
        `select nango_connection_id, nango_provider_config_key, method
         from public.connections
         where account_id = $1 and provider = 'gmail'`,
        [accountB],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nango_connection_id).toBe('nibbin-acc-test-gmail');
    expect(rows[0].nango_provider_config_key).toBe('google-mail');
    expect(rows[0].method).toBe('N');
  });

  it('RLS unchanged: account B cannot read account A connections', async () => {
    const { rows } = await h.as(asB, async (c) =>
      c.query(`select id from public.connections where account_id = $1`, [accountA]),
    );
    expect(rows).toHaveLength(0);
  });

  it('comment on nango_connection_id column is set', async () => {
    const { rows } = await h.sql(
      `select col_description(
         (select oid from pg_class where relname = 'connections' and relnamespace = (select oid from pg_namespace where nspname = 'public')),
         (select attnum from pg_attribute
          where attrelid = (select oid from pg_class where relname = 'connections' and relnamespace = (select oid from pg_namespace where nspname = 'public'))
            and attname = 'nango_connection_id')
       ) as comment`,
    );
    expect(rows[0].comment).toBeTruthy();
    expect(rows[0].comment).toContain('Nango');
  });
});
