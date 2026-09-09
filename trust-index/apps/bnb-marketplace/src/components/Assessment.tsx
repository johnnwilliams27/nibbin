import { AlertTriangle, CircleSlash, HelpCircle, ShieldAlert } from 'lucide-react';
import type { Agent, Coverage } from '@/lib/types';
import { COVERAGE_COPY, compositeOutOf100, gateCopy } from '@/lib/format';

/**
 * Three legitimate states, and only three:
 *   rated     — we assessed it and had enough evidence to publish a number
 *   withheld  — we assessed it and deliberately did not publish a number
 *   unassessed— we have not called it yet
 * A zero is never used to mean any of these.
 */
export type ScoreState = 'rated' | 'withheld' | 'unassessed';

export function scoreState(agent: Agent): ScoreState {
  if (!agent.assessment) return 'unassessed';
  return agent.assessment.composite === null ? 'withheld' : 'rated';
}

/** Why an agent has no assessment at all. Contract rule 1: never a blank. */
export function unassessedReason(agent: Agent): string {
  if (agent.is_reference_agent) {
    return 'We do not score our own agents. An assessor that rates its own deployments has nothing to say about anyone else’s.';
  }
  // Before blaming the agent for having no endpoint, check whether we ever
  // looked. An unread detail produces exactly the same `endpoint: null`, and
  // this string is the one place that null gets narrated to a reader.
  if (!agent.endpoint && agent.detail_status === 'unread_rate_limited') {
    return 'We could not read its registry detail before hitting the rate limit, so we do not know whether it declares an endpoint. That is our gap, not a finding about the agent.';
  }
  if (!agent.endpoint && !agent.protocols.some((p) => /mcp|a2a/i.test(p))) {
    return 'It declares no callable endpoint, so there is nothing for us to call.';
  }
  if (agent.endpoint && /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(agent.endpoint)) {
    return 'Its endpoint is a loopback address, so there is nothing publicly reachable for us — or for you — to call.';
  }
  return 'It is registered and callable, but has not reached the front of our probe queue yet.';
}

export function ScoreBlock({ agent, size = 'md' }: { agent: Agent; size?: 'sm' | 'md' | 'lg' }) {
  const state = scoreState(agent);
  const big = size === 'lg';
  const numberClass = big ? 'text-[44px]' : size === 'md' ? 'text-[28px]' : 'text-[20px]';

  if (state === 'rated' && agent.assessment?.composite !== null && agent.assessment) {
    const score = compositeOutOf100(agent.assessment.composite as number);
    return (
      <div>
        <p className="eyebrow">Our assessment</p>
        <p className={`mono ${numberClass} font-semibold leading-none`} style={{ color: 'var(--measured)' }}>
          {score}
          <span className="text-[0.45em] font-normal text-[var(--fg-muted)]"> / 100</span>
        </p>
        <p className="mt-1.5 text-[12px] text-[var(--fg-muted)]">
          Composite of our probe results. Read alongside coverage, never instead of it.
        </p>
      </div>
    );
  }

  if (state === 'withheld' && agent.assessment) {
    return (
      <div>
        <p className="eyebrow" style={{ color: 'var(--withheld)' }}>
          Our assessment
        </p>
        <p
          className={`font-semibold leading-tight ${
            big ? 'text-[28px]' : 'text-[17px]'
          }`}
          style={{ color: 'var(--withheld)' }}
        >
          Not rated
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-[13px]" style={{ color: 'var(--withheld)' }}>
          <ShieldAlert size={15} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
          <span>Insufficient evidence to publish a number.</span>
        </p>
        {agent.assessment.withheld_reason ? (
          <p className="mt-2 text-[13px] text-[var(--fg-muted)]">{agent.assessment.withheld_reason}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <p className="eyebrow">Our assessment</p>
      <p
        className={`font-semibold leading-tight ${
          big ? 'text-[28px]' : 'text-[17px]'
        }`}
        style={{ color: 'var(--neutral-fg)' }}
      >
        Not assessed
      </p>
      <p className="mt-1 flex items-start gap-1.5 text-[13px]" style={{ color: 'var(--neutral-fg)' }}>
        <CircleSlash size={15} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
        <span>{unassessedReason(agent)}</span>
      </p>
    </div>
  );
}

/**
 * Coverage is how much we looked. It is drawn as its own axis, in its own
 * colour, next to the score and never inside it — an agent can score well on a
 * thin look, and that combination is exactly what a buyer needs to see.
 */
export function CoverageAxis({ coverage, compact = false }: { coverage: Coverage; compact?: boolean }) {
  const copy = COVERAGE_COPY[coverage];
  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="eyebrow" style={{ color: 'var(--coverage)' }}>
          Coverage
        </p>
        <span className="mono text-[13px] font-medium" style={{ color: 'var(--coverage)' }}>
          {copy.label}
        </span>
      </div>
      <div className="mt-1.5 flex gap-1" role="img" aria-label={`Coverage: ${copy.label}, ${copy.steps} of 3`}>
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className="h-1.5 flex-1 rounded-full"
            style={{
              background: step <= copy.steps ? 'var(--coverage)' : 'var(--border)',
              maxWidth: 34,
            }}
          />
        ))}
      </div>
      {!compact ? <p className="mt-2 text-[12px] text-[var(--fg-muted)]">{copy.meaning}</p> : null}
    </div>
  );
}

