import { parseReferenceResult } from '@/lib/reference-result';

/** Render only after the parent has verified the manifest against the chain. */
export function ReferenceResult({ content }: { content: string }) {
  const result = parseReferenceResult(content);
  return <div className="mt-3 min-w-0 max-w-full">
    {result ? <>
      <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
        {[
          ['Health factor', result.health_factor, 'Ratio from supplied inputs'],
          ['Headroom', result.headroom, 'Same unit as collateral and debt'],
          ['Maximum debt at threshold', result.max_debt_before_liquidation, 'Same unit as collateral and debt'],
        ].map(([label, value, note]) => <div key={label} className="min-w-0"><dt className="break-words text-[12px] text-[var(--fg-muted)]">{label}</dt><dd className="mt-1 break-all text-[22px] font-semibold tabular-nums">{value}</dd><dd className="mt-1 break-words text-[11px] text-[var(--fg-muted)]">{note}</dd></div>)}
      </dl>
      <p className="mt-3 text-[12px]">Health factor = (collateral × threshold) ÷ debt</p>
      <p className="mt-1 break-words text-[12px] tabular-nums">({result.inputs.collateral} × {result.inputs.threshold}) ÷ {result.inputs.debt} = {result.health_factor}</p>
      <p className="mt-2 text-[12px] text-[var(--fg-muted)]">Reference arithmetic from supplied inputs. Not live position data, liquidation protection, investment advice or an independent Nibbin rating.</p>
    </> : <p className="text-[12px] text-[var(--fg-muted)]">This verified content does not match the reference calculation format. Inspect the raw result below.</p>}
    <details className="mt-3 min-w-0 text-[12px]"><summary className="cursor-pointer">Raw delivery JSON</summary><pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-all text-[11px]">{content}</pre></details>
  </div>;
}
