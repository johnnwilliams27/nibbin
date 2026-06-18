import { describe, it, expect } from 'vitest';
import { connectionSummary, deletionState, sweepConsentRow, type ConnectionRow } from './panel';

describe('connectionSummary', () => {
  it('counts connections and labels access by scope count', () => {
    const rows: ConnectionRow[] = [
      { provider: 'gmail', scopes: ['a', 'b'], status: 'active' },
      { provider: 'stripe', scopes: ['x'], status: 'active' },
    ];
    const s = connectionSummary(rows);
    expect(s.total).toBe(2);
    expect(s.items[0]).toEqual({ provider: 'gmail', access: '2 scopes', status: 'active' });
    expect(s.items[1]).toEqual({ provider: 'stripe', access: '1 scope', status: 'active' });
  });

  it('labels empty or null scopes as read-only access', () => {
    const rows: ConnectionRow[] = [
      { provider: 'gmail', scopes: [], status: 'active' },
      { provider: 'calendar', scopes: null, status: 'paused' },
    ];
    const s = connectionSummary(rows);
    expect(s.items[0].access).toBe('Read-only access');
    expect(s.items[1].access).toBe('Read-only access');
    expect(s.items[1].status).toBe('paused');
  });

  it('handles an empty list', () => {
    expect(connectionSummary([])).toEqual({ total: 0, items: [] });
  });
});

describe('sweepConsentRow', () => {
  it('reports gmail connected + consent state', () => {
    expect(sweepConsentRow([{ provider: 'gmail', status: 'active', sweep_consent_at: '2026-06-18T00:00:00Z' }]))
      .toEqual({ gmailConnected: true, consented: true, consentedAt: '2026-06-18T00:00:00Z' });
    expect(sweepConsentRow([{ provider: 'gmail', status: 'active', sweep_consent_at: null }]))
      .toEqual({ gmailConnected: true, consented: false, consentedAt: null });
    expect(sweepConsentRow([])).toEqual({ gmailConnected: false, consented: false, consentedAt: null });
  });
});

describe('deletionState', () => {
  it('is not pending when purge_after is null/undefined', () => {
    expect(deletionState(null)).toEqual({ pending: false, date: null });
    expect(deletionState(undefined)).toEqual({ pending: false, date: null });
  });

  it('is pending and carries the date when purge_after is set', () => {
    expect(deletionState('2026-07-01T00:00:00Z')).toEqual({
      pending: true,
      date: '2026-07-01T00:00:00Z',
    });
  });
});
