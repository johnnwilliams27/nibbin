import type { SelectOption } from '../../components/ui';

export type ChannelKind = 'push' | 'email' | 'sms' | 'telegram' | 'whatsapp';

export const URGENCY_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Everything' },
  { value: 'normal', label: 'Normal and up' },
  { value: 'high', label: 'Only important' },
  { value: 'urgent', label: 'Only urgent' },
];

export const DIGEST_OPTIONS: SelectOption[] = [
  { value: 'off', label: 'Send as they happen' },
  { value: 'smart', label: 'Batch the non-urgent' },
  { value: 'daily', label: 'One daily digest' },
];

export interface ChannelFlags {
  telegram?: boolean;
  sms?: boolean;
  whatsapp?: boolean;
}

export function channelMeta(flags: ChannelFlags): Record<ChannelKind, { label: string; live: boolean; help: string }> {
  const soon = (what: string) => `${what} is coming soon — your grove can't reach you here yet.`;
  return {
    push: { label: 'In-app', live: true, help: 'Always on — your grove always has a home in the app.' },
    email: { label: 'Email', live: true, help: 'Field-study nudges and your map, by email.' },
    telegram: { label: 'Telegram', live: !!flags.telegram, help: flags.telegram ? 'Connect Telegram for instant, free reach with one-tap approvals.' : soon('Telegram') },
    sms: { label: 'Text (SMS)', live: !!flags.sms, help: flags.sms ? 'Get texts for the things that matter most.' : soon('Text messages') },
    whatsapp: { label: 'WhatsApp', live: !!flags.whatsapp, help: flags.whatsapp ? 'Reach on WhatsApp with quick approve/deny.' : soon('WhatsApp') },
  };
}

function clampHour(v: FormDataEntryValue | null): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : 0;
}

const URGENCIES = new Set(['all', 'normal', 'high', 'urgent']);
const DIGESTS = new Set(['off', 'smart', 'daily']);

export function parseChannelPrefsForm(form: FormData): { channel: string; enabled: boolean; priority: number; urgencyThreshold: string } {
  const priorityRaw = Math.trunc(Number(form.get('priority')));
  const priority = Number.isFinite(priorityRaw) ? Math.min(1000, Math.max(0, priorityRaw)) : 100;
  const u = String(form.get('urgency_threshold') ?? '');
  return {
    channel: String(form.get('channel') ?? ''),
    enabled: form.get('enabled') === 'on',
    priority,
    urgencyThreshold: URGENCIES.has(u) ? u : 'all',
  };
}

export function parseSettingsForm(form: FormData): { quietStart: number; quietEnd: number; digestMode: string } {
  const d = String(form.get('digest_mode') ?? '');
  return {
    quietStart: clampHour(form.get('quiet_start')),
    quietEnd: clampHour(form.get('quiet_end')),
    digestMode: DIGESTS.has(d) ? d : 'smart',
  };
}
