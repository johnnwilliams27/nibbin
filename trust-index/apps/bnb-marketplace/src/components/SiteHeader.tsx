import Link from 'next/link';
import { SiteNav } from './SiteNav';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-wrap site-header-inner">
        <Link href="/" aria-label="Nibbin BNB Agent Marketplace home" className="site-brand">
          <span className="site-wordmark">Nibbin<span aria-hidden>.</span></span>
          <span className="site-product">BNB Agent Marketplace</span>
        </Link>
      <SiteNav />
      </div>
    </header>
  );
}
