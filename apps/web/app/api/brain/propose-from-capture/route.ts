/**
 * POST /api/brain/propose-from-capture
 *
 * Cloud entry-point for the P3 passive-capture propose loop. The desktop bridge
 * fires this after the user completes a Field Study review: the Rust command
 * derives an ObservationSummary on-device from the survivor events, then POSTs
 * only that summary here (C1/C7: no raw AX labels, window titles, URL paths,
 * or event ids ever cross the trust boundary).
 *
 * Flow:
 *   a. Auth: clientForRequest + auth.getUser + ensureAccount
 *      (mirrors /api/study/packet — the same desktop Bearer token path).
 *   b. Strict parse: parseObservationSummary (extra field → 400).
 *   c. Boundary battery scan: summaryIsClean (residual token → 422, no DB write).
 *   d. proposeFromCaptureCore (service-role):
 *       - INSERT sources(kind='observation', source_tier=40, redaction_status='clean')
 *       - deriveProposalsFromObservation → 0–3 CaptureProposal[]
 *       - per proposal: battery-scan value → propose_memory_change(origin='capture')
 *   e. Return { source_id, proposal_ids }.
 *
 * Error contract (§11 — fire-and-forget UX):
 *   The desktop bridge calls this fire-and-forget. Any 4xx/5xx means the study
 *   completes silently — no user-visible error. The only path that must NOT
 *   silently swallow errors is auth (401) and boundary scan (422), which
 *   correctly short-circuit before any DB write.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { clientForRequest } from '../../../../lib/auth/desktop-client';
import { ensureAccount } from '../../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../../lib/auth/profile';
import { anthropicGenerate } from '../../../../lib/llm/client';
import { parseObservationSummary, summaryIsClean } from '../../../../lib/brain/observation-schema';
import { proposeFromCaptureCore } from '../../../../lib/brain/propose-from-capture';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── a. Auth ──────────────────────────────────────────────────────────────
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

  // ── b. Parse body ─────────────────────────────────────────────────────────
  // Reject oversized payloads before attempting JSON parse (§ input validation).
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 64_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // Strict parse — any extra field rejects (guards against future raw-content leaks).
  const summary = parseObservationSummary(body);
  if (!summary) return NextResponse.json({ error: 'invalid_summary' }, { status: 400 });

  // ── c. Boundary battery scan ──────────────────────────────────────────────
  // Run the battery over the entire stringified payload. If ANY residual sensitive
  // token is detected → 422 quarantine, zero DB writes (C1 enforcement).
  if (!summaryIsClean(summary)) {
    return NextResponse.json({ error: 'quarantined' }, { status: 422 });
  }

  // ── d + e. Service-role orchestration ─────────────────────────────────────
  try {
    const result = await proposeFromCaptureCore(
      accountId,
      summary,
      serviceClient(),
      anthropicGenerate(),
    );
    return NextResponse.json(result);
  } catch {
    // Source insert failed or unexpected error — never surface to the bridge UX.
    return NextResponse.json({ error: 'propose_failed' }, { status: 500 });
  }
}
