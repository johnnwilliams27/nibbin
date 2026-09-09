import Link from 'next/link';
import { loadDataset } from '@/lib/data';
import { timestamp, relativeAge } from '@/lib/format';
import { CENSUS_SOURCE } from '@/lib/census';

export function SiteFooter() {
  const { generated_at, agents } = loadDataset();
  const age = relativeAge(generated_at);

  return (
    <footer className="mt-20 border-t border-[var(--color-understory)] bg-[var(--color-canopy)]">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <p className="eyebrow">Data snapshot</p>
            <p className="mt-2 text-[14px] text-[var(--color-ink-secondary)]">
              {generated_at ? (
                <>
                  Built from an index generated {timestamp(generated_at)}
                  {age ? ` (${age})` : ''}, covering {agents.length.toLocaleString('en-US')} agent
                  {agents.length === 1 ? '' : 's'}. This page is a static render of that snapshot, not a live query —
                  every number you see was true at that timestamp.
                </>
              ) : (
                <>
                  No index snapshot was available when this page was built. Nothing on the site is estimated to fill the
                  gap; empty means empty.
                </>
              )}
            </p>
            <p className="mt-3 text-[13px] text-[var(--color-ink-secondary)]">
              <a className="underline underline-offset-2" href="/data/agents.json">
                Download the raw dataset
              </a>{' '}
              and check any figure here against it.
            </p>
          </div>
          <div>
            <p className="eyebrow">How to read this site</p>
            <ul className="mt-2 space-y-1.5 text-[14px] text-[var(--color-ink-secondary)]">
              <li>Assessment scores are ours, produced by calling the agent.</li>
              <li>Feedback counts and verification badges are 8004scan&apos;s, not ours.</li>
              <li>Not rated means we withheld a score, and we say why.</li>
              <li>Our own reference agents are labelled and never ranked.</li>
            </ul>
            <p className="mt-3 text-[13px] text-[var(--color-ink-secondary)]">
              <Link className="underline underline-offset-2" href="/methodology">
                Full methodology
              </Link>
            </p>
          </div>
        </div>
        <p className="mt-8 border-t border-[var(--color-understory)] pt-5 text-[12px] text-[var(--color-ink-secondary)]">
          Population figures: {CENSUS_SOURCE} Nothing here is financial advice — it is a record of what answered when we
          called.
        </p>
      </div>
    </footer>
  );
}
