import { describe, expect, it } from 'vitest';
import { CONNECTABLE_PROVIDERS, scopeSummary, isReadOnly } from './providers';

it('lists Gmail, Google Calendar, and Stripe as the wired providers', () => {
  expect(CONNECTABLE_PROVIDERS.find((p) => p.id === 'gmail')?.wired).toBe(true);
  expect(CONNECTABLE_PROVIDERS.find((p) => p.id === 'google-calendar')?.wired).toBe(true);
  expect(CONNECTABLE_PROVIDERS.find((p) => p.id === 'stripe')?.wired).toBe(true);
  expect(
    CONNECTABLE_PROVIDERS.filter((p) => p.wired)
      .map((p) => p.id)
      .sort(),
  ).toEqual(['gmail', 'google-calendar', 'stripe']);
});

describe('scopeSummary', () => {
  it('maps the Gmail read scope to plain language, never a raw URL', () => {
    const s = scopeSummary(['https://www.googleapis.com/auth/gmail.readonly']);
    expect(s).toBe('Reads your inbox');
    expect(s).not.toContain('googleapis.com');
  });

  it('joins and de-duplicates multiple scopes', () => {
    expect(
      scopeSummary([
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
      ]),
    ).toBe('Reads your inbox · Sends replies you approve');
  });

  it('falls back to a de-prefixed name for an unmapped scope (no URL leaks)', () => {
    const s = scopeSummary(['https://www.googleapis.com/auth/calendar.settings.readonly.extra']);
    expect(s).not.toContain('https://');
    expect(s).not.toContain('/');
  });

  it('defaults to "Read-only access" for empty/missing scopes', () => {
    expect(scopeSummary([])).toBe('Read-only access');
    expect(scopeSummary(null)).toBe('Read-only access');
    expect(scopeSummary(undefined)).toBe('Read-only access');
  });
});

describe('isReadOnly', () => {
  it('is true for read-only / drive.file scopes', () => {
    expect(isReadOnly(['https://www.googleapis.com/auth/gmail.readonly'])).toBe(true);
    expect(isReadOnly(['https://www.googleapis.com/auth/drive.file'])).toBe(true);
    expect(isReadOnly([])).toBe(true);
  });

  it('is false when any write scope (send/compose) is present', () => {
    expect(
      isReadOnly([
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
      ]),
    ).toBe(false);
  });
});
