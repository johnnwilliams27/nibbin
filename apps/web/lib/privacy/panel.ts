/**
 * Pure view-model helpers for the Data & Privacy settings panel (T&C spec §6.1).
 * Kept framework-free so the panel's only real logic is unit-tested in node;
 * the page itself stays a thin server component.
 */

export interface ConnectionRow {
  provider: string;
  scopes: string[] | null;
  status: string;
  sweep_consent_at?: string | null;
}

export interface ConnectionSummary {
  total: number;
  items: { provider: string; access: string; status: string }[];
}

/** Summarize non-revoked connections for display. Shares the connections
 * page's read-only-when-empty rule (no scopes → "Read-only access", since
 * read-only is the default until a Nibbin requests writes, C8). It does NOT
 * reproduce that page's scope display: this panel shows a scope *count*, never
 * the raw scope strings — intentionally more conservative for a privacy home. */
export function connectionSummary(rows: ConnectionRow[]): ConnectionSummary {
  const items = rows.map((r) => {
    const n = r.scopes?.length ?? 0;
    return {
      provider: r.provider,
      access: n > 0 ? `${n} scope${n === 1 ? '' : 's'}` : 'Read-only access',
      status: r.status,
    };
  });
  return { total: items.length, items };
}

export function sweepConsentRow(
  rows: { provider: string; status: string; sweep_consent_at?: string | null }[],
): { gmailConnected: boolean; consented: boolean; consentedAt: string | null } {
  const gmail = rows.find((r) => r.provider === 'gmail' && r.status === 'active');
  return {
    gmailConnected: !!gmail,
    consented: !!gmail?.sweep_consent_at,
    consentedAt: gmail?.sweep_consent_at ?? null,
  };
}

export interface DeletionState {
  pending: boolean;
  date: string | null;
}

/** Derive the account-deletion clock state from accounts.purge_after. */
export function deletionState(purgeAfter: string | null | undefined): DeletionState {
  return { pending: !!purgeAfter, date: purgeAfter ?? null };
}
