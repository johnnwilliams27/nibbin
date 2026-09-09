import { Check } from 'lucide-react';
import { hireProgress } from '@/lib/hire-progress';

export function HireProgress({ connected, quoted, status }: { connected: boolean; quoted: boolean; status: number | null }) {
  const { current, notice } = hireProgress(connected, quoted, status);
  return <div className="mb-5">
    <ol aria-label="Hire progress" className="flex flex-wrap gap-x-4 gap-y-3">
      {['Connect', 'Quote', 'Fund', 'Delivery', 'Review'].map((label, index) => <li key={label} aria-current={current === index ? 'step' : undefined} className="flex min-w-0 items-center gap-2 text-[12px]" style={{ color: current !== null && index <= current ? 'var(--measured)' : 'var(--fg-muted)' }}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-[11px]" aria-hidden>{current !== null && index < current ? <Check size={13} strokeWidth={1.5} /> : index + 1}</span>
        <span className={current === index ? 'font-semibold' : ''}>{label}</span>
      </li>)}
    </ol>
    {notice ? <p className="mt-2 text-[13px] text-[var(--withheld)]">{notice}</p> : null}
  </div>;
}
