import 'server-only';

/**
 * Grove Memory (SPEC §4.8) read side: load the account's business brain and
 * format it as a cacheable system block for the drafter. Returns null when
 * there's nothing to inject. Uses the service role because runs are server-side
 * and may be system-triggered (no user session); the row is account-scoped.
 */
import { serviceClient } from '../supabase/service';

interface GroveMemoryRow {
  sections: Record<string, string> | null;
  hard_rules: string[] | null;
  notes: string | null;
}

/** Section keys → human labels, in the order they're shown to the model. */
export const MEMORY_SECTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'facts', label: 'Business facts' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'policies', label: 'Policies' },
  { key: 'faq', label: 'Common questions' },
  { key: 'voice', label: 'Voice & tone' },
];

export async function loadGroveMemoryBlock(accountId: string): Promise<string | null> {
  try {
    const { data } = await serviceClient()
      .from('grove_memory')
      .select('sections, hard_rules, notes')
      .eq('account_id', accountId)
      .maybeSingle<GroveMemoryRow>();
    if (!data) return null;

    const sections = data.sections ?? {};
    const parts: string[] = [];
    for (const { key, label } of MEMORY_SECTIONS) {
      const v = (sections[key] ?? '').trim();
      if (v) parts.push(`${label}:\n${v}`);
    }
    if (data.notes?.trim()) parts.push(`Notes:\n${data.notes.trim()}`);
    const rules = (data.hard_rules ?? []).map((r) => String(r).trim()).filter(Boolean);

    if (parts.length === 0 && rules.length === 0) return null;

    const lines = [
      'What you know about this business — use it so drafts sound like the owner, not a generic assistant.',
    ];
    if (parts.length) lines.push('', parts.join('\n\n'));
    if (rules.length) {
      lines.push('', 'Hard rules — non-negotiable; never violate these:');
      for (const r of rules) lines.push(`- ${r}`);
    }
    return lines.join('\n');
  } catch (err) {
    // Missing table (pre-migration) or a read failure must never break a draft.
    console.error('[grove-memory] load failed — drafting without it', err instanceof Error ? err.message : err);
    return null;
  }
}
