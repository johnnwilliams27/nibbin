import { describe, it, expect } from 'vitest';
import type { SweepDerived } from './types';

import {
  buildSentQuery,
  buildInboxQuery,
  SWEEP_WINDOW_DAYS,
  MAX_SENT_MESSAGES,
  MAX_INBOX_THREADS,
  BATCH_SIZE_PASS1,
  BATCH_SIZE_PASS2,
  isNewsletter,
  writeSweepDerivedToMemory,
  mergeProfileChannelsAndTools,
} from './gmail-onboarding';

describe('buildSentQuery', () => {
  it('includes from:me and the after: cutoff and excludes spam/trash', () => {
    const q = buildSentQuery(new Date('2026-03-18'));
    expect(q).toContain('from:me');
    expect(q).toContain('after:2026/03/18');
    expect(q).toContain('-in:spam');
    expect(q).toContain('-in:trash');
  });
});

describe('buildInboxQuery', () => {
  it('filters to inbox and excludes noise categories', () => {
    const q = buildInboxQuery(new Date('2026-03-18'));
    expect(q).toContain('in:inbox');
    expect(q).toContain('-category:promotions');
    expect(q).toContain('-category:updates');
    expect(q).toContain('-category:social');
    expect(q).toContain('-in:spam');
    expect(q).toContain('-in:trash');
  });
});

describe('sweep constants', () => {
  it('SWEEP_WINDOW_DAYS is 90', () => expect(SWEEP_WINDOW_DAYS).toBe(90));
  it('MAX_SENT_MESSAGES is a positive number', () => expect(MAX_SENT_MESSAGES).toBeGreaterThan(0));
  it('MAX_INBOX_THREADS is a positive number', () => expect(MAX_INBOX_THREADS).toBeGreaterThan(0));
  it('BATCH_SIZE_PASS1 is a positive number', () => expect(BATCH_SIZE_PASS1).toBeGreaterThan(0));
  it('BATCH_SIZE_PASS2 is a positive number', () => expect(BATCH_SIZE_PASS2).toBeGreaterThan(0));
});

describe('isNewsletter', () => {
  it('returns true when List-Unsubscribe header is present', () => {
    const meta = { id: 'x', threadId: 'y', payload: { headers: [{ name: 'List-Unsubscribe', value: '<mailto:unsub@list.com>' }] } };
    expect(isNewsletter(meta)).toBe(true);
  });
  it('returns false for normal messages', () => {
    const meta = { id: 'x', threadId: 'y', payload: { headers: [{ name: 'From', value: 'client@example.com' }] } };
    expect(isNewsletter(meta)).toBe(false);
  });
  it('returns false when payload/headers absent', () => {
    expect(isNewsletter({ id: 'x', threadId: 'y' })).toBe(false);
  });
});

describe('writeSweepDerivedToMemory — section gating', () => {
  it('does not overwrite a non-empty existing voice section', () => {
    const existing = { voice: 'User-written voice.', faq: '', facts: '' };
    const derived: Partial<SweepDerived> = {
      voiceSamples: ['My sample.'],
      faqCandidates: ['Q → A'],
      inferredFacts: ['Fact 1'],
    };
    const result = writeSweepDerivedToMemory(existing, derived as SweepDerived);
    expect(result.voice).toBe('User-written voice.'); // untouched
    expect(result.faq).toBeTruthy();                  // was empty, now filled
    expect(result.facts).toBeTruthy();                // was empty, now filled
  });

  it('populates empty voice section from voiceSamples', () => {
    const existing = { voice: '', faq: '', facts: '' };
    const derived: Partial<SweepDerived> = {
      voiceSamples: ['Hey!', 'Let me know.'],
      faqCandidates: [],
      inferredFacts: [],
    };
    const result = writeSweepDerivedToMemory(existing, derived as SweepDerived);
    expect(result.voice).toContain('Hey!');
  });
});

describe('mergeProfileChannelsAndTools', () => {
  it('unions extraChannels into existing profile channels, deduped, capped at 12', () => {
    const existing = ['email', 'sms'];
    const extra = ['email', 'instagram', 'whatsapp'];
    const merged = mergeProfileChannelsAndTools(existing, extra);
    expect(merged.filter(c => c === 'email')).toHaveLength(1);
    expect(merged).toContain('instagram');
    expect(merged.length).toBeLessThanOrEqual(12);
  });
});
