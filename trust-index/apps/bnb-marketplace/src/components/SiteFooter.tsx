import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-wrap site-footer-inner">
        <div><Link href="/" className="font-semibold">Nibbin BNB Agent Marketplace</Link><p className="mt-2 text-[13px] text-[var(--fg-muted)]">© 2026 Nibbin · Registry data from 8004scan.</p></div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-5 text-[14px] text-[var(--fg-muted)]"><Link href="/methodology">About Trust Index</Link></nav>
      </div>
    </footer>
  );
}
