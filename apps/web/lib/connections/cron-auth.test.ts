import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAuthorizedCronRequest } from './cron-auth';

const SECRET = 'top-secret-cron-value';

function req(authorization?: string): { headers: { get(name: string): string | null } } {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? authorization ?? null : null,
    },
  };
}

describe('isAuthorizedCronRequest', () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it('accepts the correct bearer secret', () => {
    expect(isAuthorizedCronRequest(req(`Bearer ${SECRET}`))).toBe(true);
  });

  it('rejects a wrong secret of equal length', () => {
    expect(isAuthorizedCronRequest(req(`Bearer ${'x'.repeat(SECRET.length)}`))).toBe(false);
  });

  it('rejects a token that is a prefix of the secret (length guard)', () => {
    expect(isAuthorizedCronRequest(req(`Bearer ${SECRET.slice(0, 5)}`))).toBe(false);
  });

  it('rejects a token longer than the secret', () => {
    expect(isAuthorizedCronRequest(req(`Bearer ${SECRET}-extra`))).toBe(false);
  });

  it('rejects a non-bearer scheme', () => {
    expect(isAuthorizedCronRequest(req(`Basic ${SECRET}`))).toBe(false);
  });

  it('rejects a missing authorization header', () => {
    expect(isAuthorizedCronRequest(req())).toBe(false);
  });

  it('fails closed when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCronRequest(req(`Bearer ${SECRET}`))).toBe(false);
  });
});
