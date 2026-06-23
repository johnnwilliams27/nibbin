export interface ConnectableProvider {
  id: string;
  label: string;
  wired: boolean; // false → shown as "Coming soon", non-interactive
  domain: string | null; // brand root domain for the connector logo
}

// The short "Accounts your Nibbins work from" list only carries connectables we
// can actually wire up. Still-coming-soon providers live in the "Browse all
// connectors" directory below, not in this list.
export const CONNECTABLE_PROVIDERS: ConnectableProvider[] = [
  { id: 'gmail', label: 'Gmail', wired: true, domain: 'gmail.com' },
  { id: 'google-calendar', label: 'Google Calendar', wired: true, domain: 'calendar.google.com' },
  // Read-only payments connector (overdue-invoice nudges ride email.send via
  // Gmail; Stripe itself is never written to). Live once STRIPE_OAUTH_* are set.
  { id: 'stripe', label: 'Stripe', wired: true, domain: 'stripe.com' },
];

/** Plain-language summary for each granted OAuth scope (no raw URLs in the UI). */
const SCOPE_SUMMARY: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.readonly': 'Reads your inbox',
  'https://www.googleapis.com/auth/gmail.send': 'Sends replies you approve',
  'https://www.googleapis.com/auth/gmail.compose': 'Drafts replies',
  'https://www.googleapis.com/auth/calendar.readonly': 'Reads your calendar',
  'https://www.googleapis.com/auth/calendar.events': 'Adds events you approve',
  'https://www.googleapis.com/auth/drive.file': 'Opens files you choose',
};

/**
 * Turn a connection's granted scopes into a human-readable summary of what the
 * connection can actually do — e.g. ['…/gmail.readonly'] → "Reads your inbox".
 * Falls back to a de-prefixed scope name for anything not yet mapped, so the UI
 * never shows a raw googleapis URL.
 */
export function scopeSummary(scopes: string[] | null | undefined): string {
  if (!scopes || scopes.length === 0) return 'Read-only access';
  const parts: string[] = [];
  for (const s of scopes) {
    const label = SCOPE_SUMMARY[s] ?? (s.split('/').pop() ?? s).replace(/[._]/g, ' ');
    if (!parts.includes(label)) parts.push(label);
  }
  return parts.join(' · ');
}

/** True when every granted scope is read-only (no send/compose/write power). */
export function isReadOnly(scopes: string[] | null | undefined): boolean {
  if (!scopes || scopes.length === 0) return true;
  return scopes.every((s) => /readonly|drive\.file/.test(s));
}
