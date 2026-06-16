/**
 * On-device study segmenter (SPEC §5; design 2026-06-15). Turns the redacted
 * ObserverEvent stream into the cloud's diagnosis-packet contract
 * (apps/web/lib/diagnosis/types.ts SynthesisPacket) WITHOUT the event stream
 * ever leaving the device — only categorized workflow summaries upload (C1/C7).
 *
 * Deterministic v0: category by host→app dictionary, one workflow per category,
 * coarse `${category}.general` keys (the server's Opus pass writes warm labels
 * and finer keys; this stays honest). Paranoid re-scan before returning.
 */
import { batteryStillMatches } from './battery.js';
import { sequenceCandidates } from './packet.js';
import type { ObserverEvent } from './types.js';

export class PacketLeakError extends Error {
  constructor(ruleId: string) {
    super(`synthesis packet failed the paranoid re-scan: battery rule ${ruleId} still matches`);
    this.name = 'PacketLeakError';
  }
}

export type WorkflowCategory =
  | 'email' | 'calendar' | 'payments' | 'crm' | 'docs' | 'social' | 'other';

export interface SequenceCandidateLite {
  steps: string[];
  count: number;
}

export interface PacketWorkflow {
  key: string;
  label: string;
  category: WorkflowCategory;
  apps: string[];
  minutesObserved: number;
  sessions: number;
  friction?: string;
  sequences?: SequenceCandidateLite[];
  urlTemplates?: string[];
  dailyMinutes?: Record<string, number>;
}

export interface SynthesisPacket {
  version: 1;
  studyId: string;
  studyDays: number;
  capturedFrom: string;
  capturedTo: string;
  workflows: PacketWorkflow[];
  dailyAppMinutes?: Record<string, Record<string, number>>;
  kind?: 'full_study' | 'quick_scan';
  label?: string;
}

const CATEGORY_LABEL: Record<WorkflowCategory, string> = {
  email: 'Email', calendar: 'Calendar', payments: 'Payments & invoicing',
  crm: 'Client records', docs: 'Documents', social: 'Social', other: 'Other work',
};

/**
 * Labels for the finer `${category}.${subkey}` workflow keys. `.general` keys
 * fall back to CATEGORY_LABEL[category] (see `labelForKey`), so only the split
 * subkeys need an entry here.
 */
const KEY_LABEL: Record<string, string> = {
  'payments.invoices': 'Sending invoices',
  'payments.overdue': 'Chasing overdue payments',
  'email.newsletter': 'Newsletters & campaigns',
  'email.overdue': 'Follow-up nudges',
  'calendar.confirmations': 'Booking confirmations',
};

function labelForKey(key: string, category: WorkflowCategory): string {
  return KEY_LABEL[key] ?? CATEGORY_LABEL[category];
}

/**
 * A finer subkey within a category, derived from ONLY the already-redacted url
 * fields (path_template, host). Conservative: only strong signals split a
 * category; everything else stays `general` (behavior unchanged for those).
 */
function subkeyOf(e: ObserverEvent, category: WorkflowCategory): string {
  const path = e.url?.path_template?.toLowerCase() ?? '';
  const host = e.url?.host?.toLowerCase() ?? '';
  switch (category) {
    case 'payments':
      if (path.includes('invoice')) return 'invoices';
      if (path.includes('overdue') || path.includes('past-due') || path.includes('reminder')) return 'overdue';
      return 'general';
    case 'email':
      if (
        host.includes('mailchimp') || host.includes('substack') || host.includes('beehiiv') ||
        path.includes('newsletter') || path.includes('campaign')
      ) return 'newsletter';
      if (path.includes('overdue') || path.includes('reminder')) return 'overdue';
      return 'general';
    case 'calendar':
      if (path.includes('confirm') || path.includes('booking') || host.includes('confirm') || host.includes('booking'))
        return 'confirmations';
      return 'general';
    default:
      return 'general';
  }
}

/** host substring → category (checked first), then app-name substring. */
const HOST_RULES: Array<[string, WorkflowCategory]> = [
  ['mail.google.com', 'email'], ['outlook.', 'email'], ['mail.yahoo.', 'email'],
  ['mailchimp', 'email'], ['substack.com', 'email'], ['beehiiv.com', 'email'],
  ['calendar.google.com', 'calendar'], ['cal.com', 'calendar'],
  ['stripe.com', 'payments'], ['paypal.com', 'payments'], ['squareup.com', 'payments'],
  ['quickbooks.', 'payments'], ['intuit.com', 'payments'],
  ['salesforce.com', 'crm'], ['hubspot.com', 'crm'], ['pipedrive.com', 'crm'], ['honeybook.com', 'crm'],
  ['docs.google.com', 'docs'], ['notion.so', 'docs'], ['dropbox.com', 'docs'], ['office.com', 'docs'],
  ['x.com', 'social'], ['twitter.com', 'social'], ['linkedin.com', 'social'],
  ['facebook.com', 'social'], ['instagram.com', 'social'],
];

const APP_RULES: Array<[string, WorkflowCategory]> = [
  ['gmail', 'email'], ['outlook', 'email'], [' mail', 'email'], ['spark', 'email'], ['superhuman', 'email'],
  ['calendar', 'calendar'], ['fantastical', 'calendar'],
  ['stripe', 'payments'], ['quickbooks', 'payments'], ['quicken', 'payments'],
  ['salesforce', 'crm'], ['hubspot', 'crm'], ['honeybook', 'crm'],
  ['notion', 'docs'], ['word', 'docs'], ['excel', 'docs'], ['pages', 'docs'], ['docs', 'docs'],
  ['slack', 'social'], ['twitter', 'social'], ['linkedin', 'social'],
];

