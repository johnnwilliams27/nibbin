/**
 * Composer Slice 2b — REAL DIFFERENTIAL parity (FIX 1, all-reviewers P1).
 *
 * The runtime-side parity test (packages/runtime/test/composer-slice2b.test.ts)
 * drives only the PRIMITIVE against hardcoded values — it never instantiates the
 * apps/web TEMPLATE programs, so a future edit that broke a template's
 * delegation would NOT fail any test. This closes that gap from the side where
 * the template programs actually live.
 *
 * For each of the four delegating templates {echo, tally, hopper, scribe} it:
 *  - builds the TEMPLATE ProgramFn through the real router `buildProgram(spec,
 *    connMap, nowMs)` with a spec whose `templateKey` is that template and EMPTY
 *    `steps` (so buildProgram routes to the hand-written template, not the
 *    interpreter);
 *  - builds the corresponding PRIMITIVE ProgramFn directly with the template's
 *    default params (echo staleDays=3, tally minDaysLate=0, hopper withinDays=7,
 *    scribe {});
 *  - drives BOTH generators over the SAME mock reader/fixture, feeding identical
 *    quarantined results to each `.next()` keyed by the yielded read path;
 *  - asserts the two yielded-step arrays are DEEP-EQUAL (kind, capability,
 *    connectionId, path, patternKey, effectArgs, prompt, title, draft — the full
 *    step shape).
 *
 * Because programs.ts imports 'server-only', this runs under the repo vitest
 * config that aliases 'server-only' to an inert stub (vitest.config.ts) — the
 * same path compose.test.ts / programs.conformance.test.ts rely on.
 */
import { describe, expect, it } from 'vitest';
import { quarantine } from '@nibbin/connectors';
import {
  digestInboxCleanup,
  digestMorning,
  nudgeOverdueEmail,
  nudgeOverdueInvoice,
  nudgeUnconfirmedEvent,
  replyNewInquiry,
  type AgentSpec,
  type NibbinRef,
  type ProgramFn,
  type ProgramStep,
  type RunTrigger,
} from '@nibbin/runtime';
import { buildProgram, type ConnectionMap } from './programs';

const ACCOUNT = 'acct-parity';
const GMAIL = 'conn-gmail';
const STRIPE = 'conn-stripe';
const GCAL = 'conn-gcal';
const TRIGGER: RunTrigger = { kind: 'user' };
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const CURRICULUM = {
  measures: 'drafts approved without edits',
  promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95, coverageMinPatterns: 4 },
  routineMinApprovals: 5,
};
const CREDIT = { weightClass: 'standard' as const, ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 } };
const TRIGGERS = [
  { kind: 'schedule' as const, schedule: 'daily.morning', cooldownSecs: 3600 },
  { kind: 'user' as const },
];

/** A template spec: a real templateKey + EMPTY steps so buildProgram routes to
 *  the hand-written template program (not the interpreter). */
function templateSpec(templateKey: string): AgentSpec {
  return {
    templateKey,
    version: 1,
    displayName: templateKey,
    toolsAllowlist: ['email.read'],
    requiredConnectors: ['gmail'],
    triggers: TRIGGERS,
    curriculum: CURRICULUM,
    creditProfile: CREDIT,
    steps: [],
    personaPolicy: { tone: 'warm' },
  };
}

function nib(): NibbinRef {
  return {
    id: 'nib-parity',
    accountId: ACCOUNT,
    name: 'Parity',
    stage: 'student',
    status: 'active',
    spec: templateSpec('echo'),
  };
}

/** Drive a ProgramFn to exhaustion, feeding quarantined replies keyed by the
 *  yielded read path/connection (compose steps get no fed value, so both sides
 *  fall to the same deterministic draft). Collects every yielded step. */
async function drive(
  program: ProgramFn,
  responder: (step: ProgramStep) => string | undefined,
): Promise<ProgramStep[]> {
  const steps: ProgramStep[] = [];
  const gen = program({ nibbin: nib(), trigger: TRIGGER });
  let fed: ReturnType<typeof quarantine> | undefined;
  for (;;) {
    const r = await gen.next(fed as ReturnType<typeof quarantine>);
    if (r.done) break;
    steps.push(r.value);
    const body = responder(r.value);
    fed = body !== undefined ? quarantine(body, 'prov:test') : undefined;
  }
  return steps;
}

/* ── fixtures (one per connector shape) ─────────────────────────────────────── */

function gmailMeta(id: string, headers: Record<string, string>, internalDate: number) {
  return JSON.stringify({
    id,
    threadId: id,
    internalDate: String(internalDate),
    payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
  });
}

/** Mailbox fixture shared by echo + scribe: one stale, unanswered first-contact
 *  inbound (overdue + a new inquiry), no sent replies. */
function mailboxReader(): (path: string) => string {
  return (path) => {
    if (path.includes('/messages?')) {
      const isSent = path.includes('in%3Asent') || path.includes('in:sent');
      return isSent ? '{"messages":[]}' : '{"messages":[{"id":"thread_a"}]}';
    }
    // metadata fetch for thread_a
    return gmailMeta(
      'thread_a',
      { From: 'New Lead <lead@example.com>', Subject: 'Wedding inquiry' },
      NOW - 10 * DAY,
    );
  };
}

function stripeReader(): (path: string) => string {
  return () =>
    JSON.stringify({
      data: [{ id: 'in_overdue', status: 'open', due_date: Math.floor((NOW - 20 * DAY) / 1000), amount_due: 24_900 }],
    });
}

