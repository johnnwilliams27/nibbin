/**
 * `reply.new-inquiry` — a detect-and-nudge PRIMITIVE (design §2.3), lifted from
 * the `scribe` template. The template program (apps/web programs.ts) delegates
 * to THIS exact implementation, so the primitive and `scribe` stay byte-for-byte
 * identical (parity test). No scalar knob — first-contact detection isn't
 * day-parameterized, so the inputSchema is empty (valid + already supported).
 *
 * Shape: `email.read` (gmail) → detect a NEW unanswered first-contact inquiry
 * (no In-Reply-To, not bulk, no sent reply on the thread), newest first → draft
 * a warm first reply (model draft, deterministic fallback) via `email.send`.
 *
 * SAFETY (load-bearing): the Composer never emits the read path or effectArgs —
 * it picks this primitive's id (no params). The mailbox sweep, the first-inquiry
 * filter, the inquiry-reply prompt, and the `{threadId, subject:'Re: …'}` args
 * are built by THIS trusted code. The polite pause throws INSIDE the generator
 * (Slice-2a P1), never at factory-build time.
 */
import type { ProgramFn } from '../runner';
import type { ProgramStep } from '../types';
import { header, modelDraftOr, readMailbox, safeHeaderValue } from './shared';

type ConnectionMap = Record<string, string | undefined>;

export type ReplyNewInquiryInputs = Record<string, never>;

/**
 * The trusted implementation of the `reply.new-inquiry` primitive.
 * `scribeProgram` (apps/web) delegates here.
 */
export function replyNewInquiry(
  _inputs: ReplyNewInquiryInputs,
  connMap: ConnectionMap,
  nowMs: number,
): ProgramFn {
  return async function* () {
    const gmail = connMap.gmail;
    if (!gmail) throw new Error('no active gmail connection — pausing politely');
    const mail = yield* readMailbox(gmail, nowMs);
    const answered = new Set(mail.sent.map((m) => m.threadId));
    const inquiries = mail.inbox
      .filter((m) => !header(m, 'In-Reply-To') && !header(m, 'List-Unsubscribe') && !answered.has(m.threadId))
      .sort((a, b) => Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0));
    if (inquiries.length === 0) {
      yield { kind: 'compose', payload: { note: 'no unanswered inquiries' } };
      return;
    }
    const newest = inquiries[0];
    const subject = safeHeaderValue(header(newest, 'Subject')) || 'your note';
    const fallback =
      `Hi, and thanks so much for reaching out — I’d love to help. ` +
      `Could you share the date you have in mind and a little about what you’re planning? ` +
      `I’ll send over availability and a clear picture of how I work and what it costs. ` +
      `Looking forward to it.`;
    const fed = yield {
      kind: 'compose',
      payload: { note: 'drafting inquiry reply' },
      prompt: {
        intent:
          'Draft a short, warm first reply to a new business inquiry. Thank them for reaching ' +
          'out, ask for the date and a little about what they are planning, and say a clear ' +
          'picture of availability and pricing will follow. Under 90 words. Output only the ' +
          'email body text.',
        context: `Subject: ${subject}`,
        maxTokens: 300,
      },
    };
    yield {
      kind: 'draft',
      capability: 'email.send',
      connectionId: gmail,
      patternKey: 'email.send:inquiry-reply',
      title: `Reply to “${subject}”`,
      draft: modelDraftOr(fallback, fed),
      effectArgs: { threadId: newest.threadId, subject: `Re: ${subject}` },
    } satisfies ProgramStep;
  };
}
