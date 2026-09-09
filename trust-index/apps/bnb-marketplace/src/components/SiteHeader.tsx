import Link from 'next/link';
import { CATEGORIES } from '@/lib/categories';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-understory)] bg-[rgba(245,246,242,0.92)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-[family-name:var(--font-display)] text-[19px] font-extrabold tracking-tight">
            Measured
          </span>
          <span className="eyebrow hidden sm:inline">BNB Chain agent index</span>
        </Link>

        <nav aria-label="Agent categories" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          {CATEGORIES.map((c) => (
            <Link
              key={c.path}
              href={`/category/${c.path}`}
              className="text-[var(--color-ink-secondary)] transition-colors hover:text-[var(--color-ink)]"
            >
              {c.name}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4 text-[13px]">
          <Link href="/compare" className="text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]">
            Compare
          </Link>
          <Link href="/methodology" className="text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]">
            Methodology
          </Link>
        </div>
      </div>
    </header>
  );
}
