'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getStaff, canAdjustCredits, canImpersonate } from '../../../lib/staff/session';
import { adminClient } from '../../../lib/supabase/admin';
import { parseAdjustment, type AdjustmentDirection } from '../../../lib/staff/adjust';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function accountIdFrom(formData: FormData): string {
  const id = String(formData.get('accountId') ?? '');
  if (!UUID_RE.test(id)) throw new Error('invalid account id');
  return id;
}

export async function adjustCredits(formData: FormData) {
  const staff = await getStaff();
  if (!staff) redirect('/login');
  if (!canAdjustCredits(staff.role)) redirect(`/accounts?error=forbidden`);

  const accountId = accountIdFrom(formData);
  let delta: number;
  let reason: string;
  try {
    ({ delta, reason } = parseAdjustment({
      amount: String(formData.get('amount') ?? ''),
      direction: String(formData.get('direction') ?? '') as AdjustmentDirection,
      reason: String(formData.get('reason') ?? ''),
    }));
  } catch {
    redirect(`/accounts/${accountId}?error=adjust`);
  }

  const { error } = await adminClient().rpc('staff_adjust_credits', {
    p_account_id: accountId,
    p_delta: delta,
    p_reason: reason,
    p_staff_id: staff.staffId,
  });
  if (error) redirect(`/accounts/${accountId}?error=adjust`);

  revalidatePath(`/accounts/${accountId}`);
  redirect(`/accounts/${accountId}?done=adjusted`);
}

export async function startImpersonation(formData: FormData) {
  const staff = await getStaff();
  if (!staff) redirect('/login');
  if (!canImpersonate(staff.role)) redirect(`/accounts?error=forbidden`);

  const accountId = accountIdFrom(formData);
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') redirect(`/accounts/${accountId}?error=impersonate`);

  // Read-only only in this milestone; 'act' requires superadmin and is deferred.
  const { error } = await adminClient().rpc('staff_start_impersonation', {
    p_account_id: accountId,
    p_staff_id: staff.staffId,
    p_reason: reason,
    p_scope: 'read',
  });
  if (error) redirect(`/accounts/${accountId}?error=impersonate`);

  revalidatePath(`/accounts/${accountId}`);
  redirect(`/accounts/${accountId}?done=impersonating`);
}
