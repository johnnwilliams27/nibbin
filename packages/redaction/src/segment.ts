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

export interface PacketWorkflow {
  key: string;
  label: string;
  category: WorkflowCategory;
  apps: string[];
  minutesObserved: number;
  sessions: number;
  friction?: string;
}

export interface SynthesisPacket {
  version: 1;
  studyId: string;
  studyDays: number;
  capturedFrom: string;
  capturedTo: string;
  workflows: PacketWorkflow[];
}

const CATEGORY_LABEL: Record<WorkflowCategory, string> = {
  email: 'Email', calendar: 'Calendar', payments: 'Payments & invoicing',
  crm: 'Client records', docs: 'Documents', social: 'Social', other: 'Other work',
};

/** host substring → category (checked first), then app-name substring. */
const HOST_RULES: Array<[string, WorkflowCategory]> = [
  ['mail.google.com', 'email'], ['outlook.', 'email'], ['mail.yahoo.', 'email'],
  ['calendar.google.com', 'calendar'], ['cal.', 'calendar'],
  ['stripe.com', 'payments'], ['paypal.com', 'payments'], ['squareup.com', 'payments'],
  ['quickbooks.', 'payments'], ['intuit.com', 'payments'],
  ['salesforce.com', 'crm'], ['hubspot.com', 'crm'], ['pipedrive.com', 'crm'], ['honeybook.com', 'crm'],
  ['docs.google.com', 'docs'], ['notion.so', 'docs'], ['dropbox.com', 'docs'], ['office.com', 'docs'],
  ['x.com', 'social'], ['twitter.com', 'social'], ['linkedin.com', 'social'],
  ['facebook.com', 'social'], ['instagram.com', 'social'],
];

const APP_RULES: Array<[string, WorkflowCategory]> = [
  ['gmail', 'email'], ['outlook', 'email'], ['mail', 'email'], ['spark', 'email'], ['superhuman', 'email'],
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
  const days = Math.ceil((toMs - fromMs) / 86_400_000);
  return Math.max(1, Math.min(14, days || 1));
}

export async function segmentStudy(
  studyId: string,
  events: ObserverEvent[],
  now: string,
): Promise<SynthesisPacket> {
  const exportable = events.filter((e) => e.redaction.review_state !== 'user_deleted');

  const byCat = new Map<WorkflowCategory, ObserverEvent[]>();
  for (const e of exportable) {
    const cat = categorize(e);
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(e);
  }

  const workflows: PacketWorkflow[] = [];
  for (const [category, evs] of byCat) {
    const ms = evs.reduce((s, e) => s + (e.input?.duration_ms ?? 0), 0);
    const sessions = new Set(evs.map((e) => e.session)).size;
    const apps = [...new Set(evs.map((e) => e.app.name))].sort();
    const seqs = sequenceCandidates(evs);
    const top = seqs[0];
    const friction =
      top && top.count >= 3 ? `Repeated ${top.steps.length}-step sequence observed ${top.count}×` : undefined;
    workflows.push({
      key: `${category}.general`,
      label: CATEGORY_LABEL[category],
      category,
      apps,
      minutesObserved: Math.round((ms / 60000) * 10) / 10,
      sessions,
      ...(friction ? { friction } : {}),
    });
  }
  workflows.sort((a, b) => b.minutesObserved - a.minutesObserved);

  const tss = exportable.map((e) => e.ts).sort();
  const capturedFrom = tss[0] ?? now;
  const capturedTo = tss[tss.length - 1] ?? now;
  const studyDays = isoFloorToDays(Date.parse(capturedFrom), Date.parse(capturedTo));

  const packet: SynthesisPacket = {
    version: 1, studyId, studyDays, capturedFrom, capturedTo, workflows,
  };

  const residual = batteryStillMatches(JSON.stringify(packet));
  if (residual !== null) throw new PacketLeakError(residual);

  return packet;
}
