'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SiteNav() {
  const pathname = usePathname().replace(/\/$/, '') || '/';
  const links = [
    { href: '/', name: 'Home' },
    { href: '/compare', name: 'Find agents' },
    { href: '/methodology', name: 'How we assess' },
    { href: '/try', name: 'Try a hire' },
  ];
  return <nav aria-label="Main navigation" className="site-nav">
    {links.map((link) => {
      const active = pathname === link.href || (link.href === '/compare' && (pathname.startsWith('/category/') || pathname.startsWith('/agent/'))) || (link.href === '/try' && pathname.startsWith('/try/'));
      return <Link key={link.href} href={link.href} aria-current={active ? 'page' : undefined}
        className="site-nav-link">
        {link.name}
      </Link>;
    })}
  </nav>;
}
