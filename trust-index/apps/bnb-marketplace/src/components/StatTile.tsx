import { ProvenanceChip, type Source } from './Provenance';

export function StatTile({
  label,
  value,
  suffix,
  note,
  source,
  tone = 'var(--fg)',
}: {
  label: string;
  value: string | number;
  suffix?: string;
  note?: string;
  source?: Source;
  tone?: string;
}) {
  return (
    <div className="card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mono mt-1.5 text-[26px] font-semibold leading-none" style={{ color: tone }}>
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
        {suffix ? <span className="text-[0.5em] font-normal text-[var(--fg-muted)]"> {suffix}</span> : null}
      </p>
      {note ? <p className="mt-2 text-[12px] leading-snug text-[var(--fg-muted)]">{note}</p> : null}
      {source ? (
        <div className="mt-2.5">
          <ProvenanceChip source={source} />
        </div>
      ) : null}
    </div>
  );
}
