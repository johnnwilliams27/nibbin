/**
 * Unit tests for the `knowledge_lookup` classifier signal (P5 Task 5b).
 *
 * The signal is added to `classifyComplexity` in packages/router/src/classifier.ts.
 * It fires when the message text matches retrieval-shaped question markers,
 * WITHOUT adding a separate model call.  The signal is then surfaced on
 * `RouteDecision.classification.signals` so the `keeperChatAction` in T7 can
 * gate the synthesis path without re-classifying.
 *
 * Invariants tested:
 *  - Known knowledge-lookup phrasings emit 'knowledge_lookup'.
 *  - Unrelated messages do NOT emit 'knowledge_lookup'.
 *  - The signal co-exists with other signals (e.g. 'drafting') on the same call.
 *  - The signal does not change the tier — a short lookup stays T0.
 */
import { describe, it, expect } from 'vitest';
import { classifyComplexity } from '../src/classifier';

describe('classifyComplexity — knowledge_lookup signal (P5 §5b)', () => {
  // -------------------------------------------------------------------------
  // Positive cases — should emit 'knowledge_lookup'
  // -------------------------------------------------------------------------

  it('emits knowledge_lookup for "what do I charge for portraits"', () => {
    const result = classifyComplexity('what do I charge for portraits');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('emits knowledge_lookup for "what is my policy on deposits"', () => {
    const result = classifyComplexity('what is my policy on deposits');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it("emits knowledge_lookup for \"what's my rate for weddings\"", () => {
    const result = classifyComplexity("what's my rate for weddings");
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('emits knowledge_lookup for "do I have any notes about Acme"', () => {
    const result = classifyComplexity('do I have any notes about Acme');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('emits knowledge_lookup for "what is in my notes on pricing"', () => {
    const result = classifyComplexity('what is in my notes on pricing');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it("emits knowledge_lookup for \"what's in my memory about client onboarding\"", () => {
    const result = classifyComplexity("what's in my memory about client onboarding");
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('emits knowledge_lookup for "what have I noted about cancellations"', () => {
    const result = classifyComplexity('what have I noted about cancellations');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('emits knowledge_lookup for "tell me about my pricing"', () => {
    const result = classifyComplexity('tell me about my pricing');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('emits knowledge_lookup for "what do you know about my deposit policy"', () => {
    const result = classifyComplexity('what do you know about my deposit policy');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('emits knowledge_lookup for "what do I know about late payments"', () => {
    const result = classifyComplexity('what do I know about late payments');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('is case-insensitive — "What Do I Charge" matches', () => {
    const result = classifyComplexity('What Do I Charge for weekend sessions?');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('emits knowledge_lookup for "my rates for corporate events"', () => {
    const result = classifyComplexity('my rates for corporate events');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('emits knowledge_lookup for "my pricing for packages"', () => {
    const result = classifyComplexity('my pricing for packages');
    expect(result.signals).toContain('knowledge_lookup');
  });

  // -------------------------------------------------------------------------
  // Negative cases — must NOT emit 'knowledge_lookup'
  // -------------------------------------------------------------------------

  it('does NOT emit knowledge_lookup for "hey what time is it"', () => {
    const result = classifyComplexity('hey what time is it');
    expect(result.signals).not.toContain('knowledge_lookup');
  });

  it('does NOT emit knowledge_lookup for "hi there"', () => {
    const result = classifyComplexity('hi there');
    expect(result.signals).not.toContain('knowledge_lookup');
  });

  it('does NOT emit knowledge_lookup for "draft a reply to the Acme inquiry"', () => {
    const result = classifyComplexity('draft a reply to the Acme inquiry');
    expect(result.signals).not.toContain('knowledge_lookup');
  });

  it('does NOT emit knowledge_lookup for "plan a marketing campaign"', () => {
    const result = classifyComplexity('plan a marketing campaign');
    expect(result.signals).not.toContain('knowledge_lookup');
  });

  it('does NOT emit knowledge_lookup for an empty string', () => {
    const result = classifyComplexity('');
    expect(result.signals).not.toContain('knowledge_lookup');
  });

  // -------------------------------------------------------------------------
  // Co-existence with other signals
  // -------------------------------------------------------------------------

  it('emits knowledge_lookup alongside drafting when both markers are present', () => {
    // "summarise" → drafting signal from DRAFT_WORK; "what do I charge" → knowledge_lookup.
    // The two signals are independent and both must fire on the same Classification.
    const result = classifyComplexity(
      'can you summarise what do I charge for weddings — write it in plain prose',
    );
    expect(result.signals).toContain('drafting');
    expect(result.signals).toContain('knowledge_lookup');
  });

  // -------------------------------------------------------------------------
  // Tier invariant — knowledge_lookup does not elevate the tier on its own
  // -------------------------------------------------------------------------

  it('a short knowledge-lookup question stays T0 (lookup does not add score)', () => {
    const result = classifyComplexity('what do I charge for portraits');
    // Short text: no length bonus, no planning/drafting bonus → stays T0.
    expect(result.tier).toBe('t0');
    expect(result.signals).toContain('knowledge_lookup');
  });

  it('knowledge_lookup signal is present on the returned Classification object', () => {
    const result = classifyComplexity('what is my policy on late payments');
    // Verify the shape: signals is an array that contains the string.
    expect(Array.isArray(result.signals)).toBe(true);
    expect(result.signals).toContain('knowledge_lookup');
  });
});
