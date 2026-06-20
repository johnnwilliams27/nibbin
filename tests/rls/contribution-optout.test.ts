/**
 * Tier-2 opt-out gate: the model_task_performance aggregate must only include
 * model_calls from accounts with model_contribution_enabled = true (the Data &
 * Privacy "Model improvement" toggle). Opted-out accounts — and account-less
 * system calls — must not flow into the cross-account aggregate that feeds the
 * reinforcement loop.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsHarness } from './harness';

const dbAvailable = await RlsHarness.probe();

describe.skipIf(!dbAvailable)('Tier-2: model_contribution_enabled gates model_task_performance', () => {
  const h = new RlsHarness();
  const service = { kind: 'service_role' } as const;
  const A = '33333333-3333-4333-8333-333333333333';
  const B = '22222222-2222-4222-8222-222222222222';
  const ownerA = { kind: 'authenticated', uid: A } as const;
  const ownerB = { kind: 'authenticated', uid: B } as const;

  let acctA = '';
  let acctB = '';
  const MODEL_A = 'optin-model-zzz';
  const MODEL_B = 'optout-model-zzz';
  const MODEL_NULL = 'noaccount-model-zzz';

  async function calls(model: string, account: string | null, n: number) {
    for (let i = 0; i < n; i++) {
      await h.as(service, (c) =>
        c.query(
          `insert into public.model_calls (account_id, tier, task, model, outcome) values ($1, 't1', 'specialist_draft', $2, 'ok')`,
          [account, model],
        ),
      );
    }
  }

  async function perfRow(model: string) {
    return h.as(service, async (c) =>
      (await c.query(`select calls from public.model_task_performance where model = $1`, [model])).rows[0],
    );
  }

  beforeAll(async () => {
    await h.reset();
    for (const [uid, email] of [
      [A, 'optina@example.test'],
      [B, 'optoutb@example.test'],
    ] as const) {
      await h.sql(`insert into auth.users (id, email) values ($1, $2)`, [uid, email]);
      await h.as({ kind: 'authenticated', uid }, async (c) => {
        await c.query(`insert into public.users (id, email) values ($1, $2)`, [uid, email]);
      });
    }
    acctA = await h.as(ownerA, async (c) =>
      (await c.query(`select public.create_account_with_owner('OptInGrove') as id`)).rows[0].id,
    );
    acctB = await h.as(ownerB, async (c) =>
      (await c.query(`select public.create_account_with_owner('OptOutGrove') as id`)).rows[0].id,
    );
    // B opts OUT.
    await h.as(ownerB, (c) => c.query(`select public.set_model_contribution($1, false)`, [acctB]));

    await calls(MODEL_A, acctA, 3); // opted-in account
    await calls(MODEL_B, acctB, 3); // opted-out account
    await calls(MODEL_NULL, null, 3); // account-less system calls
  });

  afterAll(async () => {
    await h.close();
  });

  it('includes an opted-in account, excludes an opted-out account and account-less calls', async () => {
    const a = await perfRow(MODEL_A);
    expect(a).toBeDefined();
    expect(Number(a.calls)).toBe(3);

    expect(await perfRow(MODEL_B)).toBeUndefined(); // opted out → not aggregated
    expect(await perfRow(MODEL_NULL)).toBeUndefined(); // no consenting account → not aggregated
  });

  it('re-enabling contribution lets the account flow back into the aggregate', async () => {
    await h.as(ownerB, (c) => c.query(`select public.set_model_contribution($1, true)`, [acctB]));
    const b = await perfRow(MODEL_B);
    expect(b).toBeDefined();
    expect(Number(b.calls)).toBe(3);
  });
});