function categorize(e: ObserverEvent): WorkflowCategory {
  const host = e.url?.host?.toLowerCase() ?? '';
  for (const [needle, cat] of HOST_RULES) if (host.includes(needle)) return cat;
  const app = e.app.name.toLowerCase();
  for (const [needle, cat] of APP_RULES) if (app.includes(needle)) return cat;
  return 'other';
}

function isoFloorToDays(fromMs: number, toMs: number): number {
  const days = fromMs === toMs ? 1 : Math.ceil((toMs - fromMs) / 86_400_000);
  return Math.max(1, Math.min(14, days));
}

export async function segmentStudy(
  studyId: string,
  events: ObserverEvent[],
  now: string,
  meta?: { kind?: 'full_study' | 'quick_scan'; label?: string | null },
): Promise<SynthesisPacket> {
  const exportable = events.filter((e) => e.redaction.review_state !== 'user_deleted');

  // Group by `${category}.${subkey}` so a category can yield finer workflows
  // (e.g. payments.invoices vs payments.overdue). `groupCat` records which
  // category each group key belongs to for label + category lookup.
  const byGroup = new Map<string, ObserverEvent[]>();
  const groupCat = new Map<string, WorkflowCategory>();
  for (const e of exportable) {
    const category = categorize(e);
    const key = `${category}.${subkeyOf(e, category)}`;
    (byGroup.get(key) ?? byGroup.set(key, []).get(key)!).push(e);
    groupCat.set(key, category);
  }

  const workflows: PacketWorkflow[] = [];
  for (const [key, evs] of byGroup) {
    const category = groupCat.get(key)!;
    const ms = evs.reduce((s, e) => s + (e.input?.duration_ms ?? 0), 0);
    const sessions = new Set(evs.map((e) => e.session)).size;
    const apps = [...new Set(evs.map((e) => e.app.name))].sort();
    const seqs = sequenceCandidates(evs);
    const top = seqs[0];
    const friction =
      top && top.count >= 3 ? `Repeated ${top.steps.length}-step sequence observed ${top.count}×` : undefined;
    // Cap each step to 80 chars at the source so the device-emitted packet
    // matches what the server validator stores (it truncates steps to 80) — the
    // on-device battery re-scan must check the exact bytes that get uploaded.
    const sequences = seqs.slice(0, 10).map((s) => ({ steps: s.steps.map((x) => x.slice(0, 80)), count: s.count }));
    const urlTemplates = [...new Set(evs.map((e) => e.url?.path_template).filter((u): u is string => !!u))].slice(0, 20);
    const dayMs: Record<string, number> = {};
    for (const e of evs) {
      const d = e.ts.slice(0, 10);
      dayMs[d] = (dayMs[d] ?? 0) + (e.input?.duration_ms ?? 0);
    }
    const dailyMinutes: Record<string, number> = {};
    for (const [d, dms] of Object.entries(dayMs).slice(0, 31)) dailyMinutes[d] = Math.round((dms / 60000) * 10) / 10;

    workflows.push({
      key,
      label: labelForKey(key, category),
      category,
      apps,
      minutesObserved: Math.round((ms / 60000) * 10) / 10,
      sessions,
      ...(friction ? { friction } : {}),
      ...(sequences.length ? { sequences } : {}),
      ...(urlTemplates.length ? { urlTemplates } : {}),
      ...(Object.keys(dailyMinutes).length ? { dailyMinutes } : {}),
    });
  }
  workflows.sort((a, b) => b.minutesObserved - a.minutesObserved);

  const tss = exportable.map((e) => e.ts).sort();
  const capturedFrom = tss[0] ?? now;
  const capturedTo = tss[tss.length - 1] ?? now;
  const studyDays = isoFloorToDays(Date.parse(capturedFrom), Date.parse(capturedTo));

  const dayAppMs: Record<string, Record<string, number>> = {};
  for (const e of exportable) {
    const d = e.ts.slice(0, 10);
    const bucket = (dayAppMs[d] ??= {});
    bucket[e.app.name] = (bucket[e.app.name] ?? 0) + (e.input?.duration_ms ?? 0);
  }
  const dailyAppMinutes: Record<string, Record<string, number>> = {};
  for (const [d, apps] of Object.entries(dayAppMs).slice(0, 31)) {
    const inner: Record<string, number> = {};
    for (const [app, appMs] of Object.entries(apps).slice(0, 20)) inner[app] = Math.round((appMs / 60000) * 10) / 10;
    dailyAppMinutes[d] = inner;
  }

  const packet: SynthesisPacket = {
    version: 1, studyId, studyDays, capturedFrom, capturedTo, workflows,
    ...(Object.keys(dailyAppMinutes).length ? { dailyAppMinutes } : {}),
    ...(meta?.kind ? { kind: meta.kind } : {}),
    ...(meta?.label ? { label: meta.label.slice(0, 120) } : {}),
  };

  const residual = batteryStillMatches(JSON.stringify(packet));
  if (residual !== null) throw new PacketLeakError(residual);

  return packet;
}
