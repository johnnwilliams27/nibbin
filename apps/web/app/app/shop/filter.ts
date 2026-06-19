/**
 * Pure connector-filter predicate for the Agent Shop — extracted so it is
 * trivially unit-testable without touching React or Next.
 */

export type ConnectorKey = string;

/** 'all' is the sentinel for "no filter active". */
export type FilterValue = 'all' | ConnectorKey;

/**
 * Build the ordered list of unique connector chips from a template list.
 * 'all' is always first.
 */
export function buildConnectorOptions(
  templates: readonly { spec: { requiredConnectors: readonly string[] } }[],
): FilterValue[] {
  const seen = new Set<string>();
  for (const t of templates) {
    for (const c of t.spec.requiredConnectors) {
      seen.add(c);
    }
  }
  return ['all', ...Array.from(seen).sort()];
}

/**
 * Returns the subset of `templates` whose requiredConnectors includes
 * `filter` (or all templates when filter is 'all').
 */
export function filterTemplates<T extends { spec: { requiredConnectors: readonly string[] } }>(
  templates: readonly T[],
  filter: FilterValue,
): T[] {
  if (filter === 'all') return [...templates];
  return templates.filter((t) => t.spec.requiredConnectors.includes(filter));
}
