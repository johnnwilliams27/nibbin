import 'server-only';
import type { StoredToken } from '@nibbin/connectors';
import type { PendingAuth } from './pending';

export interface CompleteConnectionInput {
  code: string;
  returnedState: string;
  nowMs: number;
}

export interface CompleteConnectionDeps {
  consume: (state: string, nowMs: number) => Promise<PendingAuth | null>;
  exchange: (pending: PendingAuth, code: string) => Promise<StoredToken>;
  createActiveConnection: (pending: PendingAuth, token: StoredToken) => Promise<string>;
  resumeAdopt?: (pending: PendingAuth, templateKey: string) => Promise<{ ok: boolean; missing: string[] }>;
}

export async function completeConnection(
  input: CompleteConnectionInput,
  deps: CompleteConnectionDeps,
): Promise<{ redirectTo: string }> {
  const pending = await deps.consume(input.returnedState, input.nowMs);
  if (!pending) return { redirectTo: '/app/connections?error=expired' };

  let token: StoredToken;
  try {
    token = await deps.exchange(pending, input.code);
  } catch {
    const back = pending.returnTo ?? '/app/connections';
    return { redirectTo: appendQuery(back, { error: 'exchange_failed' }) };
  }

  await deps.createActiveConnection(pending, token);

  if (pending.resumeTemplate && deps.resumeAdopt) {
    const r = await deps.resumeAdopt(pending, pending.resumeTemplate);
    if (r.ok) return { redirectTo: `/app?adopted=${encodeURIComponent(pending.resumeTemplate)}` };
    return {
      redirectTo: appendQuery('/app/connections', {
        needed: r.missing.join(','),
        resume: pending.resumeTemplate,
      }),
    };
  }

  return { redirectTo: `/app/connections?connected=${encodeURIComponent(pending.provider)}` };
}

function appendQuery(path: string, params: Record<string, string>): string {
  const [base, existing] = path.split('?');
  const sp = new URLSearchParams(existing);
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
