'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Rows3, Search, SlidersHorizontal, X } from 'lucide-react';
import type { Agent, CategorySlug } from '@/lib/types';
import { CATEGORIES, CATEGORY_BY_SLUG } from '@/lib/categories';
import { AgentCardGrid } from './AgentCardGrid';
import { AgentTable } from './AgentTable';
import { EmptyState } from './EmptyState';
import { FilterSelect } from './FilterSelect';
import { BuyerReviewsProvider } from './BuyerReviews';
import { buildGroups, collapse } from '@/lib/grouping';
import { FILTERS, SORTS, discoverAgents, readExplorerState, writeExplorerState, type ExplorerState, type FilterKey, type SortKey } from '@/lib/sorting';
import { pageAfterChange, pageNumbers, paginateGroups, readPage, writePage } from '@/lib/pagination';

interface Props {
  agents: Agent[];
  reference: Agent[];
  showCategoryFilter?: boolean;
  defaultView?: 'grid' | 'table';
}

const primaryEvidence: FilterKey[] = ['protocol_confirmed', 'assessed', 'rated'];

export function AgentExplorer({ agents, reference, showCategoryFilter = false, defaultView = 'grid' }: Props) {
  const [state, setState] = useState<ExplorerState>(() => readExplorerState('', defaultView, showCategoryFilter));
  const [requestedPage, setRequestedPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const updateVersion = useRef(0);
  const activeTransition = useRef<{ skipTransition?: () => void } | null>(null);
  const pathname = usePathname();
  const { query, sort, filters, categories, view } = state;
  const matches = useMemo(() => discoverAgents(agents, state), [agents, state]);
  /*
    Group AFTER filtering and sorting, never before.
    Searching for one registration must still find it, and a group's card has to
    sit where its best-ranked member would have sat — so the pool is filtered and
    ordered first, and grouping preserves that order (see buildGroups).
  */
  /*
    ONE grouping pass over BOTH halves, then split the result back.

    Grouping ranked and unranked separately splits a group down the middle: the
    sort puts scored rows in `ranked` and unscored in `unranked`, so
    bubbleaiagent's twelve deployments became a group of the ten that scored and
    a separate group of the two that did not — and the two we never assessed
    disappeared from the count. So the pool is grouped whole and each lead is
    returned to the half its own row came from. `buildGroups` preserves input
    order and ranked rows come first, so a group with any ranked member leads
    with it.

    The browse view only ever shows leads. The registrations behind a group are
    listed on the lead's detail page, where there is room to say what they are:
    a card is for choosing between agents, and a paragraph about deployment
    topology on every card is noise at exactly the moment someone is scanning.
  */
  const listingGroups = useMemo(
    () => buildGroups([...matches.ranked, ...matches.unranked]),
    [matches],
  );
  const groups = useMemo(() => {
    const rows = collapse([...matches.ranked, ...matches.unranked], listingGroups, new Set());
    const isRanked = new Set(matches.ranked.map((a) => a.agent_id));
    return {
      ranked: rows.filter((a) => isRanked.has(a.agent_id)),
      unranked: rows.filter((a) => !isRanked.has(a.agent_id)),
    };
  }, [matches, listingGroups]);
  const results = paginateGroups(groups.ranked, groups.unranked, requestedPage);
  const activeCount = filters.length + categories.length + (query.trim() ? 1 : 0);
  const secondaryCount = filters.filter((key) => !primaryEvidence.includes(key)).length;
  const evidenceValue = filters.find((key) => primaryEvidence.includes(key)) ?? '';
  const activeSort = SORTS.find((s) => s.key === sort)!;

  // Restore shared URLs after hydration, with the page clamped to the actual results.
  useEffect(() => {
    function restore() {
      ++updateVersion.current;
      activeTransition.current?.skipTransition?.();
      const restored = readExplorerState(window.location.search, defaultView, showCategoryFilter);
      const matches = discoverAgents(agents, restored);
      const page = paginateGroups(matches.ranked, matches.unranked, readPage(window.location.search)).page;
      setState(restored);
      setRequestedPage(page);
      const search = writePage(writeExplorerState(restored, window.location.search), page);
      window.history.replaceState(window.history.state, '', `${window.location.pathname}?${search}${window.location.hash}`);
    }
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [agents, defaultView, showCategoryFilter, pathname]);

  function save(next: ExplorerState, page: number, push = false) {
    setState(next);
    setRequestedPage(page);
    const search = writePage(writeExplorerState(next, window.location.search), page);
    const url = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
    if (push) window.history.pushState(window.history.state, '', url);
    else window.history.replaceState(window.history.state, '', url);
  }

  function update(patch: Partial<ExplorerState>) {
    const version = ++updateVersion.current;
    activeTransition.current?.skipTransition?.();
    const commit = () => {
      if (version === updateVersion.current) save({ ...state, ...patch }, pageAfterChange(results.page, patch));
    };
    const transitionDocument = document as Document & { startViewTransition?: (callback: () => void) => { finished: Promise<void>; skipTransition?: () => void } };
    if (patch.view && patch.view !== view && transitionDocument.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const transition = transitionDocument.startViewTransition(() => flushSync(commit));
      activeTransition.current = transition;
      void transition.finished.catch(() => { /* A newer transition may supersede this one. */ });
    } else commit();
  }

  function goToPage(page: number) {
    ++updateVersion.current;
    activeTransition.current?.skipTransition?.();
    flushSync(() => save(state, Math.max(1, Math.min(results.pageCount, page)), true));
    document.getElementById('agent-results')?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  function toggleFilter(key: FilterKey) {
    update({ filters: filters.includes(key) ? filters.filter((f) => f !== key) : [...filters, key] });
  }

  function clearFilters() { update({ query: '', filters: [], categories: [] }); }

  function renderAgents(rows: Agent[]) {
    return view === 'grid'
      ? <AgentCardGrid agents={rows} />
      : <AgentTable agents={rows} />;
  }

  return (
    <BuyerReviewsProvider agents={[...results.ranked, ...results.unranked, ...reference]}><div id="explorer" className="scroll-mt-28">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-[280px]">
          <span className="sr-only">Search agents</span>
          <span className="agent-search-field flex min-h-11 items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--panel)] px-3">
            <Search size={16} strokeWidth={1.5} className="shrink-0 text-[var(--fg-muted)]" aria-hidden />
            <input type="search" value={query} onChange={(e) => update({ query: e.target.value })} placeholder="Name or capability" className="min-h-11 w-full min-w-0 bg-transparent text-[15px] focus:outline-none" />
          </span>
        </label>
        {showCategoryFilter ? <FilterSelect label="Category" className="flex-1 basis-[180px] sm:max-w-[240px]" value={categories.length > 1 ? 'multiple' : categories[0] ?? ''}
          onChange={(value) => { if (value !== 'multiple') update({ categories: value ? [value as CategorySlug] : [] }); }}
          options={[{ value: '', label: 'All categories' }, ...(categories.length > 1 ? [{ value: 'multiple', label: `${categories.length} categories selected` }] : []), ...CATEGORIES.map((category) => ({ value: category.slug, label: category.name }))]} /> : null}
        <FilterSelect label="Evidence" className="flex-1 basis-[180px] sm:max-w-[230px]" value={evidenceValue}
          onChange={(value) => update({ filters: [...filters.filter((key) => !primaryEvidence.includes(key)), ...(value ? [value as FilterKey] : [])] })}
          options={[{ value: '', label: 'Any evidence level' }, { value: 'protocol_confirmed', label: 'Protocol responded' }, { value: 'assessed', label: 'Has check results' }, { value: 'rated', label: 'Has a published score' }]} />
        <button type="button" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} aria-controls="more-filters" className="inline-flex min-h-11 items-center gap-2 px-2 text-[14px]">
          <SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden /> More filters{secondaryCount ? ` (${secondaryCount})` : ''}
        </button>
      </div>

      {filtersOpen ? <div id="more-filters" className="disclosure-enter mt-4 rounded-[var(--radius-card)] border border-[var(--border)] p-4">
        <p className="mb-3 text-[13px] text-[var(--fg-muted)]">Match all selected filters.</p>
        <div className="flex flex-wrap gap-2">
          {FILTERS.filter((filter) => !primaryEvidence.includes(filter.key)).map((filter) => <button key={filter.key} type="button" onClick={() => toggleFilter(filter.key)} aria-pressed={filters.includes(filter.key)} title={filter.hint} className="min-h-11 rounded-[var(--radius-btn)] border border-[var(--border)] px-3 text-[14px]" style={filters.includes(filter.key) ? { background: 'var(--measured-bg)', color: 'var(--measured)', borderColor: 'var(--measured)' } : undefined}>{filter.label}</button>)}
        </div>
      </div> : null}

      {activeCount > 0 ? <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
        {query.trim() ? <FilterChip label={`Search: ${query}`} onRemove={() => update({ query: '' })} /> : null}
        {categories.map((slug) => <FilterChip key={slug} label={CATEGORY_BY_SLUG.get(slug)?.name ?? slug} onRemove={() => update({ categories: categories.filter((c) => c !== slug) })} />)}
        {filters.map((key) => <FilterChip key={key} label={FILTERS.find((f) => f.key === key)!.label} onRemove={() => toggleFilter(key)} />)}
        <button type="button" onClick={clearFilters} className="min-h-11 px-2 text-[14px] underline underline-offset-4">Clear all</button>
      </div> : null}

      <div id="agent-results" className="mt-7 scroll-mt-24 border-t border-[var(--border)] pt-5" style={{ overflowAnchor: 'none' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" aria-live="polite" aria-atomic="true" className="text-[15px] text-[var(--fg-muted)]">
            {results.total ? <><span className="font-semibold text-[var(--fg)]">{results.start}–{results.end}</span> of {results.total.toLocaleString('en-US')} agents</> : 'No agents found'}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect label="Sort" inline className="w-[260px] max-w-full" value={sort} onChange={(value) => update({ sort: value as SortKey })} options={SORTS.map((option) => ({ value: option.key, label: option.label }))} />
            <div role="group" aria-label="Results view" className="flex rounded-[var(--radius-input)] border border-[var(--border)] p-1">
              {(['grid', 'table'] as const).map((mode) => <button key={mode} type="button" onClick={() => update({ view: mode })} aria-pressed={view === mode} aria-label={mode === 'grid' ? 'Cards' : 'Table'} className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-btn)]" style={view === mode ? { background: 'var(--panel-2)' } : undefined}>{mode === 'grid' ? <LayoutGrid size={16} strokeWidth={1.5} aria-hidden /> : <Rows3 size={16} strokeWidth={1.5} aria-hidden />}</button>)}
            </div>
          </div>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--fg-muted)]">Trust Index checks connections, reported capabilities, and access requirements.</p>

        <div key={`${results.page}-${view}-${query}-${sort}-${filters.join(',')}-${categories.join(',')}`} className="results-transition results-enter mt-5">
          {results.total === 0 ? <EmptyState title="No matches" body="Try a broader search or clear a filter." /> : null}
          {results.ranked.length > 0 ? renderAgents(results.ranked) : null}
          {results.unranked.length > 0 ? <section className={results.ranked.length ? 'mt-7' : ''}>
            <p className="mb-4 text-[14px] text-[var(--fg-muted)]">{sort === 'evidence' ? 'No usable interface reading' : `No ${activeSort.label.toLowerCase()} value available`} · listed A–Z, without a ranking.</p>
            {renderAgents(results.unranked)}
          </section> : null}
        </div>

        {results.pageCount > 1 ? <nav aria-label="Agent result pages" className="mt-7 flex flex-wrap items-center justify-center gap-1.5">
          <button type="button" disabled={results.page === 1} onClick={() => goToPage(results.page - 1)} className="min-h-11 rounded-[var(--radius-btn)] px-3 text-[14px] disabled:opacity-40">Previous</button>
          {pageNumbers(results.page, results.pageCount).map((page, i) => page === 'gap' ? <span key={`gap-${i}`} className="px-1 text-[var(--fg-muted)]" aria-hidden>…</span> : <button key={page} type="button" aria-label={`Page ${page}`} aria-current={page === results.page ? 'page' : undefined} onClick={() => goToPage(page)} className="min-h-11 min-w-11 rounded-[var(--radius-btn)] border border-[var(--border)] px-2 text-[14px]" style={page === results.page ? { background: 'var(--fg)', color: 'var(--panel)' } : undefined}>{page}</button>)}
          <button type="button" disabled={results.page === results.pageCount} onClick={() => goToPage(results.page + 1)} className="min-h-11 rounded-[var(--radius-btn)] px-3 text-[14px] disabled:opacity-40">Next</button>
        </nav> : null}
      </div>

      {reference.length > 0 ? <details className="mt-10 border-t border-[var(--border)] pt-5">
        <summary className="min-h-11 cursor-pointer text-[15px] font-medium">Our demo agents ({reference.length})</summary>
        <p className="mb-4 text-[14px] text-[var(--fg-muted)]">Our deployments are excluded from independent results and ratings.</p>
        {renderAgents(reference)}
      </details> : null}
    </div></BuyerReviewsProvider>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-[var(--radius-btn)] bg-[var(--panel-2)] px-3 text-[13px]">
    <span className="truncate">{label}</span><X size={16} strokeWidth={1.5} className="shrink-0" aria-hidden />
  </button>;
}
