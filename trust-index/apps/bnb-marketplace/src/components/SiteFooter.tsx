import Link from 'next/link';
import { loadDataset } from '@/lib/data';
import { timestamp, relativeAge } from '@/lib/format';
import { CENSUS_SOURCE } from '@/lib/census';

export function SiteFooter() {
  const { generated_at, agents } = loadDataset();
  const age = relativeAge(generated_at);

  return (
    <footer className="mt-16 border-t border-[var(--border)] bg-[var(--panel)]">
      <div className="mx-auto max-w-[1240px] px-5 py-9">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="eyebrow">Snapshot</p>
            <p className="mt-2 text-[13px] text-[var(--fg-muted)]">
              {generated_at ? (
                <>
                  Index generated <span className="mono text-[var(--fg)]">{timestamp(generated_at)}</span>
                  {age ? ` (${age})` : ''}, covering{' '}
                  <span className="mono text-[var(--fg)]">{agents.length.toLocaleString('en-US')}</span> agent
                  {agents.length === 1 ? '' : 's'}. This site is a static render of that snapshot. Every figure was true
                  at that timestamp and is not re-queried on page load.
                </>
              ) : (
                <>
                  No index snapshot was available when this site was built. Nothing has been estimated to fill the gap.
                </>
              )}
            </p>
            <p className="mt-3 text-[13px]">
              <a className="underline underline-offset-2 text-[var(--measured)]" href="/data/agents.json">
                Download the raw dataset
              </a>
              <span className="text-[var(--fg-muted)]"> — every number on this site is derived from it.</span>
            </p>
          </div>

          <div>
            <p className="eyebrow">Reading the numbers</p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-[var(--fg-muted)]">
              <li>
                <span style={{ color: 'var(--measured)' }}>Assessment</span> figures are ours, produced by calling the
                agent.
              </li>
              <li>
                <span style={{ color: 'var(--thirdparty)' }}>Feedback and verification</span> figures are 8004scan&apos;s.
                We report them; we did not verify them.
              </li>
              <li>
                <span style={{ color: 'var(--withheld)' }}>Not rated</span> means we withheld a score, with the reason
                stated.
              </li>
              <li>
                <span style={{ color: 'var(--reference)' }}>Reference agents</span> are ours and are excluded from every
                ranking.
              </li>
            </ul>
          </div>

          <div>
            <p className="eyebrow">Audit</p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-[var(--fg-muted)]">
              <li>
                <Link className="underline underline-offset-2" href="/methodology">
                  Methodology, scoring and withholding rules
                </Link>
              </li>
              <li>
                <Link className="underline underline-offset-2" href="/compare">
                  Full cross-category comparison table
                </Link>
              </li>
              <li>ERC-8004 identity registry, chain 56 (BNB Smart Chain).</li>
            </ul>
          </div>
        </div>

        <p className="mt-8 border-t border-[var(--border)] pt-5 text-[12px] text-[var(--fg-faint)]">
          Population figures: {CENSUS_SOURCE} Trust Index is an assessor, not a marketplace participant: it does not
          operate, sell or take payment for any agent listed here. Nothing on this site is financial advice — it is a
          record of what answered when we called.
        </p>
      </div>
    </footer>
  );
}
