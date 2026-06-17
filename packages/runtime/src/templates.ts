/**
 * The Agent Shop — six spec-versioned templates (SPEC §4.6): required
 * connectors, tool allowlist, trigger definitions, School curriculum (what
 * accuracy is measured against), credit profile.
 *
 * Adoption snapshots the template into agent_specs via adopt_nibbin, so a
 * hatched Nibbin keeps the spec version it was born with. Copy follows
 * .claude/skills/brand-voice: sentence case, concrete nouns, no corporate
 * filler; trust is earned, never unlocked.
 *
 * v0 keeps every template on draft-shaped capabilities (email.draft,
 * invoice.nudge, dm.reply) — no template ships with raw send authority, and
 * write scopes only arrive per-Nibbin at adoption (C8).
 */
import type { SpeciesName, Accessory, Marking } from '@nibbin/creatures';
import type { AgentSpec, RunCeilings } from './types';

export interface ShopTemplate {
  key: string;
  spec: AgentSpec;
  /** Shop card copy. */
  tagline: string;
  description: string;
  /** Creature rendering defaults (users can restyle at hatch). */
  species: SpeciesName;
  accessory: Accessory;
  marking: Marking;
  /** Brand palette hex for the sprite. */
  color: string;
}

const DEFAULT_CEILINGS: RunCeilings = {
  // Read steps are cheap and free (connector REST, no model), and a single
  // mailbox sweep is dozens of metadata reads — so the step ceiling must clear
  // a realistic inbox sample or the email programs self-kill before drafting
  // (cost-auditor P1-1). maxTokens stays conservative for the model era:
  // standard-weight work is draft-shaped, not long-context (cost-auditor P3-2).
  maxSteps: 120,
  maxTokens: 12_000,
  maxWallClockMs: 60_000,
};

const PROMOTION = { windowRuns: 25, minApprovedUneditedPct: 0.95 };

function spec(partial: Omit<AgentSpec, 'version' | 'creditProfile'>): AgentSpec {
  return {
    ...partial,
    version: 1,
    creditProfile: { weightClass: 'standard', ceilings: DEFAULT_CEILINGS },
  };
}

