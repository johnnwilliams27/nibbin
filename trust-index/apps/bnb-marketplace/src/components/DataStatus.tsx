import { CircleDashed } from 'lucide-react';
import { loadDataset } from '@/lib/data';
import { timestamp } from '@/lib/format';

export { EmptyState } from './EmptyState';

/**
 * The index pipeline runs independently of this build. If it had not finished
 * when the site was built, say so plainly — what happened, what is unaffected,
 * what to do — rather than shipping a page that looks broken or, worse, full.
 *
 * An empty index is a real state of the world here, and the site is supposed to
 * read well in it. The population figures, the categories, the provenance rules
 * and the methodology are all still true and still on the page.
 */
export function DataStatusBanner() {
  const { generated_at, agents, status } = loadDataset();
  if (agents.length > 0) return null;

  return (
    <section
      aria-label="Index status"
      className="rounded-[var(--radius-shell)] border p-5"
      style={{ borderColor: 'var(--withheld)', background: 'var(--withheld-bg)' }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <CircleDashed
          size={18}
          strokeWidth={1.5}
          className="mt-0.5 shrink-0"
          style={{ color: 'var(--withheld)' }}
          aria-hidden
        />
        <div className="min-w-[260px] flex-1">
          <p className="text-[15px] font-medium" style={{ color: 'var(--withheld)' }}>
            No agent records in this build
          </p>
          <p className="mt-1.5 max-w-2xl text-[13px] text-[var(--fg-muted)]">
            The index snapshot was empty when this site was compiled, so there are no listings to show. That is the
            pipeline&apos;s state, not a failure of the page: the population figures, the categories, the
            provenance rules and the methodology are unaffected and still true.
          </p>
          <p className="mt-2 max-w-2xl text-[13px] text-[var(--fg-muted)]">
            We have not filled the gap with sample agents, demo records or estimates. An index that invents rows to look
            populated is worth less than an empty one that says so.
          </p>

          <dl className="mono mt-4 grid gap-x-8 gap-y-1.5 text-[11px] sm:grid-cols-2">
            <div className="flex justify-between gap-3 border-b border-[var(--border)] pb-1.5">
              <dt className="text-[var(--fg-faint)]">records</dt>
              <dd>0</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-[var(--border)] pb-1.5">
              <dt className="text-[var(--fg-faint)]">generated_at</dt>
              <dd>{generated_at ? timestamp(generated_at) : 'null'}</dd>
            </div>
            {status ? (
              <div className="flex justify-between gap-3 border-b border-[var(--border)] pb-1.5 sm:col-span-2">
                <dt className="shrink-0 text-[var(--fg-faint)]">producer status</dt>
                <dd className="text-right" style={{ color: 'var(--withheld)' }}>
                  {status}
                </dd>
              </div>
            ) : null}
          </dl>

          <p className="mt-3 text-[12px] text-[var(--fg-faint)]">
            Listings appear on the next build after the pipeline writes <span className="mono">data/agents.json</span>.
            The exact snapshot this site was built from is always downloadable at{' '}
            <a className="mono underline underline-offset-2" href="/data/agents.json">
              /data/agents.json
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
