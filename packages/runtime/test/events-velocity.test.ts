/**
 * §6.12 event taxonomy + the atomic send-velocity limiter (RISKS §2).
 */
import { describe, expect, it } from 'vitest';
import { getConnector } from '@nibbin/connectors';
import {
  AtomicSendVelocityLimiter,
  isProductEventName,
  MemoryEventSink,
  PRODUCT_EVENT_NAMES,
} from '../src/index';

describe('§6.12 product event taxonomy', () => {
  it('contains the full instrumented-from-day-one set', () => {
    for (const name of [
      'account_created', 'connector_linked', 'scan_completed', 'scan_empty', 'nibbin_adopted',
      'first_draft_approved', 'run_approved', 'run_edited', 'run_rejected', 'stage_promoted',
      'stage_demoted', 'study_started', 'study_completed', 'study_aborted', 'diagnosis_viewed',
      'plan_upgraded', 'topup_purchased',
    ]) {
      expect(PRODUCT_EVENT_NAMES).toContain(name);
    }
  });

  it('accepts drip beats dynamically and rejects everything else', () => {
    expect(isProductEventName('drip_half_time_sent')).toBe(true);
    expect(isProductEventName('drip_day7_opened')).toBe(true);
    expect(isProductEventName('drip_whatever')).toBe(false);
    expect(isProductEventName('made_up_event')).toBe(false);
  });

  it('the memory sink refuses unknown names (catches taxonomy drift in tests)', async () => {
    const sink = new MemoryEventSink();
    await expect(sink.emit({ name: 'nope' as never })).rejects.toThrow(/unknown product event/);
    await sink.emit({ name: 'scan_completed', accountId: 'a' });
    expect(sink.events).toHaveLength(1);
  });
});

describe('AtomicSendVelocityLimiter (RISKS §2)', () => {
  const gmail = getConnector('gmail');

  it('routes the check through the atomic consume fn and allows under cap', async () => {
    const calls: Array<{ hourCap: number; dayCap: number }> = [];
    const limiter = new AtomicSendVelocityLimiter(async (req) => {
      calls.push({ hourCap: req.hourCap, dayCap: req.dayCap });
      return { allowed: true, reason: null, retryAfterMs: 0 };
    });
    const old = Date.now() - 30 * 86_400_000; // mature account
    const decision = await limiter.checkAndConsume('acct', gmail, old);
    expect(decision).toEqual({ allowed: true });
    expect(calls[0]).toEqual({
      hourCap: gmail.send!.velocity.perAccountPerHour,
      dayCap: gmail.send!.velocity.perAccountPerDay,
    });
  });

  it('new accounts get the stricter daily budget', async () => {
    let seenDayCap = 0;
    const limiter = new AtomicSendVelocityLimiter(async (req) => {
      seenDayCap = req.dayCap;
      return { allowed: false, reason: 'daily-cap', retryAfterMs: 1000 };
    });
    const decision = await limiter.checkAndConsume('acct', gmail, Date.now()); // brand new
    expect(seenDayCap).toBe(gmail.send!.velocity.newAccountPerDay);
    expect(decision).toMatchObject({ allowed: false, reason: 'new-account-cap' });
  });

  it('a connector without declared caps may never send', async () => {
    const limiter = new AtomicSendVelocityLimiter(async () => {
      throw new Error('must not be called');
    });
    const noSend = getConnector('pixieset'); // read-only connector
    const decision = await limiter.checkAndConsume('acct', noSend, 0);
    expect(decision.allowed).toBe(false);
  });
});
