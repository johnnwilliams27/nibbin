import { describe, it, expect } from 'vitest';
import { buildConnectorOptions, filterTemplates } from './filter';

const makeTemplate = (key: string, connectors: string[]) => ({
  key,
  spec: { requiredConnectors: connectors },
});

const TEMPLATES = [
  makeTemplate('sweep', ['gmail']),
  makeTemplate('echo', ['gmail']),
  makeTemplate('brief', ['gmail', 'google-calendar', 'stripe']),
  makeTemplate('tally', ['stripe']),
  makeTemplate('hopper', ['google-calendar', 'gmail']),
  makeTemplate('scribe', ['gmail']),
];

describe('buildConnectorOptions', () => {
  it('starts with all and includes each connector once', () => {
    const opts = buildConnectorOptions(TEMPLATES);
    expect(opts[0]).toBe('all');
    expect(opts).toContain('gmail');
    expect(opts).toContain('stripe');
    expect(opts).toContain('google-calendar');
    // no duplicates
    expect(new Set(opts).size).toBe(opts.length);
  });

  it('returns only all for an empty list', () => {
    expect(buildConnectorOptions([])).toEqual(['all']);
  });
});

describe('filterTemplates', () => {
  it('returns all templates when filter is all', () => {
    expect(filterTemplates(TEMPLATES, 'all')).toHaveLength(TEMPLATES.length);
  });

  it('returns only templates that require the connector', () => {
    const stripeOnly = filterTemplates(TEMPLATES, 'stripe');
    expect(stripeOnly.map((t) => t.key)).toEqual(['brief', 'tally']);
  });

  it('returns gmail templates', () => {
    const gmailTemplates = filterTemplates(TEMPLATES, 'gmail');
    expect(gmailTemplates.map((t) => t.key)).toEqual(['sweep', 'echo', 'brief', 'hopper', 'scribe']);
  });

  it('returns empty array for an unknown connector', () => {
    expect(filterTemplates(TEMPLATES, 'shopify')).toHaveLength(0);
  });
});
