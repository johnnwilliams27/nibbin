import { expect, it, describe } from 'vitest';
import { modulesForProvider } from '../src/engine';

describe('google-calendar scan wiring', () => {
  it('resolves the three calendar modules for the provider', () => {
    const ids = modulesForProvider('google-calendar').map((m) => m.id).sort();
    expect(ids).toEqual(['calendar.confirmation-gaps', 'calendar.meeting-load', 'calendar.no-show-churn']);
  });
});
