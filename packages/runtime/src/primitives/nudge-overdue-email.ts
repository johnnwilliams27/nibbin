/**
 * `nudge.overdue-email` — the detect-and-nudge PRIMITIVE (design §1/§2.1).
 *
 * This is the SAME read→detect→draft logic the `echo` template runs, lifted
 * into runtime as a parameterized `ProgramFn` factory so the Composer can
 * compose it by id + typed params. The template program (apps/web
 * programs.ts) delegates to these exact internals, so the primitive and the
 * template stay byte-for-byte identical (parity test).
 *
 * SAFETY (load-bearing): the Composer never emits `inputs.path` or
 * `effectArgs` — it picks this primitive's id + schema-validated scalar params
 * (`staleDays`). The read paths, the overdue detection, the recipient/subject
 * args, and the prompt are all built by THIS trusted code (helpers in
 * `./shared`). The interpreter still only *yields* the steps; the runner gates
 * every one.
 *
 * It yields exactly what echoProgram yields: the mailbox sweep reads, then
 * either a no-op compose ("nothing to draft") or a compose→draft handoff with
 * the model prompt + sanitized effectArgs.
 */
import type { ProgramFn } from '../runner';
import type { ProgramStep } from '../types';
import {
  DAY,
  header,
  modelDraftOr,
  overdueInbound,
  readMailbox,
  safeAddress,
  safeHeaderValue,
} from './shared';

type ConnectionMap = Record<string, string | undefined>;

export interface NudgeOverdueEmailInputs {
  /** Threads older than this many days are overdue. Default 3 (echo's floor). */
  staleDays?: number;
  /** Routine-matching identity for the draft. Default echo's key for parity. */
  patternKey?: string;
}

/**
 * The parameterized echo program: the trusted implementation of the
 * `nudge.overdue-email` primitive. `echoProgram` (apps/web) delegates here.
 */
export function nudgeOverdueEmail(
  inputs: NudgeOverdueEmailInputs,
  connMap: ConnectionMap,
  nowMs: number,
): ProgramFn {
  const staleDays = inputs.staleDays ?? 3;
  const patternKey = inputs.patternKey ?? 'email.send:overdue-followup';
  return async function* () {
    const gmail = connMap.gmail;
    if (!gmail) throw new Error('no active gmail connection — pausing politely');
    const mail = yield* readMailbox(gmail, nowMs);
    const overdue = overdueInbound(mail, nowMs, staleDays);
    if (overdue.length === 0) {
      yield { kind: 'compose', payload: { note: 'no overdue threads — nothing to draft' } };
      return;
    }
    const oldest = overdue[0];
    const from = safeHeaderValue(header(oldest, 'From')) || 'them';
    const subject = safeHeaderValue(header(oldest, 'Subject')) || 'your last message';
    const waitedDays = Math.round((nowMs - Number(oldest.internalDate ?? nowMs)) / DAY);
    const fallback =
      `Hi — thanks for your patience, and sorry for the slow reply. ` +
      `I wanted to pick this back up: happy to answer anything still open on “${subject}”. ` +
      `If the timing moved on, no trouble at all — just let me know either way.`;
    // M6.5: ask the runner for a model draft (T1). Context is the same
    // sanitized metadata the template uses — never raw message bodies.
    const fed = yield {
      kind: 'compose',
      payload: { note: 'drafting overdue follow-up' },
      prompt: {
        intent:
          'Draft a short, warm follow-up email body for a conversation the sender let go quiet. ' +
          'Apologize briefly for the slow reply without groveling, reopen the thread, and make ' +
          'responding easy. Under 90 words. Output only the email body text.',
        context: `Subject: ${subject}\nWaiting: ${waitedDays} days\nRecipient (from header): ${from}`,
        maxTokens: 300,
      },
    };
    yield {
      kind: 'draft',
      capability: 'email.send',
      connectionId: gmail,
      patternKey,
      title: `Follow-up on “${subject}” (waiting ${waitedDays} days)`,
      draft: modelDraftOr(fallback, fed),
      effectArgs: { threadId: oldest.threadId, to: safeAddress(from), subject: `Re: ${subject}` },
    } satisfies ProgramStep;
  };
}
