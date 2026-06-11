import 'server-only';
import { createClient } from '../supabase/server';
import { adminClient } from '../supabase/admin';
import type { StaffRole } from './rbac';

export { canAdjustCredits, canImpersonate } from './rbac';
export type { StaffRole } from './rbac';

export interface Staff {
  authUserId: string;
  email: string;
  staffId: string;
  role: StaffRole;
}

/**
 * Resolve the current session to a staff identity, or null if the signed-in
 * user is not in staff_users. Staff are a separate world from product users
 * (§6.10): a valid product session is NOT staff access. The lookup uses the
 * service role (staff_users is invisible to product roles).
 */
export async function getStaff(): Promise<Staff | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  // Exact, case-folded, wildcard-free match via the RPC — never a PostgREST
  // .ilike() on the attacker-controlled login email (red-team P0).
  const { data, error } = await adminClient().rpc('staff_identity_for_email', { p_email: user.email });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return null;

  return { authUserId: user.id, email: user.email, staffId: row.id, role: row.role as StaffRole };
}
