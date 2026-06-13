/**
 * Pure profile → recommended connections + Nibbins (spec Component 2). The model
 * only ever produces the profile; this deterministic map turns it into the
 * desktop handoff. Always returns a non-empty connection list — the floor.
 */
import type { UnderstandingProfile } from '@nibbin/keeper';

export interface RecommendedConnection {
  provider: string;
  reason: string;
  priority: number;
}
export interface RecommendedNibbin {
  templateKey: string;
  displayName: string;
  reason: string;
}
export interface Recommendations {
  connections: RecommendedConnection[];
  nibbins: RecommendedNibbin[];
  source: 'model' | 'static_fallback' | 'default_floor';
}

export const DEFAULT_STARTER_CONNECTIONS: RecommendedConnection[] = [
  { provider: 'gmail', reason: 'Most work and questions still arrive by email.', priority: 1 },
  { provider: 'google_calendar', reason: 'So your schedule and bookings stay in view.', priority: 2 },
  { provider: 'stripe', reason: 'To watch invoices and money that is past due.', priority: 3 },
];

// templateKey 'scribe' verified against packages/runtime/src/templates.ts (line 194):
// { key: 'scribe', templateKey: 'scribe', displayName: 'Scribe', ... }
const DEFAULT_STARTER_NIBBIN: RecommendedNibbin = {
  templateKey: 'scribe',
  displayName: 'Scribe',
  reason: 'A gentle first hand: it drafts replies to the routine questions for your approval.',
};

// channel id (from the profile) → connector provider + reason
const CHANNEL_PROVIDER: Record<string, RecommendedConnection> = {
  email: { provider: 'gmail', reason: 'Most of your work arrives by email.', priority: 1 },
  instagram_dm: { provider: 'instagram', reason: 'You said work comes through Instagram DMs.', priority: 1 },
  instagram_dms: { provider: 'instagram', reason: 'You said work comes through Instagram DMs.', priority: 1 },
};

export function deriveRecommendations(profile: UnderstandingProfile): Recommendations {
  const byProvider = new Map<string, RecommendedConnection>();

  for (const ch of profile.channels) {
    const conn = CHANNEL_PROVIDER[ch];
    if (conn) byProvider.set(conn.provider, conn);
  }
  if (['bookings', 'retainer', 'projects', 'products', 'mixed'].includes(profile.businessModel)) {
    byProvider.set('stripe', { provider: 'stripe', reason: 'To keep an eye on invoices and money past due.', priority: 3 });
    byProvider.set('google_calendar', { provider: 'google_calendar', reason: 'So your bookings and schedule stay in view.', priority: 2 });
  }
  if (profile.pains.some((p) => /invoice|paid|payment|money/i.test(p))) {
    byProvider.set('stripe', { provider: 'stripe', reason: 'You mentioned chasing payments.', priority: 1 });
  }

  const connections = [...byProvider.values()].sort((a, b) => a.priority - b.priority);

  // The floor: an empty/thin map → the default starter set.
  if (connections.length === 0) {
    return { connections: DEFAULT_STARTER_CONNECTIONS, nibbins: [DEFAULT_STARTER_NIBBIN], source: 'default_floor' };
  }

  return {
    connections,
    nibbins: [DEFAULT_STARTER_NIBBIN],
    source: profile.confidence > 0 ? 'model' : 'static_fallback',
  };
}
