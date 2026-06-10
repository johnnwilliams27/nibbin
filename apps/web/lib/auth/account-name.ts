/**
 * Default account name for a first-time sign-in. This is only a placeholder so
 * the account is never unnamed; the real "name your grove" moment is M2
 * onboarding (SPEC §4.1). Pure — no deps, unit-tested.
 */
const MAX = 80;
const FALLBACK = 'My grove';

export function defaultAccountName(email: string): string {
  const trimmed = (email ?? '').trim();
  // local-part = before '@' (or the whole token if there's no '@'), minus any '+tag'
  const local = (trimmed.includes('@') ? trimmed.slice(0, trimmed.indexOf('@')) : trimmed)
    .split('+')[0]
    .trim();
  if (local === '') return FALLBACK;
  return local.length > MAX ? local.slice(0, MAX) : local;
}