function gcalGmailReader(): (path: string) => string {
  return (path) => {
    if (path.includes('/calendar/')) {
      return JSON.stringify({
        items: [
          {
            id: 'evt_1',
            summary: 'Discovery call',
            status: 'confirmed',
            start: { dateTime: new Date(NOW + 2 * DAY).toISOString() },
            attendees: [
              { email: 'me@studio.com', self: true, responseStatus: 'accepted' },
              { email: 'Guest <guest@example.com>', responseStatus: 'needsAction' },
            ],
          },
        ],
      });
    }
    return '{"messages":[]}';
  };
}

/** sweep fixture: an inbox of newsletter-ish messages (List-Unsubscribe set)
 *  from two senders, no sent. Drives the non-trivial top-N digest path. */
function sweepReader(): (path: string) => string {
  return (path) => {
    if (path.includes('/messages?')) {
      const isSent = path.includes('in%3Asent') || path.includes('in:sent');
      return isSent
        ? '{"messages":[]}'
        : '{"messages":[{"id":"n1"},{"id":"n2"},{"id":"n3"}]}';
    }
    // metadata fetch — id is in the path; n1/n2 from Acme, n3 from Beta.
    const id = path.includes('n3') ? 'n3' : path.includes('n2') ? 'n2' : 'n1';
    const from = id === 'n3' ? 'Beta <news@beta.com>' : 'Acme <news@acme.com>';
    return gmailMeta(
      id,
      { From: from, Subject: 'Weekly digest', 'List-Unsubscribe': '<mailto:unsub@x>' },
      NOW - 1 * DAY,
    );
  };
}

/** brief fixture: 1 calendar event + 1 overdue invoice + fresh inbox messages.
 *  All three reads return data so every line of the digest is exercised. */
function briefReader(): (path: string) => string {
  return (path) => {
    if (path.includes('/calendar/')) {
      return JSON.stringify({
        items: [{ summary: 'Discovery call', start: { dateTime: new Date(NOW + DAY).toISOString() } }],
      });
    }
    if (path.includes('/v1/invoices')) {
      return JSON.stringify({
        data: [{ id: 'in_1', status: 'open', due_date: Math.floor((NOW - 5 * DAY) / 1000), amount_due: 12_345 }],
      });
    }
    // gmail fresh-mail list (in:inbox over 2 days).
    return '{"messages":[{"id":"m1"},{"id":"m2"}]}';
  };
}

/* ── the differential parity matrix ─────────────────────────────────────────── */

interface Case {
  templateKey: string;
  /** the primitive built with the template's default params. */
  primitive: ProgramFn;
  /** connections the template program is built against. */
  connMap: ConnectionMap;
  reader: (path: string) => string;
}

const CASES: Case[] = [
  {
    templateKey: 'echo',
    primitive: nudgeOverdueEmail({ staleDays: 3 }, { gmail: GMAIL }, NOW),
    connMap: { gmail: GMAIL },
    reader: mailboxReader(),
  },
  {
    templateKey: 'tally',
    primitive: nudgeOverdueInvoice({ minDaysLate: 0 }, { stripe: STRIPE }, NOW),
    connMap: { stripe: STRIPE },
    reader: stripeReader(),
  },
  {
    templateKey: 'hopper',
    primitive: nudgeUnconfirmedEvent({ withinDays: 7 }, { 'google-calendar': GCAL, gmail: GMAIL }, NOW),
    connMap: { 'google-calendar': GCAL, gmail: GMAIL },
    reader: gcalGmailReader(),
  },
  {
    templateKey: 'scribe',
    primitive: replyNewInquiry({}, { gmail: GMAIL }, NOW),
    connMap: { gmail: GMAIL },
    reader: mailboxReader(),
  },
  // Slice 2c — the digest/summarize shape (presentation primitives).
  {
    templateKey: 'sweep',
    primitive: digestInboxCleanup({ topSenders: 5 }, { gmail: GMAIL }, NOW),
    connMap: { gmail: GMAIL },
    reader: sweepReader(),
  },
  {
    templateKey: 'brief',
    primitive: digestMorning({}, { 'google-calendar': GCAL, stripe: STRIPE, gmail: GMAIL }, NOW),
    connMap: { 'google-calendar': GCAL, stripe: STRIPE, gmail: GMAIL },
    reader: briefReader(),
  },
];

describe('template ↔ primitive DIFFERENTIAL parity (real buildProgram routing)', () => {
  for (const c of CASES) {
    it(`${c.templateKey}: buildProgram(template) yields identical steps to its primitive`, async () => {
      const responder = (step: ProgramStep) => (step.kind === 'read' ? c.reader(step.path) : undefined);

      // The TEMPLATE program, through the real router (empty steps → template).
      const templateProgram = buildProgram(templateSpec(c.templateKey), c.connMap, NOW);
      const templateSteps = await drive(templateProgram, responder);

      // The PRIMITIVE, driven over the same fixture.
      const primitiveSteps = await drive(c.primitive, responder);

      // Guard against a vacuous pass: both must have actually produced a draft.
      expect(templateSteps.some((s) => s.kind === 'draft')).toBe(true);
      // The full step shape must be deep-equal: kind, capability, connectionId,
      // path, patternKey, effectArgs, prompt, title, draft.
      expect(templateSteps).toEqual(primitiveSteps);
    });
  }
});