export const SHOP_TEMPLATES: readonly ShopTemplate[] = [
  {
    key: 'sweep',
    tagline: 'Keeps your inbox floor clean',
    description:
      'Sweep reads your inbox the way you would on a tidy morning: it gathers newsletter noise, stale threads, and things you already answered, then hands you one short keep-or-clear list.',
    species: 'Puff',
    accessory: 'broom',
    marking: 'none',
    color: '#7FA8A0',
    spec: spec({
      templateKey: 'sweep',
      displayName: 'Sweep',
      toolsAllowlist: ['email.read'],
      requiredConnectors: ['gmail'],
      triggers: [
        { kind: 'schedule', schedule: 'daily.morning', cooldownSecs: 3600 },
        { kind: 'user' },
      ],
      curriculum: {
        measures: 'sweep suggestions you keep vs. send back',
        promotion: PROMOTION,
        routineMinApprovals: 5,
      },
    }),
  },
  {
    key: 'echo',
    tagline: 'Never lets a thread go quiet',
    description:
      'Echo watches for conversations waiting on you — overdue replies, stalled follow-ups, deliveries that went out without a note — and drafts the nudge so all you do is read it and say go.',
    species: 'Wisp',
    accessory: 'none',
    marking: 'stripe',
    color: '#5B8DB0',
    spec: spec({
      templateKey: 'echo',
      displayName: 'Echo',
      toolsAllowlist: ['email.read', 'email.draft'],
      requiredConnectors: ['gmail'],
      triggers: [
        { kind: 'schedule', schedule: 'daily.morning', cooldownSecs: 3600 },
        { kind: 'event', source: 'connector:gmail:thread.overdue', debounceSecs: 3600, cooldownSecs: 300 },
        { kind: 'user' },
      ],
      curriculum: {
        measures: 'overdue-reply drafts approved without edits',
        promotion: PROMOTION,
        routineMinApprovals: 5,
      },
    }),
  },
  {
    key: 'brief',
    tagline: 'Your morning, on one card',
    description:
      "Brief reads yesterday and today across your calendar, inbox, and money, then writes the short version: what's booked, what's waiting, what needs a decision. Five lines, every morning.",
    species: 'Glim',
    accessory: 'glasses',
    marking: 'none',
    color: '#8A5F0C',
    spec: spec({
      templateKey: 'brief',
      displayName: 'Brief',
      toolsAllowlist: ['email.read', 'calendar.read', 'payments.read'],
      requiredConnectors: ['gmail', 'google-calendar', 'stripe'],
      triggers: [
        { kind: 'schedule', schedule: 'daily.morning', cooldownSecs: 21600 },
        { kind: 'user' },
      ],
      curriculum: {
        measures: 'digests you read and keep as-is',
        promotion: PROMOTION,
        routineMinApprovals: 5,
      },
    }),
  },
  {
    key: 'tally',
    tagline: 'Minds the money you already earned',
    description:
      'Tally keeps an eye on invoices: which went out late, which are overdue, where fees are nibbling at you. It drafts the polite payment nudge you keep meaning to send.',
    species: 'Capling',
    accessory: 'coin',
    marking: 'none',
    color: '#44601F',
    spec: spec({
      templateKey: 'tally',
      displayName: 'Tally',
      toolsAllowlist: ['payments.read', 'invoice.nudge'],
      requiredConnectors: ['stripe'],
      triggers: [
        { kind: 'schedule', schedule: 'weekly.monday', cooldownSecs: 3600 },
        { kind: 'event', source: 'connector:stripe:invoice.overdue', debounceSecs: 86_400, cooldownSecs: 3600 },
        { kind: 'user' },
      ],
      curriculum: {
        measures: 'payment nudges approved without edits',
        promotion: PROMOTION,
        routineMinApprovals: 5,
      },
    }),
  },
  {
    key: 'hopper',
    tagline: 'Keeps your calendar honest',
    description:
      'Hopper checks tomorrow before you do: unconfirmed sessions, missing reminders, the reschedule that never got rebooked. It drafts the confirmation so nobody no-shows on you.',
    species: 'Longear',
    accessory: 'pencil',
    marking: 'spots',
    color: '#5C3FB0',
    spec: spec({
      templateKey: 'hopper',
      displayName: 'Hopper',
      toolsAllowlist: ['calendar.read', 'email.draft', 'email.read'],
      requiredConnectors: ['google-calendar', 'gmail'],
      triggers: [
        { kind: 'schedule', schedule: 'daily.afternoon', cooldownSecs: 3600 },
        { kind: 'event', source: 'connector:google-calendar:event.created', debounceSecs: 600, cooldownSecs: 300 },
        { kind: 'user' },
      ],
      curriculum: {
        measures: 'confirmations and reminders approved without edits',
        promotion: PROMOTION,
        routineMinApprovals: 5,
      },
    }),
  },
  {
    key: 'scribe',
    tagline: 'Answers the question you answer every week',
    description:
      'Scribe learns how you reply to the inquiries that arrive again and again — pricing, availability, what a session includes — and drafts the answer in your voice, ready for your yes.',
    species: 'Sprout',
    accessory: 'quill',
    marking: 'none',
    color: '#B14A22',
    spec: spec({
      templateKey: 'scribe',
      displayName: 'Scribe',
      toolsAllowlist: ['email.read', 'email.draft'],
      requiredConnectors: ['gmail'],
      triggers: [
        { kind: 'event', source: 'connector:gmail:message.received', debounceSecs: 300, cooldownSecs: 120 },
        { kind: 'user' },
      ],
      curriculum: {
        measures: 'inquiry replies approved without edits',
        promotion: PROMOTION,
        routineMinApprovals: 5,
      },
    }),
  },
];

export const SHOP_TEMPLATE_KEYS = SHOP_TEMPLATES.map((t) => t.key);

export function getTemplate(key: string): ShopTemplate {
  const t = SHOP_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`unknown shop template: ${key}`);
  return t;
}

/**
 * Which template fixes which §4.4 scan module — the inverse of
 * Finding.recommendedNibbin. Kept total: a registry scan module without a
 * mapping is a build error caught by the test suite.
 */
export const TEMPLATE_FOR_SCAN_MODULE: Record<string, string> = {
  'email.inquiry-rate': 'scribe',
  'email.overdue-threads': 'echo',
  'email.newsletter-noise': 'sweep',
  'calendar.meeting-load': 'brief',
  'calendar.no-show-churn': 'hopper',
  'calendar.confirmation-gaps': 'hopper',
  'payments.invoice-latency': 'tally',
  'payments.overdue-balances': 'tally',
  'payments.fee-leakage': 'tally',
  'payments.recurring-revenue': 'brief',
  'crm.lead-response-lag': 'scribe',
  'crm.pipeline-stalls': 'echo',
  'crm.delivery-latency': 'echo',
  'dm.inquiry-rate': 'scribe',
  'dm.overdue-threads': 'echo',
};
