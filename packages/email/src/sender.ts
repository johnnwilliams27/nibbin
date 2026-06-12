/**
 * The beat mailer: suppression check → warm-up cap → render → provider →
 * send log. Implements the drip worker's EmailPort. A withheld email is a
 * quiet success for the beat (the in-product leaf is the primary surface);
 * a provider error throws so the worker can mark the beat failed.
 *
 * Ordering matters (§6.8 + RISKS legal floor): suppression is checked on
 * EVERY send, immediately before dispatch — never cached across ticks — and
 * an unconfigured warm-up means nothing sends at all, because the ramp and
 * the bounce/complaint webhooks must exist before the first drip email.
 */
import type { BeatEmail, EmailPort } from '@nibbin/drip';
import { renderBeatEmail } from './render';
import { normalizeEmail } from './unsubscribe';
import { utcDay, warmupDailyCap } from './warmup';
import type { EmailProvider, MailerConfig, SendLog, SendOutcome, SuppressionStore, WithholdReason } from './types';

export interface MailerDeps {
  config: MailerConfig;
  suppressions: SuppressionStore;
  log: SendLog;
  provider: EmailProvider;
  clock?: () => Date;
  onWithheld?: (email: BeatEmail, reason: WithholdReason) => void;
}

export function createBeatMailer(deps: MailerDeps): EmailPort & { sendBeatDetailed(email: BeatEmail): Promise<SendOutcome> } {
  const clock = deps.clock ?? (() => new Date());

  async function sendBeatDetailed(email: BeatEmail): Promise<SendOutcome> {
    const withhold = (reason: WithholdReason): SendOutcome => {
      deps.onWithheld?.(email, reason);
      return { sent: false, withheld: reason };
    };

    const to = normalizeEmail(email.to);
    if (!to.includes('@')) return withhold('invalid_address');
    if (!deps.config.warmupStart) return withhold('warmup_unconfigured');
    if (await deps.suppressions.isSuppressed(to)) return withhold('suppressed');

    const now = clock();
    const cap = warmupDailyCap(deps.config.warmupStart, now, deps.config.warmupSchedule);
    const sentToday = await deps.log.countForUtcDay(utcDay(now));
    if (sentToday >= cap) return withhold('warmup_cap');

    const msg = renderBeatEmail(email.content, to, deps.config);
    const { id } = await deps.provider.send(msg);
    await deps.log.record({ to, beat: email.beat, providerId: id || null, accountId: email.accountId });
    return { sent: true };
  }

  return {
    sendBeatDetailed,
    sendBeat: async (email) => (await sendBeatDetailed(email)).sent,
  };
}
