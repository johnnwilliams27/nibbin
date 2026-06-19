import { describe, it, expect } from 'vitest';
import { buildPorts } from './ports';

describe('buildPorts', () => {
  it('registers Telegram when the bot token is set; SMS/WhatsApp only when their flag is on', () => {
    const a = buildPorts({ TELEGRAM_BOT_TOKEN: 'BOT' });
    expect(a.ports.has('telegram')).toBe(true);
    expect(a.ports.has('sms')).toBe(false);
    expect(a.ports.has('whatsapp')).toBe(false);

    const b = buildPorts({
      TELEGRAM_BOT_TOKEN: 'BOT',
      CHANNELS_SMS_ENABLED: 'true', TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+1',
    });
    expect(b.ports.has('sms')).toBe(true);
  });

  it('omits Telegram when no token is configured (no live port without config)', () => {
    const a = buildPorts({});
    expect(a.ports.has('telegram')).toBe(false);
  });

  it('omits SMS when the flag is on but Twilio env is incomplete', () => {
    const a = buildPorts({ TELEGRAM_BOT_TOKEN: 'BOT', CHANNELS_SMS_ENABLED: 'true' });
    expect(a.ports.has('sms')).toBe(false);
  });
});
