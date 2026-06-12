/**
 * The Keeper interview — the scan_empty fallback (SPEC §6.12 cold start):
 * "if the scan finds nothing meaningful, the Grovekeeper switches to
 * interview mode — five questions that produce a manual workflow map and
 * shop recommendations. Nobody hits an empty screen on day one."
 *
 * Pure: questions in, map + recommendations out. Copy follows the brand-voice
 * skill (warm, first person, one question at a time, no guilt).
 */
import { getTemplate, SHOP_TEMPLATES } from '@nibbin/runtime';

export interface InterviewQuestion {
  id: InterviewQuestionId;
  prompt: string;
  /** Pre-canned chips; free text is always allowed alongside. */
  chips: Array<{ id: string; label: string }>;
  multi: boolean;
}

export type InterviewQuestionId = 'arrive' | 'repeat' | 'waiting' | 'money' | 'calendar';

export type InterviewAnswers = Partial<Record<InterviewQuestionId, string[]>>;

export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = [
  {
    id: 'arrive',
    prompt: 'My scan came back quiet, so let me just ask — where does new work usually find you?',
    chips: [
      { id: 'email', label: 'Email' },
      { id: 'dms', label: 'Instagram or other DMs' },
      { id: 'referrals', label: 'Referrals and word of mouth' },
      { id: 'site', label: 'My website or a booking form' },
    ],
    multi: true,
  },
  {
    id: 'repeat',
    prompt: 'What do you find yourself typing over and over — the message you could write in your sleep?',
    chips: [
      { id: 'pricing', label: 'Pricing and packages' },
      { id: 'availability', label: 'Availability' },
      { id: 'followup', label: 'Follow-ups and check-ins' },
      { id: 'delivery', label: 'Delivery and handoff notes' },
    ],
    multi: true,
  },
  {
    id: 'waiting',
    prompt: 'Right now, is anyone waiting on a reply from you that you keep meaning to send?',
    chips: [
      { id: 'yes_few', label: 'A few people, honestly' },
      { id: 'yes_one', label: 'One or two' },
      { id: 'no', label: 'All caught up' },
    ],
    multi: false,
  },
  {
    id: 'money',
    prompt: 'And the money side — do invoices ever go out late, or sit unpaid longer than you’d like?',
    chips: [
      { id: 'late', label: 'They go out late' },
      { id: 'unpaid', label: 'They sit unpaid' },
      { id: 'both', label: 'Both, ouch' },
      { id: 'fine', label: 'Money side is tidy' },
    ],
    multi: false,
  },
  {
    id: 'calendar',
    prompt: 'Last one: how does scheduling feel — confirmations, reminders, reschedules?',
    chips: [
      { id: 'noshows', label: 'No-shows happen' },
      { id: 'chasing', label: 'I chase confirmations by hand' },
      { id: 'fine', label: 'Calendar runs itself' },
    ],
    multi: false,
  },
];

export interface WorkflowMapNode {
  key: string;
  label: string;
  /** What the user told us, restated plainly. */
  detail: string;
}

export interface InterviewRecommendation {
  templateKey: string;
  displayName: string;
  reason: string;
  requiredConnectors: string[];
}

export interface InterviewResult {
  map: WorkflowMapNode[];
  recommendations: InterviewRecommendation[];
}

function has(answers: InterviewAnswers, q: InterviewQuestionId, ...ids: string[]): boolean {
  const picked = answers[q] ?? [];
  return ids.some((id) => picked.includes(id));
}

function recommend(templateKey: string, reason: string): InterviewRecommendation {
  const t = getTemplate(templateKey);
  return {
    templateKey,
    displayName: t.spec.displayName,
    reason,
    requiredConnectors: t.spec.requiredConnectors,
  };
}

/**
 * Five answers → a manual workflow map + ranked shop recommendations.
 * Deterministic; always returns at least two recommendations so day one
 * never dead-ends.
 */
export function interviewResult(answers: InterviewAnswers): InterviewResult {
  const map: WorkflowMapNode[] = [];
  const recs: InterviewRecommendation[] = [];

  if (has(answers, 'arrive', 'email', 'site')) {
    map.push({ key: 'inbound-email', label: 'Work arrives by email', detail: 'Inquiries and bookings start in the inbox.' });
  }
  if (has(answers, 'arrive', 'dms')) {
    map.push({ key: 'inbound-dms', label: 'Work arrives in DMs', detail: 'Inquiries open as direct messages.' });
  }
  if (has(answers, 'repeat', 'pricing', 'availability')) {
    map.push({ key: 'faq-replies', label: 'The same answers, retyped', detail: 'Pricing and availability get rewritten by hand.' });
    recs.push(recommend('scribe', 'You retype the same answers — Scribe drafts them in your voice for your yes.'));
  }
  if (has(answers, 'waiting', 'yes_few', 'yes_one') || has(answers, 'repeat', 'followup')) {
    map.push({ key: 'overdue-replies', label: 'Replies waiting on you', detail: 'Threads go quiet while busy weeks happen.' });
    recs.push(recommend('echo', 'People are waiting on replies — Echo finds those threads and drafts the nudge.'));
  }
  if (has(answers, 'money', 'late', 'unpaid', 'both')) {
    map.push({ key: 'money-lag', label: 'Money runs behind', detail: 'Invoices go out late or sit unpaid.' });
    recs.push(recommend('tally', 'Invoices sit unpaid — Tally watches them and drafts the polite payment nudge.'));
  }
  if (has(answers, 'calendar', 'noshows', 'chasing')) {
    map.push({ key: 'calendar-churn', label: 'Scheduling needs chasing', detail: 'Confirmations and reminders happen by hand.' });
    recs.push(recommend('hopper', 'Confirmations are manual — Hopper checks tomorrow and drafts them for you.'));
  }
  if (has(answers, 'repeat', 'delivery')) {
    map.push({ key: 'delivery-chain', label: 'Delivery handoffs', detail: 'Finished work needs its handoff note every time.' });
  }

  // never an empty screen: round out with the broadest helpers
  if (!recs.some((r) => r.templateKey === 'brief')) {
    recs.push(recommend('brief', 'Brief reads your morning across everything connected and hands you the short version.'));
  }
  if (recs.length < 2) {
    recs.push(recommend('sweep', 'Sweep tidies inbox noise into one keep-or-clear list.'));
  }

  const ranked = recs.slice(0, 3);
  if (map.length === 0) {
    map.push({
      key: 'fresh-grove',
      label: 'A quiet start',
      detail: 'Not much busywork surfaced yet — the grove grows as your accounts connect.',
    });
  }
  return { map, recommendations: ranked };
}

/** Sanity guard used by tests: every recommendable template really exists. */
export function interviewTemplatesExist(): boolean {
  return ['scribe', 'echo', 'tally', 'hopper', 'brief', 'sweep'].every((k) =>
    SHOP_TEMPLATES.some((t) => t.key === k),
  );
}
