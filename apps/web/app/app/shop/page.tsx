import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { buildCreature, type Stage } from '@nibbin/creatures';
import { SHOP_TEMPLATES } from '@nibbin/runtime';
import { TIERS, type Tier } from '@nibbin/shared';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { ShopGrid, type ShopCard } from './ShopGrid';
import styles from './shop.module.css';

export const metadata: Metadata = { title: 'Agent Shop — Nibbin' };

// Per-request session read — never statically cached.
export const dynamic = 'force-dynamic';

const STAGE_PILL: Record<Stage, { label: string; className: string }> = {
  egg: { label: 'Egg', className: 'pillEgg' },
  student: { label: 'Student', className: 'pillStudent' },
  senior: { label: 'Senior', className: 'pillSenior' },
  grad: { label: 'Graduate', className: 'pillGrad' },
};

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, accountId, user } = session;
  const params = await searchParams;

  // RLS-scoped reads under the user's own session.
  const [{ data: nibbins }, { data: balanceRow }, { data: sub }] = await Promise.all([
    supabase
      .from('nibbins')
      .select('id, name, stage, status, agent_specs!inner(template_key)')
      .eq('account_id', accountId)
      .eq('kind', 'specialist'),
    supabase.from('credit_balances').select('balance').eq('account_id', accountId).maybeSingle<{ balance: number }>(),
    supabase.from('subscriptions').select('tier').eq('account_id', accountId).maybeSingle<{ tier: Tier }>(),
  ]);

  const adoptedByTemplate = new Map<string, { name: string; stage: Stage; status: string }>();
  for (const n of nibbins ?? []) {
    const specs = n.agent_specs as { template_key: string | null } | Array<{ template_key: string | null }>;
    const key = (Array.isArray(specs) ? specs[0]?.template_key : specs?.template_key) ?? null;
    if (key) adoptedByTemplate.set(key, { name: n.name, stage: n.stage as Stage, status: n.status });
  }

  const tier = sub?.tier ?? 'hatchling';
  const maxNibbins = TIERS[tier].maxNibbins;
  const activeCount = (nibbins ?? []).filter((n) => n.status !== 'sleeping').length;
  const credits = balanceRow?.balance ?? 0;

  // Build card data server-side so SVG generation and adopted-state lookup
  // stay on the server; ShopGrid receives plain-serialisable props.
  const cards: ShopCard[] = SHOP_TEMPLATES.map((t) => {
    const adopted = adoptedByTemplate.get(t.key);
    const stage: Stage = adopted?.stage ?? 'student';
    const pill = STAGE_PILL[adopted?.stage ?? 'egg'];
    const svg = buildCreature({
      species: t.species,
      stage,
      color: t.color,
      acc: t.accessory,
      mark: t.marking,
      size: 88,
    });
    return {
      key: t.key,
      displayName: t.spec.displayName,
      tagline: t.tagline,
      description: t.description,
      measures: t.spec.curriculum.measures,
      requiredConnectors: [...t.spec.requiredConnectors],
      svg,
      adopted: adopted
        ? { name: adopted.name, stage: adopted.stage, pillLabel: pill.label, pillClassName: pill.className }
        : null,
    };
  });

  return (
    <AppShell active="shop" title="Agent Shop" email={user.email}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Room in the grove</h1>
          </div>
          <p className={styles.meter}>
            <span className={styles.meterValue}>{credits}</span> credits ·{' '}
            <span className={styles.meterValue}>{activeCount}</span>
            {maxNibbins !== null ? ` of ${maxNibbins}` : ''} Nibbins
          </p>
        </header>
        <p className={styles.lede}>
          Every Nibbin starts in Agent School: it drafts everything, you approve, and trust is
          earned through verified accuracy — never time served. A Nibbin can never send or change
          anything until you approve that specific action, explained plainly.
        </p>

        {params.limit === '1' && (
          <p className={styles.adoptedNote} role="status">
            Your grove is full for the {tier} plan — nobody gets deleted to make room; growing the
            grove means <a href="/billing">moving up a plan</a>.
          </p>
        )}

        <ShopGrid cards={cards} />
      </div>
    </AppShell>
  );
}
