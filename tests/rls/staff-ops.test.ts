/**
 * Staff operations (admin console, §6.10) — the DB-layer backstop. These run as
 * the service role (the admin server) and must keep the audit/append-only
 * invariants regardless of app bugs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('staff operations (SPEC §6.10)', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const anon = { kind: 'anon' } as const;

  const UID = '66666666-6666-4666-8666-666666666666';
  let accountId = '';
  let supportId = '';
  let engineerId = '';

  beforeAll(async () => {
    await h.reset();
    await h.sql(`insert into auth.users (id, email) values ($1, 'u@example.test')`, [UID]);
    await h.as({ kind: 'authenticated', uid: UID } as const, async (c) => {
      await c.query(`insert into public.users (id, email, name) values ($1, 'u@example.test', 'U')`, [UID]);
    });
    accountId = await h.as({ kind: 'authenticated', uid: UID } as const, async (c) =>
      (await c.query(`select public.create_account_with_owner('Acct') as id`)).rows[0].id,
    );
    await h.as(service, async (c) => {
      supportId = (
        await c.query(`insert into public.staff_users (email, role) values ('support@nibbin.com', 'support') returning id`)
      ).rows[0].id;
      engineerId = (
        await c.query(`insert into public.staff_users (email, role) values ('eng@nibbin.com', 'engineer') returning id`)
      ).rows[0].id;
    });
  });

  afterAll(async () => {
    await h.close();
  });

  describe('staff_role_for_email', () => {
    it('resolves a staff email to its role, case-insensitively', async () => {
      const role = await h.as(service, async (c) =>
        (await c.query(`select public.staff_role_for_email('SUPPORT@nibbin.com') as r`)).rows[0].r,
      );
      expect(role).toBe('support');
    });

    it('returns null for a non-staff email', async () => {
      const role = await h.as(service, async (c) =>
        (await c.query(`select public.staff_role_for_email('u@example.test') as r`)).rows[0].r,
      );
      expect(role).toBeNull();
    });

    it('is not callable by anon or authenticated', async () => {
      await expect(
        h.as(anon, (c) => c.query(`select public.staff_role_for_email('x')`)),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('staff_adjust_credits', () => {
    it('grants credits as an append-only ledger entry + an audit row, atomically', async () => {
      await h.as(service, async (c) => {
        await c.query(`select public.staff_adjust_credits($1, 500, 'goodwill', $2)`, [accountId, supportId]);
      });
      const balance = await h.as(service, async (c) =>
        (await c.query(`select sum(delta)::int as b from public.credit_ledger where account_id = $1`, [accountId])).rows[0].b,
      );
      expect(balance).toBe(500);
      const audit = await h.as(service, async (c) =>
        (await c.query(`select actor, action, meta from public.audit_log where action = 'credit.adjusted' and account_id = $1`, [accountId])).rows,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: 'staff', action: 'credit.adjusted' });
      expect(audit[0].meta).toMatchObject({ delta: 500, reason: 'goodwill' });
    });

    it('clawback writes a negative ledger entry', async () => {
      await h.as(service, async (c) => {
        await c.query(`select public.staff_adjust_credits($1, -200, 'chargeback', $2)`, [accountId, supportId]);
      });
      const balance = await h.as(service, async (c) =>
        (await c.query(`select sum(delta)::int as b from public.credit_ledger where account_id = $1`, [accountId])).rows[0].b,
      );
      expect(balance).toBe(300);
    });

    it('requires a non-empty reason and a non-zero delta', async () => {
      await expect(
        h.as(service, (c) => c.query(`select public.staff_adjust_credits($1, 100, '  ', $2)`, [accountId, supportId])),
      ).rejects.toThrow(/reason is required/);
      await expect(
        h.as(service, (c) => c.query(`select public.staff_adjust_credits($1, 0, 'noop', $2)`, [accountId, supportId])),
      ).rejects.toThrow(/non-zero/);
    });

    it('rejects an unknown staff actor or unknown account', async () => {
      await expect(
        h.as(service, (c) =>
          c.query(`select public.staff_adjust_credits($1, 100, 'x', gen_random_uuid())`, [accountId]),
        ),
      ).rejects.toThrow(/unknown staff actor/);
      await expect(
        h.as(service, (c) =>
          c.query(`select public.staff_adjust_credits(gen_random_uuid(), 100, 'x', $1)`, [supportId]),
        ),
      ).rejects.toThrow(/unknown account/);
    });

    it('the resulting ledger rows remain immutable (append-only holds)', async () => {
      await expect(
        h.as(service, (c) => c.query(`update public.credit_ledger set delta = 9 where account_id = $1`, [accountId])),
      ).rejects.toThrow(/append-only/);
    });

    it('is not callable by anon or authenticated', async () => {
      await expect(
        h.as(anon, (c) => c.query(`select public.staff_adjust_credits($1, 1, 'x', $2)`, [accountId, supportId])),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('staff_start_impersonation', () => {
    it('starts a read session and writes the account-visible audit row', async () => {
      const sess = await h.as(service, async (c) =>
        (await c.query(`select public.staff_start_impersonation($1, $2, 'ticket 7', 'read') as id`, [accountId, supportId])).rows[0].id,
      );
      expect(sess).toBeTruthy();
      // member of the account sees it in their own audit log
      const visible = await h.as({ kind: 'authenticated', uid: UID } as const, async (c) =>
        (await c.query(`select count(*)::int as n from public.audit_log where action = 'impersonation.started'`)).rows[0].n,
      );
      expect(visible).toBe(1);
    });

    it('act scope requires superadmin — support is refused', async () => {
      await expect(
        h.as(service, (c) =>
          c.query(`select public.staff_start_impersonation($1, $2, 'reason', 'act')`, [accountId, supportId]),
        ),
      ).rejects.toThrow(/act scope requires superadmin/);
    });

    it('requires a reason and a valid scope', async () => {
      await expect(
        h.as(service, (c) =>
          c.query(`select public.staff_start_impersonation($1, $2, '', 'read')`, [accountId, engineerId]),
        ),
      ).rejects.toThrow(/reason is required/);
      await expect(
        h.as(service, (c) =>
          c.query(`select public.staff_start_impersonation($1, $2, 'r', 'delete')`, [accountId, engineerId]),
        ),
      ).rejects.toThrow(/scope must be read or act/);
    });
  });
});
