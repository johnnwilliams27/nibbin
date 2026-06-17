export interface ConnectableProvider {
  id: string;
  label: string;
  wired: boolean; // false → shown as "Coming soon", non-interactive
}

export const CONNECTABLE_PROVIDERS: ConnectableProvider[] = [
  { id: 'gmail', label: 'Gmail', wired: true },
  { id: 'google-calendar', label: 'Google Calendar', wired: false },
  { id: 'stripe', label: 'Stripe', wired: false },
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
