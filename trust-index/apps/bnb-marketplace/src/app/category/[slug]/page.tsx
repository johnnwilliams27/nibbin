import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CATEGORIES, CATEGORY_BY_PATH } from '@/lib/categories';
import { agentsInCategory, categoryStats } from '@/lib/data';
import { num } from '@/lib/format';
import { AgentExplorer } from '@/components/AgentExplorer';
import { DataStatusBanner } from '@/components/DataStatus';
import { StatTile } from '@/components/StatTile';

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.path }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const meta = CATEGORY_BY_PATH.get(slug);
  if (!meta) return {};
  return { title: `${meta.name} agents`, description: meta.blurb };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = CATEGORY_BY_PATH.get(slug);
  if (!meta) notFound();

  const all = agentsInCategory(meta.slug);
  const ranked = all.filter((a) => !a.is_reference_agent);
  const reference = all.filter((a) => a.is_reference_agent);
  const stats = categoryStats(meta.slug);

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-9">
      <nav className="text-[12px] text-[var(--fg-faint)]">
        <Link href="/" className="hover:text-[var(--fg)]">
          Index
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--fg-muted)]">{meta.name}</span>
      </nav>

      <header className="mt-4 border-l-2 pl-4" style={{ borderColor: meta.accent }}>
        <p className="mono text-[10px] uppercase tracking-[0.09em]" style={{ color: meta.accent }}>
          Category
        </p>
        <h1 className="mt-1.5 text-[28px]">{meta.name}</h1>
        <p className="mt-2 max-w-3xl text-[15px] text-[var(--fg-muted)]">{meta.blurb}</p>
        <dl className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-2">
          <div>
            <dt className="eyebrow">What it touches</dt>
            <dd className="mt-1 text-[13px] text-[var(--fg-muted)]">{meta.handles}</dd>
          </div>
          <div>
            <dt className="eyebrow">Ask before you hire one</dt>
            <dd className="mt-1 text-[13px] text-[var(--fg-muted)]">{meta.buyerQuestion}</dd>
          </div>
        </dl>
      </header>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Indexed" value={stats.total} note="Excludes our reference agents." source="onchain" />
        <StatTile
          label="We assessed"
          value={stats.assessed}
          note={`${stats.rated} rated, ${stats.withheld} withheld with a stated reason.`}
          source="measured"
          tone="var(--measured)"
        />
        <StatTile
          label="Median score"
          value={
            stats.medianComposite === null
              ? 'n/a'
              : String(Math.round(stats.medianComposite <= 1 ? stats.medianComposite * 100 : stats.medianComposite))
          }
          note={stats.medianComposite === null ? 'Nothing in this category has been rated yet.' : 'Median across rated agents only. Withheld scores are not counted as zero.'}
          source="measured"
          tone="var(--measured)"
        />
        <StatTile
          label="Gates fired"
          value={stats.gatesFired}
          note="Agents that tripped a hard safety cap during assessment."
          source="measured"
          tone={stats.gatesFired > 0 ? 'var(--critical)' : undefined}
        />
        <StatTile
          label="Ecosystem verified"
          value={stats.ecosystemVerified}
          note="8004scan's endpoint verification, not ours."
          source="third_party"
          tone="var(--thirdparty)"
        />
      </div>

      {all.length === 0 ? (
        <div className="mt-8">
          <DataStatusBanner />
          <div className="card mt-4 p-6">
            <p className="font-medium">No {meta.name.toLowerCase()} agents in this snapshot</p>
            <p className="mt-1.5 max-w-2xl text-[14px] text-[var(--fg-muted)]">
              Either the index had not been built when this site was deployed, or nothing in the population classified
              into this category above our confidence threshold. We have not moved agents in from elsewhere to fill the
              page.
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-[13px]">
              {CATEGORIES.filter((c) => c.slug !== meta.slug).map((c) => (
                <Link
                  key={c.path}
                  href={`/category/${c.path}`}
                  className="rounded-[var(--radius-btn)] border border-[var(--border)] px-3 py-2"
                >
                  Try {c.name.toLowerCase()}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <h2 className="text-[16px]">
            {num(ranked.length)} {meta.name.toLowerCase()} agent{ranked.length === 1 ? '' : 's'}
          </h2>
          <p className="mt-1 max-w-3xl text-[14px] text-[var(--fg-muted)]">
            Sorted by our assessment by default. Agents we could not rate are listed under the ranking with the reason,
            never folded into it with a placeholder score.
          </p>
          <div className="mt-5">
            <AgentExplorer agents={ranked} reference={reference} />
          </div>
        </div>
      )}
    </div>
  );
}
