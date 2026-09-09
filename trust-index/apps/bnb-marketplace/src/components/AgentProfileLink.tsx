'use client';

import Link from 'next/link';
import { BROWSE_RETURN_KEY, safeBrowseReturn } from '@/lib/browse-return';

export function AgentProfileLink({ href, children, ...props }: { href: string; children: React.ReactNode; className?: string; 'aria-label'?: string }) {
  function rememberResults() {
    try { sessionStorage.setItem(BROWSE_RETURN_KEY, safeBrowseReturn(`${window.location.pathname}${window.location.search}`)); } catch { /* Home remains available without storage. */ }
  }
  return <Link href={href} {...props} onClick={rememberResults}>{children}</Link>;
}
