/**
 * Layer 2 — category blocklist (C5). Evaluated BEFORE persistence; a hit means
 * the event is dropped entirely and nothing is recorded. Matchers ship in
 * rules/category-blocklist.json (shared with the Rust daemon); user-added
 * exclusions extend the list at runtime.
 */
import blocklistJson from '../rules/category-blocklist.json';

export interface UserExclusions {
  hosts: string[];
  bundleIds: string[];
  appNames: string[];
}

export const EMPTY_EXCLUSIONS: UserExclusions = { hosts: [], bundleIds: [], appNames: [] };

const blockedCategories = new Set<string>(blocklistJson.blockedCategories);

interface CategoryMatchers {
  hosts: string[];
  bundleIds: string[];
  titleTerms: string[];
}

const matchers: Record<string, CategoryMatchers> = blocklistJson.matchers;

function hostMatches(host: string, suffix: string): boolean {
  const h = host.toLowerCase();
  const s = suffix.toLowerCase();
  return h === s || h.endsWith('.' + s);
}

/**
 * Decide whether a window/url must be blocked. Returns the category name on a
 * hit, or null. An explicit pre-categorized `category` (from the capture
 * layer's own categorizer) is honored if it names a blocked category.
 */
export function blockedCategoryFor(
  window: { title: string; category?: string },
  app: { bundleId: string; name: string },
  urlHost: string | null,
  exclusions: UserExclusions = EMPTY_EXCLUSIONS,
): string | null {
  if (window.category && blockedCategories.has(window.category)) return window.category;

  const bundle = app.bundleId.toLowerCase();
  const title = window.title.toLowerCase();

  for (const [category, m] of Object.entries(matchers)) {
    if (urlHost && m.hosts.some((h) => hostMatches(urlHost, h))) return category;
    if (m.bundleIds.some((b) => bundle === b.toLowerCase() || bundle.startsWith(b.toLowerCase() + '.'))) {
      return category;
    }
    if (m.titleTerms.some((t) => title.includes(t.toLowerCase()))) return category;
  }

  if (urlHost && exclusions.hosts.some((h) => hostMatches(urlHost, h))) return 'user_exclusion';
  if (exclusions.bundleIds.some((b) => bundle === b.toLowerCase())) return 'user_exclusion';
  if (exclusions.appNames.some((n) => app.name.toLowerCase() === n.toLowerCase())) return 'user_exclusion';

  return null;
}
