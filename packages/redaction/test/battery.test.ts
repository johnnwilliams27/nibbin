/**
 * Unit tests for the regex battery. These use their OWN synthetic PII shapes —
 * corpus sentinel values must never appear outside tests/redaction-corpus
 * (the full-repo leak walk enforces that, including over this file).
 */
import { describe, expect, it } from 'vitest';
import { applyBattery, batteryStillMatches, classifyValue } from '../src/battery.js';

describe('regex battery', () => {
  it('redacts emails', () => {
    const r = applyBattery('contact jane.doe+test@example-corp.io today');
    expect(r.text).toBe('contact {EMAIL} today');
    expect(r.rulesHit).toContain('EMAIL');
  });

  it('redacts card numbers, dashed and plain', () => {
    expect(applyBattery('card 4111-1111-1111-1111 on file').text).toBe('card {NUM} on file');
    expect(applyBattery('card 4111111111111111 on file').text).toBe('card {NUM} on file');
  });

  it('redacts SSN and EIN shapes', () => {
    expect(applyBattery('ssn 123-45-6789').text).toBe('ssn {NUM}');
    expect(applyBattery('ein 12-3456789').text).toBe('ein {NUM}');
  });

  it('redacts phone numbers including international and trailing extensions', () => {
    expect(applyBattery('call +1-415-555-0132 now').text).toBe('call {NUM} now');
    expect(applyBattery('call (415) 555-0132 now').text).toBe('call {NUM} now');
    expect(applyBattery('call 415-555-0132 now').text).toBe('call {NUM} now');
  });

  it('redacts secret-shaped tokens to {KEY}', () => {
    expect(applyBattery('key sk_live_a1B2c3D4e5F6 set').text).toBe('key {KEY} set');
    expect(applyBattery('aws AKIAIOSFODNN7EXAMPLE creds').text).toBe('aws {KEY} creds');
  });

  it('redacts street addresses', () => {
    expect(applyBattery('ship to 1842 Willowmere Hollow Lane please').text).toBe('ship to {ADDR} please');
  });

  it('sweeps leftover digit runs to {NUM} last', () => {
    const r = applyBattery('Invoice 48213 ready');
    expect(r.text).toBe('Invoice {NUM} ready');
    expect(r.rulesHit).toEqual(['NUM']);
  });

  it('leaves clean UI text untouched', () => {
    const r = applyBattery('Send invoice');
    expect(r.text).toBe('Send invoice');
    expect(r.rulesHit).toEqual([]);
  });

  it('placeholders do not retrigger the battery (idempotent)', () => {
    const once = applyBattery('mail jane.doe@example.com re 123-45-6789').text;
    expect(applyBattery(once).text).toBe(once);
  });
});

describe('value classifier', () => {
  it('classifies email / currency / date / freeform / none', () => {
    expect(classifyValue('billing@example.com')).toBe('email');
    expect(classifyValue('$1,250.00')).toBe('currency');
    expect(classifyValue('2026-06-10')).toBe('date');
    expect(classifyValue('06/10/2026')).toBe('date');
    expect(classifyValue('meeting notes draft')).toBe('freeform');
    expect(classifyValue('')).toBe('none');
    expect(classifyValue(null)).toBe('none');
  });
});

describe('paranoid re-scan', () => {
  it('flags residual PII shapes but tolerates benign numbers', () => {
    expect(batteryStillMatches('left jane@example.com behind')).toBe('EMAIL');
    expect(batteryStillMatches('{"duration_ms":41000,"keys":142}')).toBeNull();
  });
});
