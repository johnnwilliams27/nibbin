import 'server-only';

/**
 * Open-web utility (Slice 3a, design §4) — the redact→egress→quarantine
 * pipeline for web.search / web.fetch. Built fully in Task 5; this module
 * exposes `webSearchEnabled()` now so plan synthesis (Task 4) only offers the
 * web.* utilities when a provider key is configured (no key → not offered).
 */

/** True when a search provider is configured (env-gated). With no key the
 *  web.* utilities are never offered to the planner surface. */
export function webSearchEnabled(): boolean {
  const key = process.env.WEB_SEARCH_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}
