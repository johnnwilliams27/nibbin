'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Layers, ChevronDown } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { groupBadge, groupIndex, groupSummary, type ListingGroup } from '@/lib/grouping';

/**
 * Group state, shared by context rather than threaded through the grid and the
 * table.
 *
 * Both views render `Agent[]` and both need the same badge and the same toggle.
 * Passing groups down through AgentCardGrid, AgentTable and every row would put
 * the same three props in six signatures for one feature; a context keeps the
 * card's own props about the agent.
 */
type GroupContext = {
  index: Map<string, ListingGroup>;
  expanded: ReadonlySet<string>;
  toggle: (key: string) => void;
};

const Ctx = createContext<GroupContext | null>(null);

export function ListingGroupsProvider({
  groups,
  expanded,
  onToggle,
  children,
}: {
  groups: ListingGroup[];
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ index: groupIndex(groups), expanded, toggle: onToggle }),
    [groups, expanded, onToggle],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The group an agent leads, or null.
 *
 * Deliberately null for a member that is not the lead: an expanded member is
 * shown as an ordinary listing, so repeating the badge on all twelve rows would
 * restate the same fact twelve times — the repetition this feature exists to
 * remove.
 */
function useLeadGroup(agent: Agent): GroupContext & { group: ListingGroup | null } {
  const ctx = useContext(Ctx);
  if (ctx === null) return { index: new Map(), expanded: new Set(), toggle: () => {}, group: null };
  const g = ctx.index.get(agent.agent_id);
  return { ...ctx, group: g !== undefined && g.leadId === agent.agent_id && g.registrations > 1 ? g : null };
}

/**
 * The collapsed card's own line: what it stands for, and how to see inside it.
 *
 * A fan-out and a fleet say different things because they ARE different things
 * — one measurement shared by many registrations, against many measurements of
 * many deployments. See src/lib/grouping.ts.
 */
export function ListingGroupBadge({ agent }: { agent: Agent }) {
  const { group, expanded, toggle } = useLeadGroup(agent);
  if (group === null) return null;
  const open = expanded.has(group.key);
  const badge = groupBadge(group);
  const summary = groupSummary(group);
  return (
    <div className="mt-3 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
      <p className="flex items-center gap-2 text-[13px] text-[var(--fg-muted)]">
        <Layers size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
        <span className="min-w-0 break-words">{badge}</span>
      </p>
      {summary ? <p className="mt-1 text-[12px] leading-relaxed text-[var(--fg-faint)]">{summary}</p> : null}
      <button
        type="button"
        onClick={() => toggle(group.key)}
        aria-expanded={open}
        className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium"
      >
        {open
          ? 'Hide the individual registrations'
          : `Show all ${group.registrations.toLocaleString('en-US')} registrations`}
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className="agent-card-disclosure-chevron"
          data-expanded={open}
        />
      </button>
    </div>
  );
}

/** Marks a row revealed by expanding a group, so it is not read as a separate service. */
export function ListingGroupMemberNote({ agent }: { agent: Agent }) {
  const ctx = useContext(Ctx);
  if (ctx === null) return null;
  const g = ctx.index.get(agent.agent_id);
  if (g === undefined || g.registrations <= 1 || g.leadId === agent.agent_id) return null;
  if (!ctx.expanded.has(g.key)) return null;
  return (
    <p className="mt-3 text-[12px] text-[var(--fg-faint)]">
      {g.kind === 'fanout'
        ? 'One of the registrations pointing at the service above. It was not measured separately.'
        : 'One deployment of the template above, measured at its own endpoint.'}
    </p>
  );
}
