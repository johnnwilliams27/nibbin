import { describe, it, expect } from 'vitest';
import { CHANNEL_SUBPROCESSORS } from '@nibbin/channels';

describe('channel subprocessors', () => {
  it('lists Twilio, Telegram and Meta with regions, data categories and retention', () => {
    const names = CHANNEL_SUBPROCESSORS.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Twilio', 'Telegram', 'Meta Platforms']));
    for (const s of CHANNEL_SUBPROCESSORS) {
      expect(s.dataCategories.length).toBeGreaterThan(0);
      expect(s.retention).toMatch(/\w/);
      // D-N3: each notes provider retention is beyond Nibbin's reach
      expect(s.retention.toLowerCase()).toMatch(/provider|beyond|their/);
    }
  });
});
