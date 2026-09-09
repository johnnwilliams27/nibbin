import { Activity, FileText, Link2, Megaphone } from 'lucide-react';

/**
 * Every number on this site carries one of these. Blurring "we called it and it
 * answered" with "someone left a review" is the exact failure mode the index
 * exists to fix, so provenance is a first-class visual, not a footnote.
 */
export type Source = 'measured' | 'third_party' | 'onchain' | 'self_reported';

const SOURCE_META: Record<Source, { label: string; who: string; fg: string; bg: string; Icon: typeof Activity }> = {
  measured: {
    label: 'We measured',
    who: 'Produced by our probe calling the agent directly.',
    fg: 'var(--color-moss-deep)',
    bg: 'var(--color-moss-tint)',
    Icon: Activity,
  },
  third_party: {
    label: '8004scan',
    who: 'Third-party reputation data. Reported here as-is; we did not verify it.',
    fg: 'var(--color-sky-deep)',
    bg: 'var(--color-sky-tint)',
    Icon: Megaphone,
  },
  onchain: {
    label: 'On-chain',
    who: 'Read from the ERC-8004 identity registry on BSC.',
    fg: 'var(--color-slate-deep)',
    bg: 'var(--color-slate-tint)',
    Icon: Link2,
  },
  self_reported: {
    label: 'Agent claims',
    who: 'Declared by the agent in its own registration. Nobody checked it.',
    fg: 'var(--color-honey-deep)',
    bg: 'var(--color-honey-tint)',
    Icon: FileText,
  },
};

export function ProvenanceChip({ source, className = '' }: { source: Source; className?: string }) {
  const meta = SOURCE_META[source];
  const Icon = meta.Icon;
  return (
    <span
      title={meta.who}
      className={`mono inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${className}`}
      style={{ color: meta.fg, background: meta.bg }}
    >
      <Icon size={11} strokeWidth={1.5} aria-hidden />
      {meta.label}
    </span>
  );
}

export function sourceMeaning(source: Source): string {
  return SOURCE_META[source].who;
}

/**
 * The two-column split used on the detail page. Left is ours, right is theirs.
 * They never share a column and never share a total.
 */
export function ProvenanceSplit({
  ours,
  theirs,
}: {
  ours: React.ReactNode;
  theirs: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section
        aria-label="What we measured"
        className="shell overflow-hidden"
        style={{ borderColor: 'var(--color-moss-deep)', borderWidth: 1.5 }}
      >
        <header
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ background: 'var(--color-moss-tint)' }}
        >
          <div>
            <p className="eyebrow" style={{ color: 'var(--color-moss-deep)' }}>
              What we measured
            </p>
            <p className="mt-0.5 text-[13px]" style={{ color: 'var(--color-moss-deep)' }}>
              We called this agent and recorded what happened.
            </p>
          </div>
          <ProvenanceChip source="measured" />
        </header>
        <div className="px-5 py-4">{ours}</div>
      </section>

      <section aria-label="What the ecosystem claims" className="shell overflow-hidden">
        <header
          className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ background: 'var(--color-sky-tint)' }}
        >
          <div>
            <p className="eyebrow" style={{ color: 'var(--color-sky-deep)' }}>
              What the ecosystem claims
            </p>
            <p className="mt-0.5 text-[13px]" style={{ color: 'var(--color-sky-deep)' }}>
              Reported by others. Shown as-is, never folded into our score.
            </p>
          </div>
          <ProvenanceChip source="third_party" />
        </header>
        <div className="px-5 py-4">{theirs}</div>
      </section>
    </div>
  );
}

/** A single labelled figure with its origin attached. */
export function Figure({
  label,
  value,
  source,
  note,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  source?: Source;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="border-b border-[var(--color-understory)] py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] text-[var(--color-ink-secondary)]">{label}</span>
        <span className="mono text-[14px] font-medium" style={tone ? { color: tone } : undefined}>
          {value}
        </span>
      </div>
      {note ? <p className="mt-1 text-[12px] text-[var(--color-ink-secondary)]">{note}</p> : null}
      {source ? (
        <div className="mt-1.5">
          <ProvenanceChip source={source} />
        </div>
      ) : null}
    </div>
  );
}
