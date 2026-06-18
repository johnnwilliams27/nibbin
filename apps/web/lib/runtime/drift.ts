import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** R2 drift nudge: when a Senior/Grad's recent real drafts degrade, surface a
 *  CALM, human-only nudge leaf — never auto-demote, never key on silence.
 *  Best-effort: any failure is swallowed (the decision already committed). */
export async function maybeDriftNudge(
  svc: SupabaseClient,
  accountId: string,
  nibbinId: string,
): Promise<void> {
  try {
    const { data: n } = await svc
      .from('nibbins')
      .select('name, stage, species, palette, accessory, marking')
      .eq('id', nibbinId)
      .single();
    if (!n || (n.stage !== 'senior' && n.stage !== 'grad')) return;

    // Last 10 DECIDED runs for this nibbin (any stage — recent behavior).
    const { data: recent } = await svc
      .from('approvals')
      .select('decision, decided_at, runs!inner(nibbin_id)')
      .eq('runs.nibbin_id', nibbinId)
      .order('decided_at', { ascending: false })
      .limit(10);
    const rows = (recent ?? []) as Array<{ decision: string }>;
    if (rows.length < 10) return; // insufficient recent evidence — silence never trips it

    const approved = rows.filter((r) => r.decision === 'approved').length;
    if (approved / rows.length >= 0.8) return; // healthy

    // Deduped per nibbin per UTC day so it never spams every decision.
    const day = new Date().toISOString().slice(0, 10);
    const name = n.name as string;
    await svc.rpc('insert_system_notification', {
      p_account: accountId,
      p_kind: 'nudge',
      p_source_id: `drift:${nibbinId}:${day}`,
      p_title: `${name}'s recent drafts needed more edits`,
      p_body:
        `Her last ten runs went back for changes more than usual. You might put ${name} back to drafts while she re-learns — nothing's lost either way. Your call.`,
      p_payload: {
        ctaPath: '/app/nibbins',
        ctaLabel: `Review ${name}`,
        nibbinId,
        species: n.species,
        stage: n.stage,
        palette: n.palette ?? null,
        accessory: n.accessory ?? 'none',
        marking: n.marking ?? 'none',
      },
    });
  } catch {
    // best-effort; never disrupt the decision path
  }
}
