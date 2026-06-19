import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupConnectors, sortConnectors } from '../../lib/connections/catalog-view';
import type { ConnectorEntry } from '../../lib/connections/catalog';
import { ConnectorDirectory } from './ConnectorDirectory';

// @testing-library/react is not installed in this repo; using behavior-focused tests
// that assert groupConnectors/sortConnectors produce the expected grouped/ordered shape.

const FIXTURE: ConnectorEntry[] = [
  { id: 'gmail', name: 'Gmail', category: 'Email', status: 'live', whatItDoes: 'x', domain: 'gmail.com' },
  { id: 'outlook', name: 'Outlook', category: 'Email', status: 'early_access', whatItDoes: 'y', domain: 'microsoft.com' },
  { id: 'slack', name: 'Slack', category: 'Messaging & Meetings', status: 'early_access', whatItDoes: 'z', domain: 'slack.com' },
  { id: 'icloud', name: 'iCloud Mail', category: 'Email', status: 'coming_soon', whatItDoes: 'w', domain: 'icloud.com' },
];

describe('ConnectorDirectory data helpers', () => {
  it('groupConnectors produces one group per category found in fixture', () => {
    const groups = groupConnectors(FIXTURE);
    const categories = groups.map((g) => g.category);
    expect(categories).toContain('Email');
    expect(categories).toContain('Messaging & Meetings');
    expect(categories).toHaveLength(2);
  });

  it('groupConnectors Email group contains all 3 email connectors', () => {
    const groups = groupConnectors(FIXTURE);
    const emailGroup = groups.find((g) => g.category === 'Email');
    expect(emailGroup).toBeDefined();
    expect(emailGroup!.items).toHaveLength(3);
  });

  it('groupConnectors sorts Email group: live first, then early_access, then coming_soon', () => {
    const groups = groupConnectors(FIXTURE);
    const emailItems = groups.find((g) => g.category === 'Email')!.items;
    expect(emailItems[0].status).toBe('live');
    expect(emailItems[1].status).toBe('early_access');
    expect(emailItems[2].status).toBe('coming_soon');
  });

  it('sortConnectors alpha mode returns connectors in name order', () => {
    const sorted = sortConnectors(FIXTURE, 'alpha');
    const names = sorted.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('sortConnectors alpha mode: Gmail < Outlook alphabetically', () => {
    const emailOnly = FIXTURE.filter((c) => c.category === 'Email');
    const sorted = sortConnectors(emailOnly, 'alpha');
    const gmailIdx = sorted.findIndex((c) => c.id === 'gmail');
    const outlookIdx = sorted.findIndex((c) => c.id === 'outlook');
    // Gmail (G) < iCloud Mail (i lower, but localeCompare is case-aware; G < O)
    expect(outlookIdx).toBeGreaterThan(gmailIdx);
  });

  it('sortConnectors available mode: live before early_access', () => {
    const sorted = sortConnectors(FIXTURE.filter((c) => c.category === 'Email'), 'available');
    expect(sorted[0].status).toBe('live');
  });
});

describe('ConnectorDirectory collapse-by-default', () => {
  it('expands the first category and collapses the rest (bounding logo requests)', () => {
    const html = renderToStaticMarkup(<ConnectorDirectory connectors={FIXTURE} />);
    // Email is the first category (contains live Gmail) -> expanded by default
    expect(html).toContain('Gmail');
    // Messaging & Meetings is collapsed -> its connector is NOT rendered (no logo request)
    expect(html).not.toContain('Slack');
    // ...but every category header + count is still shown for browsing
    expect(html).toContain('Messaging &amp; Meetings');
  });
});
