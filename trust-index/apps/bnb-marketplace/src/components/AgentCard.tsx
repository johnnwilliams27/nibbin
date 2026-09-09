import Link from 'next/link';
import { BadgeCheck, MessageSquare, Wrench, Zap } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { CATEGORY_BY_SLUG } from '@/lib/categories';
import { CoverageAxis, GateFlag, ReferenceBadge, ScoreBlock } from './Assessment';
import { ProvenanceChip } from './Provenance';
import { latency } from '@/lib/format';

export function agentHref(agent: Agent): string {
  return `/agent/${agent.chain_id}/${agent.token_id}`;
}

export function AgentCard({ agent, rank }: { agent: Agent; rank?: number }) {
  const meta = CATEGORY_BY_SLUG.get(agent.category);
  const a = agent.assessment;

  return (
    <article className="card lift relative flex flex-col overflow-hidden">
      {/* Category colour is a per-category identity, never a quality signal. */}
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: meta?.accent ?? 'var(--neutral-fg)' }} />

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {typeof rank === 'number' ? (
                <span className="mono text-[11px] font-semibold text-[var(--fg-faint)]">#{rank}</span>
              ) : null}
              <span className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: meta?.accent }}>
                {meta?.name ?? 'Other'}
              </span>
            </div>
            <h3 className="mt-1 truncate text-[17px]">
              <Link href={agentHref(agent)} className="hover:underline underline-offset-2">
                {agent.name}
              </Link>
            </h3>
            <p className="mono mt-0.5 text-[11px] text-[var(--fg-faint)]">
              token #{agent.token_id} · chain {agent.chain_id}
            </p>
          </div>
        </div>

        {agent.is_reference_agent ? <ReferenceBadge /> : null}

        {agent.description ? (
          <p className="line-clamp-3 text-[14px] text-[var(--fg-muted)]">{agent.description}</p>
        ) : (
          <p className="text-[14px] italic text-[var(--fg-faint)]">No description was registered.</p>
        )}

        <div className="grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
          <ScoreBlock agent={agent} size="sm" />
          {a ? (
            <CoverageAxis coverage={a.coverage} compact />
          ) : (
            <div>
              <p className="eyebrow">Coverage</p>
              <p className="mt-1 text-[13px] text-[var(--fg-muted)]">Not measured.</p>
            </div>
          )}
        </div>

        {a && a.gates_fired.length > 0 ? (
          <div>
            <GateFlag count={a.gates_fired.length} />
          </div>
        ) : null}

        {/* Evidence strip: what we can actually say about it, at a glance. */}
        <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3 text-[12px]">
          <div>
            <dt className="eyebrow flex items-center gap-1">
              <Wrench size={10} strokeWidth={1.5} aria-hidden /> Tools
            </dt>
            <dd className="mono mt-0.5">{a ? a.tool_count : '—'}</dd>
          </div>
          <div>
            <dt className="eyebrow flex items-center gap-1">
              <Zap size={10} strokeWidth={1.5} aria-hidden /> Latency
            </dt>
            <dd className="mono mt-0.5">{a ? latency(a.latency_ms) : '—'}</dd>
          </div>
          <div>
            <dt className="eyebrow flex items-center gap-1">
              <MessageSquare size={10} strokeWidth={1.5} aria-hidden /> Feedback
            </dt>
            <dd className="mono mt-0.5">{agent.scan_feedbacks}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          {agent.scan_endpoint_verified ? (
            <span
              className="mono inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]"
              style={{ background: 'var(--thirdparty-bg)', color: 'var(--thirdparty)' }}
            >
              <BadgeCheck size={11} strokeWidth={1.5} aria-hidden />
              Ecosystem verified
            </span>
          ) : null}
          {agent.scan_feedbacks > 0 || agent.scan_total_score !== null ? <ProvenanceChip source="third_party" /> : null}
          {agent.x402_supported ? (
            <span
              className="mono rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]"
              style={{ background: 'var(--withheld-bg)', color: 'var(--withheld)' }}
              title="Accepts x402 machine payments — it can take your money programmatically."
            >
              x402 payments
            </span>
          ) : null}
        </div>

        <Link
          href={agentHref(agent)}
          data-target
          className="mt-1 inline-flex items-center justify-center rounded-[var(--radius-btn)] border px-3 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--border)]"
          style={{ borderColor: 'var(--border)' }}
        >
          View assessment
        </Link>
      </div>
    </article>
  );
}
