import { describe, it, expect } from 'vitest';
import { parsePass1, parsePass2, mergeSweepDerived } from './derive';

// ── parsePass1 ──────────────────────────────────────────────────────────────

describe('parsePass1', () => {
  it('extracts voiceSamples, inferredFacts, extraChannels, extraTools from valid JSON', () => {
    const raw = JSON.stringify({
      voiceSamples: ['Hey! Quick question for you.', 'Let me know if that works.'],
      inferredFacts: ['Booking-based photography business', 'Primarily works weekends'],
      extraChannels: ['instagram'],
      extraTools: ['honeybook'],
    });
    const out = parsePass1(raw);
    expect(out.voiceSamples).toHaveLength(2);
    expect(out.inferredFacts).toHaveLength(2);
    expect(out.extraChannels).toEqual(['instagram']);
    expect(out.extraTools).toEqual(['honeybook']);
  });

  it('clamps voiceSamples to max 3, each ≤ 280 chars after sanitize', () => {
    const raw = JSON.stringify({
      voiceSamples: ['a', 'b', 'c', 'd', 'e'],
      inferredFacts: [],
      extraChannels: [],
      extraTools: [],
    });
    const out = parsePass1(raw);
    expect(out.voiceSamples).toHaveLength(3);
  });

  it('strips HTML and URLs from voiceSamples (sanitizeProse gate)', () => {
    const raw = JSON.stringify({
      voiceSamples: ['<b>Bold text</b> and https://evil.com/inject'],
      inferredFacts: [],
      extraChannels: [],
      extraTools: [],
    });
    const out = parsePass1(raw);
    expect(out.voiceSamples[0]).not.toMatch(/<|https?:\/\//);
  });

  it('returns empty arrays on a garbled model response', () => {
    const out = parsePass1('not json at all, sorry!');
    expect(out.voiceSamples).toEqual([]);
    expect(out.inferredFacts).toEqual([]);
    expect(out.extraChannels).toEqual([]);
    expect(out.extraTools).toEqual([]);
  });

  it('extracts JSON embedded in prose (model adds surrounding text)', () => {
    const inner = JSON.stringify({ voiceSamples: ['Sure!'], inferredFacts: [], extraChannels: [], extraTools: [] });
    const raw = `Here is my analysis:\n\n${inner}\n\nHope that helps.`;
    const out = parsePass1(raw);
    expect(out.voiceSamples).toEqual(['Sure!']);
  });
});

// ── parsePass2 ──────────────────────────────────────────────────────────────

describe('parsePass2', () => {
  it('extracts faqCandidates from valid JSON', () => {
    const raw = JSON.stringify({
      faqCandidates: [
        'How do I book a session? → Use the link in my bio.',
        'Do you travel? → Yes, within 50 miles.',
      ],
    });
    const out = parsePass2(raw);
    expect(out.faqCandidates).toHaveLength(2);
  });

  it('clamps faqCandidates to max 8, each ≤ 200 chars', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Q${i} → A${i}`);
    const raw = JSON.stringify({ faqCandidates: many });
    const out = parsePass2(raw);
    expect(out.faqCandidates).toHaveLength(8);
  });

  it('sanitizes each faqCandidate through sanitizeProse', () => {
    const raw = JSON.stringify({ faqCandidates: ['<script>evil</script> question → answer'] });
    const out = parsePass2(raw);
    expect(out.faqCandidates[0]).not.toContain('<script>');
  });

  it('returns empty array on parse failure', () => {
    expect(parsePass2('{bad json').faqCandidates).toEqual([]);
  });
});

// ── mergeSweepDerived ───────────────────────────────────────────────────────

describe('mergeSweepDerived', () => {
  it('merges two passes into a complete SweepDerived', () => {
    const p1 = { voiceSamples: ['Hey!'], inferredFacts: ['bookings'], extraChannels: ['email'], extraTools: [] };
    const p2 = { faqCandidates: ['Do you travel? → Yes.'] };
    const meta = { oldestMessageDate: '2026-03-18', messagesRead: 47, recurringContactCount: 12 };
    const out = mergeSweepDerived([p1, p2], meta);
    expect(out.voiceSamples).toEqual(['Hey!']);
    expect(out.faqCandidates).toEqual(['Do you travel? → Yes.']);
    expect(out.inferredFacts).toEqual(['bookings']);
    expect(out.messagesRead).toBe(47);
    expect(out.recurringContactCount).toBe(12);
    expect(out.oldestMessageDate).toBe('2026-03-18');
  });

  it('deduplicates extraChannels across passes', () => {
    const p1 = { extraChannels: ['email', 'instagram'], voiceSamples: [], inferredFacts: [], extraTools: [] };
    const p2 = { extraChannels: ['email', 'sms'], voiceSamples: [], inferredFacts: [], faqCandidates: [], extraTools: [] };
    const out = mergeSweepDerived([p1, p2], { oldestMessageDate: '2026-03-18', messagesRead: 0, recurringContactCount: 0 });
    expect(out.extraChannels.filter(c => c === 'email')).toHaveLength(1);
    expect(out.extraChannels).toContain('sms');
  });
});
