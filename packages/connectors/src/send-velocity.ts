/**
 * Per-account send-velocity caps (SPEC §6.9; docs/RISKS.md §2): outbound-send
 * abuse is an OAuth-app killer — a spammer sending through their own Gmail
 * gets *our* app flagged platform-wide. Every send-capable capability checks
 * here before emitting, regardless of Agent School stage or who asked.
 *
 * Caps come from the connector's registry descriptor. New accounts get the
 * stricter new-account budget until the cooldown elapses.
 */
import type { ConnectorDescriptor, SendVelocityCaps } from './registry/types';

export interface SendRecordStore {
  /** Timestamps (ms) of sends for this account+provider since `sinceMs`. */
  recentSends(accountId: string, provider: string, sinceMs: number): Promise<number[]>;
  recordSend(accountId: string, provider: string, atMs: number): Promise<void>;
}

/**
 * ATOMICITY CONTRACT (read before implementing a production store):
 * `SendVelocityLimiter.checkAndConsume` reads the window then records — two
 * statements. Under concurrency that is a TOCTOU: two simultaneous sends can
 * both pass the read and both record, blowing past the cap that RISKS §2
 * calls the OAuth-app killer. `MemorySendRecordStore` is single-threaded and
 * safe for tests, but any real (DB-backed) `SendRecordStore` MUST serialize
 * check-and-record — e.g. an `insert ... where (count in window) < cap`
 * returning whether the row landed, or a `select ... for update` around both
 * steps. The M4 runtime is responsible for wiring such a store; do not ship
 * the read-then-write pair against a concurrent backend.
 */

export class MemorySendRecordStore implements SendRecordStore {
  private sends = new Map<string, number[]>();

  async recentSends(accountId: string, provider: string, sinceMs: number): Promise<number[]> {
    return (this.sends.get(`${accountId}:${provider}`) ?? []).filter((t) => t >= sinceMs);
  }

  async recordSend(accountId: string, provider: string, atMs: number): Promise<void> {
    const key = `${accountId}:${provider}`;
    const list = this.sends.get(key) ?? [];
    list.push(atMs);
    this.sends.set(key, list);
  }
}

export type SendDecision =
  | { allowed: true }
  | { allowed: false; reason: 'hourly-cap' | 'daily-cap' | 'new-account-cap'; retryAfterMs: number };

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export class SendVelocityLimiter {
  constructor(
    private readonly store: SendRecordStore,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Check the caps and, if allowed, record the send atomically from the
   * caller's perspective. `accountCreatedAtMs` drives the new-account budget.
   */
  async checkAndConsume(
    accountId: string,
    descriptor: ConnectorDescriptor,
    accountCreatedAtMs: number,
  ): Promise<SendDecision> {
    const caps = descriptor.send?.velocity;
    if (!caps) {
      // a connector without declared caps must never send at all
      return { allowed: false, reason: 'daily-cap', retryAfterMs: DAY_MS };
    }
    const at = this.now();
    const day = await this.store.recentSends(accountId, descriptor.id, at - DAY_MS);
    const hour = day.filter((t) => t >= at - HOUR_MS);

    const isNewAccount = at - accountCreatedAtMs < caps.newAccountCooldownHours * HOUR_MS;
    const dailyBudget = isNewAccount ? Math.min(caps.newAccountPerDay, caps.perAccountPerDay) : caps.perAccountPerDay;

    if (day.length >= dailyBudget) {
      const oldest = Math.min(...day);
      const windowExpiry = oldest + DAY_MS - at;
      // For new accounts, also respect the cooldown window: the budget may
      // refill before the cooldown expires, so retry must wait for both.
      const cooldownExpiry = isNewAccount
        ? accountCreatedAtMs + caps.newAccountCooldownHours * HOUR_MS - at
        : windowExpiry;
      return {
        allowed: false,
        reason: isNewAccount && dailyBudget < caps.perAccountPerDay ? 'new-account-cap' : 'daily-cap',
        retryAfterMs: Math.max(0, windowExpiry, cooldownExpiry),
      };
    }
    if (hour.length >= caps.perAccountPerHour) {
      const oldest = Math.min(...hour);
      return { allowed: false, reason: 'hourly-cap', retryAfterMs: Math.max(0, oldest + HOUR_MS - at) };
    }
    await this.store.recordSend(accountId, descriptor.id, at);
    return { allowed: true };
  }
}

export type { SendVelocityCaps };
