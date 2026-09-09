import { Inbox } from 'lucide-react';

/**
 * Kept free of any filesystem import so client components can use it — the
 * dataset loader is server-only and would drag node:fs into the browser bundle.
 */
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <Inbox size={20} strokeWidth={1.5} style={{ color: 'var(--fg-faint)' }} aria-hidden />
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-[13px] text-[var(--fg-muted)]">{body}</p>
    </div>
  );
}
