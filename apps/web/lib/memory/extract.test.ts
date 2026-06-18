/**
 * Unit tests for the memory writer's pure helpers (§12A):
 *   • parseEntries tolerates bad / partial JSON → [] and validates the schema;
 *   • the derived-not-raw guard (applyBattery) drops any entry whose text still
 *     trips a redaction rule, BEFORE it would be embedded or stored.
 */
import { describe, it, expect } from 'vitest';
import { applyBattery } from '@nibbin/redaction';
import { parseEntries } from './extract';

describe('parseEntries', () => {
  it('returns [] on non-JSON / no array', () => {
    expect(parseEntries('not json at all')).toEqual([]);
    expect(parseEntries('{"scope":"user"}')).toEqual([]); // object, not array
    expect(parseEntries('')).toEqual([]);
  });

  it('returns [] on malformed JSON inside brackets', () => {
    expect(parseEntries('[{bad json,,}]')).toEqual([]);
  });

  it('parses well-formed entries and clamps confidence to 0..1', () => {
    const out = parseEntries(
      'noise [{"scope":"user","kind":"fact","text":"works in eastern time","provenance":"user-stated","confidence":1.7}] trailer',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ scope: 'user', kind: 'fact', provenance: 'user-stated', confidence: 1 });
  });

  it('drops items with an invalid scope/kind/provenance or empty text', () => {
    const out = parseEntries(
      JSON.stringify([
        { scope: 'team', kind: 'fact', text: 'x', provenance: 'observed', confidence: 0.5 }, // bad scope
        { scope: 'user', kind: 'thought', text: 'x', provenance: 'observed', confidence: 0.5 }, // bad kind
        { scope: 'user', kind: 'fact', text: '   ', provenance: 'observed', confidence: 0.5 }, // empty text
        { scope: 'agent', kind: 'preference', text: 'keep this', provenance: 'inferred', confidence: 0.4 }, // valid
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('keep this');
  });

  it('defaults confidence to 0.5 when missing/non-numeric', () => {
    const out = parseEntries(JSON.stringify([{ scope: 'user', kind: 'fact', text: 'ok', provenance: 'observed' }]));
    expect(out[0].confidence).toBe(0.5);
  });
});

describe('derived-not-raw guard (the writer filters on applyBattery hits)', () => {
  // Mirror the exact filter used in writeMemoryFromDecision.
  const guard = (text: string) => Boolean(text) && applyBattery(text).rulesHit.length === 0;

  it('keeps clean derived text (zero redaction hits)', () => {
    expect(guard('prefers a warm sign-off')).toBe(true);
  });

  it('drops text that still carries PII (a redaction rule fires)', () => {
    // An email address is a battery rule; applyBattery must report a hit.
    const sentinel = 'contact them at jane.doe@example.com next week';
    expect(applyBattery(sentinel).rulesHit.length).toBeGreaterThan(0);
    expect(guard(sentinel)).toBe(false);
  });
});
