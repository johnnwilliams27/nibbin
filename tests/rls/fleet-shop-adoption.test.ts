/**
 * Tier-2 fleet learning: shop_template_performance — anonymized, opt-out-gated,
 * k-anonymous (>=5 distinct contributing accounts) cross-account view of shop
 * template adoption (nibbins, active vs dormant, senior_plus/graduated). Staff-only.
 *
 * Proves: a template with >=5 opted-in adopters is exposed with correct
 * active/dormant/maturity splits; <5 is suppressed; an opted-out account does NOT
 * count toward the cohort; the read RPC + view are service-role/staff only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('Tier-2: shop_template_performance (k-anon + opt-out)', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const anon = { kind: 'anon' } as const;

  const uids: string[] = [];
  const accts: string[] = [];
  let owner1: { kind: 'authenticated'; uid: string };

  /** Seed one nibbin for `account` adopting `template`, with given status/stage. */
  async function seed(account: string, template: string, status = 'active', stage = 'egg') {
    await h.as(service, async (c) => {
      const spec = (
        await c.query(
          `insert into public.agent_specs (account_id, template_key, version, display_name, validated_at)
           values ($1, $2, 1, 'T', now()) returning id`,
          [account, template],
        )
      ).rows[0].id;
      await c.query(
        `insert into public.nibbins (account_id, spec_id, name, species, stage, status)
         values ($1, $2, 'N', 'wisp', $3, $4)`,
        [account, spec, stage, status],
      );
    });
  }

  async function rows() {
    return h.as(service, async (c) =>
      (await c.query(`select * from public.shop_template_performance order by template_key`)).rows,
    );
  }
  const tpl = (rs: Record<string, unknown>[], k: string) => rs.find((r) => r.template_key === k);

  beforeAll(async () => {
    await h.reset();
    for (let i = 1; i <= 6; i++) {
      const uid = `cccccccc-0000-4000-8000-00000000000${i}`;
      uids.push(uid);
      await h.sql(`insert into auth.users (id, email) values ($1, $2)`, [uid, `shop${i}@example.test`]);
      await h.as({ kind: 'authenticated', uid }, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, `shop${i}@example.test`]);
      });
      accts.push(
        await h.as({ kind: 'authenticated', uid }, async (c) =>
          (await c.query(`select public.create_account_with_owner($1) as id`, [`Grove${i}`])).rows[0].id,
        ),
      );
    }
    owner1 = { kind: 'authenticated', uid: uids[0] };
    await h.as({ kind: 'authenticated', uid: uids[5] }, (c) =>
      c.query(`select public.set_model_contribution($1, false)`, [accts[5]]),
    );

    // 'popular': A1-A5 adopt → exposed. A4 is senior (maturity), A5 is sleeping (dormant).
    await seed(accts[0], 'popular');
    await seed(accts[1], 'popular');
    await seed(accts[2], 'popular');
    await seed(accts[3], 'popular', 'active', 'senior');
    await seed(accts[4], 'popular', 'sleeping');
    // 'rare': only A1, A2 → suppressed (<5 accounts).
    await seed(accts[0], 'rare');
    await seed(accts[1], 'rare');
    // 'optout': A1-A4 + A6(opted-out) → 5 contributors but 4 opted-in → suppressed.
    await seed(accts[0], 'optout');
    await seed(accts[1], 'optout');
    await seed(accts[2], 'optout');
    await seed(accts[3], 'optout');
    await seed(accts[5], 'optout');
  });

  afterAll(async () => {
    await h.close();
  });

  it('exposes a template with >=5 opted-in adopters, with correct active/dormant/maturity splits', async () => {
    const p = tpl(await rows(), 'popular');
    expect(p).toBeDefined();
    expect(Number(p!.nibbins)).toBe(5);
    expect(Number(p!.contributing_accounts)).toBe(5);
    expect(Number(p!.active)).toBe(4); // A1-A4 active; A5 sleeping
    expect(Number(p!.dormant)).toBe(1); // A5
    expect(Number(p!.senior_plus)).toBe(1); // A4
    expect(Number(p!.graduated)).toBe(0);
  });

  it('suppresses a template below the k=5 cohort threshold', async () => {
    expect(tpl(await rows(), 'rare')).toBeUndefined(); // 2 accounts
  });

  it('does not count an opted-out account toward the cohort', async () => {
    // 4 opted-in + 1 opted-out = 4 counted < 5 → suppressed.
    expect(tpl(await rows(), 'optout')).toBeUndefined();
  });

  it('read RPC + view are service-role only (authenticated + anon denied)', async () => {
    await expect(
      h.as(owner1, (c) => c.query(`select * from public.shop_template_performance_read()`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(anon, (c) => c.query(`select * from public.shop_template_performance_read()`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(owner1, (c) => c.query(`select * from public.shop_template_performance`)),
    ).rejects.toThrow(/permission denied/);
  });
});
