import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { ensureAccount } from '../../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../../lib/auth/profile';
import { synthesizeDiagnosis, validateSynthesisPacket } from '../../../../lib/diagnosis/synthesize';
import { labelDiagnosis } from '../../../../lib/diagnosis/label';

/**
 * Study-packet ingest (SPEC §5, §8 M7). The Observer uploads the redacted,
 * structured synthesis packet (C7 — pixels never leave the device, only this).
 * We validate it, synthesize the diagnosis (deterministic v0), and store
 * packet + map on one row (§6.11: the packet becomes the diagnosis). The upload
 * is user-initiated and authenticated; the diagnosis is written under the
 * resolved account.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let accountId: string;
  try {
    accountId = await ensureAccount({
      getEmail: async () => user.email ?? null,
      ensureProfile: () => upsertOwnProfile(supabase, user),
      bootstrap: async (name) => {
        const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
        if (error) throw error;
        return data as string;
      },
    });
  } catch {
    return NextResponse.json({ error: 'account' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const packet = validateSynthesisPacket(body);
  if (!packet) return NextResponse.json({ error: 'invalid_packet' }, { status: 422 });

  // Deterministic mining, then the Opus labeling pass (warm labels + the
  // Grovekeeper's letter); labeling degrades to deterministic labels on failure.
  const mined = synthesizeDiagnosis(packet);
  const { map, letter } = await labelDiagnosis(accountId, mined);

  const svc = serviceClient();
  const { data, error } = await svc
    .from('diagnoses')
    .insert({ account_id: accountId, status: 'ready', packet, map, letter })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: 'store_failed' }, { status: 502 });

  // §6.12: the study produced a diagnosis. Service-role emit (auth.uid() is null
  // under the service role, so emit_product_event skips its membership check).
  try {
    await svc.rpc('emit_product_event', {
      p_account: accountId,
      p_name: 'study_completed',
      p_props: { diagnosisId: data.id },
    });
  } catch {
    // analytics is best-effort — never fail the ingest on it.
  }

  return NextResponse.json({ ok: true, diagnosisId: data.id, totalHoursPerWeek: map.totalHoursPerWeek });
}
