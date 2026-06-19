/**
 * Deterministic mock model for `--mock` mode — returns canned, schema-valid
 * outputs per task with a fixed token usage so the runner produces stable
 * results with NO network and NO spend. Implements the package's `Generate`
 * surface, so it slots in exactly where the real Anthropic client would.
 *
 * The canned outputs are intentionally VALID for each task's rubric so a mock
 * run exercises the full pipeline (build prompt → "call" model → judge →
 * aggregate → clearance) end-to-end. Token usage is fixed so the cost-delta
 * column is deterministic and reflects the model's pricing tier.
 */
import type { Generate, GenerateRequest, GenerateResult } from '../src/anthropic';

/** Canned, schema-valid output keyed by a signature of the system prompt. */
function cannedOutput(req: GenerateRequest): string {
  const sys = req.system.map((b) => b.text).join('\n');
  if (sys.includes('You are the Composer for Nibbin')) {
    return '{"displayName":"Morning ops","steps":[{"capability":"digest.morning","inputs":{}}],"personaPolicy":{"tone":"warm, plainspoken"}}';
  }
  if (sys.includes('You are the Planner for Nibbin')) {
    return '{"goal":"Draft follow-ups for quiet threads","intendedSteps":["Search recent inbox threads","Identify ones with no reply","Draft a gentle follow-up for each","done"],"toolsAllowlist":["email.search","email.draft","done"],"requiredConnectors":["gmail"]}';
  }
  if (sys.includes('You label clusters of observed work')) {
    return '{"label":"Chasing quiet email threads","category":"email"}';
  }
  if (sys.includes('You are a Nibbin drafting a short message')) {
    return "Hi — just circling back on the quote I sent over. No rush at all, but I wanted to check whether you had any questions or wanted me to walk through anything. Happy to help however is easiest for you.";
  }
  // ── scan_synthesis: ≤2 warm, standard-capitalization sentences ──────────────
  if (sys.includes('summarizing what a read-only scan')) {
    return 'It looks like most of your week goes to chasing email threads that went quiet, often late in the evening. The other steady pull is nudging invoices that slip past due.';
  }
  // ── onboarding_understanding: {extraction, nextQuestion, confidence} ────────
  if (sys.includes('getting to know a self-employed person')) {
    return '{"extraction":{"businessModel":"bookings","channels":["email"]},"nextQuestion":{"prompt":"What kind of work do most of your bookings involve?","placeholder":"e.g. portrait sessions"},"confidence":0.4}';
  }
  // ── training_feedback: {lesson, scope} ───────────────────────────────────────
  if (sys.includes('learn from how a self-employed person corrects')) {
    return '{"lesson":"Prefer a warmer, less formal opening line.","scope":"tone"}';
  }
  // ── sweep_pass1: {voiceSamples, inferredFacts, extraChannels, extraTools} ────
  if (sys.includes('batches of sent email bodies')) {
    return '{"voiceSamples":["Just wanted to circle back — no rush, let me know your thoughts."],"inferredFacts":["Sends invoices and follow-ups to clients"],"extraChannels":["text"],"extraTools":["stripe"]}';
  }
  // ── sweep_pass2: {faqCandidates} ─────────────────────────────────────────────
  if (sys.includes('thread subjects and first lines')) {
    return '{"faqCandidates":["How much do you charge? → Rates depend on the package","Are you available? → Some openings most weeks"]}';
  }
  // ── memory_extract: array of {scope, kind, text, provenance, confidence} ─────
  if (sys.includes('maintain the long-term memory of a small AI helper')) {
    return '[{"scope":"user","kind":"preference","text":"Prefers warm, plainspoken follow-ups","provenance":"observed","confidence":0.7}]';
  }
  // ── diagnosis_synthesis (splurge): warm plain-prose, no markdown headers ─────
  if (sys.includes('writing the heart of a Nibbin diagnosis')) {
    return 'Your week is mostly client communication, and a good chunk of it is the same gentle follow-up sent again and again. Where the hours really leak is chasing threads that went quiet — it adds up fast. That pattern repeats enough to hand off, so the first thing to give a Nibbin is your follow-up emails: high volume, low risk, and easy for you to glance at before anything goes out.';
  }
  // ── nibbin_note (splurge): {note} — one warm sentence ────────────────────────
  if (sys.includes('keeper of a small grove of AI helpers')) {
    return '{"note":"It has learned that you like your follow-ups warm and short, and you approve most of its drafts almost untouched now."}';
  }
  return 'OK';
}

/** Fixed per-model token usage so cost deltas are deterministic in mock mode. */
const FIXED_USAGE = {
  inputTokens: 1200,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 180,
};

export function createMockGenerate(): Generate {
  return async (req: GenerateRequest): Promise<GenerateResult> => ({
    text: cannedOutput(req),
    usage: { ...FIXED_USAGE },
    stopReason: 'end_turn',
    model: req.model,
  });
}
