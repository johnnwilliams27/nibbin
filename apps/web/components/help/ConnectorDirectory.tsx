'use client';
import { useState } from 'react';
import { CONNECTORS, type ConnectorEntry } from '../../lib/connections/catalog';
import { groupConnectors, sortConnectors } from '../../lib/connections/catalog-view';
import { ConnectorLogo } from './ConnectorLogo';
import { Badge } from '../ui';
import styles from './help.module.css';

const STATUS_LABEL: Record<ConnectorEntry['status'], { label: string; tone: 'moss' | 'sky' | 'neutral' }> = {
  live: { label: 'Available', tone: 'moss' },
  early_access: { label: 'Early access', tone: 'sky' },
  coming_soon: { label: 'Coming soon', tone: 'neutral' },
};

export function ConnectorDirectory({
  connectors = CONNECTORS,
  heading = 'All connectors',
  showSort = true,
}: {
  connectors?: ConnectorEntry[];
  heading?: string;
  showSort?: boolean;
}) {
  const [mode, setMode] = useState<'available' | 'alpha'>('available');
  const groups =
    mode === 'available'
      ? groupConnectors(connectors)
      : [{ category: 'All', items: sortConnectors(connectors, 'alpha') }];

  return (
    <section className={styles.directory}>
      <header className={styles.directoryHead}>
        <h2>{heading}</h2>
        {showSort && (
          <label className={styles.sort}>
            Sort
            <select value={mode} onChange={(e) => setMode(e.target.value as 'available' | 'alpha')}>
              <option value="available">Available first, then A–Z</option>
              <option value="alpha">A–Z</option>
            </select>
          </label>
        )}
      </header>
      {groups.map((g) => (
        <div key={g.category} className={styles.group}>
          <h3>{g.category}</h3>
          <ul className={styles.grid}>
            {g.items.map((c) => (
              <li key={c.id} className={styles.card}>
                <ConnectorLogo name={c.name} domain={c.domain} />
                <div className={styles.cardBody}>
                  <div className={styles.cardName}>{c.name}</div>
                  <p className={styles.cardDesc}>{c.whatItDoes}</p>
                </div>
                <Badge tone={STATUS_LABEL[c.status].tone}>{STATUS_LABEL[c.status].label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
