import { CONNECTOR_CATEGORIES, type ConnectorEntry, type ConnectorStatus } from './catalog';

const STATUS_ORDER: Record<ConnectorStatus, number> = {
  live: 0,
  early_access: 1,
  coming_soon: 2,
};

export function sortConnectors(list: ConnectorEntry[], mode: 'available' | 'alpha'): ConnectorEntry[] {
  const byName = (a: ConnectorEntry, b: ConnectorEntry) => a.name.localeCompare(b.name);
  if (mode === 'alpha') return [...list].sort(byName);
  return [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b));
}

export function groupConnectors(list: ConnectorEntry[]): { category: string; items: ConnectorEntry[] }[] {
  return CONNECTOR_CATEGORIES.map((category) => ({
    category,
    items: sortConnectors(list.filter((c) => c.category === category), 'available'),
  })).filter((g) => g.items.length > 0);
}

// Curated "most-used" connectors for the Popular tab, ordered by likely demand
// for a solo professional / small business. Ids must exist in the catalog;
// popularConnectors() silently drops any that don't, so this stays safe.
const POPULAR_CONNECTOR_IDS: string[] = [
  'gmail',
  'google-calendar',
  'outlook-m365',
  'stripe',
  'quickbooks',
  'hubspot',
  'notion',
  'google-drive',
  'slack',
  'calendly',
  'zoom',
  'docusign',
  'xero',
  'dropbox',
  'shopify',
];

/** The curated Popular connectors, in curated order, filtered to ones present. */
export function popularConnectors(list: ConnectorEntry[]): ConnectorEntry[] {
  const byId = new Map(list.map((c) => [c.id, c]));
  return POPULAR_CONNECTOR_IDS.map((id) => byId.get(id)).filter(
    (c): c is ConnectorEntry => c != null,
  );
}

export function monogramFor(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
