import { Terminal } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { ProvenanceChip } from './Provenance';

/**
 * The capability list is enumerated from a live session, not read off the
 * registration. That distinction matters: an operator can claim anything in a
 * description, but a tool list is what the agent actually offered us.
 */
export function CapabilityList({ agent }: { agent: Agent }) {
  const a = agent.assessment;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px]">What it can actually do</h2>
        {a ? <ProvenanceChip source="measured" /> : <ProvenanceChip source="self_reported" />}
      </div>

      {!a ? (
        <p className="mt-3 text-[13px] text-[var(--fg-muted)]">
          We have not opened a session with this agent, so we cannot list its capabilities. Whatever the description
          above promises is unverified.
        </p>
      ) : a.tools_or_skills.length === 0 ? (
        <div className="mt-3">
          <p className="text-[13px]" style={{ color: 'var(--withheld)' }}>
            {a.reachable === true ? 'It answered, but exposed no callable tools.' : 'Nothing was enumerated.'}
          </p>
          <p className="mt-1.5 text-[13px] text-[var(--fg-muted)]">
            {a.withheld_reason
              ? a.withheld_reason
              : a.reachable === true
                ? 'The endpoint is live and speaks a protocol, but the tool listing came back empty. There is nothing here to hire.'
                : a.reachable === null
                  ? 'We could not obtain a reading from this endpoint, so nothing could be enumerated. That is our gap, not a finding about the agent.'
                  : 'We could not establish a session, so nothing could be enumerated.'}
          </p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-[var(--fg-muted)]">
            <span className="mono text-[var(--fg)]">{a.tool_count}</span> capabilit
            {a.tool_count === 1 ? 'y' : 'ies'} enumerated over{' '}
            <span className="mono">{a.protocol_spoken?.toUpperCase() ?? 'an established session'}</span>. These are the
            operations you would be paying for.
          </p>
          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {a.tools_or_skills.map((tool) => (
              <li
                key={tool}
                className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2"
              >
                <Terminal size={13} strokeWidth={1.5} aria-hidden style={{ color: 'var(--measured)' }} />
                <span className="mono truncate text-[12px]" title={tool}>
                  {tool}
                </span>
              </li>
            ))}
          </ul>
          {a.tools_or_skills.length < a.tool_count ? (
            <p className="mt-3 text-[12px] text-[var(--fg-faint)]">
              {a.tool_count - a.tools_or_skills.length} further capabilities were counted but not named in this run.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
