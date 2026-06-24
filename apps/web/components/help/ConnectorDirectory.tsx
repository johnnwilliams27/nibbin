'use client';
import { useMemo, useState } from 'react';
import type { ConnectorEntry } from '../../lib/connections/catalog';
import { groupConnectors, sortConnectors, popularConnectors } from '../../lib/connections/catalog-view';
import { ConnectorLogo } from './ConnectorLogo';
import { Badge } from '../ui';
import styles from './help.module.css';

const STATUS_LABEL: Record<ConnectorEntry['status'], { label: string; tone: 'moss' | 'sky' | 'neutral' }> = {
  live: { label: 'Available', tone: 'moss' },
  early_access: { label: 'Early access', tone: 'sky' },
  coming_soon: { label: 'Coming soon', tone: 'neutral' },
};

const POPULAR_KEY = '__popular__';
const ALL_KEY = '__all__';

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

  // Category views: Popular (curated) first, then "All connectors", then each
  // non-empty category. A single <select> drives which view shows — far more
  // scannable than a 27-chip horizontal rail when there are 26 categories.
  const groups = useMemo(() => groupConnectors(connectors), [connectors]);
  const popular = useMemo(() => popularConnectors(connectors), [connectors]);

  type View = { key: string; label: string; items: ConnectorEntry[] };
  const views = useMemo<View[]>(() => {
    const v: View[] = [];
    if (popular.length) v.push({ key: POPULAR_KEY, label: 'Popular', items: popular });
    v.push({ key: ALL_KEY, label: 'All connectors', items: connectors });
    for (const g of groups) v.push({ key: g.category, label: g.category, items: g.items });
    return v;
  }, [connectors, groups, popular]);

  const [activeKey, setActiveKey] = useState<string>(POPULAR_KEY);
  // Resolve the active view; fall back to the first view if the key goes stale.
  const active = views.find((v) => v.key === activeKey) ?? views[0];
  const isPopular = active?.key === POPULAR_KEY;

  // Popular keeps its curated order; every other view respects the Sort control.
  const activeItems = active ? (isPopular ? active.items : sortConnectors(active.items, mode)) : [];

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
          <label className={styles.sort}>
            Category
            <span className={styles.sortWrapper}>
              <select
                className={styles.sortSelect}
                value={active?.key ?? POPULAR_KEY}
                onChange={(e) => setActiveKey(e.target.value)}
                // While searching we show cross-category matches, so the category
                // picker has no effect — disable it to signal that.
                disabled={searching}
                aria-label="Filter connectors by category"
              >
                {views.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label} ({v.items.length})
                  </option>
                ))}
              </select>
            </span>
          </label>
          {showSort && (
            <label className={styles.sort}>
              Sort
              <span className={styles.sortWrapper}>
                <select
                  className={styles.sortSelect}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'available' | 'alpha')}
                  // Sort orders the active grid; no effect while searching
                  // (always available-first) or on the curated Popular view.
                  disabled={searching || isPopular}
                >
                  <option value="available">Available first, then A–Z</option>
                  <option value="alpha">A–Z</option>
                </select>
              </span>
            </label>
          )}
        </div>
      </header>

      {searching ? (
        matches.length === 0 ? (
          <p className={styles.searchEmpty}>No connectors match “{query.trim()}”.</p>
        ) : (
          <ConnectorGrid items={matches} connectedIds={connectedSet} />
        )
      ) : (
        active && <ConnectorGrid items={activeItems} connectedIds={connectedSet} />
      )}
    </section>
  );
}
