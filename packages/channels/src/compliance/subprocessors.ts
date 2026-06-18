export interface SubprocessorEntry {
  name: string;
  purpose: string;
  regions: string;
  dataCategories: string[];
  retention: string;
  url: string;
}

// D-N3: providers retain message history beyond Nibbin's reach — say so plainly.
export const CHANNEL_SUBPROCESSORS: SubprocessorEntry[] = [
  {
    name: 'Twilio',
    purpose: 'SMS delivery and inbound message relay',
    regions: 'United States',
    dataCategories: ['phone number', 'message content', 'delivery metadata'],
    retention: 'Per Twilio\'s policy; message history is retained by the provider beyond Nibbin\'s control.',
    url: 'https://www.twilio.com/legal/privacy',
  },
  {
    name: 'Telegram',
    purpose: 'Telegram message delivery and inbound relay',
    regions: 'Global',
    dataCategories: ['Telegram chat id', 'message content'],
    retention: 'Per Telegram\'s policy; message history is retained by the provider beyond Nibbin\'s reach.',
    url: 'https://telegram.org/privacy',
  },
  {
    name: 'Meta Platforms',
    purpose: 'WhatsApp Business message delivery and inbound relay',
    regions: 'Global',
    dataCategories: ['phone number', 'message content', 'delivery metadata'],
    retention: 'Per Meta\'s policy; message history is retained by the provider beyond Nibbin\'s reach.',
    url: 'https://www.whatsapp.com/legal/business-data-transfer-addendum',
  },
];
