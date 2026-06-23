/**
 * Pure data: section keys → human labels, in the order they're shown to the
 * model and the UI. No server-only guard — safe to import from client components.
 *
 * Server-side code (lib/grove/memory.ts) re-exports this so existing importers
 * continue to work unchanged.
 *
 * Task 4: rewritten to a neutral 7-section set (no photographer-specific copy).
 * `hard_rules` and `notes` are handled separately (not section entries).
 */

export type MemorySection = { key: string; label: string };

/** FieldKind controls how a section is formatted when displayed or injected into a draft. */
export type FieldKind = 'list' | 'dl' | 'quote' | 'paragraphs';

/**
 * A section descriptor: the full shape used by the dynamic registry and FIELD_CONFIG.
 * Extends MemorySection with kind and placeholder (required for defaults).
 */
export interface SectionEntry {
  key: string;
  label: string;
  kind: FieldKind | 'list';
  placeholder: string;
  hint?: string;
}

/**
 * The 7 neutral default sections, in canonical display order.
 * No photographer-specific keys, labels, or placeholder copy.
 * `hard_rules` and `notes` are separate RPC parameters — never in this list.
 */
export const DEFAULT_SECTIONS: ReadonlyArray<SectionEntry> = [
  {
    key: 'about',
    label: 'About us',
    kind: 'paragraphs',
    placeholder: 'Who you are, what you make or do, who you serve.',
    hint: 'A few sentences or paragraphs about your business.',
  },
  {
    key: 'offering',
    label: 'What we do',
    kind: 'list',
    placeholder: 'Brand strategy & identity\nContent creation\nSocial media management',
    hint: 'List your main services or products, one per line.',
  },
  {
    key: 'how',
    label: 'How we work',
    kind: 'list',
    placeholder: 'Initial discovery call → proposal → kickoff\nAll work reviewed before delivery\nRevisions included in every package',
    hint: 'Describe your process or workflow, one step or principle per line.',
  },
  {
    key: 'pricing',
    label: 'Pricing & terms',
    kind: 'list',
    placeholder: 'Standard plan: $X / month\nSetup fee: $Y\nNet-30 terms',
    hint: 'List your packages or rate cards, one per line.',
  },
  {
    key: 'policies',
    label: 'Policies',
    kind: 'list',
    placeholder: 'Contracts required for all projects\nChanges within scope at no extra cost\nOut-of-scope requests quoted separately',
    hint: 'One policy per line.',
  },
  {
    key: 'voice',
    label: 'Voice & tone',
    kind: 'quote',
    placeholder: 'Clear, direct, and human. No buzzwords — just straightforward communication that respects your time.',
    hint: 'Write how you naturally speak. Your Nibbins will match this.',
  },
  {
    key: 'faq',
    label: 'Common questions',
    kind: 'list',
    placeholder: 'How long does a project take? Typically 2–4 weeks.\nDo you work with international clients? Yes.',
    hint: 'One question-answer pair per line.',
  },
] as const;

/**
 * MEMORY_SECTIONS: the canonical ordered list for the LLM drafter and legacy
 * server-side code (lib/grove/memory.ts re-exports this).
 *
 * Shape is MemorySection[] for back-compat; contents updated to neutral keys.
 * Existing importers that iterate `{ key, label }` continue to work unchanged.
 */
export const MEMORY_SECTIONS: ReadonlyArray<MemorySection> = DEFAULT_SECTIONS.map(({ key, label }) => ({
  key,
  label,
}));
