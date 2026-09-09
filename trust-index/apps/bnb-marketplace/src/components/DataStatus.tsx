import { Loader } from 'lucide-react';
import { loadDataset } from '@/lib/data';
import { timestamp } from '@/lib/format';

export { EmptyState } from './EmptyState';

/**
 * The index pipeline runs independently of this build. If it had not finished
 * when the site was built, say that plainly — what happened, what is safe, what
 * to do — rather than shipping a page that looks broken or, worse, full.
 */
export function DataStatusBanner() {
  const { generated_at, agents } = loadDataset();
  if (agents.length > 0) return null;

  return (
    <div
      className="rounded-[var(--radius-shell)] border p-5"
      style={{ background: 'var(--withheld-bg)', borderColor: 'var(--withheld)' }}
    >
      <div className="flex items-start gap-3">
        <Loader size={18} strokeWidth={1.5} className="mt-0.5 shrink-0" style={{ color: 'var(--withheld)' }} aria-hidden />
        <div>
          <p className="font-semibold" style={{ color: 'var(--withheld)' }}>
            The index is still building
          </p>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--fg)]">
            This build found no agent records, so there is nothing to list yet. Everything you can read below —
            the population figures, the method, the categories — is unaffected. Nothing on this page has been
            filled in with estimates to cover the gap.
          </p>
          <p className="mt-2 text-[13px] text-[var(--fg-muted)]">
            Rebuild once the pipeline has written <span className="mono">data/agents.json</span> and the listings appear.
            {generated_at ? ` Last snapshot seen: ${timestamp(generated_at)}.` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
