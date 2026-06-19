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

function ConnectorGrid({ items }: { items: ConnectorEntry[] }) {
  return (
    <ul className={styles.grid}>
      {items.map((c) => (
        <li key={c.id} className={styles.card}>
          <ConnectorLogo name={c.name} domain={c.domain} />
          <div className={styles.cardBody}>
            <div className={styles.cardName}>{c.name}</div>
            <p className={styles.cardDesc}>{c.whatItDoes}</p>
          </div>
          <Badge tone={STATUS_LABEL[c.status].tone} style={{ alignSelf: "flex-start" }}>{STATUS_LABEL[c.status].label}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function ConnectorDirectory({
  connectors,
  heading = 'All connectors',
  showSort = true,
}: {
  connectors: ConnectorEntry[];
  heading?: string;
  showSort?: boolean;
}) {
  const [mode, setMode] = useState<'available' | 'alpha'>('available');
  const groups = useMemo(
    () =>
      mode === 'available'
        ? groupConnectors(connectors)
        : [{ category: 'All', items: sortConnectors(connectors, 'alpha') }],
    [connectors, mode],
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

  const grouped = mode === 'available';

  return (
    <section className={styles.directory}>
      <header className={styles.directoryHead}>
        <h2>{heading}</h2>
        {showSort && (
          <label className={styles.sort}>
            Sort
            <span className={styles.sortWrapper}>
              <select
                className={styles.sortSelect}
                value={mode}
                onChange={(e) => setMode(e.target.value as "available" | "alpha")}
              >
                <option value="available">Available first, then A–Z</option>
                <option value="alpha">A–Z</option>
              </select>
            </span>
          </label>
        )}
      </header>
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
            {expanded && <ConnectorGrid items={g.items} />}
          </div>
        );
      })}
    </section>
  );
}
