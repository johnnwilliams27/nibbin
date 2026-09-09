import Link from 'next/link';
import { CATEGORIES } from '@/lib/categories';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[860px] px-5 py-16">
      <p className="eyebrow">404</p>
      <h1 className="mt-2 text-[26px]">Nothing is indexed at this address</h1>
      <p className="mt-2 text-[15px] text-[var(--fg-muted)]">
        The agent you asked for is not in the current snapshot. Either it was never indexed, or it appeared after this
        site was built. Nothing is broken and nothing has been lost.
      </p>
      <div className="mt-6 flex flex-wrap gap-3 text-[13px]">
        <Link
          href="/"
          className="rounded-[var(--radius-btn)] border px-3 py-2"
          style={{ borderColor: 'var(--measured)', color: 'var(--measured)' }}
        >
          Back to the index
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c.path}
            href={`/category/${c.path}`}
            className="rounded-[var(--radius-btn)] border border-[var(--border)] px-3 py-2"
          >
            {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
