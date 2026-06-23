/**
 * Pure data: section keys → human labels, in the order they're shown to the
 * model and the UI. No server-only guard — safe to import from client components.
 *
 * Server-side code (lib/grove/memory.ts) re-exports this so existing importers
 * continue to work unchanged.
 */

export type MemorySection = { key: string; label: string };

/** Section keys → human labels, in the order they're shown to the model. */
export const MEMORY_SECTIONS: ReadonlyArray<MemorySection> = [
  { key: 'facts', label: 'Business facts' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'policies', label: 'Policies' },
  { key: 'faq', label: 'Common questions' },
  { key: 'voice', label: 'Voice & tone' },
];
