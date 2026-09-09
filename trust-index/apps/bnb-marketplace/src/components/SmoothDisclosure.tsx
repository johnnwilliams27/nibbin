'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Keep the panel mounted for closing motion; closed contents are never interactive. */
export function SmoothDisclosure({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  return <div className={className}>
    <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(open => !open)} className="inline-flex min-h-11 items-center gap-2 text-left">
      {label}<ChevronDown size={16} strokeWidth={1.5} aria-hidden className="agent-card-disclosure-chevron" data-expanded={expanded} />
    </button>
    <div id={panelId} className="agent-card-disclosure" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
      <div className="agent-card-disclosure-clip">{children}</div>
    </div>
  </div>;
}
