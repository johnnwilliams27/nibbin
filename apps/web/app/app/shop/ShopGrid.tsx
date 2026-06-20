'use client';

/**
 * Client-side grid + connector filter for the Agent Shop.
 * Receives pre-rendered SVG strings and serialised template data from the
 * server page so no additional fetch is needed for filtering.
 */
import { useState } from 'react';
import { EmptyState } from '../../../components/ui';
import { AdoptButton } from '../../../components/adopt/AdoptButton';
import { buildConnectorOptions, filterTemplates } from './filter';
import type { FilterValue } from './filter';
import { adoptFromShopOutcome } from './actions';
import styles from './shop.module.css';

const CONNECTOR_LABEL: Record<string, string> = {
  gmail: 'Gmail',
  'google-calendar': 'Calendar',
  stripe: 'Stripe',
};

function connectorLabel(key: string): string {
  return CONNECTOR_LABEL[key] ?? key;
}

export interface ShopCard {
  key: string;
  displayName: string;
  tagline: string;
  description: string;
  measures: string;
  requiredConnectors: string[];
  svg: string;
  adopted: { name: string; stage: string; pillLabel: string; pillClassName: string } | null;
}

export function ShopGrid({ cards }: { cards: ShopCard[] }) {
  const [filter, setFilter] = useState<FilterValue>('all');

  // Adapt flat ShopCard shape to the generic {spec:{requiredConnectors}} form expected by the pure utils.
  const asSpecs = cards.map((c) => ({ ...c, spec: { requiredConnectors: c.requiredConnectors } }));
  const options = buildConnectorOptions(asSpecs);
  // filterTemplates returns the same adapted objects; we only use the keys to
  // recover the original ShopCard from cards so no data is lost.
  const visibleKeys = new Set(filterTemplates(asSpecs, filter).map((t) => t.key));
  const visible = cards.filter((c) => visibleKeys.has(c.key));

  return (
    <>
      {/* connector filter row */}
      <div className={styles.filterRow} role="group" aria-label="Filter by connector">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={[styles.filterChip, filter === opt ? styles.filterChipActive : ''].filter(Boolean).join(' ')}
            aria-pressed={filter === opt}
            onClick={() => setFilter(opt)}
          >
            {opt === 'all' ? 'All' : connectorLabel(opt)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="No templates need that connector just yet. More are on their way."
        />
      ) : (
        <div className={styles.grid}>
          {visible.map((card) => (
            <article key={card.key} className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.sprite} dangerouslySetInnerHTML={{ __html: card.svg }} />
                <div>
                  <h2 className={styles.name}>{card.adopted?.name ?? card.displayName}</h2>
                  <p className={styles.tagline}>{card.tagline}</p>
                </div>
              </div>
              <p className={styles.description}>{card.description}</p>
              <p className={styles.measures}>School measures: {card.measures}.</p>
              <p className={styles.connectors}>Works from {card.requiredConnectors.join(' · ')}</p>
              <div className={styles.actions}>
                {card.adopted ? (
                  <>
                    <span className={`${styles.pill} ${styles[card.adopted.pillClassName]}`}>
                      {card.adopted.pillLabel}
                    </span>
                    <p className={styles.adoptedNote}>
                      {card.adopted.name} is in your grove — <a href="/app">say hello</a>.
                    </p>
                  </>
                ) : (
                  <AdoptButton
                    action={adoptFromShopOutcome}
                    templateKey={card.key}
                    label={`Adopt ${card.displayName}`}
                  />
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
