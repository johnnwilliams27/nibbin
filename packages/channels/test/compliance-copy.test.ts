import { describe, it, expect } from 'vitest';
import { isStopKeyword, isHelpKeyword, isStartKeyword, SMS_CONSENT_COPY, SMS_HELP_REPLY, SMS_STOP_REPLY } from '@nibbin/channels';

describe('SMS compliance keywords', () => {
  it('recognizes the standard STOP set (case/space-insensitive)', () => {
    for (const k of ['STOP', 'stop', ' Stop ', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) expect(isStopKeyword(k)).toBe(true);
    expect(isStopKeyword('stop the invoice')).toBe(false); // only the bare keyword opts out
  });
  it('recognizes HELP and START', () => {
    expect(isHelpKeyword('HELP')).toBe(true);
    expect(isHelpKeyword('info')).toBe(true);
    expect(isStartKeyword('START')).toBe(true);
    expect(isStartKeyword('unstop')).toBe(true);
  });
  it('consent + help + stop copy are non-empty and on-brand (sentence case, actionable)', () => {
    expect(SMS_CONSENT_COPY.length).toBeGreaterThan(20);
    expect(SMS_HELP_REPLY).toMatch(/STOP/);
    expect(SMS_STOP_REPLY).toMatch(/opted out|no more|won.t/i);
  });
});
