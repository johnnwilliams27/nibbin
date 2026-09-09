import { Terminal } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { ProvenanceChip } from './Provenance';

export function CapabilityList({ agent }: { agent: Agent }) {
  const assessment = agent.assessment;
  const names = assessment?.tools_or_skills ?? [];
  const fromSession = assessment?.capability_source === 'tools_list';
  const sourceLabel = fromSession ? 'a tools/list response' : assessment?.capability_source === 'agent_card' ? 'an agent card' : assessment?.capability_source === 'service_descriptor' ? 'a service descriptor' : 'the saved endpoint record';
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px]">Capabilities surfaced</h2>
        {names.length > 0 ? <ProvenanceChip source={fromSession ? 'measured' : 'self_reported'} /> : null}
      </div>
      {names.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--fg-muted)]">No capability names were captured in this snapshot. This does not establish that the agent has no capabilities; read its declared connection and endpoint evidence before proceeding.</p>
      ) : (
        <>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--fg-muted)]">
            {names.length} named {names.length === 1 ? 'capability' : 'capabilities'} from {sourceLabel}. {fromSession ? 'The server offered these tools; we have not established that each tool works.' : 'These are declarations, not completed skill executions.'}
          </p>
          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {names.map((name) => (
              <li key={name} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
                <Terminal size={13} strokeWidth={1.5} aria-hidden className="shrink-0 text-[var(--fg-muted)]" />
                <span className="mono break-all text-[12px]">{name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
