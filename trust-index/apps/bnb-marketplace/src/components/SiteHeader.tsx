import Link from 'next/link';
import { CATEGORIES } from '@/lib/categories';
import { listedAgents, loadDataset } from '@/lib/data';
import { timestamp } from '@/lib/format';

export function SiteHeader() {
  const { generated_at, agents } = loadDataset();
  const listed = listedAgents().length;

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[rgba(11,14,19,0.94)] backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-7 gap-y-2 px-5 py-2.5">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="mono text-[15px] font-semibold tracking-tight">TRUST&nbsp;INDEX</span>
          <span className="eyebrow hidden sm:inline">independent agent assessment · bsc</span>
        </Link>

        <nav aria-label="Agent categories" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          {CATEGORIES.map((c) => (
            <Link
              key={c.path}
              href={`/category/${c.path}`}
              className="text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]"
            >
              {c.name}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4 text-[13px]">
          <Link href="/compare" className="text-[var(--fg-muted)] hover:text-[var(--fg)]">
            Compare
          </Link>
          <Link href="/methodology" className="text-[var(--fg-muted)] hover:text-[var(--fg)]">
            Methodology
          </Link>
          <span
            className="mono hidden text-[10px] uppercase tracking-[0.09em] text-[var(--fg-faint)] lg:inline"
            title={generated_at ? `Snapshot generated ${timestamp(generated_at)}` : 'No snapshot available at build time'}
          >
            {generated_at
              ? `snapshot ${timestamp(generated_at)} · ${agents.length.toLocaleString('en-US')} indexed · ${listed.toLocaleString('en-US')} listed`
              : 'no snapshot'}
          </span>
        </div>
      </div>
    </header>
  );
}
