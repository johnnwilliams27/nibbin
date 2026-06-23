import { describe, it, expect } from 'vitest';
import { CONNECTORS, CONNECTOR_CATEGORIES } from './catalog';

describe('connector catalog', () => {
  it('has at least 150 entries', () => {
    expect(CONNECTORS.length).toBeGreaterThanOrEqual(150);
  });
  it('has unique ids', () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('uses only declared categories', () => {
    const set = new Set(CONNECTOR_CATEGORIES);
    for (const c of CONNECTORS) expect(set.has(c.category)).toBe(true);
  });
  it('marks Gmail, Google Calendar, and Stripe as live', () => {
    expect(CONNECTORS.filter((c) => c.status === 'live').map((c) => c.id).sort()).toEqual(
      ['gmail', 'google-calendar', 'stripe'],
    );
  });
  it('gives every non-rail a domain for logos', () => {
    const rails = new Set(['imap-smtp', 'caldav', 'generic-mcp', 'webhook-rail', 'csv-import']);
    for (const c of CONNECTORS) {
      if (!rails.has(c.id)) expect(c.domain, `${c.id} needs a domain`).toBeTruthy();
    }
  });
});
