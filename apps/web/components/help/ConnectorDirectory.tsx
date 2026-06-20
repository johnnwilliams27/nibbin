'use client';
import { useMemo, useState } from 'react';
import type { ConnectorEntry } from '../../lib/connections/catalog';
import { groupConnectors, sortConnectors } from '../../lib/connections/catalog-view';
import { ConnectorLogo } from './ConnectorLogo';
import { Badge } from '../ui';
import styles from './help.module.css';

const STATUS_LABEL: Record<ConnectorEntry['status'], { label: string; tone: 'moss' | 'sky' | 'neutral' }> = {
  live: { label: 'Available', tone: 'moss' },
  early_access: { label: 'Early access', tone: 'sky' },
  coming_soon: { label: 'Coming soon', tone: 'neutral' },
};

function ConnectorGrid({ items, connectedIds }: { items: ConnectorEntry[]; connectedIds: Set<string> }) {
  return (
    <ul className={styles.grid}>
      {items.map((c) => {
        const connected = connectedIds.has(c.id);
        return (
          <li key={c.id} className={styles.card}>
            <ConnectorLogo name={c.name} domain={c.domain} />
            <div className={styles.cardBody}>
              <div className={styles.cardHead}>
                <span className={styles.cardName}>{c.name}</span>
                {connected ? (
                  <Badge tone="moss">Connected</Badge>
                ) : (
                  <Badge tone={STATUS_LABEL[c.status].tone}>{STATUS_LABEL[c.status].label}</Badge>
                )}
              </div>
              <p className={styles.cardDesc}>{c.whatItDoes}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ConnectorDirectory({
  connectors,
  heading = 'All connectors',
  showSort = true,
  connectedIds = [],
}: {
  connectors: ConnectorEntry[];
  heading?: string;
  showSort?: boolean;
  /** Catalog ids the account has an active connection for — shown as "Connected". */
  connectedIds?: string[];
}) {
  const connectedSet = useMemo(() => new Set(connectedIds), [connectedIds]);
  const [mode, setMode] = useState<'available' | 'alpha'>('available');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Matches by display name, category, and what-it-does so a search like
  // "invoice" or "calendar" surfaces relevant connectors, not just name hits.
  const matches = useMemo(() => {
    if (!q) return [];
    return sortConnectors(
      connectors.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q) ||
          c.whatItDoes.toLowerCase().includes(q),
      ),
      'available',
    );
  }, [connectors, q]);

  // When searching, collapse to a single flat result list (no category
  // accordions); otherwise group/sort per the Sort control.
  const groups = useMemo(
    () =>
      searching
        ? [{ category: 'Results', items: matches }]
        : mode === 'available'
          ? groupConnectors(connectors)
          : [{ category: 'All', items: sortConnectors(connectors, 'alpha') }],
    [connectors, mode, searching, matches],
  );

  // Collapse categories by default so each category fetches its (third-party)
  // logos only when expanded — the first category opens so the section isn't empty.
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = groupConnectors(connectors)[0]?.category;
    return new Set(first ? [first] : []);
  });
  const toggle = (category: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  // When searching, never collapse — every result group is expanded.
  const grouped = mode === 'available' && !searching;

  return (
    <section className={styles.directory}>
      <header className={styles.directoryHead}>
        <h2>{heading}</h2>
        <div className={styles.directoryControls}>
          <input
            type="search"
            className={styles.connectorSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connectors…"
            aria-label="Search connectors"
          />
          {showSort && (
            <label className={styles.sort}>
              Sort
              <span className={styles.sortWrapper}>
                <select
                  className={styles.sortSelect}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "available" | "alpha")}
                  disabled={searching}
                >
                  <option value="available">Available first, then A–Z</option>
                  <option value="alpha">A–Z</option>
                </select>
              </span>
            </label>
          )}
        </div>
      </header>
      {searching && matches.length === 0 && (
        <p className={styles.searchEmpty}>No connectors match “{query.trim()}”.</p>
      )}
      {groups.map((g) => {
        const expanded = !grouped || open.has(g.category);
        return (
          <div key={g.category} className={styles.group}>
            {grouped ? (
              <button
                type="button"
                className={styles.groupToggle}
                aria-expanded={expanded}
                onClick={() => toggle(g.category)}
              >
                <span className={styles.groupChevron} aria-hidden="true">
                  {expanded ? '▾' : '▸'}
                </span>
                <span className={styles.groupName}>{g.category}</span>
                <span className={styles.groupCount}>{g.items.length}</span>
              </button>
            ) : (
              <h3>{g.category}</h3>
            )}
            {expanded && <ConnectorGrid items={g.items} connectedIds={connectedSet} />}
          </div>
        );
      })}
    </section>
  );
}
