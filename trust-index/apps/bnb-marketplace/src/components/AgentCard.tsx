'use client';

import { useId, useState } from 'react';
import { AgentProfileLink } from './AgentProfileLink';
import { AgentAvatar } from './AgentAvatar';
import { BuyerReviewSummary, BuyerReviews } from './BuyerReviews';
import { ArrowDownUp, ArrowUpRight, ChartNoAxesCombined, ChevronDown, Grid2X2, Shapes, ShieldCheck, Wallet, Shield, Search, PenLine, Code2, Workflow, TrendingUp, Sprout, type LucideIcon } from 'lucide-react';
import type { Agent, CategorySlug } from '@/lib/types';
import { CATEGORY_BY_SLUG } from '@/lib/categories';
import { agentHref } from '@/lib/routes';
import { cardRating, evidenceSummary } from '@/lib/evidence';
import { COVERAGE_COPY, sharedEndpointNote, timestamp } from '@/lib/format';

const categoryIcons: Record<CategorySlug, LucideIcon> = {
  rebalancing: ArrowDownUp, grid_trading: Grid2X2, yield: ChartNoAxesCombined, health_factor: ShieldCheck,
  payments: Wallet, security: Shield, research: Search, content: PenLine,
  development: Code2, automation: Workflow, trading: TrendingUp, staking: Sprout, other: Shapes,
};

export function CategoryIcon({ category }: { category: CategorySlug }) {
  const Icon = categoryIcons[category] ?? Shapes;
  return <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0" />;
}

export function TrustIndexStatus({ agent, showLabel = true, showCoverage = true }: { agent: Agent; showLabel?: boolean; showCoverage?: boolean }) {
  const evidence = evidenceSummary(agent);
  const flagged = (agent.assessment?.gates_fired.length ?? 0) > 0;
  const rating = cardRating(agent);
  if (rating) {
    const coverage = COVERAGE_COPY[rating.coverage];
    return <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px]">
      <p aria-label={`Trust Index score: ${rating.score} out of 100`}>
        {showLabel ? <span className="text-[var(--fg-muted)]">Trust Index · </span> : null}
        <span className="font-semibold tabular-nums">{rating.score}</span>
        <span className="text-[var(--fg-muted)]"> / 100</span>
      </p>
      {showCoverage ? <p className="text-[12px] text-[var(--coverage)]" title={coverage.meaning}>{coverage.label} coverage</p> : null}
      {sharedEndpointNote(agent.assessment) ? <span tabIndex={0} title={sharedEndpointNote(agent.assessment)} className="text-[12px] text-[var(--fg-muted)]">Shared service</span> : null}
    </div>;
  }
  const label = agent.is_reference_agent ? 'Our demonstration · independently unrated'
    : flagged ? 'Safety flag recorded' : evidence.state === 'unmeasured' ? 'Evidence unknown' : evidence.label;
  return (
    <p className="text-[14px] leading-relaxed" title={agent.is_reference_agent ? 'Our own deployment, excluded from independent rankings.' : flagged ? 'Open the profile to review recorded safety findings.' : evidence.detail}>
      {showLabel ? <span className="text-[var(--fg-muted)]">Trust Index · </span> : null}
      <span className="font-medium" style={{ color: flagged ? 'var(--withheld)' : 'var(--fg)' }}>{label}</span>
    </p>
  );
}

export function AgentCard({ agent }: { agent: Agent; rank?: number }) {
  const meta = CATEGORY_BY_SLUG.get(agent.category);
  const [expanded, setExpanded] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const detailsId = useId();
  const capabilities = agent.assessment?.tools_or_skills.slice(0, 4) ?? [];
  return (
    <article className="agent-card card lift group flex min-w-0 flex-col self-start p-5 sm:p-6">
      <div data-card-base><div data-card-natural className="flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[13px] text-[var(--fg-muted)]" title="Category based on the agent's description"><CategoryIcon category={agent.category} />{meta?.name ?? 'Other'}</p>
          <h3 className="mt-4 line-clamp-2 break-words text-[20px] font-semibold leading-snug">
            <AgentProfileLink href={agentHref(agent)} className="hover:underline underline-offset-4">{agent.name}</AgentProfileLink>
          </h3>
        </div>
        <AgentAvatar imageUrl={agent.image_url} name={agent.name} />
      </div>
      <p className="mt-3 line-clamp-2 text-[15px] leading-relaxed text-[var(--fg-muted)]">{agent.description || 'No description provided.'}</p>
      <div className="mt-auto pt-6">
        <TrustIndexStatus agent={agent} showCoverage={false} />
        <div className="mt-2"><BuyerReviewSummary agent={agent} /></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 border-t border-[var(--border)] pt-2 text-[14px] font-medium">
        <button type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => { setHasOpened(true); setExpanded((open) => !open); }} className="inline-flex min-h-11 items-center gap-2">
          {expanded ? 'Hide details' : 'Show details'}<ChevronDown size={16} strokeWidth={1.5} aria-hidden className="agent-card-disclosure-chevron" data-expanded={expanded} />
        </button>
        <AgentProfileLink href={agentHref(agent)} aria-label={`View agent: ${agent.name}`} className="inline-flex min-h-11 items-center gap-2">
          View agent <ArrowUpRight size={16} strokeWidth={1.5} aria-hidden />
        </AgentProfileLink>
      </div>
      </div></div>
      <div id={detailsId} className="agent-card-disclosure" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
        <div className="agent-card-disclosure-clip">
          {hasOpened ? <div className="mt-3 border-t border-[var(--border)] pt-4">
            <dl className="space-y-3 text-[13px] leading-relaxed">
              {agent.assessment ? <div><dt className="font-medium">Evidence coverage</dt><dd className="text-[var(--fg-muted)]">{COVERAGE_COPY[agent.assessment.coverage].label} — {COVERAGE_COPY[agent.assessment.coverage].meaning}</dd></div> : null}
              <div><dt className="font-medium">Declared connection</dt><dd className="break-all text-[var(--fg-muted)]">{agent.endpoint || (agent.detail_status === 'read' ? 'No endpoint declared' : 'Endpoint not yet recorded')}</dd></div>
              <div><dt className="font-medium">Reported protocols</dt><dd className="break-words text-[var(--fg-muted)]">{agent.protocols.length ? agent.protocols.join(', ') : agent.detail_status === 'read' ? 'None declared' : 'Not yet recorded'}</dd></div>
              {capabilities.length ? <div><dt className="font-medium">Reported capabilities</dt><dd className="break-words text-[var(--fg-muted)]">{capabilities.join(', ')}{(agent.assessment?.tools_or_skills.length ?? 0) > 4 ? ` +${agent.assessment!.tools_or_skills.length - 4} more` : ''}</dd></div> : null}
              <div><dt className="font-medium">Latest check</dt><dd className="text-[var(--fg-muted)]">{agent.assessment?.checked_at && timestamp(agent.assessment.checked_at) !== 'Unknown' ? <time dateTime={agent.assessment.checked_at}>{timestamp(agent.assessment.checked_at)}</time> : 'No dated reading available'}</dd></div>
            </dl>
            <div className="mt-4 border-t border-[var(--border)] pt-4"><BuyerReviews agent={agent} /></div>
          </div> : null}
        </div>
      </div>
    </article>
  );
}
