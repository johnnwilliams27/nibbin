import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { ensureAccount } from '../../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../../lib/auth/profile';
import { clientForRequest } from '../../../../lib/auth/desktop-client';
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
  const supabase = await clientForRequest(req);
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

  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 512_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const packet = validateSynthesisPacket(body);
  if (!packet) return NextResponse.json({ error: 'invalid_packet' }, { status: 422 });

  const svc = serviceClient();

  // First-write-wins: a retry of the same study must NOT re-run the
  // non-deterministic Opus labeling or overwrite the existing map/letter. If a
  // diagnosis already exists for this (account, study), return it unchanged and
  // skip synthesis + labeling + write entirely.
  if (packet.studyId) {
    const { data: existing } = await svc
      .from('diagnoses')
      .select('id, map')
      .eq('account_id', accountId)
      .eq('study_id', packet.studyId)
      .maybeSingle();
    if (existing) {
      const existingMap = existing.map as { totalHoursPerWeek?: number } | null;
      return NextResponse.json({
        ok: true,
        diagnosisId: existing.id,
        totalHoursPerWeek: existingMap?.totalHoursPerWeek ?? 0,
      });
    }
  }

  // Deterministic mining, then the Opus labeling pass (warm labels + the
  // Grovekeeper's letter); labeling degrades to deterministic labels on failure.
  const mined = synthesizeDiagnosis(packet);
  const { map, letter } = await labelDiagnosis(accountId, mined);

  const row = {
    account_id: accountId,
    status: 'ready' as const,
    packet,
    map,
    letter,
    kind: packet.kind ?? 'full_study',
    depth: packet.depth ?? 'lite',
    ...(packet.label ? { label: packet.label } : {}),
    ...(packet.studyId ? { study_id: packet.studyId } : {}),
  };
  const writer = packet.studyId
    ? svc.from('diagnoses').upsert(row, { onConflict: 'account_id,study_id' })
    : svc.from('diagnoses').insert(row);
  const { data, error } = await writer.select('id').single();
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

  // Diagnosis-ready leaf: surface a nudge so the grove home can prompt the user
  // to view their new field study map. Best-effort — never blocks the response.
  try {
    await svc.rpc('insert_system_notification', {
      p_account: accountId,
      p_kind: 'nudge',
      p_source_id: 'diagnosis_ready:' + data.id,
      p_title: 'Your field study map is ready',
      p_body: 'Your workflow diagnosis is in your grove.',
      p_payload: { ctaPath: '/app/diagnosis', ctaLabel: 'See your map' },
    });
  } catch {
    // notification is best-effort — never fail the ingest on it.
  }

  return NextResponse.json({ ok: true, diagnosisId: data.id, totalHoursPerWeek: map.totalHoursPerWeek });
}
