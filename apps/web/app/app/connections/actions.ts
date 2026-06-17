'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';
import { getGoogleOAuthConfig } from '../../../lib/connections/google-oauth-env';
import { loadTesterAllowlist } from '../../../lib/connections/tester-allowlist';
import { storePending } from '../../../lib/connections/pending';
import { beginConnect } from '../../../lib/connections/begin';

export async function beginConnectAction(formData: FormData): Promise<void> {
  const provider = String(formData.get('provider') ?? '');
  const returnTo = (formData.get('returnTo') as string) || undefined;
  const resumeTemplate = (formData.get('resumeTemplate') as string) || undefined;

  const { user, accountId } = await appSession();
  const svc = serviceClient();
  const { url } = await beginConnect(
    { provider, accountId, userId: user.id, userEmail: user.email ?? null, returnTo, resumeTemplate },
    {
      config: getGoogleOAuthConfig(),
      allowlistFor: (p) => loadTesterAllowlist(p, svc),
      save: (input) => storePending(input, svc),
      nowMs: Date.now(),
    },
  );
  redirect(url);
}
