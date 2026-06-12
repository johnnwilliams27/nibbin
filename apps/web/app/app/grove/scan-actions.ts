'use server';

/**
 * The connector scan in the grove (§4.1 steps 5–7): the Grovekeeper narrates
 * findings as cards, recommends adoptions with the math, falls back to the
 * five-question interview when the scan comes back empty (§6.12), and walks
 * the first draft to approval.
 *
 * C10 holds: nothing here gives the Grovekeeper a side-effect tool. The scan
 * is read-only; adoption and decisions are USER actions the Keeper narrates;
 * runs execute under the Agent School gates in @nibbin/runtime.
 */
import type { Finding } from '@nibbin/connectors';
import type { KeeperExpression, KeeperMessage } from '@nibbin/keeper';
import { getTemplate } from '@nibbin/runtime';
import {
  INTERVIEW_QUESTIONS,
  interviewResult,
  type InterviewAnswers,
  type InterviewQuestionId,
} from '@nibbin/scan';
import { appSession } from '../../../lib/auth/app-session';
import { adoptTemplate } from '../../../lib/runtime/adopt';
import { decideDraft, editDistance, type DraftDecision } from '../../../lib/runtime/decide';
import { devSeedEnabled } from '../../../lib/runtime/engine';
import { serviceClient } from '../../../lib/supabase/service';
import { runAccountScan, seedDevConnections } from '../../../lib/scan/run';

let seq = 0;
function msg(card: KeeperMessage['card']): KeeperMessage {
  seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
  return { id: `scan-${seq}`, from: 'keeper', card };
}

function prose(text: string): KeeperMessage {
  return msg({ kind: 'prose', text, transcript: text });
}

export interface AdoptChip {
  templateKey: string;
  label: string;
}

export interface PendingDraft {
  runId: string;
  specialistName: string;
  title: string;
  draft: string;
}

export interface ScanTurnPayload {
  messages: KeeperMessage[];
  expression: KeeperExpression;
  adoptChips: AdoptChip[];
  /** Present while the interview fallback is running. */
  interviewQuestionId: InterviewQuestionId | null;
  pendingDraft: PendingDraft | null;
}

function costLine(f: Finding): string {
  if (f.cost.dollarsPerMonth) return `$${f.cost.dollarsPerMonth.toLocaleString('en-US')}`;
  if (f.cost.hoursPerWeek) return `~${f.cost.hoursPerWeek}h/week`;
  return '';
}

function findingCard(f: Finding): KeeperMessage {
  const stat = costLine(f);
  return msg({
    kind: 'scan_finding',
    title: moduleLabel(f.module),
    detail: f.insight,
    ...(stat ? { stat: { value: stat, label: 'on the table' } } : {}),
    transcript: `${moduleLabel(f.module)}: ${f.insight}${stat ? ` (${stat} on the table)` : ''} — the math: ${f.cost.basis}`,
  });
}

function moduleLabel(moduleId: string): string {
  const labels: Record<string, string> = {
    'email.inquiry-rate': 'Inquiries in your inbox',
    'email.overdue-threads': 'Replies waiting on you',
    'email.newsletter-noise': 'Inbox noise',
    'calendar.meeting-load': 'Calendar load',
    'calendar.no-show-churn': 'Cancellations and no-shows',
    'calendar.confirmation-gaps': 'Unconfirmed sessions',
    'payments.invoice-latency': 'Slow invoices',
    'payments.overdue-balances': 'Money past due',
    'payments.fee-leakage': 'Fee nibbling',
    'payments.recurring-revenue': 'Your repeat clients',
    'crm.lead-response-lag': 'Leads going cold',
    'crm.pipeline-stalls': 'Stalled projects',
    'crm.delivery-latency': 'Delivery lag',
    'dm.inquiry-rate': 'DM inquiries',
    'dm.overdue-threads': 'DMs waiting on you',
  };
  return labels[moduleId] ?? 'Something I noticed';
}

function recommendationCards(findings: Finding[]): { messages: KeeperMessage[]; chips: AdoptChip[] } {
  // group by recommended template; rank by how much cost each one addresses
  const byTemplate = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byTemplate.get(f.recommendedNibbin) ?? [];
    list.push(f);
    byTemplate.set(f.recommendedNibbin, list);
  }
  const score = (list: Finding[]) =>
    list.reduce((s, f) => s + (f.cost.dollarsPerMonth ?? 0) / 50 + (f.cost.hoursPerWeek ?? 0), 0);
  const ranked = [...byTemplate.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, 3);

  const messages: KeeperMessage[] = [];
  const chips: AdoptChip[] = [];
  for (const [templateKey, list] of ranked) {
    const t = getTemplate(templateKey);
    const top = list[0];
    const math = top.cost.basis;
    messages.push(
      msg({
        kind: 'recommendation',
        title: `${t.spec.displayName} could take this over`,
        detail: t.description,
        math,
        adoptLabel: `Adopt ${t.spec.displayName}`,
        transcript: `Recommendation: ${t.spec.displayName}. ${t.description} The math: ${math}.`,
      }),
    );
    chips.push({ templateKey, label: `Adopt ${t.spec.displayName}` });
  }
  return { messages, chips };
}

