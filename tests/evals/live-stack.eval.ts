/**
 * M6.5 live-stack verification — the DoD items that only count against the
 * REAL stack: hosted dev Supabase + the live model API, no stubs anywhere.
 *
 *  - a seeded account's Nibbin run produces a REAL model draft that lands
 *    in the approval queue (runs/run_steps/model_calls rows)
 *  - keeper chat answers with a real model reply and records COGS
 *  - the durable frontier budget grants-then-degrades against the live RPC
 *  - scan summary (T1) and diagnosis (T2/Opus pin) produce real output
 *
 * Creates one clearly-named synthetic account on DEV per run (staging uses
 * synthetic data only — AGREEMENTS; account deletion is #29, so rows stay).
 * Requires ANTHROPIC_API_KEY + the dev Supabase secrets from
 * apps/web/.env.local, which this file loads itself.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// ── env first: the app modules read these at call time ──────────────────────
const envPath = fileURLToPath(new URL('../../apps/web/.env.local', import.meta.url));
try {
  // dotenv semantics: the LAST occurrence of a key wins (the env file
  // carries a fixed key appended below its stale predecessor)
  const fromFile: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) fromFile[m[1]] = m[2].trim();
  }
  for (const [k, v] of Object.entries(fromFile)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
} catch {
  // missing env file → suite skips below
}
process.env.NIBBIN_DEV_SEED = '1';

const LIVE =
  Boolean(process.env.ANTHROPIC_API_KEY) &&
  Boolean(process.env.SUPABASE_SECRET_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

if (!LIVE) console.warn('[live-stack] missing ANTHROPIC_API_KEY / Supabase env — skipped');

describe.skipIf(!LIVE)('M6.5 live stack (hosted dev + real model)', () => {
  const stamp = `m65-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let accountId = '';
  let userId = '';
  let nibbinId = '';

  afterAll(async () => {
    const { evalCostSummary } = await import('./harness');
    console.log(evalCostSummary());
  });

  it('seeds a synthetic dev account end to end', async () => {
    const { serviceClient } = await import('../../apps/web/lib/supabase/service');
    const svc = serviceClient();

    const { data: created, error: userErr } = await svc.auth.admin.createUser({
      email: `${stamp}@verify.nibbin.test`,
      email_confirm: true,
    });
    expect(userErr).toBeNull();
    userId = created!.user!.id;
    await svc.from('users').insert({ id: userId, email: `${stamp}@verify.nibbin.test` });

    const { data: acct, error: acctErr } = await svc
      .from('accounts')
      .insert({ name: `M6.5 live verification (${stamp})` })
      .select('id')
      .single();
    expect(acctErr).toBeNull();
    accountId = acct!.id;

    await svc.from('memberships').insert({ account_id: accountId, user_id: userId, role: 'owner', status: 'active' });
    await svc.from('grove_state').insert({
      account_id: accountId,
      keeper_name: 'Sprig',
      onboarding_step: 'done',
      answers: { craft: 'photographer', time: 'inbox', channels: ['email'] },
    });
    const { error: grantErr } = await svc
      .from('credit_ledger')
      .insert({ account_id: accountId, delta: 1000, reason: 'grant', source_id: stamp });
    expect(grantErr).toBeNull();

    const { seedDevConnections } = await import('../../apps/web/lib/scan/run');
    await seedDevConnections(accountId);

    // adopt with the REAL shop template snapshot — the same shape the shop
    // flow writes (an empty credit profile would leave the runner without a
    // weight class)
    const { getTemplate } = await import('@nibbin/runtime');
    const template = getTemplate('scribe');
    const { data: adopted, error: adoptErr } = await svc.rpc('adopt_nibbin', {
      p_account: accountId,
      p_actor_user: userId,
      p_template_key: 'scribe',
      p_version: template.spec.version,
      p_display_name: template.spec.displayName,
      p_tools_allowlist: template.spec.toolsAllowlist,
      p_required_connectors: template.spec.requiredConnectors,
      p_triggers: template.spec.triggers,
      p_curriculum: template.spec.curriculum,
      p_credit_profile: template.spec.creditProfile,
      p_name: 'Inka',
      p_species: 'Wisp',
      p_palette: null,
      p_accessory: null,
      p_marking: null,
      p_seed: 7,
    });
    expect(adoptErr).toBeNull();
    nibbinId = (adopted as Array<{ nibbin_id: string }>)[0].nibbin_id;

    // grove answers exist → the egg has observed context; leave the egg
    const { error: promoteErr } = await svc.rpc('nibbin_promote', { p_nibbin: nibbinId });
    expect(promoteErr).toBeNull();
  }, 60_000);

  it('a real Nibbin run drafts with the live model into the approval queue', async () => {
    const { triggerNibbinRun } = await import('../../apps/web/lib/runtime/engine');
    const outcome = await triggerNibbinRun(nibbinId, { kind: 'user' });
    expect(outcome.kind).toBe('awaiting_approval');
    if (outcome.kind !== 'awaiting_approval') throw new Error('unreachable');
    console.log(`[live-stack] DRAFT (${outcome.draft.title}):\n${outcome.draft.draft}\n`);
    expect(outcome.draft.draft.length).toBeGreaterThan(40);

    const { serviceClient } = await import('../../apps/web/lib/supabase/service');
    const svc = serviceClient();
    const { data: run } = await svc.from('runs').select('status').eq('id', outcome.runId).single();
    expect(run?.status).toBe('awaiting_approval');
    const { data: calls } = await svc
      .from('model_calls')
      .select('task, tier, model, input_tokens, output_tokens, cost_microusd, run_id')
      .eq('account_id', accountId)
      .eq('task', 'specialist_draft');
    expect(calls?.length).toBeGreaterThan(0);
    expect(calls![0].run_id).toBe(outcome.runId);
    expect(calls![0].tier).toBe('t1');
    expect(calls![0].output_tokens).toBeGreaterThan(0);
    console.log('[live-stack] specialist_draft COGS row:', JSON.stringify(calls![0]));
  }, 90_000);

  it('keeper chat answers with a real model voice and records COGS', async () => {
    const { keeperChat, KEEPER_SYSTEM_PROMPT, buildKeeperContext } = await import('@nibbin/keeper');
    const { groveRouter } = await import('../../apps/web/lib/grove/router');
    const { anthropicGenerate, recordModelCall } = await import('../../apps/web/lib/llm/client');

    const llm = anthropicGenerate();
    expect(llm).not.toBeNull();
    let usage: Parameters<typeof recordModelCall>[0]['usage'] | null = null;
    let servedModel = '';
    const reply = await keeperChat(
      'Can you send the invoice reminder to my client right now?',
      { userId, keeperName: 'Sprig' },
      {
        route: (r) => groveRouter.route(r),
        generate: async (model, text) => {
          const result = await llm!({
            model,
            system: [
              { text: KEEPER_SYSTEM_PROMPT, cache: true },
              { text: buildKeeperContext({ keeperName: 'Sprig' }) },
            ],
            messages: [{ role: 'user', content: text }],
            maxTokens: 400,
            temperature: 0.7,
          });
          usage = result.usage;
          servedModel = result.model;
          return result.text;
        },
      },
    );
    expect(reply.decision.model).not.toBe('scripted-floor');
    if (reply.message.card.kind !== 'prose') throw new Error('expected prose');
    console.log(`[live-stack] KEEPER: ${reply.message.card.text}\n`);
    // C10 in the live voice: it must not claim to have sent anything
    expect(/i('ve| have) sent|sent it|done!/i.test(reply.message.card.text)).toBe(false);
    await recordModelCall({
      accountId,
      userId,
      tier: reply.decision.tier,
      task: 'chat',
      model: servedModel,
      usage: usage!,
    });
  }, 90_000);

  it('the durable budget grants to the limit then degrades, against the live RPC', async () => {
    const { createRouter } = await import('@nibbin/router');
    const { pgBudgetStore } = await import('../../apps/web/lib/grove/budget-store');
    const router = createRouter({ dailyFrontierBudget: 2, budgetStore: pgBudgetStore() });
    const T2 = `Plan a complete end-to-end overhaul of my booking workflow. First, audit the current intake.
      Then design the new flow step by step:
      1. capture
      2. qualify
      3. follow up
      Finally, summarize the strategy.`;
    const a = await router.route({ userId, task: 'chat', origin: 'chat', text: T2 });
    const b = await router.route({ userId, task: 'chat', origin: 'chat', text: T2 });
    const c = await router.route({ userId, task: 'chat', origin: 'chat', text: T2 });
    expect([a.degraded, b.degraded, c.degraded]).toEqual([false, false, true]);
    expect(c.notice).toBeTruthy();
    const { serviceClient } = await import('../../apps/web/lib/supabase/service');
    const { data } = await serviceClient().from('frontier_budget').select('used').eq('user_id', userId);
    expect(data?.[0]?.used).toBe(2);
    console.log('[live-stack] budget: grant, grant, degrade — frontier_budget.used =', data?.[0]?.used);
  }, 60_000);

  it('scan summary (T1) and diagnosis (T2/Opus) produce real output', async () => {
    const { scanSummaryLine, diagnosisSynthesis } = await import('../../apps/web/lib/llm/synthesis');
    const findings = [
      { insight: 'You answered 11 inquiries by hand last week.' },
      { insight: 'Four gallery deliveries went out late after manual chasing.' },
    ] as Parameters<typeof scanSummaryLine>[2];

    const summary = await scanSummaryLine(accountId, userId, findings);
    expect(summary).toBeTruthy();
    console.log(`[live-stack] SCAN SUMMARY: ${summary}\n`);

    const diagnosis = await diagnosisSynthesis(accountId, userId, {
      sections: [
        { title: 'Week shape', content: 'Mornings: inbox triage ~90 min. Afternoons: editing blocks, interrupted by booking questions.' },
        { title: 'Leaks', content: 'Gallery delivery chasing (4x/week), invoice nudges (3 overdue), rescheduling ping-pong.' },
      ],
    });
    expect(diagnosis.kind).toBe('ok');
    if (diagnosis.kind !== 'ok') throw new Error('diagnosis did not produce output');
    expect(diagnosis.model).toContain('opus');
    console.log(`[live-stack] DIAGNOSIS (${diagnosis.model}, free=${diagnosis.free}, first 300 chars):\n${diagnosis.text.slice(0, 300)}…\n`);

    const { serviceClient } = await import('../../apps/web/lib/supabase/service');
    const { data: cogs } = await serviceClient().rpc('account_model_cogs', { p_account: accountId, p_days: 1 });
    console.log('[live-stack] account COGS:', JSON.stringify(Array.isArray(cogs) ? cogs[0] : cogs));
  }, 120_000);
});
