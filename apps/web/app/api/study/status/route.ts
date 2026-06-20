import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { ensureAccount } from '../../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../../lib/auth/profile';
import { clientForRequest } from '../../../../lib/auth/desktop-client';

const VALID_KINDS = ['full_study', 'quick_scan'] as const;
const VALID_STATUSES = ['active', 'stopped'] as const;

type StudyKind = (typeof VALID_KINDS)[number];
type StudyStatus = (typeof VALID_STATUSES)[number];

interface StatusBody {
  studyId: string;
  kind: StudyKind;
  label?: string | null;
  status: StudyStatus;
  startedAt: string;
  endsAt?: string | null;
}

function parseBody(raw: unknown): StatusBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.studyId !== 'string' || !b.studyId.trim()) return null;
  if (!VALID_KINDS.includes(b.kind as StudyKind)) return null;
  if (!VALID_STATUSES.includes(b.status as StudyStatus)) return null;
  if (typeof b.startedAt !== 'string' || !b.startedAt.trim()) return null;
  if (b.label !== undefined && b.label !== null && typeof b.label !== 'string') return null;
  if (b.endsAt !== undefined && b.endsAt !== null && typeof b.endsAt !== 'string') return null;
  return {
    studyId: b.studyId as string,
    kind: b.kind as StudyKind,
    label: (b.label as string | null | undefined) ?? null,
    status: b.status as StudyStatus,
    startedAt: b.startedAt as string,
    endsAt: (b.endsAt as string | null | undefined) ?? null,
  };
}

/**
 * POST /api/study/status
 *
 * The desktop Observer reports field-study lifecycle events here so the web
 * grove home can surface an "in-progress" card while a study is running.
 * Auth: Bearer <supabase-access-token> (desktop) or session cookie (web).
 * Writes via service-role; member-read RLS guards the read path.
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const body = parseBody(raw);
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 422 });

  const svc = serviceClient();

  const { error } = await svc.from('study_status').upsert(
    {
      account_id: accountId,
      study_id: body.studyId,
      kind: body.kind,
      label: body.label ?? null,
      status: body.status,
      started_at: body.startedAt,
      ends_at: body.endsAt ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,study_id' },
  );
  if (error) return NextResponse.json({ error: 'store_failed' }, { status: 502 });

  // When a study becomes active, emit a nudge leaf so the grove home can
  // surface "Field study started". Best-effort — never blocks the upsert.
  if (body.status === 'active') {
    try {
      await svc.rpc('insert_system_notification', {
        p_account: accountId,
        p_kind: 'nudge',
        p_source_id: 'study_started:' + body.studyId,
        p_title: body.kind === 'quick_scan' ? 'Quick scan started' : 'Field study started',
        p_body:
          body.kind === 'quick_scan'
            ? "Your quick scan is running. We'll let you know when the map is ready."
            : "Your field study is underway. We'll let you know when your map is ready.",
        p_payload: { ctaPath: '/app', ctaLabel: 'Open your grove' },
      });
    } catch {
      // notification is best-effort — never fail the status update on it.
    }
  }

  return NextResponse.json({ ok: true });
}