function interviewQuestionCard(id: InterviewQuestionId): KeeperMessage {
  const q = INTERVIEW_QUESTIONS.find((x) => x.id === id)!;
  return msg({
    kind: 'question',
    prompt: q.prompt,
    chips: q.chips,
    multi: q.multi,
    skippable: false,
    transcript: `${q.prompt} Choices: ${q.chips.map((c) => c.label).join(', ')}`,
  });
}

/** §4.1 step 5: run the scan live, narrate findings as cards. */
export async function runScanAction(): Promise<ScanTurnPayload> {
  const { user, accountId } = await appSession();

  if (devSeedEnabled()) {
    await seedDevConnections(accountId);
  }

  const scan = await runAccountScan(accountId, user.id);

  if (scan.empty) {
    // §6.12 cold start: scan_empty already emitted — interview mode begins.
    return {
      messages: [
        prose(
          scan.scannedConnections === 0
            ? 'I looked around, but nothing is connected yet for me to read. No matter — I can learn the shape of your work the old way: by asking.'
            : 'I read everything I could reach and nothing jumped out — which is rare, honestly. Let me ask a few questions instead; five at most, I promise.',
        ),
        interviewQuestionCard('arrive'),
      ],
      expression: 'listening',
      adoptChips: [],
      interviewQuestionId: 'arrive',
      pendingDraft: null,
    };
  }

  const top = [...scan.findings]
    .sort(
      (a, b) =>
        (b.cost.dollarsPerMonth ?? 0) / 50 + (b.cost.hoursPerWeek ?? 0) -
        ((a.cost.dollarsPerMonth ?? 0) / 50 + (a.cost.hoursPerWeek ?? 0)),
    )
    .slice(0, 5);
  const recs = recommendationCards(scan.findings);

  return {
    messages: [
      prose(`Scan's done — I read across ${scan.scannedConnections} connected accounts. Here's what I found.`),
      ...top.map(findingCard),
      prose('Here’s who I’d bring in first. Each one drafts everything for your approval — nothing goes out without you.'),
      ...recs.messages,
    ],
    expression: 'presenting',
    adoptChips: recs.chips,
    interviewQuestionId: null,
    pendingDraft: null,
  };
}

/** One interview answer in; the next question (or the map + recs) out. */
export async function interviewStepAction(
  answersSoFar: InterviewAnswers,
  questionId: InterviewQuestionId,
  picked: string[],
): Promise<ScanTurnPayload & { answers: InterviewAnswers }> {
  const { user, accountId } = await appSession();

  const q = INTERVIEW_QUESTIONS.find((x) => x.id === questionId);
  if (!q) throw new Error('unknown interview question');
  const valid = new Set(q.chips.map((c) => c.id));
  const clean = picked.filter((p) => valid.has(p)).slice(0, q.chips.length);
  const answers: InterviewAnswers = { ...answersSoFar, [questionId]: clean };

  const order = INTERVIEW_QUESTIONS.map((x) => x.id);
  const nextId = order[order.indexOf(questionId) + 1];
  if (nextId) {
    return {
      messages: [interviewQuestionCard(nextId)],
      expression: 'listening',
      adoptChips: [],
      interviewQuestionId: nextId,
      pendingDraft: null,
      answers,
    };
  }

  // interview complete → manual workflow map + recommendations (§6.12)
  const result = interviewResult(answers);
  const svc = serviceClient();
  // persisted as a scan result so the map survives and incubation has context
  const { error } = await svc.from('scan_results').insert({
    account_id: accountId,
    connection_id: null,
    batch_id: crypto.randomUUID(),
    module: 'interview.manual-map',
    finding: { map: result.map, answers, by: user.id },
  });
  if (error) throw new Error(`interview map save failed: ${error.message}`);

  const mapCards = result.map.map((node) =>
    msg({
      kind: 'field_notes',
      title: node.label,
      detail: node.detail,
      transcript: `${node.label}: ${node.detail}`,
    }),
  );
  const chips = result.recommendations.map((r) => ({ templateKey: r.templateKey, label: `Adopt ${r.displayName}` }));

  return {
    messages: [
      prose('That’s plenty. Here’s the shape of your work as I understand it so far — we’ll sharpen it together.'),
      ...mapCards,
      prose('And here’s who I’d bring in first. Everything they do lands as a draft for your yes.'),
      ...result.recommendations.map((r) =>
        msg({
          kind: 'recommendation',
          title: `${r.displayName} could help here`,
          detail: r.reason,
          math: 'Based on what you just told me — the scan will firm up the numbers as accounts connect.',
          adoptLabel: `Adopt ${r.displayName}`,
          transcript: `Recommendation: ${r.displayName}. ${r.reason}`,
        }),
      ),
    ],
    expression: 'presenting',
    adoptChips: chips,
    interviewQuestionId: null,
    pendingDraft: null,
    answers,
  };
}

