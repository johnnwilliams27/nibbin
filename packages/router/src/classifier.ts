import type { Classification, Tier } from './types';

/**
 * T0 complexity classifier (§6.3): scores every Grovekeeper chat request and
 * picks the tier. v0 is deterministic and local — the cheapest possible T0,
 * zero tokens, same interface a model-backed classifier slots into later.
 * Grovekeeper chat is free/near-free by construction: T0 default, T1 only on
 * classified need, T2 only for genuinely complex multi-step plans.
 */

const SMALLTALK = /^(hi|hiya|hey|hello|howdy|yo|thanks?|thank you|ok(ay)?|cool|nice|good (morning|afternoon|evening)|night|bye|goodbye|see you|hello there|how are you|what'?s up)\b/i;

/** Drafting/synthesis verbs — work a specialist would draft at T1. */
const DRAFT_WORK = /\b(draft|write|rewrite|reword|compose|summari[sz]e|synthesi[sz]e|compare|translate|outline|explain why|analy[sz]e|review)\b/i;

/** Genuinely complex multi-step planning — the only chat road to T2. */
const PLANNING = /\b(plan|strategy|strategi[sz]e|roadmap|architect|design a|restructure|reorgani[sz]e|migrate|overhaul|end[- ]to[- ]end|step[- ]by[- ]step|workflow)\b/i;

const MULTI_STEP = /\b(then|after that|next,|first\b[\s\S]*\bsecond|finally|followed by)\b/i;
const ENUMERATION = /(^|\n)\s*(\d+[.)]|[-*•])\s+\S+[\s\S]*(\n)\s*(\d+[.)]|[-*•])\s+/;

export function classifyComplexity(text: string): Classification {
  const trimmed = text.trim();
  const signals: string[] = [];
  let score = 0;

  if (trimmed.length === 0 || SMALLTALK.test(trimmed)) {
    if (trimmed.length > 0) signals.push('smalltalk');
    return { tier: 't0', score: 0, signals };
  }

  // Length: long requests tend to carry real work.
  if (trimmed.length > 700) {
    score += 0.3;
    signals.push('long-form');
  } else if (trimmed.length > 240) {
    score += 0.15;
    signals.push('mid-length');
  }

  const sentences = trimmed.split(/[.!?]+\s/).filter((s) => s.trim().length > 0).length;
  if (sentences >= 4) {
    score += 0.1;
    signals.push('multi-sentence');
  }

  if (DRAFT_WORK.test(trimmed)) {
    score += 0.35;
    signals.push('drafting');
  }
  if (PLANNING.test(trimmed)) {
    score += 0.3;
    signals.push('planning');
  }
  if (MULTI_STEP.test(trimmed)) {
    score += 0.2;
    signals.push('multi-step');
  }
  if (ENUMERATION.test(trimmed)) {
    score += 0.2;
    signals.push('enumerated-steps');
  }

  score = Math.min(1, score);

  // T0 default; T1 on classified need; T2 only for genuinely complex
  // multi-step plans (and the budget still gates it from chat).
  let tier: Tier = 't0';
  if (score >= 0.7) tier = 't2';
  else if (score >= 0.35) tier = 't1';

  return { tier, score, signals };
}
