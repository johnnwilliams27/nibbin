import { describe, it, expect } from 'vitest';
import { formatHour, HOUR_OPTIONS, parseNotificationPrefs } from './notifications';

describe('formatHour', () => {
  it('formats 12-hour clock with AM/PM', () => {
    expect(formatHour(0)).toBe('12 AM');
    expect(formatHour(9)).toBe('9 AM');
    expect(formatHour(12)).toBe('12 PM');
    expect(formatHour(21)).toBe('9 PM');
    expect(formatHour(23)).toBe('11 PM');
  });
});

describe('HOUR_OPTIONS', () => {
  it('has 24 entries, value 0..23, labelled', () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toEqual({ value: '0', label: '12 AM' });
    expect(HOUR_OPTIONS[23]).toEqual({ value: '23', label: '11 PM' });
  });
});

describe('parseNotificationPrefs', () => {
  function fd(entries: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.append(k, v);
    return f;
  }

  it('reads a checked checkbox as enabled and parses hours', () => {
    const p = parseNotificationPrefs(fd({ email_enabled: 'on', quiet_start: '21', quiet_end: '9' }));
    expect(p).toEqual({ emailEnabled: true, quietStart: 21, quietEnd: 9 });
  });

  it('treats a missing checkbox as disabled', () => {
    const p = parseNotificationPrefs(fd({ quiet_start: '0', quiet_end: '8' }));
    expect(p.emailEnabled).toBe(false);
  });

  it('clamps out-of-range or non-numeric hours into 0..23', () => {
    expect(parseNotificationPrefs(fd({ quiet_start: '99', quiet_end: '-3' }))).toMatchObject({
      quietStart: 23,
      quietEnd: 0,
    });
    expect(parseNotificationPrefs(fd({ quiet_start: 'x', quiet_end: '' }))).toMatchObject({
      quietStart: 0,
      quietEnd: 0,
    });
  });
});
