'use server';

import { redirect } from 'next/navigation';
import { getStaff } from '../../lib/staff/session';
import { adminClient } from '../../lib/supabase/admin';

/**
 * Invite a waitlist member into the platform. The account is provisioned + the
 * branded invite email sent by the WEB app's internal endpoint (which owns the
 * Resend + service-role auth infra); admin just triggers it over a shared
 * secret. Every attempt is audited (§6.10), success or failure.
 */
export async function inviteFromWaitlist(formData: FormData): Promise<void> {
  const staff = await getStaff();
  if (!staff) redirect('/login');

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!email) redirect('/waitlist');

  const base = (process.env.WEB_APP_URL ?? 'https://nibbin.com').replace(/\/$/, '');
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) redirect('/waitlist?notice=invite_unconfigured');

  let ok = false;
  let status = 0;
  try {
    const res = await fetch(`${base}/api/internal/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
    ok = res.ok;
    status = res.status;
  } catch {
    ok = false;
  }

  await adminClient().rpc('staff_log_access', {
    p_staff_id: staff.staffId,
    p_action: ok ? 'waitlist.invited' : 'waitlist.invite_failed',
    p_account_id: null,
    p_meta: { email, status },
  });

  redirect(ok ? '/waitlist?notice=invited' : '/waitlist?notice=invite_failed');
}
