import { describe, it, expect } from 'vitest';
import { sortConnectors, groupConnectors, monogramFor } from './catalog-view';
import type { ConnectorEntry } from './catalog';

const mk = (id: string, name: string, category: string, status: ConnectorEntry['status']): ConnectorEntry =>
  ({ id, name, category, status, whatItDoes: 'x', domain: `${id}.com` });

describe('sortConnectors', () => {
  const list = [
    mk('z', 'Zeta', 'Email', 'coming_soon'),
    mk('a', 'Alpha', 'Email', 'coming_soon'),
    mk('g', 'Gmail', 'Email', 'live'),
    mk('e', 'Echo', 'Email', 'early_access'),
  ];
  it('available mode puts live+early_access first, then alpha within tier', () => {
    expect(sortConnectors(list, 'available').map((c) => c.id)).toEqual(['g', 'e', 'a', 'z']);
  });
  it('alpha mode sorts purely by name', () => {
    expect(sortConnectors(list, 'alpha').map((c) => c.id)).toEqual(['a', 'e', 'g', 'z']);
  });
});

describe('groupConnectors', () => {
  it('groups by category in CONNECTOR_CATEGORIES order and sorts items available-first', () => {
    const groups = groupConnectors([
      mk('a', 'Alpha', 'Payments & Invoicing', 'coming_soon'),
      mk('g', 'Gmail', 'Email', 'live'),
    ]);
    expect(groups[0].category).toBe('Email');
    expect(groups.find((g) => g.category === 'Payments & Invoicing')?.items[0].id).toBe('a');
  });
  it('omits empty categories', () => {
    const groups = groupConnectors([mk('g', 'Gmail', 'Email', 'live')]);
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
});

describe('monogramFor', () => {
  it('returns up to 2 uppercase initials', () => {
    expect(monogramFor('Google Calendar')).toBe('GC');
    expect(monogramFor('Stripe')).toBe('ST');
  });
});
