/**
 * Email pipeline types. Everything effectful (suppression store, send log,
 * the provider HTTP call) is a port; render + policy are pure.
 */
import type { BeatKey } from '@nibbin/drip';

export type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint' | 'manual';

export interface SuppressionStore {
  isSuppressed(email: string): Promise<boolean>;
  /** Idempotent — re-suppressing the same address is a no-op, never an error. */
  add(email: string, reason: SuppressionReason): Promise<void>;
}

export interface SendLog {
  /** Sends recorded for the given UTC day — feeds the warm-up cap. */
  countForUtcDay(utcDay: string): Promise<number>;
  record(entry: { to: string; beat: BeatKey; providerId: string | null; accountId: string }): Promise<void>;
}

export interface OutboundEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export interface EmailProvider {
  send(msg: OutboundEmail): Promise<{ id: string }>;
}

export interface MailerConfig {
  /** e.g. "Nibbin <keeper@mail.nibbin.com>" — always the mail. subdomain,
   * never the root domain (§6.8 reputation isolation). */
  from: string;
  /** Product origin for CTAs + unsubscribe links, e.g. https://nibbin.com */
  siteUrl: string;
  /** CAN-SPAM requires a valid physical postal address in every message. */
  postalAddress: string;
  /** Secret for HMAC unsubscribe tokens. */
  unsubscribeSecret: string;
  /** Warm-up: when mail.nibbin.com started ramping, or null = ramp not
   * configured, in which case NOTHING sends (warm-up precedes first send). */
  warmupStart: Date | null;
  /** Daily send caps per warm-up week; after the last entry the cap lifts. */
  warmupSchedule?: readonly number[];
}

export type WithholdReason = 'suppressed' | 'warmup_cap' | 'warmup_unconfigured' | 'invalid_address';

export interface SendOutcome {
  sent: boolean;
  withheld?: WithholdReason;
}
