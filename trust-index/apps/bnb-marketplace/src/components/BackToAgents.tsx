'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { BROWSE_RETURN_KEY, safeBrowseReturn } from '@/lib/browse-return';

export function BackToAgents() {
  const [href, setHref] = useState('/#browse');
  useEffect(() => {
    try { setHref(safeBrowseReturn(sessionStorage.getItem(BROWSE_RETURN_KEY))); } catch { /* Direct visits fall back to Home. */ }
  }, []);
  return <Link href={href} className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 text-[15px] font-medium hover:bg-[var(--panel-2)]"><ArrowLeft size={17} strokeWidth={1.5} aria-hidden />Back to agents</Link>;
}
