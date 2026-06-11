/** Staff roles and pure RBAC predicates (§6.10). No server-only deps — unit-tested. */
export type StaffRole = 'superadmin' | 'support' | 'engineer';

/** Adjust credits + start impersonation: support and superadmin only. */
export function canAdjustCredits(role: StaffRole): boolean {
  return role === 'support' || role === 'superadmin';
}
export function canImpersonate(role: StaffRole): boolean {
  return role === 'support' || role === 'superadmin';
}
