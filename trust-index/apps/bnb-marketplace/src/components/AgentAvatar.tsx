'use client';

import { useState } from 'react';
import { avatarPresentation } from '@/lib/avatar';

export function AgentAvatar({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { src, initials } = avatarPresentation(imageUrl, name, failedUrl);

  return (
    <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[18px] font-semibold text-[var(--fg-muted)]">
      {src ? <img src={src} alt="" width={56} height={56} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(src)} className="size-full object-cover" /> : initials}
    </span>
  );
}
