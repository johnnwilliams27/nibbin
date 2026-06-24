/**
 * Unit tests for prompt.ts (P5 Task 9 — Keeper system-prompt affordance).
 *
 * Pure string / pure function — no mocks needed.
 */
import { describe, it, expect } from 'vitest';
import { KEEPER_SYSTEM_PROMPT, buildKeeperContext } from '../src/prompt';

describe('KEEPER_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof KEEPER_SYSTEM_PROMPT).toBe('string');
    expect(KEEPER_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it('mentions searching notes when user asks (T9 — discoverability affordance)', () => {
    // The prompt must tell the Keeper to offer memory search when the user
    // wonders what is in their notes. Exact phrase per the plan.
    expect(KEEPER_SYSTEM_PROMPT).toMatch(/search what I know/i);
  });

  it('instructs the Keeper to say "just ask me what you\'d like to find"', () => {
    expect(KEEPER_SYSTEM_PROMPT).toMatch(/just ask me what you.?d like to find/i);
  });

  it('preserves the "no hands" constraint (Keeper cannot act)', () => {
    expect(KEEPER_SYSTEM_PROMPT).toMatch(/no hands/i);
  });

  it('does not contain per-account or per-request variable content (cacheable invariant)', () => {
    // The stable prompt must not reference dynamic values like account IDs or
    // user names — those belong in buildKeeperContext() (the volatile suffix).
    // We verify the stable block has no template placeholders.
    expect(KEEPER_SYSTEM_PROMPT).not.toMatch(/\{\{[^}]+\}\}/);
    expect(KEEPER_SYSTEM_PROMPT).not.toMatch(/__ACCOUNT_ID__|__USER_NAME__/);
  });
});

describe('buildKeeperContext', () => {
  it('includes the Keeper name when provided', () => {
    const result = buildKeeperContext({ keeperName: 'Bramble' });
    expect(result).toContain('Bramble');
  });

  it('includes the user name when provided', () => {
    const result = buildKeeperContext({ userName: 'Alice' });
    expect(result).toContain('Alice');
  });

  it('returns the settling notice when neither name is provided', () => {
    const result = buildKeeperContext({});
    expect(result).toMatch(/settling/i);
  });

  it('returns the settling notice when names are null', () => {
    const result = buildKeeperContext({ keeperName: null, userName: null });
    expect(result).toMatch(/settling/i);
  });

  it('ignores whitespace-only keeperName', () => {
    const result = buildKeeperContext({ keeperName: '   ', userName: null });
    expect(result).toMatch(/settling/i);
  });
});
