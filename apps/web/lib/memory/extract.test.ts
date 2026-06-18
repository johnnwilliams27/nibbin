/**
 * Unit tests for the memory writer's pure helpers (§12A):
 *   • parseEntries tolerates bad / partial JSON → [] and validates the schema;
 *   • the derived-not-raw guard (the EXPORTED `isClean` predicate the writer
 *     actually calls — applyBattery + a deterministic NER name check) drops any
 *     entry whose text still trips a rule, BEFORE it would be embedded/stored.
 *     Testing the real predicate (not a re-implementation) means a regression in
 *     the production filter line is caught here.
 */
import { describe, it, expect } from 'vitest';
import { applyBattery } from '@nibbin/redaction';
import { parseEntries, isClean } from './extract';

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

describe('derived-not-raw guard — the EXPORTED isClean predicate the writer calls', () => {
  it('keeps clean derived text (no battery hit, no name run)', async () => {
    expect(await isClean('prefers a warm sign-off')).toBe(true);
  });

  it('drops empty text', async () => {
    expect(await isClean('')).toBe(false);
    expect(await isClean('   ')).toBe(false);
  });

  it('drops text that still carries structured PII (a redaction rule fires)', async () => {
    // An email address is a battery rule; applyBattery must report a hit.
    const sentinel = 'contact them at jane.doe@example.com next week';
    expect(applyBattery(sentinel).rulesHit.length).toBeGreaterThan(0);
    expect(await isClean(sentinel)).toBe(false);
  });

  it('drops text with an unstructured person name the regex battery cannot see', async () => {
    // No structured PII here — only a capitalized two-token name run, which the
    // NER pass (not applyBattery) catches. This is the gate-finding case.
    const named = 'the client Maria Sanchez prefers bullet points';
    expect(applyBattery(named).rulesHit.length).toBe(0); // battery alone misses it
    expect(await isClean(named)).toBe(false); // isClean's NER pass catches it
  });
});
