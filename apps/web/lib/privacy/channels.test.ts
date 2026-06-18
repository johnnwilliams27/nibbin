import { describe, it, expect } from 'vitest';
import { channelMeta, parseChannelPrefsForm, parseSettingsForm, URGENCY_OPTIONS, DIGEST_OPTIONS } from './channels';

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
}

describe('channelMeta', () => {
  it('marks telegram live when its token flag is set; sms/whatsapp gated', () => {
    const m = channelMeta({ telegram: true, sms: false, whatsapp: false });
    expect(m.telegram.live).toBe(true);
    expect(m.sms.live).toBe(false);
    expect(m.sms.help).toMatch(/coming/i);
  });
});

describe('parseChannelPrefsForm', () => {
  it('reads channel + clamps priority + validates urgency', () => {
    expect(parseChannelPrefsForm(fd({ channel: 'sms', enabled: 'on', priority: '5', urgency_threshold: 'high' })))
      .toEqual({ channel: 'sms', enabled: true, priority: 5, urgencyThreshold: 'high' });
    expect(parseChannelPrefsForm(fd({ channel: 'telegram', priority: '99999', urgency_threshold: 'bogus' })))
      .toEqual({ channel: 'telegram', enabled: false, priority: 1000, urgencyThreshold: 'all' });
  });
});

describe('parseSettingsForm', () => {
  it('clamps quiet hours and validates digest', () => {
    expect(parseSettingsForm(fd({ quiet_start: '25', quiet_end: '-1', digest_mode: 'daily' })))
      .toEqual({ quietStart: 23, quietEnd: 0, digestMode: 'daily' });
    expect(parseSettingsForm(fd({ quiet_start: '21', quiet_end: '9', digest_mode: 'nope' })).digestMode).toBe('smart');
  });
});

describe('option lists', () => {
  it('expose select options', () => {
    expect(URGENCY_OPTIONS.map((o) => o.value)).toEqual(['all', 'normal', 'high', 'urgent']);
    expect(DIGEST_OPTIONS.map((o) => o.value)).toEqual(['off', 'smart', 'daily']);
  });
});
