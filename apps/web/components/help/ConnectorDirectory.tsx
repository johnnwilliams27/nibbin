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

  // Tabs across the top: Popular first (curated), then each non-empty category.
  // Exactly one tab's grid shows at a time — no vertical accordion stack.
  const tabs = useMemo(() => {
    const t: { key: string; label: string; items: ConnectorEntry[] }[] = [];
    const pop = popularConnectors(connectors);
    if (pop.length) t.push({ key: POPULAR_KEY, label: 'Popular', items: pop });
    for (const g of groupConnectors(connectors)) {
      t.push({ key: g.category, label: g.category, items: g.items });
    }
    return t;
  }, [connectors]);

  const [activeKey, setActiveKey] = useState<string>(POPULAR_KEY);
  // Resolve the active tab; fall back to the first tab if the key ever goes stale.
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  const isPopular = active?.key === POPULAR_KEY;

  // Popular keeps its curated order; category tabs respect the Sort control.
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
          {showSort && (
            <label className={styles.sort}>
              Sort
              <span className={styles.sortWrapper}>
                <select
                  className={styles.sortSelect}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'available' | 'alpha')}
                  // Sort orders a category grid; no effect while searching
                  // (always available-first) or on the curated Popular tab.
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
        <>
          <nav className={styles.tabBar} aria-label="Connector categories">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`${styles.catTab} ${t.key === active?.key ? styles.catTabActive : ''}`}
                aria-pressed={t.key === active?.key}
                onClick={() => setActiveKey(t.key)}
              >
                {t.label}
                <span className={styles.catTabCount}>{t.items.length}</span>
              </button>
            ))}
          </nav>
          {active && <ConnectorGrid items={activeItems} connectedIds={connectedSet} />}
        </>
      )}
    </section>
  );
}