/** Hard safety caps. These are loud on purpose — they can cost someone funds. */
export function GateBanner({ gates, agent }: { gates: string[]; agent?: Agent }) {
  if (gates.length === 0) return null;

  const canSpend = agent ? agent.x402_supported || /spend|trade|swap|transfer|withdraw/i.test(agent.description) : false;

  return (
    <div
      className="rounded-[var(--radius-card)] border p-4"
      style={{ background: 'var(--critical-bg)', borderColor: 'var(--critical)' }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={18} strokeWidth={1.5} className="mt-0.5 shrink-0" style={{ color: 'var(--critical)' }} aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold" style={{ color: 'var(--critical)' }}>
            {gates.length === 1 ? 'A safety gate fired' : `${gates.length} safety gates fired`}
          </p>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--critical)' }}>
            These are hard caps, not deductions. A gate does not lower a score — it means we would not hand this agent
            money.
          </p>
          <ul className="mt-3 space-y-2.5">
            {gates.map((gate) => {
              const copy = gateCopy(gate);
              return (
                <li key={gate}>
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--critical)' }}>
                    {copy.title}
                  </p>
                  <p className="text-[13px] text-[var(--fg)]">{copy.why}</p>
                  <p className="mono mt-0.5 text-[10px] uppercase tracking-[0.1em] text-[var(--fg-muted)]">
                    gate: {gate}
                  </p>
                </li>
              );
            })}
          </ul>
          {canSpend ? (
            <p
              className="mt-3 rounded-[var(--radius-btn)] px-3 py-2 text-[13px] font-medium"
              style={{ background: 'var(--panel)', color: 'var(--critical)' }}
            >
              This agent also handles value. A failed gate on something that can move funds is a fund-loss risk, not a
              quality nitpick.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Small inline marker for lists and tables. */
export function GateFlag({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="mono inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
      style={{ background: 'var(--critical-bg)', color: 'var(--critical)' }}
      title="Hard safety caps tripped during assessment"
    >
      <AlertTriangle size={11} strokeWidth={1.5} aria-hidden />
      {count} gate{count === 1 ? '' : 's'} fired
    </span>
  );
}

/** Our own deployments. Labelled everywhere, ranked nowhere. */
export function ReferenceBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="mono inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
      style={{ background: 'var(--reference-bg)', color: 'var(--reference)' }}
      title="We deployed this agent. It is excluded from every ranking, sort and leaderboard on this site."
    >
      <HelpCircle size={11} strokeWidth={1.5} aria-hidden />
      {compact ? 'Ours' : 'Our reference agent — not ranked'}
    </span>
  );
}