/** §4.1 step 6–7: one tap adopts; the new Nibbin hatches and drafts fast. */
export async function adoptFromGroveAction(templateKey: string): Promise<ScanTurnPayload> {
  const { user, accountId } = await appSession();

  let adoption;
  try {
    adoption = await adoptTemplate(accountId, user.id, templateKey);
  } catch (e) {
    if (e instanceof Error && e.message === 'nibbin_limit') {
      return {
        messages: [
          prose(
            'Your grove is at its limit for this plan — every spot is taken by someone already working. Growing the grove means moving up a plan; nothing here ever gets deleted to make room.',
          ),
        ],
        expression: 'concerned',
        adoptChips: [],
        interviewQuestionId: null,
        pendingDraft: null,
      };
    }
    throw e;
  }

  if (adoption.missingConnectors.length > 0) {
    const t = getTemplate(templateKey);
    return {
      messages: [
        prose(
          `${t.spec.displayName} works from ${adoption.missingConnectors.join(' and ')} — that's not connected yet. Connect it and I'll hatch ${t.spec.displayName} the moment it's ready.`,
        ),
      ],
      expression: 'concerned',
      adoptChips: [],
      interviewQuestionId: null,
      pendingDraft: null,
    };
  }

  const messages: KeeperMessage[] = [
    msg({
      kind: 'celebration',
      title: `${adoption.name} hatched!`,
      detail:
        adoption.stage === 'student'
          ? `${adoption.name} read the scan and went straight to work — Student stage, so everything lands as a draft for your approval.`
          : `${adoption.name} is settling in as an Egg, watching how your grove works. A Student badge comes once there's context to learn from.`,
      transcript: `${adoption.name} hatched.`,
    }),
  ];

  let pendingDraft: PendingDraft | null = null;
  if (adoption.firstRun?.kind === 'awaiting_approval') {
    const d = adoption.firstRun.draft;
    pendingDraft = {
      runId: adoption.firstRun.runId,
      specialistName: adoption.name,
      title: d.title,
      draft: d.draft,
    };
    messages.push(
      msg({
        kind: 'draft_approval',
        specialistName: adoption.name,
        title: d.title,
        draft: d.draft,
        transcript: `${adoption.name} drafted: ${d.title}. ${d.draft}`,
      }),
    );
  } else if (adoption.firstRun?.kind === 'completed') {
    messages.push(prose(`${adoption.name} had a look around and found nothing urgent — a quiet start is a fine start.`));
  }

  return {
    messages,
    expression: 'delighted',
    adoptChips: [],
    interviewQuestionId: null,
    pendingDraft,
  };
}

/** The first approval — the Day-One “aha” (§4.1 step 7). */
export async function decideDraftAction(
  runId: string,
  decision: DraftDecision,
  editedText?: string,
): Promise<ScanTurnPayload> {
  const { supabase, user, accountId } = await appSession();

  // original draft text for the edit distance
  const svc = serviceClient();
  const { data: step } = await svc
    .from('run_steps')
    .select('payload')
    .eq('run_id', runId)
    .eq('kind', 'draft')
    .single();
  const original = ((step?.payload as Record<string, unknown> | null)?.draft as string) ?? '';
  const distance =
    decision === 'edited' && editedText !== undefined ? Math.max(1, editDistance(original, editedText)) : 0;

  const result = await decideDraft(supabase, accountId, user.id, runId, decision, distance);

  const messages: KeeperMessage[] = [];
  if (result.firstApproval) {
    messages.push(
      msg({
        kind: 'celebration',
        title: 'Your first approved draft!',
        detail:
          'That approval is how trust grows here: every yes (and every correction) is a training session. Keep approving good work and your Nibbins earn more rope — never the other way around.',
        transcript: 'Your first approved draft.',
      }),
    );
  } else if (decision === 'approved') {
    messages.push(prose('Approved and noted — that yes goes straight into the training record.'));
  } else if (decision === 'edited') {
    messages.push(prose('Got it — sent your version, and the correction is in the journal. That’s exactly how they learn.'));
  } else {
    messages.push(prose('Back to drafts — good instinct. Nothing went anywhere, and the no is part of the training too.'));
  }

  if (result.promotedTo) {
    messages.push(
      msg({
        kind: 'celebration',
        title: 'A graduation in the grove!',
        detail: `Verified accuracy over the last 25 reviews crossed the bar — earned, not given.`,
        transcript: 'Stage promotion earned through verified accuracy.',
      }),
    );
  }

  return {
    messages,
    expression: result.firstApproval || result.promotedTo ? 'delighted' : 'idle',
    adoptChips: [],
    interviewQuestionId: null,
    pendingDraft: null,
  };
}
