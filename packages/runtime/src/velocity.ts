/**
 * Atomic send-velocity limiter — the DB-backed store the connectors package
 * contract demands of M4 (send-velocity.ts ATOMICITY CONTRACT): the
 * read-then-write pair must not run against a concurrent backend.
 *
 * This subclass keeps the SendVelocityLimiter shape every hand-built client
 * accepts, but routes checkAndConsume through one serialized statement (the
 * send_velocity_consume RPC: per account+provider advisory lock, window
 * counts, insert-if-allowed — all in one transaction).
 */
import {
  MemorySendRecordStore,
  SendVelocityLimiter,
  type ConnectorDescriptor,
  type SendDecision,
} from '@nibbin/connectors';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface VelocityConsumeFn {
  (req: { accountId: string; provider: string; hourCap: number; dayCap: number }): Promise<{
    allowed: boolean;
    reason: string | null;
    retryAfterMs: number;
  }>;
}

export class AtomicSendVelocityLimiter extends SendVelocityLimiter {
  constructor(
    private readonly consume: VelocityConsumeFn,
    private readonly clock: () => number = Date.now,
  ) {
    // the parent's store is never consulted — checkAndConsume is fully overridden
    super(new MemorySendRecordStore(), clock);
  }

  override async checkAndConsume(
    accountId: string,
    descriptor: ConnectorDescriptor,
    accountCreatedAtMs: number,
  ): Promise<SendDecision> {
    const caps = descriptor.send?.velocity;
    if (!caps) {
      // a connector without declared caps must never send at all
      return { allowed: false, reason: 'daily-cap', retryAfterMs: DAY_MS };
    }
    // new-account budget math stays here (it needs account age); the window
    // counting + record is one atomic statement in the database
    const isNewAccount = this.clock() - accountCreatedAtMs < caps.newAccountCooldownHours * HOUR_MS;
    const dayCap = isNewAccount ? Math.min(caps.newAccountPerDay, caps.perAccountPerDay) : caps.perAccountPerDay;

    const res = await this.consume({
      accountId,
      provider: descriptor.id,
      hourCap: caps.perAccountPerHour,
      dayCap,
    });
    if (res.allowed) return { allowed: true };
    const reason =
      res.reason === 'hourly-cap'
        ? 'hourly-cap'
        : isNewAccount && dayCap < caps.perAccountPerDay
          ? 'new-account-cap'
          : 'daily-cap';
    return { allowed: false, reason, retryAfterMs: res.retryAfterMs };
  }
}
