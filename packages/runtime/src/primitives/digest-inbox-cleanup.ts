/**
 * `digest.inbox-cleanup` — the SUMMARIZE/DIGEST PRIMITIVE (design §2.1),
 * lifted from the `sweep` template. The template program (apps/web programs.ts)
 * delegates to THIS exact implementation, so the primitive and `sweep` stay
 * byte-for-byte identical (parity test) when `topSenders` is at its default
 * (5 = sweep's top-N).
 *
 * Shape: `email.read` (mailbox sweep) → group newsletter-ish inbox messages
 * (those carrying a `List-Unsubscribe` header) by sender → present a top-N
 * "keep or clear" digest. This is PRESENTATION ONLY: the yielded draft is a
 * READ capability (`email.read`) with `presentation: true`, so the runner gates
 * it as a draft ALWAYS and never executes a side effect (no message is ever
 * sent or deleted).
 *
 * SAFETY (load-bearing): the Composer never emits the read paths or effectArgs —
 * it picks this primitive's id + the schema-validated `topSenders` scalar. The
 * read paths, the unsubscribe filter, the per-sender count, and the digest body
 * are built by THIS trusted code. The polite pause throws INSIDE the generator
 * (Slice-2a P1), never at factory-build time.
 */
import type { ProgramFn } from '../runner';
import type { ProgramStep } from '../types';
import { header, readMailbox } from './shared';

type ConnectionMap = Record<string, string | undefined>;

export interface DigestInboxCleanupInputs {
  /** Show the top-N noisiest senders. Default 5 (sweep's top-N). */
  topSenders?: number;
}

/**
 * The parameterized sweep program: the trusted implementation of the
 * `digest.inbox-cleanup` primitive. `sweepProgram` (apps/web) delegates here.
 * Presentation only — reads the mailbox, presents a keep-or-clear digest.
 */
export function digestInboxCleanup(
  inputs: DigestInboxCleanupInputs,
  connMap: ConnectionMap,
  nowMs: number,
): ProgramFn {
  const topSenders = inputs.topSenders ?? 5;
  return async function* () {
    const gmail = connMap.gmail;
    if (!gmail) throw new Error('no active gmail connection — pausing politely');
    const mail = yield* readMailbox(gmail, nowMs);
    const noise = mail.inbox.filter((m) => header(m, 'List-Unsubscribe'));
    const senders = new Map<string, number>();
    for (const m of noise) {
      const from = (header(m, 'From') ?? 'unknown').replace(/.*<|>.*/g, '');
      senders.set(from, (senders.get(from) ?? 0) + 1);
    }
    const top = [...senders.entries()].sort((a, b) => b[1] - a[1]).slice(0, topSenders);
    yield {
      kind: 'draft',
      capability: 'email.read',
      connectionId: gmail,
      patternKey: 'sweep:keep-or-clear',
      presentation: true,
      title: 'This morning’s sweep',
      draft:
        top.length === 0
          ? 'Your inbox floor is clean — no newsletter pile worth clearing today.'
          : `${noise.length} newsletter-ish messages are sitting in your inbox. The biggest piles:\n` +
            top.map(([s, n]) => `• ${s} — ${n} messages`).join('\n') +
            '\nSay the word and I’ll keep flagging these for a one-tap clear.',
      effectArgs: { senders: top.map(([s]) => s) },
    } satisfies ProgramStep;
  };
}
