'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { LayoutGrid, Rows3, Search } from 'lucide-react';
import type { Agent, CategorySlug } from '@/lib/types';
import { CATEGORIES, CATEGORY_BY_SLUG } from '@/lib/categories';
import { AgentCard, agentHref } from './AgentCard';
import { CoverageAxis, GateFlag, ReferenceBadge, scoreState } from './Assessment';
import { EmptyState } from './DataStatus';
import { compositeOutOf100, latency } from '@/lib/format';
import { FILTERS, SORTS, compareAgents, isSortable, passesFilter, type FilterKey, type SortKey } from '@/lib/sorting';

interface Props {
  agents: Agent[];
  /** Reference agents arrive separately and are never mixed into the ranking. */
  reference: Agent[];
  showCategoryFilter?: boolean;
  defaultView?: 'grid' | 'table';
}

export function AgentExplorer({ agents, reference, showCategoryFilter = false, defaultView = 'grid' }: Props) {
  const [sort, setSort] = useState<SortKey>('assessment');
  const [filters, setFilters] = useState<FilterKey[]>([]);
  const [categories, setCategories] = useState<CategorySlug[]>([]);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'table'>(defaultView);

  const { ranked, unranked } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = agents.filter((a) => {
      if (categories.length > 0 && !categories.includes(a.category)) return false;
      if (!filters.every((f) => passesFilter(a, f))) return false;
      if (q && !`${a.name} ${a.description} ${a.token_id} ${a.owner_address}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const sortable = pool.filter((a) => isSortable(a, sort)).sort((a, b) => compareAgents(a, b, sort));
    const rest = pool.filter((a) => !isSortable(a, sort)).sort((a, b) => a.name.localeCompare(b.name));
    return { ranked: sortable, unranked: rest };
  }, [agents, sort, filters, categories, query]);

  const activeSort = SORTS.find((s) => s.key === sort)!;

  function toggleFilter(key: FilterKey) {
    setFilters((current) => (current.includes(key) ? current.filter((f) => f !== key) : [...current, key]));
  }

  function toggleCategory(slug: CategorySlug) {
    setCategories((current) => (current.includes(slug) ? current.filter((c) => c !== slug) : [...current, slug]));
  }

  return (
    <div>
      <div className="shell p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex-1 min-w-[220px]">
            <span className="eyebrow">Search</span>
            <span className="mt-1 flex items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--panel)] px-3">
              <Search size={15} strokeWidth={1.5} aria-hidden style={{ color: 'var(--fg-faint)' }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, description, owner, token id"
                className="w-full bg-transparent py-2 text-[14px] outline-none"
              />
            </span>
          </label>

          <label className="min-w-[220px]">
            <span className="eyebrow">Rank by</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="mt-1 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[14px]"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <div className="ml-auto flex items-center gap-1 rounded-[var(--radius-input)] border border-[var(--border)] p-0.5">
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              className="flex items-center gap-1.5 rounded-[3px] px-2.5 py-1.5 text-[13px]"
              style={view === 'grid' ? { background: 'var(--border)' } : undefined}
            >
              <LayoutGrid size={14} strokeWidth={1.5} aria-hidden /> Cards
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
              className="flex items-center gap-1.5 rounded-[3px] px-2.5 py-1.5 text-[13px]"
              style={view === 'table' ? { background: 'var(--border)' } : undefined}
            >
              <Rows3 size={14} strokeWidth={1.5} aria-hidden /> Compare
            </button>
          </div>
        </div>

        <p className="mt-2 text-[12px] text-[var(--fg-muted)]">{activeSort.hint}</p>

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="eyebrow">Narrow it down</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const on = filters.includes(f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleFilter(f.key)}
                  aria-pressed={on}
                  title={f.hint}
                  className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-[13px] transition-colors"
                  style={{
                    borderColor: on ? 'var(--measured)' : 'var(--border)',
                    background: on ? 'var(--measured-bg)' : 'var(--panel)',
                    color: on ? 'var(--measured)' : 'var(--fg-muted)',
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {showCategoryFilter ? (
            <>
              <p className="eyebrow mt-4">Categories</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const on = categories.includes(c.slug);
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => toggleCategory(c.slug)}
                      aria-pressed={on}
                      className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-[13px]"
                      style={{
                        borderColor: on ? c.accent : 'var(--border)',
                        background: on ? c.accentTint : 'var(--panel)',
                        color: on ? c.accent : 'var(--fg-muted)',
                      }}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {filters.length > 0 || categories.length > 0 || query ? (
            <button
              type="button"
              onClick={() => {
                setFilters([]);
                setCategories([]);
                setQuery('');
              }}
              className="mt-3 text-[13px] underline underline-offset-2 text-[var(--fg-muted)]"
            >
              Clear all filters
            </button>
          ) : null}
        </div>
      </div>

      <p className="mt-5 text-[14px] text-[var(--fg-muted)]">
        {ranked.length + unranked.length === 0 ? (
          'No agents match these filters.'
        ) : (
          <>
            <span className="mono font-medium text-[var(--fg)]">{ranked.length}</span> agent
            {ranked.length === 1 ? '' : 's'} can be ranked by {activeSort.label.toLowerCase()}
            {unranked.length > 0 ? (
              <>
                {' '}· <span className="mono font-medium text-[var(--fg)]">{unranked.length}</span> cannot, and are
                listed below rather than given a stand-in value
              </>
            ) : null}
            .
          </>
        )}
      </p>

      {ranked.length === 0 && unranked.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="Nothing matches yet"
            body="Loosen a filter, or clear them all. If the index is still building, there may simply be no records for this view."
          />
        </div>
      ) : null}

      {ranked.length > 0 ? (
        view === 'grid' ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ranked.map((a, i) => (
              <AgentCard key={a.agent_id} agent={a} rank={i + 1} />
            ))}
          </div>
        ) : (
          <ComparisonTable agents={ranked} rankFrom={1} />
        )
      ) : null}

      {unranked.length > 0 ? (
        <section className="mt-10">
          <h3 className="text-[16px]">Cannot be ranked by {activeSort.label.toLowerCase()}</h3>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--fg-muted)]">
            These agents are missing the measurement this sort depends on. They are not worse and not better — we simply
            do not have the number, so we will not put them in an order that implies we do.
          </p>
          {view === 'grid' ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {unranked.map((a) => (
                <AgentCard key={a.agent_id} agent={a} />
              ))}
            </div>
          ) : (
            <ComparisonTable agents={unranked} />
          )}
        </section>
      ) : null}

      {reference.length > 0 ? (
        <section className="mt-12">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-[16px]">Our reference agents</h3>
            <ReferenceBadge />
          </div>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--fg-muted)]">
            We deployed these to prove the assessment pipeline works end to end. Ranking our own agents against everyone
            else&apos;s would make every number on this site worth less, so they sit outside the ranking entirely —
            here, and in every sort, filter and count above.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reference.map((a) => (
              <AgentCard key={a.agent_id} agent={a} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ComparisonTable({ agents, rankFrom }: { agents: Agent[]; rankFrom?: number }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--border)] text-left">
            {typeof rankFrom === 'number' ? <Th>#</Th> : null}
            <Th>Agent</Th>
            <Th>Category</Th>
            <Th>
              Our score
              <Sub>we measured</Sub>
            </Th>
            <Th>
              Coverage
              <Sub>how much we looked</Sub>
            </Th>
            <Th>
              Tools
              <Sub>we enumerated</Sub>
            </Th>
            <Th>
              Latency
              <Sub>we measured</Sub>
            </Th>
            <Th>
              Feedback
              <Sub>8004scan</Sub>
            </Th>
            <Th>
              Verified
              <Sub>8004scan</Sub>
            </Th>
            <Th>Safety</Th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent, i) => {
            const meta = CATEGORY_BY_SLUG.get(agent.category);
            const a = agent.assessment;
            const state = scoreState(agent);
            return (
              <tr key={agent.agent_id} className="border-b border-[var(--border)] align-top">
                {typeof rankFrom === 'number' ? (
                  <Td>
                    <span className="mono text-[var(--fg-faint)]">{rankFrom + i}</span>
                  </Td>
                ) : null}
                <Td>
                  <Link href={agentHref(agent)} className="font-medium hover:underline underline-offset-2">
                    {agent.name}
                  </Link>
                  {agent.is_reference_agent ? (
                    <div className="mt-1">
                      <ReferenceBadge compact />
                    </div>
                  ) : null}
                  <div className="mono mt-0.5 text-[11px] text-[var(--fg-faint)]">#{agent.token_id}</div>
                </Td>
                <Td>
                  <span className="mono text-[11px] uppercase tracking-[0.1em]" style={{ color: meta?.accent }}>
                    {meta?.name ?? 'Other'}
                  </span>
                </Td>
                <Td>
                  {state === 'rated' ? (
                    <span className="mono font-semibold" style={{ color: 'var(--measured)' }}>
                      {compositeOutOf100(a!.composite as number)}
                    </span>
                  ) : state === 'withheld' ? (
                    <span
                      className="text-[12px] font-medium"
                      style={{ color: 'var(--withheld)' }}
                      title={a?.withheld_reason ?? undefined}
                    >
                      Not rated
                    </span>
                  ) : (
                    <span className="text-[12px]" style={{ color: 'var(--neutral-fg)' }}>
                      Not assessed
                    </span>
                  )}
                </Td>
                <Td>{a ? <CoverageAxis coverage={a.coverage} compact /> : <Dash />}</Td>
                <Td>{a ? <span className="mono">{a.tool_count}</span> : <Dash />}</Td>
                <Td>{a?.latency_ms != null ? <span className="mono">{latency(a.latency_ms)}</span> : <Dash />}</Td>
                <Td>
                  <span className="mono">{agent.scan_feedbacks}</span>
                </Td>
                <Td>
                  {agent.scan_endpoint_verified ? (
                    <span className="mono text-[12px]" style={{ color: 'var(--thirdparty)' }}>
                      Yes
                    </span>
                  ) : (
                    <span className="mono text-[12px] text-[var(--fg-muted)]">No</span>
                  )}
                </Td>
                <Td>
                  {a && a.gates_fired.length > 0 ? (
                    <GateFlag count={a.gates_fired.length} />
                  ) : a ? (
                    <span className="text-[12px] text-[var(--fg-muted)]">No gates fired</span>
                  ) : (
                    <Dash />
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="eyebrow px-3 py-2 align-bottom font-medium">
      {children}
    </th>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="mono block text-[9px] normal-case tracking-[0.06em] text-[var(--fg-faint)]">{children}</span>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3">{children}</td>;
}

function Dash() {
  return (
    <span className="text-[12px] text-[var(--fg-faint)]" title="Not measured — we will not guess">
      Not measured
    </span>
  );
}
